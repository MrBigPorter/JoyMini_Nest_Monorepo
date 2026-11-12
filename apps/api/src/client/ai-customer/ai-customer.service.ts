import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { buildCustomerGraph } from '@api/client/ai-customer/graph/customer.graph';
import { ConfigService } from '@nestjs/config';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { EventsGateway } from '@api/common/events/events.gateway';
import { SocketEvents } from '@lucky/shared';
import { TestChatResult } from '@api/client/ai-customer/graph/types/agent-types';
import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { RagRetrievalService } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import { PromptResolverService } from '@api/client/ai-customer/knowledge/prompt-resolver.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import { AiMemoryService } from '@api/common/ai/ai-memory.service';
import { AiActionConfirmService } from './ai-action-confirm.service';
import { handleEventStream } from './ai-stream.handler';
import { publishAiReply } from './ai-reply-publisher';
import { AddressService } from '../address/address.service';
import { ClientWalletService } from '../wallet/client-wallet.service';
import { ClientCouponService } from '../coupon/coupon.service';
import { LuckyDrawService } from '@api/common/lucky-draw/lucky-draw.service';
import { ApplyWithdrawDto } from '../wallet/dto/apply-withdraw.dto';
import { OtpService } from '../otp/otp.service';
import { CODE_TYPE } from '@lucky/shared';
import { emitStage } from '@api/common/logger/structured-logger';
import { RedisService } from '@api/common/redis/redis.service';
import { degradeToHuman } from './ai-failure-handler';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/** 故障注入：只有以这个前缀开头的消息才会走检查（普通流量零开销） */
const CHAOS_PREFIX = '__CHAOS__';
/** Redis 开关名，自测脚本设置并带 TTL，忘删也会自己过期 */
const CHAOS_KEY = 'ai:chaos:fail';

@Injectable()
export class AiCustomerService {
  private readonly logger = new Logger(AiCustomerService.name);
  private compiledGraph: ReturnType<typeof buildCustomerGraph> | null = null;
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
    private readonly clientWalletService: ClientWalletService,
    private readonly clientCouponService: ClientCouponService,
    private readonly luckyDrawService: LuckyDrawService,
    private readonly addressService: AddressService,
    private readonly otpService: OtpService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 应用启动时初始化图谱
   * 1. 编译图谱，生成可执行的有向图
   * 2. 如果编译失败，抛出异常，阻止应用启动
   * 3. 如果编译成功，记录日志
   */
  async onModuleInit() {
    await this.initGraph();
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
      this.llmConfig = {
        type: this.configService.get<'online' | 'local'>(
          'AI_LLM_TYPE',
          'local',
        ),
        model: this.configService.get<string>('OLLAMA_MODEL', 'qwen3.5:0.8b'),
        baseURL: this.configService.get<string>(
          'AI_OLLAMA_BASE_URL',
          'http://localhost:11434',
        ),
        apiKey: this.configService.get<string>('DEEPSEEK_API_KEY'),
      };
      this.compiledGraph = buildCustomerGraph(
        this.llmConfig,
        this.registry,
        this.aiService,
        this.prismaService,
        this.meilisearchService,
        this.ragRetrievalService,
        this.promptResolver,
      );
    } catch (error) {
      this.logger.error('Failed to compile AiCustomer Graph', error);
      throw error;
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
      onDone: () => void;
      onError: (error: Error) => void;
      onTransfer?: (reason: string) => void;
    },
    conversationId?: string,
    entryPoint?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    // Step 1 — 校验入参
    if (!this.assertInputValid(message, userId, callbacks)) return;

    // 本轮对话的起点。chat.done / chat.error 用它算总耗时。
    const startedAt = Date.now();

    // 只记长度，不记原文（隐私约束，见 #89 FR-7）。
    emitStage('chat.start', {
      messageLength: message.length,
      conversationId,
      entryPoint,
    });

    // 会话成员列表：本轮只查一次，供"会话房间 + 成员私有房间"双通道推送使用。
    // 放在 try 外面声明、里面赋值，是为了 error 分支也能拿到（可能仍是空数组）。
    let memberIds: string[] = [];

