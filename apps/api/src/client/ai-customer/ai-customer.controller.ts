import { runWithTrace } from '@api/common/logger/trace-context';

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  Res,
  Logger,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { AiCustomerService } from './ai-customer.service';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { SseJwtAuthGuard } from '@api/client/ai-customer/guards/sse-jwt-auth.guard';
import { StreamReservationStore } from '@api/client/ai-customer/stream-reservation.store';
import { TestChatDto } from '@api/client/ai-customer/dto/test-chat.dto';
import { ChatStreamDto } from './dto/chat-stream.dto';
import { SseRateLimiterService } from '@api/client/ai-customer/sse-rate-limiter.service';
import { RealIP } from '@api/common/decorators/real-ip.decorator';
import { CurrentDevice } from '@api/common/decorators/http.decorators';
import { ConfirmActionDto } from './dto/confirm-action.dto';
import { ConfirmOtpDto } from './dto/confirm-otp.dto';

@ApiTags('AI Customer')
@Controller('ai/customer')
export class AiCustomerController {
  private readonly logger = new Logger(AiCustomerController.name);
  constructor(
    private readonly aiCustomerService: AiCustomerService,
    private readonly rateLimiter: SseRateLimiterService,
    private readonly reservationStore: StreamReservationStore,
  ) {}

