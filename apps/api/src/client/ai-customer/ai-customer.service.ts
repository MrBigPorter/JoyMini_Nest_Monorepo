import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { MemorySaver, REMOVE_ALL_MESSAGES } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { HumanMessage, RemoveMessage } from '@langchain/core/messages';
import { buildCustomerGraph } from '@api/client/ai-customer/graph/customer.graph';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CHAT_EVENTS,
  SupportQueueChangedEvent,
} from '@api/common/chat/events/chat.events';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { EventsGateway } from '@api/common/events/events.gateway';
import { ConversationStatus, SocketEvents } from '@lucky/shared';
import { TestChatResult } from '@api/client/ai-customer/graph/types/agent-types';
import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { RagRetrievalService } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import { QueryRewriteService } from '@api/client/ai-customer/knowledge/query-rewrite.service';
import { PromptResolverService } from '@api/client/ai-customer/knowledge/prompt-resolver.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import { AiMemoryService } from '@api/common/ai/ai-memory.service';
import { AiActionConfirmService } from './ai-action-confirm.service';
import { isOtpCode, isShortAffirmation } from './confirmation-intent';
import {
  describeClaimRejection,
  localizeClaimError,
} from './coupon-claim-errors';
import { resolveTurnStatus } from './turn-status';
import { CLAIM_NOT_EXECUTED_REPLY, detectCompletionClaim } from './claim-guard';
import { AiActionLifecycleService } from './ai-action-lifecycle.service';
import {
  AiActionContextService,
  maskActionSummary,
  type ActionContext,
} from './action-context';
import { AiFeedbackService } from '@api/common/ai/ai-feedback.service';
import {
  AiConversationDebugService,
  ConversationDebugSnapshot,
} from '@api/client/ai-customer/debug/ai-conversation-debug.service';
import { buildConversationDiagnosis } from '@api/client/ai-customer/debug/conversation-diagnosis';
import {
  FlowStateVersioningService,
  RollbackStateInput,
  RollbackStateResult,
} from '@api/client/ai-customer/flow-versioning/flow-state-versioning.service';
import {
  AiUsageService,
  QuotaExceededError,
  SessionQuotaExceededError,
} from './ai-usage.service';
import { handleEventStream, StreamUsageSummary } from './ai-stream.handler';
import { publishAiReply } from './ai-reply-publisher';
import { AddressService } from '../address/address.service';
import { ClientWalletService } from '../wallet/client-wallet.service';
import { ClientCouponService } from '../coupon/coupon.service';
import { LuckyDrawService } from '@api/common/lucky-draw/lucky-draw.service';
import { ApplyWithdrawDto } from '../wallet/dto/apply-withdraw.dto';
import { CreateAddressDto, UpdateAddressDto } from '../address/dto/address.dto';
import { OtpService } from '../otp/otp.service';
import {
  ActionExecutionServices,
  getCatalogEntryByAction,
} from '@api/client/ai-customer/graph/config/action-catalog';
import { getConfirmActionMeta } from '@api/client/ai-customer/graph/nodes/orchestrator-utils/confirm-utils';
import { CODE_TYPE } from '@lucky/shared';
import { emitStage } from '@api/common/logger/structured-logger';
import { runWithContext } from '@api/common/logger/trace-context';
import { redactPiiText } from '@api/common/utils/pii-redaction';
import { decGauge, incCounter, incGauge } from '@api/common/metrics/metrics';
import type { RagCitation } from '@api/client/ai-customer/graph/state';
import { RedisService } from '@api/common/redis/redis.service';
import {
  RecordTraceSpanInput,
  TraceService,
} from '@api/admin/ai-traces/ai-traces.service';
import {
  degradeToHuman,
  handoffReply,
  mergeHandoffCallback,
} from './ai-failure-handler';
import { HandoffPresenceService } from '@api/common/chat/handoff/handoff-presence.service';
import { isSensitiveRequest } from '@api/common/utils/sensitive-content';
import {
  classifyGrounding,
  countSuccessfulToolCalls,
  decideGroundingGate,
  hasFactualAssertion,
  isCannedReply,
  isClarificationOnly,
  NO_EVIDENCE_HANDOFF_REPLY,
  readGroundingGateMode,
  type GroundingGateDecision,
  type GroundingType,
} from '@api/client/ai-customer/graph/nodes/orchestrator-utils/grounding-gate';
import { policyFallback } from './policy-fallback';
import {
  setHandoffCallbackPending,
  consumeHandoffResetFlag,
} from '@api/common/chat/handoff/ai-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/** 故障注入：只有以这个前缀开头的消息才会走检查（普通流量零开销） */
const CHAOS_PREFIX = '__CHAOS__';
/** Redis 开关名，自测脚本设置并带 TTL，忘删也会自己过期 */
const CHAOS_KEY = 'ai:chaos:fail';

/**
 * 文字「确认」只绑定这个时间窗内的动作。
 * 更早的终态动作（过期/已完成）不应劫持用户对当前上下文的确认。
 */
const CONFIRM_GATE_GRACE_MS = 10 * 60 * 1000;

