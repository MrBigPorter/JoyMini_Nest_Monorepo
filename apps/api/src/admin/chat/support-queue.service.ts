import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from '@api/common/redis/redis.service';
import {
  SupportHandlerService,
  AWAITING_HUMAN,
} from '@api/common/chat/support-handler.service';
import {
  CHAT_EVENTS,
  SupportQueueChangedEvent,
} from '@api/common/chat/events/chat.events';

const DEFAULT_IDLE_TIMEOUT_MINUTES = 10;
const DEFAULT_QUEUE_TIMEOUT_MINUTES = 10;
/** Redis 锁 TTL 要小于 cron 周期，避免上一轮卡住导致下一轮永远抢不到 */
const SWEEP_LOCK_TTL_SECONDS = 50;

/**
 * 转人工队列的后台维护（#98 AC-3 / AC-4）
 *
 * 两个职责，都是「用户不说话也会发生」的事：
 *
 *   1. 空闲回收：客服接了会话但 10 分钟没动静 → 交回 AI。
 *      以前只在用户发下一条消息时懒判定，用户沉默 = 会话永久卡在人工手里。
 *   2. 排队超时提醒：排队超过 10 分钟没人认领 → 重新广播一次（限频），
 *      避免「列表里躺着一单，没人注意到」。
 *
 * 多实例安全：Redis 锁只让一个实例跑，真正的修改在
 * SupportHandlerService 里仍是 CAS，重复执行也不会误伤。
 */
@Injectable()
export class SupportQueueService {
  private readonly logger = new Logger(SupportQueueService.name);
  private readonly idleTimeoutMs: number;
  private readonly queueTimeoutMs: number;

  constructor(
    private readonly supportHandlerService: SupportHandlerService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
    configService: ConfigService,
  ) {
    this.idleTimeoutMs =
      this.readMinutes(configService, 'SUPPORT_IDLE_TIMEOUT_MINUTES') *
      60 *
      1000;
    this.queueTimeoutMs =
      this.readMinutes(configService, 'SUPPORT_QUEUE_TIMEOUT_MINUTES') *
      60 *
      1000;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const acquired = await this.redisService.setNx(
      'cron:support-queue-sweep',
      String(Date.now()),
      SWEEP_LOCK_TTL_SECONDS,
    );
    if (!acquired) return;

    try {
      await this.releaseIdleConversations();
      await this.remindStaleQueue();
    } catch (err: unknown) {
      this.logger.error(
        `[SupportQueueSweep] failed: ${this.errorMessage(err)}`,
      );
    }
  }

  /** 人工处理中且空闲超时的会话 → 交回 AI */
  private async releaseIdleConversations(): Promise<void> {
    const released = await this.supportHandlerService.sweepIdle(
      this.idleTimeoutMs,
    );
    for (const conversationId of released) {
      this.eventEmitter.emit(
        CHAT_EVENTS.SUPPORT_QUEUE_CHANGED,
        new SupportQueueChangedEvent(conversationId, 'released', null),
      );
    }
    if (released.length > 0) {
      this.logger.log(
        `[SupportQueueSweep] released ${released.length} idle conversation(s) back to AI`,
      );
    }
  }

  /**
   * 排队超时提醒：同一会话每个 timeout 窗口最多提醒一次。
   *
   * 用 Redis SET NX + TTL 做限频，key 消失后才会再次提醒；
   * 这样 10 分钟阈值下，每 10 分钟最多一条提醒，而不是每分钟刷屏。
   */
  private async remindStaleQueue(): Promise<void> {
    const stale = await this.supportHandlerService.findStaleQueue(
      this.queueTimeoutMs,
    );

    for (const { id } of stale) {
      const throttleKey = `support:queue:remind:${id}`;
      const shouldNotify = await this.redisService.setNx(
        throttleKey,
        String(Date.now()),
        Math.ceil(this.queueTimeoutMs / 1000),
      );
      if (!shouldNotify) continue;

      this.eventEmitter.emit(
        CHAT_EVENTS.SUPPORT_QUEUE_CHANGED,
        new SupportQueueChangedEvent(
          id,
          'queue_timeout_reminder',
          AWAITING_HUMAN,
        ),
      );
      this.logger.warn(
        `[SupportQueueSweep] conversation ${id} still waiting beyond ${Math.round(
          this.queueTimeoutMs / 60000,
        )}min`,
      );
    }
  }

  private readMinutes(configService: ConfigService, key: string): number {
    const raw = Number(configService.get<string>(key));
    return Number.isFinite(raw) && raw > 0
      ? raw
      : key === 'SUPPORT_IDLE_TIMEOUT_MINUTES'
        ? DEFAULT_IDLE_TIMEOUT_MINUTES
        : DEFAULT_QUEUE_TIMEOUT_MINUTES;
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
