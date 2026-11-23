import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  KB_GENERATION_JOB,
  KB_GENERATION_QUEUE,
} from './kb-generation.constants';
import { KbGenerationJobData } from './kb-generation.types';

@Injectable()
export class KbGenerationQueue {
  private readonly logger = new Logger(KbGenerationQueue.name);

  constructor(
    @InjectQueue(KB_GENERATION_QUEUE)
    private readonly queue: Queue<KbGenerationJobData>,
  ) {}

  /**
   * jobId 用幂等键；BullMQ 会拒绝重复 jobId，天然防重复入队。
   * removeOnComplete/Fail 打开后，同一 run 才能在补偿扫描里重新入队。
   */
  async add(runId: string, idempotencyKey: string): Promise<void> {
    await this.queue.add(
      KB_GENERATION_JOB,
      { runId },
      {
        jobId: idempotencyKey,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    this.logger.log(`[kb-generation] queued run=${runId}`);
  }
}
