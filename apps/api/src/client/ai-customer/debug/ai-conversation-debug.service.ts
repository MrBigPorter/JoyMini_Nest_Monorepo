import { Injectable, Logger } from '@nestjs/common';

export interface ConversationDebugSnapshot {
  conversationId: string;
  threadId: string | null;
  checkpointId: string | null;
  flowState: Record<string, any>;
  contextState: Record<string, any>;
  pendingConfirm: Record<string, any> | null;
  previousIntent: string;
  messages: Array<{ type: string; content: string }>;
}

type Inspector = (
  conversationId: string,
) => Promise<ConversationDebugSnapshot | { error: string }>;

/**
 * 单会话上下文调试：由 AiCustomerService 注册 graph 读取实现，
 * 避免 admin 模块直接依赖 AiCustomerService（以及循环依赖）。
 */
@Injectable()
export class AiConversationDebugService {
  private readonly logger = new Logger(AiConversationDebugService.name);
  private inspector?: Inspector;

  registerInspector(inspector: Inspector): void {
    this.inspector = inspector;
  }

  async inspect(conversationId: string) {
    if (!this.inspector) {
      return { error: 'graph_not_initialized' };
    }
    try {
      return await this.inspector(conversationId);
    } catch (err: any) {
      this.logger.warn(
        `[AiDebug] inspect failed: conv=${conversationId}, reason=${err?.message ?? err}`,
      );
      return { error: 'inspect_failed' };
    }
  }
}
