import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';
import { CHAT_EVENTS } from '@api/common/chat/events/chat.events';
import { runWithTrace } from '@api/common/logger/trace-context';
import { RedisLockService } from '@api/common/redis/redis-lock.service';

/**
 * 同会话单飞的 Redis 锁 TTL。
 * 必须覆盖一次最长 LLM 调用（含工具多轮）；120s 是当前最坏耗时的上界。
 * 注意：TTL 不会自动续期，单次执行超过 TTL 时锁会提前释放（见残留风险）。
 */
const LOCK_TTL_MS = 120_000;

/** 抢锁失败后的最大有界等待时间。 */
const LOCK_MAX_WAIT_MS = 30_000;

/** 抢锁重试的间隔。 */
const LOCK_RETRY_DELAY_MS = 200;

/**
 * 有界等待后仍拿不到锁 → 放弃本条消息并给出可观测原因。
 * 不在锁内静默丢弃。
 */
class ConversationLockTimeoutError extends Error {
  constructor(
    readonly conversationId: string,
    readonly waitedMs: number,
  ) {
    super(
      `AI conversation lock not acquired within ${waitedMs}ms (conv=${conversationId})`,
    );
    this.name = 'ConversationLockTimeoutError';
  }
}

/**
 * AiMessageListener — AI 消息处理监听器
 *
 * 接收 ChatService 发出的 AI_MESSAGE_REQUESTED 事件，
 * 触发 AiCustomerService 的 LangGraph 处理。
 * AI 回复通过 AiCustomerService 内部注入的 EventsGateway 推 Socket。
 *
 * ── 同会话单飞（single-flight）分两层 ──
 * 1. 进程内 Promise 链（conversationQueues）：同一 conversationId 严格串行、保序。
 *    单实例内即使 Redis 不可用也不会并发跑两个 LangGraph。
 * 2. Redis 分布式锁（ai:conv:${conversationId}）：跨实例互斥，
 *    防止多副本各自跑同一会话导致回复乱序、成本翻倍。
 * 不同会话的 key / 队列彼此独立，因此可以并发，不存在全局串行。
 */
@Injectable()
export class AiMessageListener {
  private readonly logger = new Logger(AiMessageListener.name);

  /** conversationId → 队尾 Promise。同一实例内严格串行、先进先出。 */
  private readonly conversationQueues = new Map<string, Promise<void>>();

  // 非 readonly：测试可覆盖，避免真的空等 30s。
  private lockMaxWaitMs = LOCK_MAX_WAIT_MS;
  private lockRetryDelayMs = LOCK_RETRY_DELAY_MS;

  constructor(
    private readonly aiCustomerService: AiCustomerService,
    private readonly redisLockService: RedisLockService,
  ) {}

