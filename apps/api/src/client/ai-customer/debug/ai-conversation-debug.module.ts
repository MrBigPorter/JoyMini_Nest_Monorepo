import { Global, Module } from '@nestjs/common';
import { AiConversationDebugService } from './ai-conversation-debug.service';

@Global()
@Module({
  providers: [AiConversationDebugService],
  exports: [AiConversationDebugService],
})
export class AiConversationDebugModule {}
