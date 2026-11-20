import { Module } from '@nestjs/common';
import { QueueMonitorController } from './queue-monitor.controller';
import { QueueMonitorService } from '@api/common/queue/queue-monitor.service';
import { BullModule } from '@nestjs/bullmq';
import { EMBEDDING_QUEUE } from '@api/common/ai/queues/embedding/embedding-queue.constants';
import { AI_PROCESSING_QUEUE } from '@api/common/queue/ai-queue.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'blog-ai' },
      { name: 'avatar' },
      { name: 'group_settlement' },
      { name: EMBEDDING_QUEUE },
      { name: AI_PROCESSING_QUEUE },
    ),
  ],
  controllers: [QueueMonitorController],
  providers: [QueueMonitorService],
  exports: [QueueMonitorService],
})
export class QueueMonitorModule {}
