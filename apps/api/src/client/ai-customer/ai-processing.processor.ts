import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  AI_PROCESSING_QUEUE,
  AiProcessingJobData,
} from '@api/common/queue/ai-queue.module';
import { AiMessageListener } from '@api/client/ai-customer/ai-message.listener';
import { incCounter } from '@api/common/metrics/metrics';

/**
 * AI 处理消费者。
 *
 * 只做一件事：把 job 交给 AiMessageListener。
 * 单飞（进程内串行 + Redis 锁）、取消信号、日志都在 listener 里，
 * 这里不重复实现 —— worker 并发度可以 >1，跨会话仍可并行。
 */
@Processor(AI_PROCESSING_QUEUE, { concurrency: 4 })
export class AiProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessingProcessor.name);

  constructor(private readonly listener: AiMessageListener) {
    super();
  }

  async process(job: Job<AiProcessingJobData>): Promise<void> {
    if (job.name !== 'process-message') return;
    await this.listener.handleAiMessageRequest(job.data);
  }

  /**
   * 失败可观测：区分「还会重试」和「已进入死信」。
   *
   * 死信 = attemptsMade 达到配置的 attempts 且仍失败；job 因
   * removeOnFail=false 保留在 failed 集合，可按 jobId 排查/重放。
   * 这里只产生日志与指标，通知渠道交给 Prometheus 告警规则。
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<AiProcessingJobData>, error: Error): void {
    const attempts = job.opts.attempts ?? 1;
    const dead = job.attemptsMade >= attempts;
    incCounter('ai_queue_jobs_failed_total', {
      queue: AI_PROCESSING_QUEUE,
      final: dead ? 'dead' : 'retry',
    });

    const message = `[AiProcessing] job failed: jobId=${job.id}, conv=${job.data.conversationId}, attempts=${job.attemptsMade}/${attempts}, dead=${dead}, reason=${error.message}`;
    if (dead) this.logger.error(message);
    else this.logger.warn(message);
  }
}
