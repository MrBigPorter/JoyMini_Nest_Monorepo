import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  AI_PROCESSING_QUEUE,
  AiProcessingJobData,
} from '@api/common/queue/ai-queue.module';
import { AiMessageListener } from '@api/client/ai-customer/ai-message.listener';

/**
 * AI 处理消费者。
 *
 * 只做一件事：把 job 交给 AiMessageListener。
 * 单飞（进程内串行 + Redis 锁）、取消信号、日志都在 listener 里，
 * 这里不重复实现 —— worker 并发度可以 >1，跨会话仍可并行。
 */
@Processor(AI_PROCESSING_QUEUE, { concurrency: 4 })
export class AiProcessingProcessor extends WorkerHost {
  constructor(private readonly listener: AiMessageListener) {
    super();
  }

  async process(job: Job<AiProcessingJobData>): Promise<void> {
    if (job.name !== 'process-message') return;
    await this.listener.handleAiMessageRequest(job.data);
  }
}
