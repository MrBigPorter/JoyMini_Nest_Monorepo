import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  Res,
  Logger,
} from '@nestjs/common';
import { AiCustomerService } from './ai-customer.service';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { TestChatDto } from '@api/client/ai-customer/dto/test-chat.dto';
import { ChatStreamDto } from './dto/chat-stream.dto';
import { SseRateLimiterService } from '@api/client/ai-customer/sse-rate-limiter.service';
import { RealIP } from '@api/common/decorators/real-ip.decorator';
import { CurrentDevice } from '@api/common/decorators/http.decorators';

@ApiTags('AI Customer')
@Controller('ai/customer')
export class AiCustomerController {
  private readonly logger = new Logger(AiCustomerController.name);
  constructor(
    private readonly aiCustomerService: AiCustomerService,
    private readonly rateLimiter: SseRateLimiterService,
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

  /**
   *
   * @param userId
   * @param message
   * @param res
   * @returns
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Chat with AI customer (streaming)' })
  @ApiBody({ type: ChatStreamDto })
  @Post('chat-stream')
  async chatStream(
    @Body() dto: ChatStreamDto,
    @CurrentUserId() userId: string,
    @RealIP() ip: string,
    @CurrentDevice() device: any,
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
      await this.aiCustomerService.chatStream(
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
            sendSSE('step', { step, data });
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
      );
    } catch (error: any) {
      sendSSE('error', { content: error.message || '服务器错误' });
    } finally {
      res.end();
    }
  }
}
