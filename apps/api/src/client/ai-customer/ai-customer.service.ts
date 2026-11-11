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

    this.logger.log(`[chatStream] message="${message.slice(0, 50)}..."`);

    try {
      // Step 2 — 准备 AI 对话线程
      const threadId = await this.prepareThread(userId, conversationId);

      // Step 3 — 记录快照 + 通知 Thinking
      const prevCount = await this.snapshotBeforeStream(threadId);
      this.broadcastThinking(conversationId, callbacks);

      // Step 4 — 执行 LangGraph 流式推理（逐 token 推给前端）
      await this.runEventStream(
        threadId,
        message,
        userId,
        conversationId,
        entryPoint,
        metadata,
        callbacks,
      );

      // Step 5 — 收尾分发：转人工 / 确认卡片 / 正常完成
      await this.finalizeAfterStream(
        threadId,
        prevCount,
        userId,
        conversationId,
        callbacks,
      );
    } catch (err: any) {
      this.handleStreamError(err, conversationId, callbacks);
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
  ): void {
    callbacks.onStep('thinking', { content: 'analyzing your question...' });
    if (conversationId) {
      this.eventsGateway.dispatch(conversationId, SocketEvents.AI_STEP, {
        step: 'thinking',
        content: 'analyzing your question...',
      });
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
  ): Promise<void> {
    await handleEventStream(
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

    // 路由 A — 转人工
    if (finalState?.values?.transferToHuman && callbacks.onTransfer) {
      await this.routeTransfer(userId, conversationId);
      return;
    }

    // 路由 B — 确认卡片
    if (finalState?.values?.pendingConfirm) {
      await this.routeConfirm(userId, conversationId, finalState);
      return;
    }

    // 路由 C — 正常完成（写 chat_message + 广播）
    await this.routeNormalCompletion(newMessages, userId, conversationId);
    callbacks.onDone();
    if (conversationId) {
      this.eventsGateway.dispatch(conversationId, SocketEvents.AI_DONE, {
        conversationId,
      });
    }
  }

  /** 路由 A — 标记转人工 */
  private async routeTransfer(
    userId: string,
    conversationId?: string,
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
      this.eventsGateway.dispatch(targetConvId, SocketEvents.AI_TRANSFER, {
        conversationId: targetConvId,
        reason: 'ai_determined',
      });
    }
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
      this.eventsGateway.dispatch(conversationId, SocketEvents.AI_CONFIRM, {
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
   *   ① popPendingExecution 取回待执行任务（一次性，防重放）
   *   ② verify OTP（对用户手机号）
   *   ③ 验码通过 → 真正执行 applyWithdraw
   */

  async confirmWithdrawOtp(code: string, userId: string) {
    const pending =
      await this.aiActionConfirmService.popPendingExecution(userId);
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

    const { params } = pending;
    const dto = new ApplyWithdrawDto();
    dto.amount = Number(params.amount);
    dto.channelId = Number(params.channelId);
    dto.account = String(params.account ?? '');
    dto.accountName = String(params.accountName ?? '');
    return this.clientWalletService.applyWithdraw(userId, dto);
  }

  /** 路由 C — 写 chat_message + 广播（委托给 ai-reply-publisher） */
  private async routeNormalCompletion(
    newMessages: any[],
    userId: string,
    conversationId?: string,
  ): Promise<void> {
    if (!conversationId) return;
    await publishAiReply(
      this.prismaService,
      this.eventsGateway,
      conversationId,
      newMessages,
      userId,
    );
  }

  /** 异常兜底 */
  private handleStreamError(
    err: any,
    conversationId?: string,
    callbacks?: { onError: (err: Error) => void },
  ): void {
    this.logger.error(`[chatStream] error: ${err.message}`);
    callbacks?.onError(err);
    if (conversationId) {
      this.eventsGateway.dispatch(conversationId, SocketEvents.AI_ERROR, {
        content: err.message,
      });
    }
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
