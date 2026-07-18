import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';
import { CHAT_EVENTS } from '@api/common/chat/events/chat.events';

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
    this.logger.log(
      `[AiMessageListener] AI request: conv=${conversationId}, msg="${content.slice(0, 50)}..."`,
    );

    try {
      await this.aiCustomerService.chatStream(
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
      );
    } catch (err: any) {
      this.logger.error(
        `[AiMessageListener] AI processing failed: ${err.message}`,
      );
    }
  }
}