  @OnEvent(CHAT_EVENTS.AI_MESSAGE_REQUESTED)
  async handleAiMessageRequest(payload: {
    conversationId: string;
    content: string;
    userId: string;
  }): Promise<void> {
    const { conversationId, content, userId } = payload;
    // 只记长度，不落原文（#89 FR-7 / AC-6）
    this.logger.log(
      `[AiMessageListener] AI request: conv=${conversationId}, messageLength=${content.length}`,
    );

    try {
      // 只有 LangGraph 执行（chatStream）被纳入单飞范围；
      // 日志等无关工作留在锁外。
      await this.enqueue(conversationId, () =>
        this.runExclusive(conversationId, () =>
          this.executeGraph(conversationId, content, userId),
        ),
      );
    } catch (err: any) {
      if (err instanceof ConversationLockTimeoutError) {
        // 明确告警 + 可观测原因，不静默丢、也不让进程崩。
        this.logger.warn(
          `[AiMessageListener] AI request abandoned: reason=lock_timeout, ` +
            `waitedMs=${err.waitedMs}, conv=${conversationId}`,
        );
        return;
      }
      this.logger.error(
        `[AiMessageListener] AI processing failed: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * 进程内按会话串行：把任务接到该会话队尾，等前一个完成后再执行。
   * 返回本次任务的 Promise（拒绝会传播给调用方，但不会卡住后续任务）。
   */
  private enqueue(
    conversationId: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const prev =
      this.conversationQueues.get(conversationId) ?? Promise.resolve();

    // prev 是我们写入的"静音队尾"（永不 reject），所以这里直接用 then 即可。
    const run = prev.then(task);

    // 写入一个永不 reject 的队尾，避免前一次失败把后续任务全部拖垮。
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.conversationQueues.set(conversationId, tail);

    // 队尾完成时若自己仍是当前队尾（没有新人排队），清理 map，防止长驻内存增长。
    void tail.finally(() => {
      if (this.conversationQueues.get(conversationId) === tail) {
        this.conversationQueues.delete(conversationId);
      }
    });

    return run;
  }

  /**
   * 跨实例互斥 + 有界等待重试。
   *
   * 抢锁失败（被其他实例占用）时最多等 lockMaxWaitMs，超过则抛
   * ConversationLockTimeoutError（由上层记录 warn 后放弃）。
   *
   * Redis 基础设施故障（runWithLock 在回调启动前抛错）时降级：记 warn 后
   * 直接执行任务——进程内 Promise 链仍在，不会丢消息，只是失去跨实例保证。
   * 这样区分是安全的：任务内部异常被包进 sentinel，不会从 runWithLock 抛出，
   * 因此 runWithLock 抛错只可能是加锁前的连接/命令失败。
   */
  private async runExclusive<T>(
    conversationId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `ai:conv:${conversationId}`;
    const startedAt = Date.now();

    for (;;) {
      let outcome:
        | { ok: true; value: T }
        | { ok: false; error: unknown }
        | undefined;
      try {
        outcome = await this.redisLockService.runWithLock(
          lockKey,
          LOCK_TTL_MS,
          // 用 sentinel 包住任务：区分"抢锁失败(undefined)"与
          // "任务本身成功返回 undefined"，同时避免任务异常冒充加锁异常。
          async () => {
            try {
              return { ok: true as const, value: await task() };
            } catch (error) {
              return { ok: false as const, error };
            }
          },
          false,
        );
      } catch (err: any) {
        this.logger.warn(
          `[AiMessageListener] Redis lock unavailable, degrading to ` +
            `in-process serialization only: reason=${err?.message ?? err}, ` +
            `conv=${conversationId}`,
        );
        // 任务尚未启动（runWithLock 在回调前失败），直接本地执行。
        return task();
      }

      if (outcome !== undefined) {
        if (!outcome.ok) throw outcome.error;
        return outcome.value;
      }

      // 抢锁失败：被其他实例/请求占用。
      const waitedMs = Date.now() - startedAt;
      if (waitedMs >= this.lockMaxWaitMs) {
        throw new ConversationLockTimeoutError(conversationId, waitedMs);
      }
      await this.sleep(this.lockRetryDelayMs);
    }
  }

  /**
   * 真正的 LangGraph 执行。trace 上下文与 chatStream 调用都只在这里。
   */
  private executeGraph(
    conversationId: string,
    content: string,
    userId: string,
  ): Promise<void> {
    // 这条是事件驱动路径，没有 HTTP 请求、也就没有 req.id。
    // 这里自己生成一个 traceId 并挂到异步上下文上，
    // 否则 chat.start / intent / llm.usage 的 traceId 全是 "-"，Loki 无法按对话聚合。
    return runWithTrace(randomUUID().replaceAll('-', ''), () =>
      this.aiCustomerService.chatStream(
        content,
        userId,
        `${userId}:${Date.now()}`,
        {
          onToken: () => {},
          onStep: () => {},
          onDone: () => {},
          onError: () => {},
          onTransfer: () => {},
        },
        conversationId,
      ),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