@Injectable()
export class AiCustomerService implements OnModuleDestroy {
  private readonly logger = new Logger(AiCustomerService.name);
  private compiledGraph: ReturnType<typeof buildCustomerGraph> | null = null;
  /** 生产用 PostgresSaver；memory 模式或初始化失败时为 undefined（图内部用 MemorySaver）。 */
  private checkpointer?: BaseCheckpointSaver & {
    end?: () => Promise<void>;
  };
  private llmConfig: LlmProviderConfig | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly registry: ToolRegistryService,
    private readonly aiService: AiService,
    private readonly prismaService: PrismaService,
    private readonly ragRetrievalService: RagRetrievalService,
    private readonly promptResolver: PromptResolverService,
    private readonly meilisearchService: MeilisearchService,
    private readonly aiMemoryService: AiMemoryService,
    private readonly eventsGateway: EventsGateway,
    private readonly aiActionConfirmService: AiActionConfirmService,
    private readonly aiUsageService: AiUsageService,
    private readonly clientWalletService: ClientWalletService,
    private readonly clientCouponService: ClientCouponService,
    private readonly luckyDrawService: LuckyDrawService,
    private readonly addressService: AddressService,
    private readonly otpService: OtpService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
    private readonly aiFeedbackService: AiFeedbackService,
    private readonly flowVersioning: FlowStateVersioningService,
    private readonly conversationDebug: AiConversationDebugService,
    /**
     * 链路埋点（可选）：单元测试直接 new 本服务时不注入也不影响。
     * TraceService 内部吞掉写入异常，埋点失败不会反向影响对话。
     */
    @Optional()
    private readonly traceService?: TraceService,
    /**
     * 写操作生命周期：确认卡片/执行/过期落库。
     * 可选注入，单测直接 new 时不影响；生产由模块提供。
     */
    @Optional()
    private readonly actionLifecycle?: AiActionLifecycleService,
    /**
     * 在线客服探测（可选）：单测直接 new 时不注入。
     * 缺省时转人工一律按在线处理，保持旧行为。
     */
    @Optional()
    private readonly handoffPresence?: HandoffPresenceService,
    /**
     * 权威动作上下文（可选）：单测直接 new 时不注入，按「无历史动作」处理。
     * 生产由 AiCustomerModule 提供。
     */
    @Optional()
    private readonly actionContextService?: AiActionContextService,
  ) {}

  /**
   * 应用启动时初始化图谱
   * 1. 编译图谱，生成可执行的有向图
   * 2. 如果编译失败，抛出异常，阻止应用启动
   * 3. 如果编译成功，记录日志
   */
  async onModuleInit() {
    await this.initGraph();
    // 状态回滚需要 compiledGraph；FlowVersioningService 只做安全点/绑定/审计。
    this.flowVersioning.registerStateRollbackHandler((input) =>
      this.rollbackConversationState(input),
    );
    this.conversationDebug.registerInspector((conversationId) =>
      this.inspectConversationState(conversationId),
    );
  }

  /**
   * 初始化图谱
   * 1. 如果图谱已编译，直接返回
   * 2. 尝试编译图谱，如果失败，记录错误并抛出异常
   * 3. 如果成功，记录日志
   */
  async initGraph() {
    if (this.compiledGraph) return;
    try {
      // 生产环境如果漏配 AI_LLM_TYPE，不能静默退回本地 Ollama：
      // 容器里没有 Ollama，会 100% 报错并把用户全部转人工。
      // 有 DeepSeek key 时默认 online；显式 AI_LLM_TYPE=local 仍可覆盖。
      const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
      const type =
        this.configService.get<'online' | 'local'>('AI_LLM_TYPE') ??
        (apiKey ? 'online' : 'local');
      this.llmConfig = {
        type,
        model: this.configService.get<string>(
          'OLLAMA_MODEL',
          type === 'online' ? 'deepseek-chat' : 'qwen3.5:0.8b',
        ),
        baseURL: this.configService.get<string>(
          'AI_OLLAMA_BASE_URL',
          type === 'online'
            ? 'https://api.deepseek.com'
            : 'http://localhost:11434',
        ),
        apiKey,
      };
      const checkpointer = await this.createCheckpointer();
      // 改写需要与聊天模型同一套配置；放在这里实例化，避免在 DI 层复制
      // 「AI_LLM_TYPE / DEEPSEEK key」的选择逻辑。
      const queryRewriteService = new QueryRewriteService(
        this.llmConfig,
        this.redisService,
      );
      this.compiledGraph = buildCustomerGraph(
        this.llmConfig,
        this.registry,
        this.aiService,
        this.prismaService,
        this.meilisearchService,
        this.ragRetrievalService,
        this.promptResolver,
        this.redisService,
        checkpointer,
        queryRewriteService,
      );
    } catch (error) {
      this.logger.error('Failed to compile AiCustomer Graph', error);
      throw error;
    }
  }

  /**
   * 状态持久化选型：
   * - 默认 postgres：跨重启/多实例共享 thread 状态
   * - AI_CHECKPOINTER=memory：显式关闭（测试/本地）
   * - Postgres 初始化失败：降级 MemorySaver，应用仍可启动
   */
  private async createCheckpointer(): Promise<BaseCheckpointSaver> {
    const mode = (
      this.configService.get<string>('AI_CHECKPOINTER') ?? 'postgres'
    ).toLowerCase();

    if (mode === 'memory') {
      this.logger.log('AI checkpointer: memory (AI_CHECKPOINTER=memory)');
      return new MemorySaver();
    }

    const url =
      this.configService.get<string>('DATABASE_URL') ??
      process.env.DATABASE_URL;
    if (!url) {
      this.logger.warn(
        'DATABASE_URL missing; AI checkpointer falls back to MemorySaver',
      );
      return new MemorySaver();
    }

    try {
      const { PostgresSaver } =
        await import('@langchain/langgraph-checkpoint-postgres');
      const saver = PostgresSaver.fromConnString(url);
      await saver.setup();
      this.checkpointer = saver;
      this.logger.log(
        '✅ AI checkpointer: Postgres (state persists across restarts)',
      );
      return saver;
    } catch (err: any) {
      this.logger.warn(
        `Postgres checkpointer unavailable, falling back to MemorySaver: ${
          err?.message ?? err
        }`,
      );
      return new MemorySaver();
    }
  }

  /**
   * 把会话 thread 恢复到指定 checkpoint 的 values。
   *
   * 只回滚 LangGraph 状态，不撤销已完成的业务写操作（退款/下单等），
   * 也不改 ChatMessage 历史 —— UI 与 AI 上下文可能短暂不一致，这是设计边界。
   * 使用 updateState 生成新的 checkpoint，不直接改旧 checkpoint 行。
   */
  private async rollbackConversationState(
    input: RollbackStateInput,
  ): Promise<RollbackStateResult> {
    if (!this.compiledGraph) {
      return { ok: false, reason: 'graph_not_initialized' };
    }

    const conversation = await this.prismaService.conversation.findUnique({
      where: { id: input.conversationId },
      select: { threadId: true },
    });
    if (!conversation?.threadId) {
      return { ok: false, reason: 'thread_not_found' };
    }

    const config = {
      configurable: { thread_id: conversation.threadId },
    };
    const history: any[] = [];
    for await (const snapshot of this.compiledGraph.getStateHistory(config)) {
      history.push(snapshot);
    }

    const targetIndex = history.findIndex(
      (snapshot) =>
        snapshot?.config?.configurable?.checkpoint_id === input.checkpointId,
    );
    if (targetIndex < 0) {
      return { ok: false, reason: 'checkpoint_not_found' };
    }
    if (targetIndex === 0) {
      return { ok: false, reason: 'same_checkpoint' };
    }

    const target = history[targetIndex];
    const values = target.values ?? {};
    const restoredMessages = Array.isArray(values.messages)
      ? values.messages
      : [];

    // 用 RemoveMessage 哨兵清空当前 messages，再写回目标快照，
    // 避免 messagesStateReducer 把旧消息追加到当前列表上。
    const nextConfig = await this.compiledGraph.updateState(config, {
      messages: [
        new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
        ...restoredMessages,
      ],
      flowState: values.flowState ?? { activeFlow: '', step: '', data: {} },
      contextState: values.contextState,
      intent: values.previousIntent ?? '',
      previousIntent: values.previousIntent ?? '',
      labels: [],
      pendingConfirm: null,
      transferToHuman: false,
      transferReason: '',
      ragSources: [],
      userMemory: '',
      repeatCount: 0,
    });

    const checkpointId =
      nextConfig?.configurable?.checkpoint_id ?? input.checkpointId;
    this.logger.log(
      `[chatStream] state rolled back: conv=${input.conversationId}, checkpoint=${input.checkpointId}, newCheckpoint=${checkpointId}`,
    );
    return { ok: true, checkpointId };
  }

  /** 单会话上下文调试：只读 graph state，不写消息、不触发模型。 */
  private async inspectConversationState(
    conversationId: string,
  ): Promise<ConversationDebugSnapshot | { error: string }> {
    if (!this.compiledGraph) return { error: 'graph_not_initialized' };
    const conversation = await this.prismaService.conversation.findUnique({
      where: { id: conversationId },
      select: { threadId: true },
    });
    if (!conversation?.threadId) return { error: 'thread_not_found' };

    const state = await this.compiledGraph.getState({
      configurable: { thread_id: conversation.threadId },
    });
    const values = (state as any)?.values ?? {};
    const rawMessages = Array.isArray(values.messages) ? values.messages : [];
    const checkpoints: Array<{
      checkpointId: string;
      createdAt: string | null;
      previousIntent: string;
      flowType: string | null;
      step: string | null;
      messageCount: number;
    }> = [];
    for await (const snapshot of this.compiledGraph.getStateHistory({
      configurable: { thread_id: conversation.threadId },
    })) {
      const snapshotValues = (snapshot as any)?.values ?? {};
      const checkpointId =
        (snapshot as any)?.config?.configurable?.checkpoint_id ?? null;
      if (!checkpointId) continue;
      checkpoints.push({
        checkpointId,
        createdAt: (snapshot as any)?.createdAt ?? null,
        previousIntent: snapshotValues.previousIntent ?? '',
        flowType: snapshotValues.flowState?.activeFlow ?? null,
        step: snapshotValues.flowState?.step ?? null,
        messageCount: Array.isArray(snapshotValues.messages)
          ? snapshotValues.messages.length
          : 0,
      });
      if (checkpoints.length >= 50) break;
    }
    // 消息时间线以 ChatMessage 为准：graph state 里的消息只有 type/content，
    // 没有时间，运营无法判断「卡了多久」。落库消息还带 source，能区分 AI/人工。
    const dbMessages = await this.prismaService.chatMessage.findMany({
      where: { conversationId },
      orderBy: { seqId: 'desc' },
      take: 20,
      select: {
        id: true,
        type: true,
        content: true,
        createdAt: true,
        source: true,
        senderId: true,
      },
    });
    dbMessages.reverse();

    const messages =
      dbMessages.length > 0
        ? dbMessages.map((message) => ({
            id: message.id,
            type:
              message.source === 'ai'
                ? 'ai'
                : message.source === 'human_agent'
                  ? 'human_agent'
                  : 'human',
            content: (message.content ?? '').slice(0, 2000),
            createdAt: message.createdAt?.toISOString() ?? null,
            source: message.source ?? null,
          }))
        : rawMessages.slice(-20).map((message: any) => ({
            type: String(message?.type ?? message?._getType?.() ?? 'unknown'),
            content:
              typeof message?.content === 'string'
                ? message.content.slice(0, 2000)
                : JSON.stringify(message?.content ?? '').slice(0, 2000),
            createdAt: null,
            source: null,
          }));

    // 这个会话有没有链路可查：没有 trace 时运营必须看到「无法定位」，
    // 而不是以为页面只是没展示。
    const traceCount = await this.prismaService.aiTrace.count({
      where: { conversationId },
    });
    const actionRows = await this.prismaService.aiActionRequest.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        action: true,
        status: true,
        messageId: true,
        createdAt: true,
        expiresAt: true,
        error: true,
      },
    });
    const lastUser = [...dbMessages]
      .reverse()
      .find((message) => message.source === 'user' && message.senderId);

    const flowState = values.flowState ?? {};
    const diagnosis = buildConversationDiagnosis({
      messages,
      flowState,
      hasTrace: traceCount > 0,
      actions: actionRows,
    });

    return {
      conversationId,
      threadId: conversation.threadId,
      checkpointId: (state as any)?.config?.configurable?.checkpoint_id ?? null,
      userId: lastUser?.senderId ?? null,
      flowState,
      contextState: values.contextState ?? {},
      pendingConfirm: values.pendingConfirm
        ? {
            action: values.pendingConfirm.action,
            params: maskActionSummary(values.pendingConfirm.params ?? {}),
            summary: maskActionSummary(values.pendingConfirm.summary ?? {}),
          }
        : null,
      previousIntent: values.previousIntent ?? '',
      messages,
      diagnosis,
      actions: actionRows.map((row) => ({
        id: row.id,
        action: row.action,
        status: row.status,
        messageId: row.messageId,
        createdAt: row.createdAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        error: row.error,
      })),
      checkpoints,
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.checkpointer?.end) return;
    try {
      await this.checkpointer.end();
      this.logger.log('AI checkpointer closed');
    } catch (err: any) {
      this.logger.warn(`AI checkpointer close failed: ${err?.message ?? err}`);
    }
  }

  /*
   * 获取已编译的图谱
   * 1. 如果图谱未初始化，抛出异常
   * 2. 返回已编译的图谱
   */
  getGraph() {
    if (!this.compiledGraph) {
      throw new Error('Graph not initialized. Call initGraph() first.');
    }
    return this.compiledGraph;
  }

  /**
   * 流式聊天接口
   * 1. 接收用户消息、用户 ID、会话 ID 和回调函数
   * 2. 调用图谱的 streamEvents 方法，获取事件流
   * 3. 根据事件类型调用相应的回调函数，将数据推送给前端
   * 4. 如果发生错误，调用 onError 回调
   * 5. 流结束时，调用 onDone 回调
   * @param message
   * @param userId
   * @param sessionId
   * @param callbacks
   * @returns
   */
  // ══════════════════════════════════════════════════════════════
  //  Step 流程 — 5 步，一眼看完
  // ══════════════════════════════════════════════════════════════

  async chatStream(
    message: string,
    userId: string,
    sessionId: string,
    callbacks: {
      onToken: (token: string) => void;
      onStep: (step: string, data?: any) => void;
      onDone: (payload?: { sources?: RagCitation[] }) => void;
      onError: (error: Error) => void;
      onTransfer?: (reason: string) => void;
      /** 显式取消信号（留给后续 single-flight/取消设计）；透传给 LangGraph */
      signal?: AbortSignal;
    },
    conversationId?: string,
    entryPoint?: string,
    metadata?: Record<string, any>,
    /** 触发本轮回复的用户消息 id；用于 AI 回复落库的幂等唯一键 */
    triggerMessageId?: string,
  ): Promise<void> {
    // Step 1 — 校验入参
    if (!this.assertInputValid(message, userId, callbacks)) return;

    // 调用方在启动前已显式取消：连图都不用启动
    if (callbacks.signal?.aborted) {
      this.logger.log(
        `[chatStream] abort observed before graph start, conversationId=${conversationId ?? 'n/a'}`,
      );
      return;
    }

    // Step 0 — AI 门禁 + 交接复位消费。
    // 消息已由写入链路落库，这里只决定「AI 是否该接这一轮」：
    //   - 只有 SUPPORT/AI + NORMAL + handlerId=null 才允许跑图；
    //   - 人工处理中/已归档时直接 onDone，不跑图、不写 trace（消息保留）。
    // 门禁放在 startedAt 之前，确保被拦下的一轮不会留下 trace。
    if (conversationId) {
      const gate = await this.prismaService.conversation.findUnique({
        where: { id: conversationId },
        select: {
          type: true,
          status: true,
          handlerId: true,
          threadId: true,
          aiMetadata: true,
        },
      });

      if (!this.isAiEligibleConversation(gate)) {
        this.logger.log(
          `[chatStream] ai gate blocked: conv=${conversationId}, ` +
            `type=${gate?.type ?? 'unknown'}, ` +
            `status=${gate?.status ?? 'unknown'}, ` +
            `handlerId=${gate?.handlerId ?? 'unknown'}`,
        );
        // 人工处理中/已归档：待确认卡片不能继续 live，否则人工接管后
        // 用户仍能点旧卡片执行写操作。
        await this.actionLifecycle
          ?.expireForConversation(conversationId, 'transferred')
          .catch(() => undefined);
        callbacks.onDone();
        return;
      }

      // 自动回 AI 后留下的复位标记：本轮开图前消费一次。
      if (this.hasHandoffResetFlag(gate?.aiMetadata ?? null)) {
        await this.consumeHandoffReset(conversationId, gate?.threadId ?? null);
      }
    }

    // 本轮对话的起点。chat.done / chat.error 用它算总耗时。
    const startedAt = Date.now();

    // 只记长度，不记原文（隐私约束，见 #89 FR-7）。
    emitStage('chat.start', {
      messageLength: message.length,
      conversationId,
      entryPoint,
    });

    incGauge('ai_active_streams', {}, 1);
    let outcome = 'success';
    // 正常情况下由收尾分支写一条成功/转人工/确认链路；
    // 只有收尾前就抛错时才补写 ERROR 链路，避免同一轮写两条 trace。
    let traceRecorded = false;

    // 会话成员列表：本轮只查一次，供"会话房间 + 成员私有房间"双通道推送使用。
    // 放在 try 外面声明、里面赋值，是为了 error 分支也能拿到（可能仍是空数组）。
    let memberIds: string[] = [];

    try {
      // 故障注入（仅测试）：故意抛错，用来验证降级转人工链路。
      // 放在 try 内部，才能走到 catch → chat.error → handleStreamError → degradeToHuman。
      await this.maybeInjectChaos(message);

      // Step 2 — 准备 AI 对话线程。
      // 成员校验失败（会话不存在或不是成员）必须在这里直接返回：
      // 继续走 catch 会用调用方传入的 conversationId 去写消息/转人工，
      // 认证用户就能把别人的会话踢出 AI 模式。
      // 顺序：成员校验必须在配额之前 —— 否则配额分支也会用攻击者传入的
      // conversationId 向受害者会话写一条配额提示。
      let threadId: string;
      try {
        threadId = await this.prepareThread(userId, conversationId);
      } catch (err) {
        if (err instanceof NotFoundException) {
          this.logger.warn(
            `[chatStream] conversation membership check failed, drop turn: conv=${conversationId ?? 'n/a'}`,
          );
          callbacks.onDone();
          return;
        }
        throw err;
      }

      // 日 token 配额：超限时抛 QuotaExceededError，走降级转人工。
      await this.aiUsageService.assertWithinQuota(userId);

      // 会话级配额：只降级这一条对话，不牵连用户当天其他会话。
      await this.aiUsageService.assertWithinSessionQuota(conversationId);

      // 聊天框里的 6 位数字：有 CONFIRMED 提现时直接当 OTP 提交。
      if (conversationId) {
        const otpHandled = await this.handleOtpInChat({
          userId,
          conversationId,
          message,
          startedAt,
          triggerMessageId,
        });
        if (otpHandled) {
          callbacks.onDone();
          return;
        }
      }

      // 文字「确认」必须绑定最近的写动作，且发生在「新消息作废旧卡」之前：
      // 否则用户打「确认」这件事本身会先把卡片置 EXPIRED，再被分类器判成别的意图。
      if (conversationId) {
        const handled = await this.handlePendingActionConfirmation({
          userId,
          conversationId,
          message,
          startedAt,
          triggerMessageId,
        });
        if (handled) {
          callbacks.onDone();
          return;
        }
      }

      // 新消息到来：上一张确认卡片已不可能再被确认，写明确终态。
      // 只影响确认状态，不阻断本轮对话。
      if (conversationId && this.actionLifecycle) {
        await this.actionLifecycle
          .expireForConversation(conversationId)
          .catch((err: any) => {
            this.logger.warn(
              `[chatStream] expire confirm cards failed: ${err?.message ?? err}`,
            );
          });
      }

      // 过期之后再读：让动作上下文反映本轮真实状态（EXPIRED 而不是旧的 CONFIRM_CREATED）。
      // 读取失败返回 null，不阻断对话。
      const actionContext: ActionContext | null =
        conversationId && this.actionContextService
          ? await this.actionContextService.loadLatest(conversationId)
          : null;

      // 查成员不能影响对话主流程：失败就退化为只发会话房间
      memberIds = await this.resolveMemberIds(conversationId);

      // Step 3 — 记录快照 + 通知 Thinking
      const prevCount = await this.snapshotBeforeStream(threadId);
      this.broadcastThinking(conversationId, callbacks, memberIds);

      // Step 4 — 执行 LangGraph 流式推理（逐 token 推给前端）
      // 每轮读取一次长期记忆，覆盖注入；读取失败返回空串，不阻断对话。
      const userMemory = await this.aiMemoryService.getMemoryPrompt(userId);

      const streamUsage = await this.runEventStream(
        threadId,
        message,
        userId,
        conversationId,
        entryPoint,
        metadata,
        callbacks,
        memberIds,
        callbacks.signal,
        userMemory,
        actionContext,
      );

      // 异步抽取蒸馏记忆：失败只记日志，不影响本轮回复。
      void this.aiMemoryService
        .recordFromUserMessage({
          userId,
          conversationId,
          messageId: triggerMessageId,
          text: message,
        })
        .catch((err: any) => {
          this.logger.warn(
            `[chatStream] memory extraction failed: ${err?.message ?? err}`,
          );
        });

      // 记录 token 用量（失败不阻断对话）
      try {
        await this.aiUsageService.recordUsage(
          userId,
          streamUsage.promptTokens ?? 0,
          streamUsage.completionTokens ?? 0,
          1,
        );
      } catch (usageErr: any) {
        this.logger.warn(
          `[chatStream] usage record failed: ${usageErr?.message ?? usageErr}`,
        );
      }

      // 会话级记账：Redis 故障自己吞掉，不影响本轮对话
      await this.aiUsageService.recordSessionUsage(
        conversationId,
        streamUsage.totalTokens ?? 0,
      );

      // 取消信号在流结束后才观察到：图可能正常返回（provider 没响应 signal），
      // 但不再继续落库/广播。
      if (callbacks.signal?.aborted) {
        outcome = 'aborted';
        this.logger.log(
          `[chatStream] abort observed after stream, skip finalize, conversationId=${conversationId ?? 'n/a'}`,
        );
        return;
      }

      // Step 5 — 收尾分发：转人工 / 确认卡片 / 正常完成
      const reply = await this.finalizeAfterStream(
        threadId,
        prevCount,
        userId,
        conversationId,
        callbacks,
        startedAt,
        streamUsage.totalTokens,
        memberIds,
        triggerMessageId,
        streamUsage,
        message,
      );

      // 链路追踪：一次回复一条 trace，best-effort，不影响对话结果。
      await this.recordReplyTrace({
        message,
        userId,
        conversationId,
        triggerMessageId,
        startedAt,
        status: reply.status,
        finalState: reply.finalState,
        newMessages: reply.newMessages,
        ragSources: reply.ragSources,
        transferReason: reply.transferReason,
        streamUsage,
      });
      traceRecorded = true;
    } catch (err: any) {
      outcome =
        err instanceof QuotaExceededError ||
        err instanceof SessionQuotaExceededError
          ? 'quota_exceeded'
          : 'error';
      // 取消触发的 AbortError 不是「模型故障」：不降级转人工、不广播 AI_ERROR，
      // 避免在会话里留下一条无意义的人工介入记录。
      if (callbacks.signal?.aborted) {
        outcome = 'aborted';
        this.logger.log(
          `[chatStream] abort observed in error path (${err?.name ?? 'Error'}), skip degrade, conversationId=${conversationId ?? 'n/a'}`,
        );
        return;
      }
      if (err instanceof QuotaExceededError) {
        this.logger.warn(
          `[chatStream] quota exceeded: userId=${userId}, limit=${err.limit}, used=${err.used}`,
        );
      }
      if (err instanceof SessionQuotaExceededError) {
        this.logger.warn(
          `[chatStream] session quota exceeded: conversationId=${conversationId ?? 'n/a'}, limit=${err.limit}, used=${err.used}`,
        );
      }
      emitStage(
        'chat.error',
        {
          errorName: err?.name ?? 'Error',
          // 截断：provider 的错误信息可能回显 prompt 片段（含用户原文），
          // 按 #89 FR-7 / N-8 的原则不把原文整段写进结构化日志。
          errorMessage: String(err?.message ?? 'unknown error').slice(0, 200),
          conversationId,
          totalMs: Date.now() - startedAt,
        },
        'error',
      );

      if (!traceRecorded) {
        await this.recordErrorTrace({
          message,
          userId,
          conversationId,
          triggerMessageId,
          startedAt,
          error: err,
        });
        traceRecorded = true;
      }

      await this.handleStreamError(
        err,
        message,
        userId,
        conversationId,
        callbacks,
        memberIds,
        triggerMessageId,
      );
    } finally {
      decGauge('ai_active_streams');
      incCounter('ai_chat_requests_total', { outcome });
      incCounter('ai_chat_duration_ms_total', {}, Date.now() - startedAt);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  交接门禁 / 复位消费（Task 5）
  // ══════════════════════════════════════════════════════════════

  /**
   * 是否允许 AI 接管这一轮。
   *
   * 供 AiMessageListener 在抢锁/跑图前做一次轻量预检；
   * chatStream 内部有同样的门禁作为最终判定（消息可能已被并发转人工）。
   */
  async canRunAi(conversationId: string): Promise<boolean> {
    const conv = await this.prismaService.conversation.findUnique({
      where: { id: conversationId },
      select: { type: true, status: true, handlerId: true },
    });
    return this.isAiEligibleConversation(conv);
  }

  /**
   * 消费 aiMetadata.handoffResetPending（自动回 AI 后由交接服务写入）。
   *
   *   - 有 thread：updateState 清零失败计数/意图/确认态；
   *     不传 messages/userMemory/flowState，避免删掉上下文；
   *   - 无 thread：新线程本就是干净的，只清标记；
   *   - updateState 失败：保留标记，下一轮重试（不能带着旧失败计数继续）。
   *
   * 清标记用带条件的 updateMany：where 仍要求标记等于本次读到的值，
   * 多实例/并发下只有一个消费者能把它清掉。
   */
  async consumeHandoffReset(
    conversationId: string,
    threadId: string | null,
  ): Promise<void> {
    const conversation = await this.prismaService.conversation.findUnique({
      where: { id: conversationId },
      select: { aiMetadata: true },
    });
    const metadata = this.toMetadataRecord(conversation?.aiMetadata ?? null);
    const flag = metadata?.handoffResetPending;
    if (flag == null) return;

    if (threadId) {
      if (!this.compiledGraph) return;
      try {
        await this.compiledGraph.updateState(
          { configurable: { thread_id: threadId } },
          {
            repeatCount: 0,
            previousIntent: '',
            intent: '',
            labels: [],
            pendingConfirm: null,
            transferToHuman: false,
            transferReason: '',
          },
        );
      } catch (err: any) {
        // 图状态没复位成功就不能消费标记，否则失败计数会残留在下一轮。
        this.logger.warn(
          `[chatStream] handoff reset updateState failed, keeping flag for retry: ` +
            `conv=${conversationId}, error=${err?.message ?? err}`,
        );
        return;
      }
    }

    // 原子删除：只移除 handoffResetPending，保留 trafficSource / handoffHistory 等。
    const consumed = await consumeHandoffResetFlag(
      this.prismaService,
      conversationId,
      flag,
    );

    if (consumed > 0) {
      // 回到 AI 也意味着旧卡片作废：graph state 清了，DB 记录也要有终态。
      await this.actionLifecycle
        ?.expireForConversation(conversationId, 'transferred')
        .catch(() => undefined);
      this.logger.log(
        `[chatStream] handoff reset consumed: conv=${conversationId}, thread=${threadId ?? 'none'}`,
      );
    }
  }

  /** AI 门禁：只有 SUPPORT/AI + NORMAL + handlerId=null 才允许接话。 */
  private isAiEligibleConversation(
    conv: {
      type: string;
      status: number;
      handlerId: string | null;
    } | null,
  ): boolean {
    if (!conv) return false;
    const isAiType = conv.type === 'SUPPORT' || conv.type === 'AI';
    return (
      isAiType &&
      conv.status === ConversationStatus.NORMAL &&
      conv.handlerId == null
    );
  }

  private hasHandoffResetFlag(raw: Prisma.JsonValue | null): boolean {
    return this.toMetadataRecord(raw)?.handoffResetPending != null;
  }

  private toMetadataRecord(
    raw: Prisma.JsonValue | null,
  ): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  }

  /**
   * 取会话成员 userId —— 用于"会话房间 + 成员私有房间"双通道推送
   *
   * 为什么每轮查一次而不是每条消息查：
   * 这条列表要供逐 token 的 AI_TOKEN 使用，每个 token 都查库会把 DB 打爆。
   *
   * 为什么失败不抛错：
   * 推送兜底属于"锦上添花"，查不到成员退化成只发会话房间（旧行为），
   * 不能让一次 DB 抖动把整轮对话打挂。
   */
  private async resolveMemberIds(conversationId?: string): Promise<string[]> {
    if (!conversationId) return [];
    try {
      const members = await this.prismaService.chatMember.findMany({
        where: { conversationId },
        select: { userId: true },
      });
      return members.map((m) => m.userId);
    } catch (err: any) {
      this.logger.warn(
        `[chatStream] resolveMemberIds failed, fallback to room-only dispatch: ${err?.message}`,
      );
      return [];
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  Step 实现
  // ══════════════════════════════════════════════════════════════

  /** Step 1 — 校验入参是否合法 */
  private assertInputValid(
    message: string,
    userId: string,
    callbacks: { onError: (err: Error) => void },
  ): boolean {
    if (!this.compiledGraph) {
      callbacks.onError(new Error('Graph not initialized'));
      return false;
    }
    if (!message || !userId) {
      callbacks.onError(new Error('Message and userId are required'));
      return false;
    }
    return true;
  }

  /** Step 2 — 获取/创建 AI 对话线程 ID */
  private async prepareThread(
    userId: string,
    conversationId?: string,
  ): Promise<string> {
    const conversation = await this.aiMemoryService.createOrGetAiConversation(
      userId,
      conversationId,
    );
    return conversation.threadId!;
  }

  /** Step 3 — 记录流开始前的消息数，用于后续增量 */
  private async snapshotBeforeStream(threadId: string): Promise<number> {
    const prevState = await this.compiledGraph!.getState({
      configurable: { thread_id: threadId },
    });
    return prevState?.values?.messages?.length ?? 0;
  }

  /** Step 3 — 通知前端"Thinking" */
  private broadcastThinking(
    conversationId: string | undefined,
    callbacks: { onStep: (step: string, data?: any) => void },
    memberIds: string[] = [],
  ): void {
    callbacks.onStep('thinking', { content: 'analyzing your question...' });
    if (conversationId) {
      this.eventsGateway.dispatchToConversation(
        conversationId,
        memberIds,
        SocketEvents.AI_STEP,
        {
          step: 'thinking',
          content: 'analyzing your question...',
        },
      );
    }
  }

  /** Step 4 — 执行 LangGraph 流，逐事件推给前端（委托给 ai-stream.handler） */
  private async runEventStream(
    threadId: string,
    message: string,
    userId: string,
    conversationId: string | undefined,
    entryPoint: string | undefined,
    metadata: Record<string, any> | undefined,
    callbacks: {
      onToken: (token: string) => void;
      onStep: (step: string, data?: any) => void;
    },
    memberIds: string[],
    signal?: AbortSignal,
    userMemory = '',
    actionContext: ActionContext | null = null,
  ): Promise<StreamUsageSummary> {
    return handleEventStream(
      this.compiledGraph!,
      threadId,
      message,
      userId,
      conversationId,
      entryPoint,
      metadata,
      this.registry,
      this.eventsGateway,
      callbacks,
      memberIds,
      signal,
      userMemory,
      actionContext,
    );
  }

  /** Step 5 — 收尾：三路分发 + 错误处理 */
  private async finalizeAfterStream(
    threadId: string,
    prevCount: number,
    userId: string,
    conversationId: string | undefined,
    callbacks: {
      onDone: (payload?: { sources?: RagCitation[] }) => void;
      onTransfer?: (reason: string) => void;
    },
    startedAt: number,
    tokenTotal: number,
    memberIds: string[],
    triggerMessageId?: string,
    streamUsage?: StreamUsageSummary,
    /** 用户本轮提问原文：门禁降级话术跟随它的语言 */
    userText?: string,
  ): Promise<{
    status: 'SUCCESS' | 'TRANSFERRED' | 'CONFIRM' | 'CONFIRM_REJECTED';
    finalState: any;
    newMessages: any[];
    ragSources: RagCitation[];
    transferReason: string;
  }> {
    // 读取最终状态
    const finalState = await this.compiledGraph!.getState({
      configurable: { thread_id: threadId },
    });
    let newMessages = (finalState?.values?.messages ?? []).slice(prevCount);
    const ragSources =
      (finalState?.values?.ragSources as RagCitation[] | undefined) ?? [];

    // 事实闸门：本轮没有 EXECUTED 动作时，不允许发布「已提交/已领取」类完成语。
    if (conversationId) {
      newMessages = await this.guardCompletionClaims(
        conversationId,
        startedAt,
        newMessages,
      );
    }

    // 运行时安全闸门：AI 只要在聊天里索要银行卡/身份证/密码，就不允许把
    // 这句原文发给用户；改写成安全话术并转人工。
    const SAFE_SENSITIVE_REPLY =
      '为了你的账户安全，请不要在聊天中提供银行卡号、身份证或密码。提现请到 App「我的 → 钱包 → 提现」操作，或由人工客服协助。';
    for (let index = newMessages.length - 1; index >= 0; index -= 1) {
      const candidate = newMessages[index];
      if (candidate?.type === 'ai' && isSensitiveRequest(candidate.content)) {
        newMessages[index] = {
          type: 'ai',
          content: SAFE_SENSITIVE_REPLY,
        };
        if (finalState?.values) {
          finalState.values.transferToHuman = true;
          finalState.values.transferReason = 'sensitive_request';
          finalState.values.pendingConfirm = null;
        }
        this.logger.warn(
          `[chatStream] sensitive request blocked: conv=${conversationId ?? 'n/a'}, action=transfer`,
        );
        break;
      }
    }

    // 新会话第一次进入某个 flowType 时绑定最新定义。
    // 已绑定的旧会话不会跟随升级；绑定失败只记日志，不影响本轮回复。
    const activeFlow = finalState?.values?.flowState?.activeFlow as
      | string
      | undefined;
    const flowStep = finalState?.values?.flowState?.step as string | undefined;
    void this.flowVersioning.ensureBindingQuietly(
      conversationId,
      activeFlow,
      flowStep,
    );

    // 持久化本轮 AI 对话：跨轮状态由 Postgres checkpointer 负责；
    // IM 消息由 AiReplyPublisher 写入 ChatMessage（这里不再维护 ai:hot 缓存）。

    // 先判定走向，再执行副作用；最后统一记一条 chat.done。
    let transferred = Boolean(finalState?.values?.transferToHuman);
    const confirmCard = Boolean(finalState?.values?.pendingConfirm);

    // ── 依据门禁 ──
    // 只在「最终回复已经生成、准备发布」这个单点判定，不散落在各个节点里。
    // shadow 只记录决定；enforce 才把「业务意图 + 完全无依据 + 非澄清」的回答
    // 换成转人工话术。确认卡与已转人工的轮次不改写（告别语本来就转人工）。
    const gateMode = readGroundingGateMode();
    if (gateMode !== 'off' && finalState?.values) {
      const finalReply = this.extractText(newMessages.at(-1)?.content) ?? '';
      const grounding = classifyGrounding({
        canned: isCannedReply(finalReply),
        ragSourceCount: ragSources.length,
        toolCallCount: countSuccessfulToolCalls(streamUsage?.toolSpans),
      });
      const clarificationOnly = isClarificationOnly(finalReply);
      const factualAssertion = hasFactualAssertion(finalReply);
      const intent =
        typeof finalState.values.intent === 'string'
          ? finalState.values.intent
          : null;
      const decision = decideGroundingGate({
        grounding,
        intent,
        clarificationOnly,
        factualAssertion,
      });

      finalState.values.groundingGate = {
        mode: gateMode,
        decision,
        grounding,
        intent,
        clarificationOnly,
        factualAssertion,
      };

      if (gateMode === 'enforce' && decision === 'degrade' && !transferred && !confirmCard) {
        // 模型没坏、知识库没命中：先确认再回答，别硬编。
        // 话术跟随问句语言：英文问题被降级后收到中文，等于这条链路对他不可用。
        const replacement = {
          type: 'ai',
          content: handoffReply('no_evidence', userText),
        };
        if (newMessages.length > 0) {
          newMessages[newMessages.length - 1] = replacement;
        } else {
          newMessages.push(replacement);
        }
        finalState.values.transferToHuman = true;
        finalState.values.transferReason = 'no_evidence';
        finalState.values.pendingConfirm = null;
        transferred = true;
        emitStage(
          'transfer',
          { source: 'grounding_gate', reason: 'no_evidence' },
          'warn',
        );
        incCounter('handoff_escalations_total', {
          reason: 'no_evidence',
          source: 'grounding_gate',
        });
        this.logger.warn(
          `[grounding-gate] degraded ungrounded reply: conv=${conversationId ?? 'n/a'}, intent=${intent ?? 'unknown'}`,
        );
      }
    }
    // 真正发出去的卡片才算 CONFIRM；守卫拦下（如序号当 ID）记 CONFIRM_REJECTED。
    let confirmCardCreated = false;
    // 原因由 orchestrator 经 transferReason 带下来（explicit_request / negative_sentiment / repeated_attempts）
    const transferReason =
      (finalState?.values?.transferReason as string | undefined) || 'unknown';

    // 只看 transferred，不再和 callbacks.onTransfer 做 && 判断：
    // 那个回调是"怎么通知"的手段，不该决定"走哪条路由"。
    // 否则调用方没传 onTransfer 时会静默走正常完成，而 chat.done 却记 transferred:true。
    if (transferred) {
      // 路由 A — 转人工（transfer 事件已在 orchestrator 节点发出，这里不重复记）
      await this.routeTransfer(
        userId,
        conversationId,
        transferReason,
        callbacks,
        memberIds,
        newMessages,
        triggerMessageId,
        userText,
      );
    } else if (confirmCard) {
      // 路由 B — 确认卡片（只发提问者本人的私有房间，见 routeConfirm 注释）
      const issued = await this.routeConfirm(
        userId,
        conversationId,
        finalState,
        triggerMessageId,
      );
      confirmCardCreated = issued.created;
      // 卡片轮次同样要收尾，否则客户端会一直停在「流式输入中」，
      // 卡片消失后留下一个闪烁光标和空气泡。
      if (conversationId) {
        this.eventsGateway.dispatchToUser(userId, SocketEvents.AI_DONE, {
          conversationId,
        });
      }
    } else {
      // 路由 C — 正常完成（写 chat_message + 双通道广播）
      await this.routeNormalCompletion(
        newMessages,
        userId,
        conversationId,
        memberIds,
        ragSources,
        triggerMessageId,
      );
      callbacks.onDone({ sources: ragSources });
      if (conversationId) {
        this.eventsGateway.dispatchToConversation(
          conversationId,
          memberIds,
          SocketEvents.AI_DONE,
          { conversationId },
        );
      }
    }

    emitStage('chat.done', {
      conversationId,
      totalMs: Date.now() - startedAt,
      transferred,
      confirmCard,
      tokenTotal,
      sourceCount: ragSources.length,
      answerLength: newMessages.at(-1)?.content?.length ?? 0,
    });

    return {
      status: resolveTurnStatus(transferred, confirmCard, confirmCardCreated),
      finalState,
      newMessages,
      ragSources,
      transferReason,
    };
  }

  /**
   * 一次正常回复收尾后写一条 trace。
   *
   * 为什么放在收尾之后：此时 finalState / 最终回复 / 转人工与确认标志都已知，
   * 一条记录即可覆盖 intent、rag、llm 三段，不需要在流程中间反复落库。
   * 为什么不 await 失败：TraceService 自己吞异常，这里不会让埋点拖垮对话。
   */
  private async recordReplyTrace(params: {
    message: string;
    userId: string;
    conversationId?: string;
    triggerMessageId?: string;
    startedAt: number;
    status: 'SUCCESS' | 'TRANSFERRED' | 'CONFIRM' | 'CONFIRM_REJECTED';
    finalState: any;
    newMessages: any[];
    ragSources: RagCitation[];
    transferReason?: string;
    streamUsage?: StreamUsageSummary;
  }): Promise<void> {
    if (!this.traceService || !params.conversationId) return;

    try {
      const values = params.finalState?.values ?? {};
      const flow = values.flowState ?? {};
      const intent =
        typeof values.intent === 'string' && values.intent
          ? values.intent
          : null;
      const lastMessage = params.newMessages[params.newMessages.length - 1];
      const output = this.extractText(lastMessage?.content);
      // trace 与 span 必须用同一份脱敏文本，否则 snippet 会泄露原文。
      const safeOutput = redactPiiText(output);
      const latencyMs = Date.now() - params.startedAt;
      const traceStart = new Date(params.startedAt);

      // 回链到本轮真正落库的 AI 消息：publishAiReply 用 triggerMessageId
      // 做唯一键，因此这里按它反查最稳，不需要改发布函数签名。
      const aiMessage = params.triggerMessageId
        ? await this.prismaService.chatMessage.findFirst({
            where: {
              triggerMessageId: params.triggerMessageId,
              source: 'ai',
            },
            orderBy: { seqId: 'desc' },
            select: { id: true },
          })
        : null;

      // 依据分型：这轮回答到底靠什么支撑（kb / tool / none / fallback）。
      // canned 必须用未脱敏原文判定——脱敏只改落库 snippet，不改「是不是兜底话术」。
      const toolCallCount = countSuccessfulToolCalls(
        params.streamUsage?.toolSpans,
      );
      const grounding: GroundingType = classifyGrounding({
        canned: isCannedReply(output),
        ragSourceCount: params.ragSources.length,
        toolCallCount,
      });

      // 检索是否尝试过、为什么跳过（未尝试 ≠ 尝试了但 0 候选）。
      const retrievalMeta =
        (values.retrievalMeta as
          | {
              attempted?: boolean;
              skipReason?: string | null;
              timedOut?: boolean;
            }
          | undefined) ?? null;

      // 门禁决定由 finalizeAfterStream 写入 state；这里只负责落库。
      const groundingGate =
        (values.groundingGate as
          | {
              mode: string;
              decision: GroundingGateDecision;
              grounding: GroundingType;
              intent: string | null;
              clarificationOnly: boolean;
              factualAssertion?: boolean;
            }
          | undefined) ?? null;

      // 提示词归因：主绑定写 trace 列，全部绑定写 metadata，供多 agent 场景下钻。
      const promptBinding =
        (values.promptBinding as
          | { name: string; version: number | null; source: 'db' | 'code' }
          | null
          | undefined) ?? null;
      const promptBindings = Array.isArray(values.promptBindings)
        ? (values.promptBindings as Array<{
            name: string;
            version: number | null;
            source: 'db' | 'code';
            agent?: string;
          }>)
        : [];

      // 工具调用留痕：type=tool，含工具名、状态、耗时与脱敏参数摘要。
      // 放在 rag 之后、llm 之前，时间线上就是「检索 → 调工具 → 生成回答」。
      const toolSpans: RecordTraceSpanInput[] = (
        params.streamUsage?.toolSpans ?? []
      ).map((tool) => ({
        type: 'tool',
        name: tool.name,
        status: tool.status,
        input: tool.argsSummary ? { argsSummary: tool.argsSummary } : undefined,
        startedAt: new Date(tool.startedAt),
        endedAt: new Date(tool.startedAt + tool.durationMs),
        durationMs: tool.durationMs,
      }));

      // 只保留链路骨架：intent → rag → tool → llm。
      // RAG 片段只留预览，避免把知识库全文再复制一份进追踪表。
      const spans: RecordTraceSpanInput[] = [
        {
          type: 'intent',
          name: 'intent-router',
          status: 'OK',
          output: {
            intent,
            previousIntent:
              typeof values.previousIntent === 'string'
                ? values.previousIntent
                : null,
          },
          startedAt: traceStart,
        },
        {
          type: 'rag',
          name: 'rag-retrieval',
          status: 'OK',
          output: {
            sourceCount: params.ragSources.length,
            sources: params.ragSources.slice(0, 5).map((source) => ({
              documentId: source.documentId,
              title: source.title,
              domain: source.domain,
              score: source.score,
              preview: source.content?.slice(0, 200) ?? null,
            })),
          },
          startedAt: traceStart,
        },
        ...toolSpans,
        {
          type: 'llm',
          name: 'llm-response',
          status: 'OK',
          output: {
            contentLength: output?.length ?? 0,
            snippet: safeOutput?.slice(0, 200) ?? null,
          },
          startedAt: traceStart,
          endedAt: new Date(params.startedAt + latencyMs),
          durationMs: latencyMs,
        },
      ];

      const trace = await this.traceService.recordTrace({
        conversationId: params.conversationId,
        triggerMessageId: params.triggerMessageId,
        aiMessageId: aiMessage?.id ?? null,
        userId: params.userId,
        intent,
        input: this.truncateText(redactPiiText(params.message), 1000),
        output: this.truncateText(safeOutput, 2000),
        status: params.status,
        latencyMs,
        promptTokens: params.streamUsage?.promptTokens,
        completionTokens: params.streamUsage?.completionTokens,
        // 列字段只存主绑定；多 agent 全部绑定见 metadata.promptBindings。
        promptName: promptBinding?.name ?? null,
        promptVersion: promptBinding?.version ?? null,
        metadata: {
          promptSource: promptBinding?.source ?? null,
          promptBindings: promptBindings.length > 0 ? promptBindings : undefined,
          flow: flow.activeFlow || undefined,
          step: flow.step || undefined,
          transferReason:
            params.status === 'TRANSFERRED' ? params.transferReason : undefined,
          ragSourceCount: params.ragSources.length,
          // 依据分型是验收口径的运行时来源；评测优先读它，缺失才回退推断。
          grounding,
          toolCallCount,
          retrieval: retrievalMeta
            ? {
                attempted: Boolean(retrievalMeta.attempted),
                skipReason: retrievalMeta.skipReason ?? null,
                timedOut: Boolean(retrievalMeta.timedOut),
              }
            : undefined,
          groundingGate: groundingGate ?? undefined,
          handoffState:
            params.status === 'TRANSFERRED' ? 'WAITING_HUMAN' : 'AI_ACTIVE',
          handoffReason: params.transferReason ?? undefined,
        },
        spans,
      });
      incCounter('ai_trace_recorded_total', {
        path: 'reply',
        result: trace ? 'ok' : 'skipped',
      });
    } catch (err: any) {
      incCounter('ai_trace_recorded_total', {
        path: 'reply',
        result: 'error',
      });
      // TraceService 已兜底，这里再兜一层，确保埋点永远不冒泡到对话主流程。
      this.logger.warn(`[recordReplyTrace] skipped: ${err?.message ?? err}`);
    }
  }

  /** 本轮在收尾前失败时补一条 ERROR trace（无最终 state）。 */
  private async recordErrorTrace(params: {
    message: string;
    userId: string;
    conversationId?: string;
    triggerMessageId?: string;
    startedAt: number;
    error: any;
  }): Promise<void> {
    if (!this.traceService || !params.conversationId) return;

    try {
      const latencyMs = Date.now() - params.startedAt;
      const errorMessage = String(
        params.error?.message ?? params.error ?? 'unknown error',
      );

      const trace = await this.traceService.recordTrace({
        conversationId: params.conversationId,
        triggerMessageId: params.triggerMessageId,
        userId: params.userId,
        input: this.truncateText(redactPiiText(params.message), 1000),
        status: 'ERROR',
        latencyMs,
        metadata: { errorName: params.error?.name ?? 'Error' },
        spans: [
          {
            type: 'llm',
            name: 'llm-response',
            status: 'ERROR',
            error:
              this.truncateText(redactPiiText(errorMessage), 500) ?? undefined,
            startedAt: new Date(params.startedAt),
            endedAt: new Date(),
            durationMs: latencyMs,
          },
        ],
      });
      incCounter('ai_trace_recorded_total', {
        path: 'error',
        result: trace ? 'ok' : 'skipped',
      });
    } catch (err: any) {
      incCounter('ai_trace_recorded_total', {
        path: 'error',
        result: 'error',
      });
      this.logger.warn(`[recordErrorTrace] skipped: ${err?.message ?? err}`);
    }
  }

  /** 把字符串/多段 content 统一成纯文本；未知结构返回 null。 */
  private extractText(content: unknown): string | null {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (
            part &&
            typeof part === 'object' &&
            typeof (part as { text?: unknown }).text === 'string'
          ) {
            return (part as { text: string }).text;
          }
          return '';
        })
        .join('');
      return text || null;
    }
    return null;
  }

  /** 截断埋点文本，避免大 payload 写穿 DB / 管理端渲染卡顿。 */
  private truncateText(
    value: string | null | undefined,
    max: number,
  ): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value);
    if (!text) return null;
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  /** 路由 A — 标记转人工 */
  private async routeTransfer(
    userId: string,
    conversationId: string | undefined,
    reason: string,
    callbacks: { onTransfer?: (reason: string) => void },
    memberIds: string[] = [],
    /**
     * 本轮新增的消息（含 orchestrator 生成的那句"正在为您转接"）。
     * 转人工以前只发一个 AI_TRANSFER 事件、不落库：LLM 生成的话被直接丢掉，
     * 用户重进对话看不到任何转接记录，线上排查时也看不出 AI 说过什么。
     */
    newMessages: any[] = [],
    triggerMessageId?: string,
    /** 用户本轮提问原文：兜底/离线话术跟随它的语言 */
    userText?: string,
  ): Promise<void> {
    let targetConvId = conversationId;

    // 转人工即撤销待确认动作：否则用户/攻击者还能用未过期的卡片完成提现。
    if (targetConvId) {
      try {
        await this.actionLifecycle?.markTransferred?.(targetConvId);
      } catch (err: any) {
        this.logger.warn(
          `[routeTransfer] markTransferred failed: ${err?.message ?? err}`,
        );
      }
      // 待 OTP 任务也要从 Redis 撤掉，否则 resend/cancel 还能拿到它。
      // 清理是尽力而为：失败不能阻断转人工本身。
      try {
        await this.aiActionConfirmService?.clearPendingExecution?.(userId);
      } catch {
        /* best effort */
      }
    }

    if (!targetConvId) {
      const conv = await this.prismaService.conversation.findFirst({
        where: { type: 'SUPPORT', members: { some: { userId } } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      if (conv) targetConvId = conv.id;
    }
    if (targetConvId) {
      // 转人工前先看有没有客服在线：无人在线时入队只会让用户空等，
      // 改为留一条 callback 元数据 + 离线提示，AI 继续服务。
      const mode = await this.resolveTransferMode();
      incCounter('handoff_escalations_total', {
        reason,
        source: mode === 'offline' ? 'offline' : 'online',
      });
      if (mode === 'offline') {
        await this.routeOfflineTransfer(
          targetConvId,
          userId,
          reason,
          memberIds,
          triggerMessageId,
          userText,
        );
      } else {
        await this.prismaService.conversation.update({
          where: { id: targetConvId },
          data: {
            handlerId: 'awaiting_human',
            handlerAssignedAt: new Date(),
            // 排队起点只认 transferredAt：handlerAssignedAt 表示最后人工活动，不是排队时间，
            // 拿它算排队时长/排序会让"刚发过消息的用户"排到队尾
            transferredAt: new Date(),
            transferReason: reason,
          },
        });

        // 先把 AI 的告别语写进 chat_message（双通道广播），再发转人工事件：
        // 顺序反了的话，客户端会先收到"已转人工"、后收到本应在前的那句回复。
        // 落库失败不能吞掉转人工事件，所以单独 try/catch。
        if (newMessages.length > 0) {
          try {
            await publishAiReply(
              this.prismaService,
              this.eventsGateway,
              this.eventEmitter,
              targetConvId,
              newMessages,
              userId,
              memberIds,
              undefined,
              triggerMessageId,
            );
          } catch (err: any) {
            this.logger.warn(
              `[chatStream] publish transfer message failed: ${err?.message}`,
            );
          }
        }

        this.eventsGateway.dispatchToConversation(
          targetConvId,
          memberIds.length > 0 ? memberIds : [userId],
          SocketEvents.AI_TRANSFER,
          {
            conversationId: targetConvId,
            reason,
            mode: 'online',
          },
        );

        // 客服侧：让所有在线客服的「待接入」列表立即出现这条（#98 AC-1）
        this.eventEmitter.emit(
          CHAT_EVENTS.SUPPORT_QUEUE_CHANGED,
          new SupportQueueChangedEvent(
            targetConvId,
            'transferred',
            'awaiting_human',
          ),
        );

        // 隐式反馈：转人工是“AI 没解决”的线索，进入待标注池
        void this.aiFeedbackService
          .recordImplicit({
            conversationId: targetConvId,
            userId,
            signal: 'transferred',
            metadata: { reason, mode: 'online' },
          })
          .catch(() => undefined);
      }
    }
    // SSE 调用方（POST + GET /chat/stream 老协议）靠这个回调收尾，
    // 之前从未被调用过 → 客户端只看到连接关闭，不知道已经转人工
    callbacks.onTransfer?.(reason);
  }

  /** HANDOFF_PRESENCE_CHECK_ENABLED 默认 true；显式 false 时跳过在线检查 */
  private isPresenceCheckEnabled(): boolean {
    try {
      const raw = this.configService.get<unknown>(
        'HANDOFF_PRESENCE_CHECK_ENABLED',
      );
      if (raw === undefined || raw === null || String(raw).trim() === '') {
        return true;
      }
      return !['false', '0', 'no', 'off'].includes(
        String(raw).trim().toLowerCase(),
      );
    } catch {
      // 配置读取失败时保守地照旧走在线分支
      return true;
    }
  }

  /**
   * 转人工分支判定：在线 → 入队；离线 → 留言。
   * 检查关闭、探测器缺失或探测异常时都按在线处理（fail-open）。
   */
  private async resolveTransferMode(): Promise<'online' | 'offline'> {
    if (!this.isPresenceCheckEnabled() || !this.handoffPresence)
      return 'online';
    try {
      const presence = await this.handoffPresence.isAnyAgentOnline();
      return presence.online ? 'online' : 'offline';
    } catch (err: any) {
      this.logger.warn(
        `[chatStream] presence check failed, assume online: ${err?.message ?? err}`,
      );
      return 'online';
    }
  }

  /**
   * 离线转人工：不进入排队（handlerId 保持 null），只落一条 callback 元数据、
   * 一句留言提示，并通知端上走离线横幅。留言由客服在管理端“留言/待回电”处理。
   */
  private async routeOfflineTransfer(
    targetConvId: string,
    userId: string,
    reason: string,
    memberIds: string[],
    triggerMessageId?: string,
    /** 用户本轮提问原文：离线留言提示要跟随它的语言 */
    userText?: string,
  ): Promise<void> {
    const requestedAt = new Date();

    try {
      // 原子合并：只替换 handoffCallback，保留 trafficSource / 复位标记等。
      // 不写 handlerId/transferredAt，避免被排队 sweep 认领。
      await setHandoffCallbackPending(
        this.prismaService,
        targetConvId,
        reason,
        requestedAt,
      );
    } catch (err: any) {
      this.logger.warn(
        `[chatStream] persist offline callback failed: ${err?.message}`,
      );
    }

    try {
      await publishAiReply(
        this.prismaService,
        this.eventsGateway,
        this.eventEmitter,
        targetConvId,
        [{ type: 'ai', content: handoffReply('offline_handoff', userText) }],
        userId,
        memberIds,
        undefined,
        triggerMessageId,
      );
    } catch (err: any) {
      this.logger.warn(
        `[chatStream] publish offline notice failed: ${err?.message}`,
      );
    }

    this.eventsGateway.dispatchToConversation(
      targetConvId,
      memberIds.length > 0 ? memberIds : [userId],
      SocketEvents.AI_TRANSFER,
      { conversationId: targetConvId, reason, mode: 'offline' },
    );

    // 线下留言同样计入隐式反馈：用户明确表达了“需要人”的意图
    void this.aiFeedbackService
      .recordImplicit({
        conversationId: targetConvId,
        userId,
        signal: 'transferred',
        metadata: { reason, mode: 'offline' },
      })
      .catch(() => undefined);
  }

  /** 路由 B — 发送确认卡片事件（返回是否真的建卡） */
  private async routeConfirm(
    userId: string,
    conversationId: string | undefined,
    finalState: any,
    triggerMessageId?: string,
  ): Promise<{ requestId: string | null; created: boolean }> {
    const pc = finalState.values.pendingConfirm;
    if (!pc?.action || !conversationId) {
      return { requestId: null, created: false };
    }
    return this.issueConfirmCard({
      userId,
      conversationId,
      action: pc.action,
      params: pc.params ?? {},
      summary: pc.summary ?? {},
      triggerMessageId,
    });
  }

  /**
   * 建卡与发卡。routeConfirm 与「文字确认重发」共用同一条路径，
   * 保证两种入口展示/执行参数完全一致。
   */
  private async issueConfirmCard(input: {
    userId: string;
    conversationId: string;
    action: string;
    params: Record<string, any>;
    summary: Record<string, any>;
    triggerMessageId?: string;
  }): Promise<{ requestId: string | null; created: boolean }> {
    const { userId, conversationId, action, params, triggerMessageId } = input;

    // 目录外动作不发卡：确认时必然失败，只会留下死卡片。
    const catalogEntry = getCatalogEntryByAction(action);
    if (!catalogEntry) {
      await publishAiReply(
        this.prismaService,
        this.eventsGateway,
        this.eventEmitter,
        conversationId,
        [{ type: 'ai', content: '该操作暂不支持，请换个方式或联系人工客服。' }],
        userId,
        [],
      ).catch((err: any) => {
        this.logger.warn(
          `[routeConfirm] unsupported action message failed: ${err?.message ?? err}`,
        );
      });
      return { requestId: null, created: false };
    }

    // 展示参数只给人看；执行参数稍后由 buildParams 白名单生成。
    const displayArgs: Record<string, any> = { ...params };

    // 提现卡补全：手续费 + 到账金额（与 applyWithdraw 内算费公式一致：
    // fee = amount * feeRate + feeFixed, net = amount - fee）
    if (action === 'withdraw') {
      const channel = await this.prismaService.paymentChannel.findUnique({
        where: { id: Number(params.channelId), status: 1 },
      });
      if (channel && channel.type !== 2) {
        // 把「为什么被拒」和「可选哪些」说清楚：模型选错渠道时，
        // 只回一句“不支持”会让用户以为 GCash 本身不能提现。
        const withdrawChannels = await this.prismaService.paymentChannel
          .findMany({
            where: { type: 2, status: 1 },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, name: true },
          })
          .catch(() => []);
        const options = withdrawChannels
          .map((item) => `${item.name}（#${item.id}）`)
          .join('、');
        const content = options
          ? `你选择的渠道（#${params.channelId}）是充值渠道，不能提现。可提现渠道：${options}。请重新选择。`
          : `你选择的渠道（#${params.channelId}）是充值渠道，不能提现。请重新选择提现渠道。`;
        await publishAiReply(
          this.prismaService,
          this.eventsGateway,
          this.eventEmitter,
          conversationId,
          [{ type: 'ai', content }],
          userId,
          [],
        ).catch((err: any) => {
          this.logger.warn(
            `[routeConfirm] reject non-withdraw channel failed: ${err?.message ?? err}`,
          );
        });
        return { requestId: null, created: false };
      }
      if (channel) {
        const amount = new Prisma.Decimal(params.amount ?? 0);
        const feeRate = channel.feeRate || new Prisma.Decimal(0);
        const feeFixed = channel.feeFixed || new Prisma.Decimal(0);
        const fee = amount.mul(feeRate).add(feeFixed);
        const netAmount = amount.sub(fee);
        displayArgs.channelName = channel.name;
        displayArgs.fee = fee.toString();
        displayArgs.netAmount = netAmount.toString();
      }
    }

    // 领券动作先确认 couponId 真在可领取列表里。
    // 模型有时会把列表序号（"1"、"2"）当成 couponId，直接弹卡会让用户
    // 确认一张根本不存在的券；这里直接回消息让用户重选。
    let claimableCoupon: any = null;
    let claimableLookupOk = false;
    if (action === 'claim_coupon' && params?.couponId) {
      try {
        const claimable =
          await this.clientCouponService.getClaimableCoupons(userId);
        claimableLookupOk = true;
        claimableCoupon = claimable.find(
          (item: any) =>
            item.couponId === params.couponId || item.id === params.couponId,
        );
      } catch (err: any) {
        this.logger.warn(
          `[routeConfirm] claimable lookup failed: ${err?.message ?? err}`,
        );
      }
    }
    if (claimableLookupOk && !claimableCoupon) {
      const rejection = await this.describeClaimRejectionFor(
        userId,
        params.couponId,
      );
      await publishAiReply(
        this.prismaService,
        this.eventsGateway,
        this.eventEmitter,
        conversationId,
        [{ type: 'ai', content: rejection }],
        userId,
        [],
      ).catch((err: any) => {
        this.logger.warn(
          `[routeConfirm] reject invalid coupon message failed: ${err?.message ?? err}`,
        );
      });
      return { requestId: null, created: false };
    }

    if (claimableCoupon?.couponName) {
      displayArgs.couponName = claimableCoupon.couponName;
    }

    // 执行参数只走目录白名单；模型夹带的额外字段不进入令牌/DB。
    const execParams = catalogEntry.buildParams(displayArgs);
    // 摘要由服务端渲染：账号/手机号已掩码，作为 socket 与聊天 meta 的唯一来源。
    const summary = catalogEntry.buildSummary(displayArgs);

    // 先生命周期记录，再发卡片：即使 socket 丢包，运营/评测仍能查到
    // 这次动作存在、等待确认、何时过期。
    let request: { id: string; expiresAt: Date } | null = null;
    if (conversationId && this.actionLifecycle) {
      try {
        request = await this.actionLifecycle.createConfirm({
          conversationId,
          userId,
          messageId: triggerMessageId ?? null,
          action,
          params: execParams,
          summary,
        });
      } catch (err: any) {
        // 状态记录失败不能阻断卡片；只留日志。
        this.logger.warn(
          `[routeConfirm] lifecycle create failed: ${err?.message ?? err}`,
        );
      }
    }

    const actionMeta = getConfirmActionMeta(action);
    // 展示字段由服务端从目录渲染，客户端只负责 title + fields；
    // 执行参数只存在服务端令牌里，客户端绝不用展示字段当执行参数。
    const fields = catalogEntry.buildFields(displayArgs);
    const needsOtp = catalogEntry.needsOtp;

    const { token, expiresAt } = await this.aiActionConfirmService.generate(
      userId,
      action,
      execParams,
      summary,
      request?.id,
      conversationId,
    );
    if (conversationId) {
      // 先发确认事件，再落聊天消息：
      // 驱动/客户端以 ai_confirm 作为卡片到达信号；如果先落 chat_message，
      // 客户端可能把它当普通回复处理，错过确认卡片。
      // 只发提问者本人的私有房间，不进会话房间：
      // payload 里带 confirmToken（一次性写操作凭证），
      // 谁在房间里都收得到就等于把凭证广播出去（#85 P0-2 / T1-4）
      this.eventsGateway.dispatchToUser(userId, SocketEvents.AI_CONFIRM, {
        conversationId,
        action,
        // 向后兼容：旧客户端读 summary；新客户端读 title + fields。
        summary,
        title: actionMeta?.title ?? action,
        fields,
        needsOtp,
        confirmToken: token,
        expiresAt,
        requestId: request?.id ?? null,
      });
      incCounter('ai_action_total', {
        action,
        result: 'created',
      });

      // 落一条可见消息：以前确认卡片只发 socket，聊天记录里看不到，
      // 运营会以为 AI 没回复。卡片本身仍走 AI_CONFIRM 私有房间。
      const actionLabel = actionMeta?.title ?? action;
      // 卡片本身是临时 UI；聊天记录里要保留用户看到的内容，
      // 否则卡片消失或重进会话后，用户只看到“请确认”却不知道确认什么。
      const detailLines = (fields as Array<{ label: string; value: string }>)
        .map((item) => `- ${item.label}：${item.value}`)
        .join('\n');
      await publishAiReply(
        this.prismaService,
        this.eventsGateway,
        this.eventEmitter,
        conversationId,
        [
          {
            type: 'ai',
            content: detailLines
              ? `请确认：${actionLabel}\n${detailLines}\n确认后才会执行，60 秒内有效。`
              : `请确认：${actionLabel}。确认后才会执行，60 秒内有效。`,
          },
        ],
        userId,
        [],
        {
          kind: 'confirm_card',
          action,
          title: actionMeta?.title ?? action,
          fields,
          needsOtp,
          requestId: request?.id ?? null,
          expiresAt,
          summary,
        },
        triggerMessageId,
      ).catch((err: any) => {
        this.logger.warn(
          `[routeConfirm] persist card message failed: ${err?.message ?? err}`,
        );
      });
    }

    return { requestId: request?.id ?? null, created: true };
  }

  /** 守卫拒绝发卡时，查出真实原因用于用户提示；查询失败给通用提示。 */
  private async describeClaimRejectionFor(
    userId: string,
    couponId: string,
  ): Promise<string> {
    try {
      const [coupon, claimedCount] = await Promise.all([
        this.prismaService.coupon.findUnique({ where: { id: couponId } }),
        this.prismaService.userCoupon.count({ where: { userId, couponId } }),
      ]);
      return describeClaimRejection({ coupon, claimedCount });
    } catch (err: any) {
      this.logger.warn(
        `[routeConfirm] describe claim rejection failed: ${err?.message ?? err}`,
      );
      return '这张券当前不可领取，请重新选择。';
    }
  }

  /**
   * 文字「确认」的确定性分支：绑定最近一次写动作，不进入意图分类。
   * 返回 true 表示已处理并发布回复，调用方应跳过 graph。
   *
   * 关键：文字确认不直接执行写操作——只重发卡片，执行仍要用户点卡片。
   */
  private async handlePendingActionConfirmation(args: {
    userId: string;
    conversationId: string;
    message: string;
    startedAt: number;
    triggerMessageId?: string;
  }): Promise<boolean> {
    if (!isShortAffirmation(args.message)) return false;
    if (!this.actionContextService) return false;

    const ctx = await this.actionContextService.loadLatest(args.conversationId);
    if (!ctx) return false;

    // 只绑定「刚刚」的动作。几小时前的过期卡不应劫持用户对当前上下文的
    // 「确认」：模型可能刚给了新的文字预览（还没建卡），此时回一句「已过期」
    // 会把用户带进死路。终态动作超过宽限期就交给 graph 按当前上下文处理。
    if (ctx.status !== 'CONFIRM_CREATED' && ctx.status !== 'CONFIRMED') {
      const expiresAtMs = ctx.expiresAt ? Date.parse(ctx.expiresAt) : 0;
      if (!expiresAtMs || Date.now() - expiresAtMs > CONFIRM_GATE_GRACE_MS) {
        return false;
      }
    }

    if (ctx.status === 'CONFIRM_CREATED' && !ctx.expired) {
      // 旧卡片先作废，再发新卡；仍要求用户点卡片。
      if (this.actionLifecycle) {
        await this.actionLifecycle
          .expireForConversation(args.conversationId)
          .catch(() => undefined);
      }
      const params = ctx.params ?? {};
      const issued =
        Object.keys(params).length > 0
          ? await this.issueConfirmCard({
              userId: args.userId,
              conversationId: args.conversationId,
              action: ctx.action,
              params,
              summary: ctx.summary,
              triggerMessageId: args.triggerMessageId,
            })
          : { requestId: null, created: false };

      await this.publishDeterministicReply(
        args,
        issued.created
          ? '请点击上方卡片确认（60 秒内有效）。'
          : '这张卡片已失效，请重新告诉我你要办理的业务。',
      );
      this.recordConfirmationGateTrace(
        args,
        issued.created ? 'CONFIRM_REISSUED' : 'CONFIRM_REJECTED',
        ctx,
      );
      return true;
    }

    if (ctx.status === 'CONFIRMED') {
      await this.publishDeterministicReply(
        args,
        '验证码已发送，请输入短信验证码完成操作。',
      );
      this.recordConfirmationGateTrace(args, 'OTP_PENDING', ctx);
      return true;
    }

    await this.publishDeterministicReply(
      args,
      '上一张卡片已过期或已处理，请重新发起。',
    );
    this.recordConfirmationGateTrace(args, 'CONFIRM_EXPIRED', ctx);
    return true;
  }

  /**
   * 聊天框里的 6 位数字：如果当前有 CONFIRMED 的提现动作，直接当作 OTP 提交。
   *
   * 用户习惯在底部聊天框输验证码；如果放行给 graph，模型会把它当成新的
   * 提现请求再建一张卡，和待执行任务冲突（实测会报「已有待验证的提现」）。
   */
  private async handleOtpInChat(args: {
    userId: string;
    conversationId: string;
    message: string;
    startedAt: number;
    triggerMessageId?: string;
  }): Promise<boolean> {
    if (!isOtpCode(args.message)) return false;
    if (!this.actionContextService) return false;

    const ctx = await this.actionContextService.loadLatest(args.conversationId);
    if (!ctx || ctx.status !== 'CONFIRMED') return false;

    try {
      await this.confirmWithdrawOtp(args.message.trim(), args.userId);
      this.recordConfirmationGateTrace(args, 'OTP_VERIFIED', ctx);
    } catch (err: any) {
      this.recordConfirmationGateTrace(args, 'OTP_FAILED', ctx);
      // 验码失败没有终态结果事件；给用户一条可读提示。
      // 其他错误（CAS 失败/执行失败）已经由 confirmWithdrawOtp 自己发过结果。
      const message = String(err?.message ?? '');
      if (/Invalid OTP|No pending withdraw/i.test(message)) {
        await this.publishDeterministicReply(
          args,
          '验证码不正确或已过期，请重新发送验证码后再试。',
        );
      }
    }
    return true;
  }

  private async publishDeterministicReply(
    args: { userId: string; conversationId: string; triggerMessageId?: string },
    content: string,
  ): Promise<void> {
    await publishAiReply(
      this.prismaService,
      this.eventsGateway,
      this.eventEmitter,
      args.conversationId,
      [{ type: 'ai', content }],
      args.userId,
      [],
      undefined,
      args.triggerMessageId,
    ).catch((err: any) => {
      this.logger.warn(
        `[confirm-gate] publish reply failed: ${err?.message ?? err}`,
      );
    });
  }

  /**
   * 发布前事实闸门：把没有 EXECUTED 动作支撑的「完成语」改写成未完成。
   * 查询失败时 fail-open（保留原文）并记 warn，避免闸门本身阻断对话。
   */
  private async guardCompletionClaims(
    conversationId: string,
    startedAt: number,
    messages: any[],
  ): Promise<any[]> {
    const claimIndexes = messages
      .map((message, index) => ({ message, index }))
      .filter(
        ({ message }) =>
          message?.type === 'ai' &&
          detectCompletionClaim(String(message.content ?? '')),
      );
    if (claimIndexes.length === 0) return messages;

    try {
      const executed = await this.prismaService.aiActionRequest.findFirst({
        where: {
          conversationId,
          status: 'EXECUTED',
          updatedAt: { gte: new Date(startedAt) },
        },
        select: { id: true },
      });
      if (executed) return messages;
    } catch (err: any) {
      this.logger.warn(
        `[claim-guard] evidence lookup failed: ${err?.message ?? err}`,
      );
      return messages;
    }

    const next = [...messages];
    for (const { index } of claimIndexes) {
      next[index] = { ...next[index], content: CLAIM_NOT_EXECUTED_REPLY };
    }
    incCounter('ai_claim_guard_total', { result: 'rewritten' });
    this.logger.warn(
      `[claim-guard] rewrote ${claimIndexes.length} unsupported completion claim(s), conv=${conversationId}`,
    );
    return next;
  }

  private recordConfirmationGateTrace(
    args: {
      userId: string;
      conversationId: string;
      startedAt: number;
      message: string;
      triggerMessageId?: string;
    },
    status:
      | 'CONFIRM_REISSUED'
      | 'CONFIRM_REJECTED'
      | 'OTP_PENDING'
      | 'CONFIRM_EXPIRED'
      | 'OTP_VERIFIED'
      | 'OTP_FAILED',
    ctx: ActionContext,
  ): void {
    if (!this.traceService) return;
    void this.traceService
      .recordTrace({
        conversationId: args.conversationId,
        triggerMessageId: args.triggerMessageId,
        userId: args.userId,
        input: this.truncateText(redactPiiText(args.message), 1000),
        status,
        latencyMs: Date.now() - args.startedAt,
        metadata: {
          gate: 'confirm',
          action: ctx.action,
          actionStatus: ctx.status,
          requestId: ctx.requestId,
        },
        spans: [],
      })
      .catch((err: any) => {
        this.logger.warn(`[confirm-gate] trace failed: ${err?.message ?? err}`);
      });
  }

  /**
   * AI 确认卡片执行入口（P1-1）
   *
   * 用户点卡片[确认] → Flutter 调 POST /ai/customer/confirm → 本方法：
   *   ① consume(token) 校验：一次性 + 60s 过期 + userId 匹配
   *   ② 校验通过 → 按 action 分发到对应业务 service 执行
   *
   * 关键不变式：写操作只有一个执行点（这里，用户确认之后），服务端绝不先执行。
   */

  async confirmAction(token: string, userId: string) {
    const payload = await this.aiActionConfirmService.consume(token, userId);
    if (!payload) {
      throw new BadRequestException('Confirm token invalid or expired');
    }
    const { action, params, summary, requestId } = payload;

    // 动作目录是唯一事实源：未知 action 直接失败终态，不执行任何写操作。
    const entry = getCatalogEntryByAction(action);
    if (!entry) {
      const message = `Unknown confirm action: ${action}`;
      await this.actionLifecycle?.markFailed(requestId, message);
      incCounter('ai_action_total', { action, result: 'failed' });
      this.emitActionResult(payload, false, message);
      throw new BadRequestException(message);
    }

    try {
      // 执行权威在 DB：令牌只是一把钥匙，必须对应一条仍可确认的动作记录。
      // CAS 同时挡住「DB 已 EXPIRED/TRANSFERRED」与「两个并发确认」。
      if (!requestId) {
        throw new BadRequestException(
          'Confirm request expired or already handled',
        );
      }
      // 卡片令牌 60s 只是「点确认」的窗口；提现点完还要看短信、输 6 位码。
      // 把 DB 的 expiresAt 延长到 OTP 有效期 + 30s，否则用户在最后几秒确认后
      // 只剩几秒输码，即使 OTP 本身还有 5 分钟也会被 CAS 拒绝。
      const confirmedData: Prisma.AiActionRequestUpdateManyMutationInput = {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      };
      if (entry.needsOtp) {
        const otpTtlSec = Number(process.env.OTP_TTL_SECONDS) || 300;
        confirmedData.expiresAt = new Date(
          Date.now() + (otpTtlSec + 30) * 1000,
        );
      }

      const cas = await this.prismaService.aiActionRequest.updateMany({
        where: {
          id: requestId,
          status: 'CONFIRM_CREATED',
          expiresAt: { gt: new Date() },
        },
        data: confirmedData,
      });
      if (cas.count !== 1) {
        const message = 'Confirm request expired or already handled';
        await this.actionLifecycle?.markFailed(requestId, message);
        incCounter('ai_action_total', { action, result: 'failed' });
        this.emitActionResult(payload, false, message);
        throw new BadRequestException(message);
      }

      const result = await entry.execute({
        userId,
        params,
        summary: summary ?? {},
        requestId,
        conversationId: payload.conversationId,
        services: this.buildActionServices(),
      });

      if (entry.needsOtp) {
        // 提现：确认后只发 OTP，真正执行在 confirmWithdrawOtp。
        incCounter('ai_action_total', { action, result: 'confirmed' });
        return result;
      }

      await this.actionLifecycle?.markExecuted(requestId, result);
      incCounter('ai_action_total', { action, result: 'executed' });
      this.emitActionResult(payload, true, entry.successMessage);
      return result;
    } catch (err: any) {
      const message = err?.message ?? String(err);
      // 审计继续记原始英文错误；用户只看到中文可读结果。
      const userMessage =
        action === 'claim_coupon' ? localizeClaimError(message) : message;
      await this.actionLifecycle?.markFailed(requestId, message);
      incCounter('ai_action_total', { action, result: 'failed' });
      this.emitActionResult(payload, false, userMessage);
      if (userMessage !== message) {
        throw new BadRequestException(userMessage);
      }
      throw err;
    }
  }

  /**
   * 用户主动取消确认卡片：owner 校验消费令牌，动作记录置 CANCELLED。
   * 重复取消 / 跨用户 / 已过期统一拒绝，且不泄露令牌归属。
   */
  async cancelAction(token: string, userId: string, requestId?: string) {
    const payload = await this.aiActionConfirmService.consume(token, userId);
    if (payload) {
      await this.actionLifecycle?.markCancelled(payload.requestId);
      incCounter('ai_action_total', {
        action: payload.action,
        result: 'cancelled',
      });
      return { cancelled: true };
    }

    // 提现已经确认、正在等 OTP 时，卡片 token 已被消费。
    // 此时取消应该撤销待执行任务，而不是报“token 无效”。
    const pending =
      await this.aiActionConfirmService.peekPendingExecution(userId);
    if (!pending) {
      throw new BadRequestException('Confirm token invalid or expired');
    }
    if (requestId && pending.requestId && requestId !== pending.requestId) {
      throw new BadRequestException('Confirm token invalid or expired');
    }
    if (!requestId) {
      // 兼容旧客户端：Flutter 尚未提交 requestId 时保留按用户取消，
      // 但记录 warn，便于上线后确认是否还有旧版本调用。
      this.logger.warn(
        `[cancel] requestId missing; falling back to userId-scoped pending cancel, user=${userId}`,
      );
    }
    const consumed =
      await this.aiActionConfirmService.popPendingExecution(userId);
    if (!consumed) {
      throw new BadRequestException(
        'Pending withdraw action expired, please try again',
      );
    }
    await this.actionLifecycle?.markCancelled(consumed.requestId);
    incCounter('ai_action_total', {
      action: consumed.action,
      result: 'cancelled',
    });
    return { cancelled: true };
  }

  /** 重新发送提现验证码（仍绑定当前待执行任务）。 */
  async resendWithdrawOtp(userId: string) {
    const pending =
      await this.aiActionConfirmService.peekPendingExecution(userId);
    if (!pending) {
      throw new BadRequestException('No pending withdraw action found');
    }

    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!user || !user.phone) {
      throw new BadRequestException('User phone not found');
    }

    await this.otpService.request({
      phone: user.phone,
      codeType: CODE_TYPE.WITHDRAW,
    });

    const otpTtlSec = Number(process.env.OTP_TTL_SECONDS) || 300;
    return {
      sent: true,
      message: '验证码已重新发送',
      otpExpiresAt: Date.now() + otpTtlSec * 1000,
    };
  }

  /**
   * 动作结果事件：先把结果写进会话，再走私有房间通知。
   *
   * 只发 socket 的话，客户端本地没保存、换设备/重进会话就看不到；
   * 结果消息必须和普通 AI 回复一样落 ChatMessage。
   */
  private emitActionResult(
    payload: { conversationId?: string; action?: string; userId: string },
    success: boolean,
    message: string,
  ): void {
    if (!payload.conversationId) return;

    // 先发事件：客户端状态更新不应等落库。
    this.eventsGateway.dispatchToUser(
      payload.userId,
      SocketEvents.AI_ACTION_RESULT,
      {
        conversationId: payload.conversationId,
        action: payload.action ?? null,
        success,
        message,
      },
    );

    // 再把结果写进会话，保证换设备/重进会话仍能看到。
    void publishAiReply(
      this.prismaService,
      this.eventsGateway,
      this.eventEmitter,
      payload.conversationId,
      [{ type: 'ai', content: message }],
      payload.userId,
      [],
      { kind: 'action_result', action: payload.action ?? null, success },
    ).catch((err: any) =>
      this.logger.warn(
        `[emitActionResult] persist result message failed: ${err?.message ?? err}`,
      ),
    );
  }

  /** 把业务服务适配成动作目录要求的执行接口。 */
  private buildActionServices(): ActionExecutionServices {
    return {
      claimCoupon: (uid, couponId) =>
        this.clientCouponService.claimCoupon(uid, couponId, 2),
      redeemCouponCode: (uid, code) =>
        this.clientCouponService.redeemCode(uid, code),
      draw: (uid, ticketId) => this.luckyDrawService.draw(uid, ticketId),
      createAddress: (uid, params) => this.executeCreateAddress(uid, params),
      updateAddress: (uid, addressId, params) =>
        this.executeUpdateAddress(uid, addressId, params),
      deleteAddress: (uid, addressId) =>
        this.addressService.delete(uid, addressId),
      startWithdrawOtp: (uid, params, summary, requestId, conversationId) =>
        this.startWithdrawOtp(uid, params, summary, requestId, conversationId),
    };
  }

  /** 新增地址：确认时把卡片里的文本省市区解析成 ID，并用完整参数执行。 */
  private async executeCreateAddress(
    userId: string,
    params: Record<string, any>,
  ) {
    const geo = await this.addressService.resolveGeoIds(
      params.province,
      params.city,
      params.barangay,
    );
    const dto: CreateAddressDto = {
      contactName: params.contactName,
      phone: params.phone,
      provinceId: geo.provinceId,
      cityId: geo.cityId,
      barangayId: geo.barangayId,
      fullAddress: params.fullAddress,
      label: params.label,
      isDefault: params.isDefault ? 1 : 0,
    };
    return this.addressService.create(userId, dto);
  }

  /** 修改地址：省市区三件套齐全才重新解析，否则沿用当前地址的 ID。 */
  private async executeUpdateAddress(
    userId: string,
    addressId: string,
    params: Record<string, any>,
  ) {
    // 读当前地址做兜底：局部更新（例如只改电话）不能把未提供的字段写成 null。
    const current = await this.addressService.detail(userId, addressId);

    let provinceId = current.provinceId;
    let cityId = current.cityId;
    let barangayId = current.barangayId;
    if (params.province && params.city && params.barangay) {
      const geo = await this.addressService.resolveGeoIds(
        params.province,
        params.city,
        params.barangay,
      );
      provinceId = geo.provinceId;
      cityId = geo.cityId;
      barangayId = geo.barangayId;
    }

    const dto = {
      contactName: params.contactName ?? current.contactName,
      phone: params.phone ?? current.phone,
      provinceId,
      cityId,
      barangayId,
      fullAddress: params.fullAddress ?? current.fullAddress,
      label: params.label ?? current.label,
      firstName: current.firstName ?? undefined,
      lastName: current.lastName ?? undefined,
      isDefault:
        params.isDefault === undefined ? undefined : params.isDefault ? 1 : 0,
    } as UpdateAddressDto;

    return this.addressService.update(userId, addressId, dto);
  }

  /** 提现确认后第一段：发 OTP + 暂存待执行参数（不执行提现）。 */
  private async startWithdrawOtp(
    userId: string,
    params: Record<string, any>,
    summary: Record<string, any>,
    requestId?: string,
    conversationId?: string,
  ) {
    // 先占位再发码：发码失败可回滚；两个并发确认只有一个能占位。
    const staged = await this.aiActionConfirmService.stagePendingExecution(
      userId,
      {
        action: 'withdraw',
        params,
        summary,
        userId,
        requestId,
        ...(conversationId ? { conversationId } : {}),
      },
    );
    if (!staged) {
      throw new BadRequestException('已有待验证的提现，请先完成或取消');
    }

    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        select: { phone: true },
      });
      if (!user || !user.phone) {
        throw new BadRequestException('User phone not found');
      }
      await this.otpService.request({
        phone: user.phone,
        codeType: CODE_TYPE.WITHDRAW,
      });
    } catch (err) {
      await this.aiActionConfirmService
        .clearPendingExecution(userId)
        .catch(() => undefined);
      throw err;
    }

    const otpTtlSec = Number(process.env.OTP_TTL_SECONDS) || 300;
    return {
      needOtp: true,
      message: '验证码已发送到绑定手机号，请输入 6 位验证码',
      otpExpiresAt: Date.now() + otpTtlSec * 1000,
    };
  }

  /**
   * 提现 OTP 验码并执行（P1-2 第二道闸门）
   * 用户输入验证码 → 本方法：
   *   ① peekPendingExecution 取出待执行任务（只读，验码失败时任务不丢）
   *   ② verify OTP（对用户手机号；OTP 原子核销，本身即可防重放）
   *   ③ popPendingExecution 验码通过才删除（getDel，最后一道防重放闸）
   *   ④ 真正执行 applyWithdraw
   */

  async confirmWithdrawOtp(code: string, userId: string) {
    const pending =
      await this.aiActionConfirmService.peekPendingExecution(userId);

    if (!pending) {
      throw new BadRequestException('No pending withdraw action found');
    }

    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!user || !user.phone) {
      throw new BadRequestException('User phone not found');
    }

    const isValidOtp = await this.otpService.verify({
      phone: user.phone,
      codeType: CODE_TYPE.WITHDRAW,
      code,
    });

    if (!isValidOtp) {
      // 输入错误是可重试事件，不发终态结果；由 HTTP 400 让客户端保留输入框。
      incCounter('ai_action_total', {
        action: 'withdraw',
        result: 'otp_invalid',
      });
      throw new BadRequestException('Invalid OTP code');
    }

    // 验码通过后才真正取走任务：getDel 原子读删，防"同一张单子执行两次"
    // OTP 已在 verify 里原子核销（PENDING→VERIFIED），并发请求只有一个能走到这里
    const consumed =
      await this.aiActionConfirmService.popPendingExecution(userId);
    if (!consumed) {
      this.emitActionResult(pending, false, '验证已过期，请重新发起提现');
      incCounter('ai_action_total', { action: 'withdraw', result: 'failed' });
      throw new BadRequestException(
        'Pending withdraw action expired, please try again',
      );
    }

    // 手搓 new ApplyWithdrawDto() 不会跑任何装饰器：
    // @IsNumber / @Min(100) 只有 validate() 才会执行。
    // whitelist + forbidNonWhitelisted：多余字段直接拒，不让 LLM 夹带的东西流到执行点。
    const { params } = consumed;
    const dto = plainToInstance(ApplyWithdrawDto, params);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      const detail = errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('; ');
      this.logger.warn(`[confirmWithdrawOtp] invalid params: ${detail}`);
      this.emitActionResult(consumed, false, '提现参数不合法，请重新发起');
      incCounter('ai_action_total', { action: 'withdraw', result: 'failed' });
      throw new BadRequestException(`Invalid withdraw parameters: ${detail}`);
    }
    try {
      // 执行前再确认 DB 仍是 CONFIRMED：转人工/过期后即使是合法 OTP 也不能执行。
      if (!consumed.requestId) {
        throw new BadRequestException(
          'Confirm request expired or already handled',
        );
      }
      const cas = await this.prismaService.aiActionRequest.updateMany({
        where: {
          id: consumed.requestId,
          status: 'CONFIRMED',
          expiresAt: { gt: new Date() },
        },
        data: { status: 'EXECUTED', executedAt: new Date() },
      });
      if (cas.count !== 1) {
        throw new BadRequestException(
          'Confirm request expired or already handled',
        );
      }

      // OTP 已在上方核销：直接调用唯一执行点，不再重复验码。
      const result = await this.clientWalletService.applyWithdrawVerified(
        userId,
        dto,
      );
      await this.actionLifecycle?.attachResult(consumed.requestId, result);
      incCounter('ai_action_total', { action: 'withdraw', result: 'executed' });
      this.emitActionResult(
        consumed,
        true,
        '提现申请已提交，预计 1-3 个工作日到账',
      );
      return result;
    } catch (err: any) {
      const message = err?.message ?? String(err);
      await this.actionLifecycle?.markFailed(consumed.requestId, message);
      incCounter('ai_action_total', { action: 'withdraw', result: 'failed' });
      this.emitActionResult(consumed, false, message);
      throw err;
    }
  }

  /** 路由 C — 写 chat_message + 广播（委托给 ai-reply-publisher） */
  private async routeNormalCompletion(
    newMessages: any[],
    userId: string,
    conversationId?: string,
    memberIds: string[] = [],
    sources: RagCitation[] = [],
    triggerMessageId?: string,
  ): Promise<void> {
    if (!conversationId) return;
    await publishAiReply(
      this.prismaService,
      this.eventsGateway,
      this.eventEmitter,
      conversationId,
      newMessages,
      userId,
      memberIds,
      sources.length > 0 ? { sources } : undefined,
      triggerMessageId,
    );
  }

  /**
   * 故障注入 —— 只为端到端自测
   * （scripts/ai-e2e-smoke.sh 的「模型故障降级」场景）
   *
   * 为什么需要它：要验证"模型挂了会降级转人工"，必须制造一次真实失败。
   * 改坏 API key 的做法要重启两次、期间整个容器不可用，而且进不了 CI。
   *
   * 三道闸门，缺一不可：
   *   ① 消息以 __CHAOS__ 开头 —— 普通消息在第一个判断就返回，零 IO、零开销
   *   ② NODE_ENV !== 'production' —— 生产环境物理上不可能触发
   *   ③ Redis 里 ai:chaos:fail 存在 —— 自测脚本临时设置，带 TTL 自动过期
   *
   * 抛出的错误会被 chatStream 的 catch 捕获，于是正常走
   * chat.error → handleStreamError → degradeToHuman，
   * 与"真实模型超时"走的是同一条代码路径。
   */
  private async maybeInjectChaos(message: string): Promise<void> {
    if (!message.startsWith(CHAOS_PREFIX)) return;
    if (process.env.NODE_ENV === 'production') return;
    if (!(await this.redisService.get(CHAOS_KEY))) return;
    throw new Error('chaos: injected LLM failure (e2e only)');
  }

  /**
   * 异常兜底：模型/网络挂了 ≠ 用户收不到回复，而是"这轮改由人工接"。
   *
   * 修复前（#87 N-15）只做两件事：记日志 + 发 AI_ERROR。
   * 后果是用户屏幕上什么都没有，会话还停在 AI 处理态 ——
   * 他再发一条还是同样失败，因为 handlerId 仍然是 null。
   *
   * 降级动作本身抽到 `ai-failure-handler.ts`：这里只负责"通知调用方"和
   * "在缺 conversationId 时不要产生写操作"，写库/广播的细节由那个文件保证。
   */
  private async handleStreamError(
    err: any,
    message: string,
    userId: string | undefined,
    conversationId: string | undefined,
    callbacks?: {
      onError: (err: Error) => void;
      onDone?: (payload?: { sources?: RagCitation[] }) => void;
      onTransfer?: (reason: string) => void;
    },
    memberIds: string[] = [],
    triggerMessageId?: string,
  ): Promise<void> {
    this.logger.error(`[chatStream] error: ${err.message}`);

    // 配额耗尽：给出真实原因，不伪装成模型故障或客服离线，也不转人工排队。
    if (
      err instanceof QuotaExceededError ||
      err instanceof SessionQuotaExceededError
    ) {
      this.logger.warn(
        `[chatStream] quota exceeded: conv=${conversationId ?? 'n/a'}, limit=${err.limit}, used=${err.used}`,
      );
      if (conversationId && userId) {
        await this.routeNormalCompletion(
          [{ type: 'ai', content: handoffReply('quota_exceeded', message) }],
          userId,
          conversationId,
          memberIds,
          [],
          triggerMessageId,
        ).catch((publishErr: any) => {
          this.logger.warn(
            `[chatStream] quota reply publish failed: ${publishErr?.message ?? publishErr}`,
          );
        });
        // 配额也是一条正常终态：给 SSE 客户端一个 done 帧，别让它一直等。
        callbacks?.onDone?.();
        this.eventsGateway.dispatchToUser(userId, SocketEvents.AI_DONE, {
          conversationId,
        });
      }
      return;
    }

    // 策略型兜底：有明确政策答案的问题（KYC 时长、配送时效、券过期、
    // 余额查询失败）不要无差别转人工；先给固定安全回复。
    if (conversationId && userId) {
      const fallback = policyFallback(message);
      if (fallback) {
        await this.routeNormalCompletion(
          [{ type: 'ai', content: fallback }],
          userId,
          conversationId,
          memberIds,
          [],
          triggerMessageId,
        ).catch((fallbackErr: any) => {
          this.logger.warn(
            `[chatStream] policy fallback publish failed: ${fallbackErr?.message ?? fallbackErr}`,
          );
        });
        this.logger.log(
          `[chatStream] policy fallback used: conv=${conversationId}`,
        );
        return;
      }
    }

    callbacks?.onError(err);

    if (!conversationId) return;

    this.eventsGateway.dispatchToConversation(
      conversationId,
      memberIds,
      SocketEvents.AI_ERROR,
      { content: err.message },
    );

    if (!userId) return;

    await degradeToHuman(
      {
        prisma: this.prismaService,
        gateway: this.eventsGateway,
        eventEmitter: this.eventEmitter,
        logger: this.logger,
        presence: this.handoffPresence,
        presenceCheckEnabled: this.isPresenceCheckEnabled(),
        aiFeedback: this.aiFeedbackService,
      },
      { conversationId, userId, memberIds, triggerMessageId, userText: message },
    );

    callbacks?.onTransfer?.('ai_error');
  }

  async testChat(
    message: string,
    userId: string,
    debug = false,
    sessionId?: string,
  ) {
    this.logger.log(`Testing chat classification: "${message}"`);
    if (!this.compiledGraph) {
      throw new Error('Graph not initialized. Call initGraph() first.');
    }

    const threadId = sessionId ?? `${userId}:${Date.now()}`;

    // testChat 也走 Agent 运行时：工具身份同样从请求上下文读取。
    const graph = this.compiledGraph;
    const result = await runWithContext({ userId }, () =>
      graph.invoke(
        {
          messages: [new HumanMessage(message)],
          userId: userId,
          debug,
        },
        {
          configurable: {
            thread_id: threadId,
          },
        },
      ),
    );

    // 从 messages 中取最后一条消息作为最终输出
    const allMessages = result.messages ?? [];
    const lastMsg = allMessages[allMessages.length - 1];
    const agentOutput =
      typeof lastMsg?.content === 'string' ? lastMsg.content : '';

    this.logger.log(
      `[testChat] result: intent="${result.intent}", labels=${JSON.stringify(result.labels ?? [])}, previousIntent="${result.previousIntent ?? ''}"`,
    );

    // debug=true 时返回完整流水线追踪数据
    const response: TestChatResult = {
      intent: result.intent ?? '',
      agentOutput,
      sources: result.ragSources ?? [],
      pendingConfirm: result.pendingConfirm ?? null,
    };
    if (debug) {
      response.debug = result.debugInfo ?? undefined;
    }

    return response;
  }
}
