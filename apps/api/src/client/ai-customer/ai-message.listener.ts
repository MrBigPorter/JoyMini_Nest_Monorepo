import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';
import { CHAT_EVENTS } from '@api/common/chat/events/chat.events';
import { runWithTrace } from '@api/common/logger/trace-context';

/**
 * AiMessageListener — AI 消息处理监听器
 *
 * 接收 ChatService 发出的 AI_MESSAGE_REQUESTED 事件，
 * 触发 AiCustomerService 的 LangGraph 处理。
 * AI 回复通过 AiCustomerService 内部注入的 EventsGateway 推 Socket。
 */
@Injectable()
export class AiMessageListener {
  private readonly logger = new Logger(AiMessageListener.name);

  constructor(private readonly aiCustomerService: AiCustomerService) {}

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
      // 这条是事件驱动路径，没有 HTTP 请求、也就没有 req.id。
      // 这里自己生成一个 traceId 并挂到异步上下文上，
      // 否则 chat.start / intent / llm.usage 的 traceId 全是 "-"，Loki 无法按对话聚合。
      await runWithTrace(randomUUID().replaceAll('-', ''), () =>
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
    } catch (err: any) {
      this.logger.error(
        `[AiMessageListener] AI processing failed: ${err.message}`,
      );
    }
  }
}
