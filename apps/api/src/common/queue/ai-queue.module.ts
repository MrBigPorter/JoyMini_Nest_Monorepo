import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const AI_PROCESSING_QUEUE = 'ai-processing';

export interface AiProcessingJobData {
  conversationId: string;
  content: string;
  userId: string;
  /**
   * 触发本轮 AI 的消息 ID。
   * 用作 BullMQ jobId：同一条消息重复投递只会入队一次。
   * 老调用方没有这个字段时退化为自动 jobId（仍受进程内单飞保护）。
   */
  messageId?: string;
}

/**
 * AI 处理入队口。
 *
 * 为什么 AI 处理要进队列，而不是在 request 线程里同步跑：
 *   1. 进程崩溃 / 发布重启时，未完成的任务留在 Redis，恢复后可重试；
 *   2. 失败有 attempts/backoff，最终失败留在 failed 集合里（死信），可排查/重放；
 *   3. 请求链路不再被一次 30s 的 LLM 调用拖住。
 *
 * 全局模块：ChatService、EventsGateway 都能注入，不需要互相 import。
 */
@Injectable()
export class AiQueueService {
  private readonly logger = new Logger(AiQueueService.name);

  constructor(
    @InjectQueue(AI_PROCESSING_QUEUE)
    private readonly queue: Queue<AiProcessingJobData>,
  ) {}

  /**
   * 入队；失败时抛错，由调用方决定是否降级为进程内事件。
   * 不在这里吞异常 —— 静默丢消息比慢一点更糟。
   */
  async enqueue(data: AiProcessingJobData): Promise<void> {
    await this.queue.add('process-message', data, {
      // 消息级去重：同一条消息并发/重复投递只保留一份
      jobId: data.messageId,
      attempts: 2,
      backoff: { type: 'fixed', delay: 2_000 },
      removeOnComplete: 1_000,
      // 失败任务保留 = 死信队列；排查后可按 jobId 手工重放
      removeOnFail: false,
    });
  }
}

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: AI_PROCESSING_QUEUE })],
  providers: [AiQueueService],
  exports: [AiQueueService],
})
export class AiQueueModule {}
