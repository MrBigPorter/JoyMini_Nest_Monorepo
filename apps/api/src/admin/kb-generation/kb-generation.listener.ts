import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  KB_DOCUMENT_PUBLISHED,
  KbDocumentPublishedEvent,
} from '@api/client/ai-customer/knowledge/events/kb-document-published.event';
import { isKbGenerationEnabled } from './kb-generation.constants';
import { KbGenerationService } from './kb-generation.service';

/**
 * 发布事件 → 生成队列。
 *
 * EventEmitter2 是进程内、非持久投递：监听器必须活在有 embedding worker
 * 的同一进程（KbGenerationModule 已挂在 AdminModule 下）。
 * 事件只是「尽快触发」，漏投由 KbGenerationReconcileTask 兜底。
 */
@Injectable()
export class KbGenerationListener {
  private readonly logger = new Logger(KbGenerationListener.name);

  constructor(private readonly generationService: KbGenerationService) {}

  @OnEvent(KB_DOCUMENT_PUBLISHED, { async: true })
  async handlePublished(event: KbDocumentPublishedEvent): Promise<void> {
    if (!isKbGenerationEnabled()) return;
    // 回滚是恢复旧内容，不是新内容上线：不生成候选，避免把旧版候选再灌一遍。
    if (event.trigger === 'rollback' || !event.switched) return;

    try {
      const result = await this.generationService.enqueue(event.documentId);
      if (!result.enqueued) {
        this.logger.debug(
          `[kb-generation] skip document=${event.documentId}: ${result.reason}`,
        );
      }
    } catch (error) {
      // 发布主链路已经返回；这里再抛只会产生未处理拒绝。
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[kb-generation] enqueue failed for document=${event.documentId}: ${message}`,
      );
    }
  }
}
