import { Module } from '@nestjs/common';
import { QueueMonitorController } from './queue-monitor.controller';
import { QueueMonitorService } from '@api/common/queue/queue-monitor.service';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'blog-ai' },
      { name: 'avatar' },
      { name: 'group_settlement' },
    ),
  ],
  controllers: [QueueMonitorController],
  providers: [QueueMonitorService],
  exports: [QueueMonitorService],
})
export class QueueMonitorModule {}