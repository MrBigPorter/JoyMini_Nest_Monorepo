import { Global, Module } from '@nestjs/common';
import { AiQueueModule } from '@api/common/queue/ai-queue.module';
import { AiTaskOutboxService } from '@api/common/queue/ai-task-outbox.service';

/**
 * Outbox 对 ChatModule / EventsModule 都是横切依赖，做成全局模块，
 * 避免业务模块互相 import。
 */
@Global()
@Module({
  imports: [AiQueueModule],
  providers: [AiTaskOutboxService],
  exports: [AiTaskOutboxService],
})
export class AiTaskOutboxModule {}