  /**
   * Test AI customer intent classification
   * @param dto
   * @param userId
   * 用户输入: "帮我查看订单"
   *         ↓
   * intentRouter → intent: 'order'
   *         ↓
   * orderAgent (手动循环)
   *   ├─ 第1轮: LLM 调用 getUserOrders(userId)
   *   │    ├─ orderService.listOrders() → raw DB data
   *   │    ├─ toLLM() → 语义化 { "订单编号": "202406010001", "订单状态": "已支付", ... }
   *   │    └─ ToolMessage 返回给 LLM
   *   ├─ 第2轮: LLM 调用 getOrderInfo(userId, orderId)
   *   │    ├─ 同上流程
   *   │    └─ ToolMessage
   *   └─ LLM 不调用工具 → break
   *         ↓
   * agentOutput: "您共有3个订单：\n1. 订单号 202406010001 - 已支付 - ¥9.98 - 2024/1/1\n..."
   *         ↓
   * answerSynthesizer → "亲，您目前有3个订单。其中订单 202406010001 已支付，实付金额 ¥9.98..."
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('test-chat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Test AI customer intent classification' })
  async testChat(@Body() dto: TestChatDto, @CurrentUserId() userId: string) {
    return this.aiCustomerService.testChat(
      dto.message,
      userId,
      dto.debug ?? false,
      dto.sessionId,
    );
  }

  // ==================================================================
  //  两阶段 SSE 协议
  //  阶段 1: POST /chat → 注册消息，返回 streamId
  //  阶段 2: GET /chat/stream/:streamId → 消耗 streamId，SSE 推流
  //
  //  为什么拆两段？
  //    1. POST 带消息体（URL 长度不受限制，消息不暴露在日志里）
  //    2. GET 用 ?token= 传 JWT（EventSource/dart:io 无法设 header）
  //    3. LangGraph 在 GET 连上时才执行，无需事件缓冲
  // ==================================================================

  /**
   * 阶段 1: 注册聊天请求
   *
   * 把用户消息存到 Redis 预留记录，立即返回 streamId。
   * 不跑 LangGraph（等阶段 2 的 GET 连上来再跑）。
   *
   * 限流：轻量检查（IP、设备、令牌桶）
   * 返回：{ streamId: "uuid" }
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Initiate AI chat (Phase 1). Returns streamId for SSE consumption.',
  })
  @ApiBody({ type: ChatStreamDto })
  @Post('chat')
  async initChat(
    @Body() dto: ChatStreamDto,
    @CurrentUserId() userId: string,
    @RealIP() ip: string,
    @CurrentDevice() device: any,
  ): Promise<{ streamId: string }> {
    const { message, sessionId, conversationId, entryPoint, metadata } = dto;
    if (!message || message.trim() === '') {
      throw new BadRequestException('Message cannot be empty');
    }

    // 轻量限流（IP、设备、令牌桶）
    const limitResult = await this.rateLimiter.tryAcquireLight(
      userId,
      ip,
      device?.deviceId,
    );
    if (!limitResult.ok) {
      throw new HttpException({ error: limitResult.reason }, 429);
    }

    // 创建 Redis 预留记录（120s TTL）
    const streamId = await this.reservationStore.create(
      userId,
      message,
      sessionId ?? `${userId}:${Date.now()}`,
      ip,
      device,
      conversationId,
      entryPoint,
      metadata,
    );

    this.logger.log(
      `[initChat] streamId=${streamId} userId=${userId} message="${message.slice(0, 50)}..."`,
    );

    return { streamId };
  }

  /**
   * 阶段 2: 消费 streamId，开启 SSE 流
   *
   * 只有预留记录的 owner（userId 匹配）才能消费。
   * 原子消耗（Lua 脚本）— 同一 streamId 只被消费一次。
   */
  @ApiBearerAuth()
  @UseGuards(SseJwtAuthGuard)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Stream AI chat response (Phase 2). Consumes streamId and streams SSE events.',
  })
  @Get('chat/stream/:streamId')
  async chatStream(
    @Param('streamId') streamId: string,
    @CurrentUserId() userId: string,
    @Req() req: { id?: string }, // 3. 注入 request，拿中间件生成的 id
    @Res() res: any,
  ): Promise<void> {
    // ── 1. 原子消耗预留记录 ──
    // consume() 用 Lua 脚本保证原子性：
    //   第一个 GET 消耗成功，后续 GET 返回 null
    const reservation = await this.reservationStore.consume(streamId);
    if (!reservation) {
      res.status(404).json({ error: 'Stream not found or already consumed' });
      return;
    }

    // ── 2. 验证 owner ──
    // 只有创建这个 streamId 的用户才能消费
    if (reservation.userId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // ── 3. 完整限流（用户独占 + 全局并发） ──
    const limitResult = await this.rateLimiter.tryAcquireStream(
      userId,
      reservation.ip,
      reservation.device?.deviceId,
    );
    if (!limitResult.ok) {
      res.status(429).json({ error: limitResult.reason });
      return;
    }

    // ── 4. 设置 SSE 响应头 ──
    res.setHeader('Content-Type', 'text/event-stream;charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.flushHeaders();

    let closed = false;

    const sendSSE = (type: string, data: any = {}) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    // ── 5. 断连清理 ──
    res.on('close', () => {
      closed = true;
      this.rateLimiter.releaseStream(
        userId,
        reservation.ip,
        reservation.device?.deviceId,
      );
      this.logger.log(`Client disconnected from stream ${streamId}`);
    });

    // ── 6. 执行 LangGraph 流（整个异步链带上 traceId） ──
    try {
      await runWithTrace(req.id, () =>
        this.aiCustomerService.chatStream(
          reservation.message,
          userId,
          reservation.sessionId,
          {
            onToken: (token: string) => {
              sendSSE('token', { content: token });
            },
            onStep: (step: string, data?: any) => {
              sendSSE('step', { step, ...data });
            },
            onDone: () => {
              sendSSE('done');
            },
            onError: (error: Error) => {
              sendSSE('error', { content: error.message || '服务器错误' });
            },
            onTransfer: (reason: string) => {
              sendSSE('transfer', {
                conversationId: reservation.conversationId,
                reason,
              });
            },
          },
          reservation.conversationId,
          reservation.entryPoint,
          reservation.metadata,
        ),
      );
    } catch (error: any) {
      sendSSE('error', { content: error.message || '服务器错误' });
    } finally {
      res.end();
    }
  }

  /**
   *
   * @param dto
   * @param userId
   * @returns
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Execute a confirmed AI write action (consumes one-time confirm token)',
  })
  @Post('confirm')
  async confirmAction(
    @Body() dto: ConfirmActionDto,
    @CurrentUserId() userId: string,
  ) {
    return this.aiCustomerService.confirmAction(dto.token, userId);
  }

  /**
   *
   * @param dto
   * @param userId
   * @returns
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm withdrawal OTP',
  })
  @Post('confirm/otp')
  async confirmWithdrawOtp(
    @Body() dto: ConfirmOtpDto,
    @CurrentUserId() userId: string,
  ) {
    return this.aiCustomerService.confirmWithdrawOtp(dto.code, userId);
  }

  /**
   * @deprecated 请使用 POST /chat + GET /chat/stream/:streamId 两阶段协议
   *
   * @param userId
   * @param message
   * @param res
   * @returns
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Chat with AI customer (streaming) — deprecated' })
  @ApiBody({ type: ChatStreamDto })
  @Post('chat-stream')
  async chatStreamLegacy(
    @Body() dto: ChatStreamDto,
    @CurrentUserId() userId: string,
    @RealIP() ip: string,
    @CurrentDevice() device: any,
    @Req() req: { id?: string },
    @Res() res: any,
  ): Promise<void> {
    const { message, sessionId } = dto;
    if (!message || message.trim() === '') {
      res.status(400).json({ error: 'Message cannot be empty' });
      return;
    }

    // ── 限流检查：用户级 + 全局并发 + 令牌桶 ──
    const limitResult = await this.rateLimiter.tryAcquire(
      userId,
      ip,
      device?.deviceId,
    );
    if (!limitResult.ok) {
      res.status(429).json({ error: limitResult.reason });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream;charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for Nginx
    res.setHeader('X-Content-Type-Options', 'nosniff'); // Prevent MIME type sniffing
    // 立即将响应头发送给前端（不等到第一次 write）
    // 这样前端在 200ms 内就能收到第一条 SSE 事件，
    // 而不需要等 LangGraph 跑完一轮。
    res.flushHeaders();

    // ── SSE 流式响应 ──
    // 以下代码通过 text/event-stream 协议将 LangGraph 的流事件
    // 逐条推送给前端，而不是等全部处理完再返回 JSON。

    let closed = false; // 断线标记：客户端关闭连接后不再写入 response

    /**
     * SSE 推送辅助函数
     * 按 "data: { type, ...data }\n\n" 格式写一条事件
     */
    const sendSSE = (type: string, data: any = {}) => {
      if (closed) {
        this.logger.log('Client disconnected from chat stream');
        return;
      }
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    // 客户端断开连接时的清理
    res.on('close', () => {
      closed = true;
      this.rateLimiter.release(userId, ip, device?.deviceId);
      this.logger.log('Client disconnected from chat stream');
    });

    // ── 执行 LangGraph 流并转发到 SSE ──
    // 通过 callbacks 把 LangGraph 的 streamEvents 事件
    // 桥接到 sendSSE，推送给浏览器。
    try {
      await runWithTrace(req.id, () =>
        this.aiCustomerService.chatStream(
          message,
          userId,
          sessionId ?? `${userId}:${Date.now()}`,
          {
            // LLM 生成一个 token → 实时推给前端
            onToken: (token: string) => {
              sendSSE('token', { content: token });
            },
            // Graph 执行到某个步骤（正在查余额/正在调用工具等）
            onStep: (step: string, data?: any) => {
              sendSSE('step', { step, ...data });
            },
            // 流正常结束
            onDone: () => {
              sendSSE('done');
            },
            // 流处理中出错
            onError: (error: Error) => {
              sendSSE('error', { content: error.message || '服务器错误' });
            },
          },
        ),
      );
    } catch (error: any) {
      sendSSE('error', { content: error.message || '服务器错误' });
    } finally {
      res.end();
    }
  }
}