    try {
      // 故障注入（仅测试）：故意抛错，用来验证降级转人工链路。
      // 放在 try 内部，才能走到 catch → chat.error → handleStreamError → degradeToHuman。
      await this.maybeInjectChaos(message);

      // Step 2 — 准备 AI 对话线程
      const threadId = await this.prepareThread(userId, conversationId);

      // 查成员不能影响对话主流程：失败就退化为只发会话房间
      memberIds = await this.resolveMemberIds(conversationId);

      // Step 3 — 记录快照 + 通知 Thinking
      const prevCount = await this.snapshotBeforeStream(threadId);
      this.broadcastThinking(conversationId, callbacks, memberIds);

      // Step 4 — 执行 LangGraph 流式推理（逐 token 推给前端）
      const streamUsage = await this.runEventStream(
        threadId,
        message,
        userId,
        conversationId,
        entryPoint,
        metadata,
        callbacks,
        memberIds,
      );

      // Step 5 — 收尾分发：转人工 / 确认卡片 / 正常完成
      await this.finalizeAfterStream(
        threadId,
        prevCount,
        userId,
        conversationId,
        callbacks,
        startedAt,
        streamUsage.totalTokens,
        memberIds,
      );
    } catch (err: any) {
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
      await this.handleStreamError(
        err,
        userId,
        conversationId,
        callbacks,
        memberIds,
      );
    }
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
  ): Promise<{ totalTokens: number }> {
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
    );
  }

  /** Step 5 — 收尾：三路分发 + 错误处理 */
  private async finalizeAfterStream(
    threadId: string,
    prevCount: number,
    userId: string,
    conversationId: string | undefined,
    callbacks: {
      onDone: () => void;
      onTransfer?: (reason: string) => void;
    },
    startedAt: number,
    tokenTotal: number,
    memberIds: string[],
  ): Promise<void> {
    // 读取最终状态
    const finalState = await this.compiledGraph!.getState({
      configurable: { thread_id: threadId },
    });
    const newMessages = (finalState?.values?.messages ?? []).slice(prevCount);

    // 持久化本轮 AI 对话
    if (newMessages.length > 0) {
      await this.aiMemoryService.saveContext(threadId, newMessages);
    }

    // 先判定走向，再执行副作用；最后统一记一条 chat.done。
    const transferred = Boolean(finalState?.values?.transferToHuman);
    const confirmCard = Boolean(finalState?.values?.pendingConfirm);
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
      );
    } else if (confirmCard) {
      // 路由 B — 确认卡片（只发提问者本人的私有房间，见 routeConfirm 注释）
      await this.routeConfirm(userId, conversationId, finalState);
    } else {
      // 路由 C — 正常完成（写 chat_message + 双通道广播）
      await this.routeNormalCompletion(
        newMessages,
        userId,
        conversationId,
        memberIds,
      );
      callbacks.onDone();
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
      answerLength: newMessages.at(-1)?.content?.length ?? 0,
    });
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
  ): Promise<void> {
    let targetConvId = conversationId;
    if (!targetConvId) {
      const conv = await this.prismaService.conversation.findFirst({
        where: { type: 'SUPPORT', members: { some: { userId } } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      if (conv) targetConvId = conv.id;
    }
    if (targetConvId) {
      await this.prismaService.conversation.update({
        where: { id: targetConvId },
        data: { handlerId: 'awaiting_human', handlerAssignedAt: new Date() },
      });

      // 先把 AI 的告别语写进 chat_message（双通道广播），再发转人工事件：
      // 顺序反了的话，客户端会先收到"已转人工"、后收到本应在前的那句回复。
      // 落库失败不能吞掉转人工事件，所以单独 try/catch。
      if (newMessages.length > 0) {
        try {
          await publishAiReply(
            this.prismaService,
            this.eventsGateway,
            targetConvId,
            newMessages,
            userId,
            memberIds,
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
        },
      );
    }
    // SSE 调用方（POST + GET /chat/stream 老协议）靠这个回调收尾，
    // 之前从未被调用过 → 客户端只看到连接关闭，不知道已经转人工
    callbacks.onTransfer?.(reason);
  }

  /** 路由 B — 发送确认卡片事件 */
  private async routeConfirm(
    userId: string,
    conversationId: string | undefined,
    finalState: any,
  ): Promise<void> {
    const pc = finalState.values.pendingConfirm;

    // 提现卡补全：手续费 + 到账金额（与 applyWithdraw 内算费公式一致：
    // fee = amount * feeRate + feeFixed，net = amount - fee）
    if (pc.action === 'withdraw') {
      const channel = await this.prismaService.paymentChannel.findUnique({
        where: { id: Number(pc.params.channelId), status: 1 },
      });
      if (channel) {
        const amount = new Prisma.Decimal(pc.params.amount ?? 0);
        const feeRate = channel.feeRate || new Prisma.Decimal(0);
        const feeFixed = channel.feeFixed || new Prisma.Decimal(0);
        const fee = amount.mul(feeRate).add(feeFixed);
        const netAmount = amount.sub(fee);
        pc.summary.fee = fee.toString();
        pc.summary.netAmount = netAmount.toString();
      }
    }

    const { token, expiresAt } = await this.aiActionConfirmService.generate(
      userId,
      pc.action,
      pc.params,
      pc.summary,
    );
    if (conversationId) {
      // 只发提问者本人的私有房间，不进会话房间：
      // payload 里带 confirmToken（一次性写操作凭证），
      // 谁在房间里都收得到就等于把凭证广播出去（#85 P0-2 / T1-4）
      this.eventsGateway.dispatchToUser(userId, SocketEvents.AI_CONFIRM, {
        conversationId,
        action: pc.action,
        summary: pc.summary,
        confirmToken: token,
        expiresAt,
      });
    }
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
    const { action, params } = payload;

    switch (action) {
      case 'withdraw': {
        // 提现走 OTP 双保险：先发验证码 + 暂存任务，验码后（confirmWithdrawOtp）才真正执行
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

        await this.aiActionConfirmService.stagePendingExecution(
          userId,
          payload,
        );
        return {
          needOtp: true,
          message: 'OTP sent to user phone, please confirm with code',
        };
      }
      case 'claim_coupon':
        return this.clientCouponService.claimCoupon(userId, params.couponId, 2);
      case 'redeem_code':
        return this.clientCouponService.redeemCode(userId, params.code);
      case 'draw':
        return this.luckyDrawService.draw(userId, params.ticketId);
      case 'delete_address':
        return this.addressService.delete(userId, params.addressId);
      default:
        throw new BadRequestException(`Unknown confirm action: ${action}`);
    }
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
      throw new BadRequestException('Invalid OTP code');
    }

    // 验码通过后才真正取走任务：getDel 原子读删，防"同一张单子执行两次"
    // OTP 已在 verify 里原子核销（PENDING→VERIFIED），并发请求只有一个能走到这里
    const consumed =
      await this.aiActionConfirmService.popPendingExecution(userId);
    if (!consumed) {
      throw new BadRequestException(
        'Pending withdraw action expired, please try again',
      );
    }

    // 手搓 new ApplyWithdrawDto() 不会跑任何装饰器：
    // @IsNumber / @Min(100) 只有 validate() 才会执行。
    // whitelist + forbidNonWhitelisted：多余字段直接拒，不让 LLM 夹带的东西流到 applyWithdraw。
    const { params } = consumed;
    const dto = plainToInstance(ApplyWithdrawDto, params);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      throw new BadRequestException(
        `Invalid withdraw parameters: ${errors
          .map((e) => Object.values(e.constraints ?? {}).join(', '))
          .join('; ')}`,
      );
    }
    return this.clientWalletService.applyWithdraw(userId, dto);
  }

  /** 路由 C — 写 chat_message + 广播（委托给 ai-reply-publisher） */
  private async routeNormalCompletion(
    newMessages: any[],
    userId: string,
    conversationId?: string,
    memberIds: string[] = [],
  ): Promise<void> {
    if (!conversationId) return;
    await publishAiReply(
      this.prismaService,
      this.eventsGateway,
      conversationId,
      newMessages,
      userId,
      memberIds,
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
    userId: string | undefined,
    conversationId: string | undefined,
    callbacks?: {
      onError: (err: Error) => void;
      onTransfer?: (reason: string) => void;
    },
    memberIds: string[] = [],
  ): Promise<void> {
    this.logger.error(`[chatStream] error: ${err.message}`);
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
        logger: this.logger,
      },
      { conversationId, userId, memberIds },
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

    const result = await this.compiledGraph.invoke(
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
    };
    if (debug) {
      response.debug = result.debugInfo ?? undefined;
    }

    return response;
  }
}
