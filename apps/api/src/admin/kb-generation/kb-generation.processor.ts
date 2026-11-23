import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { KB_GENERATION_QUEUE } from './kb-generation.constants';
import { KbGenerationJobData } from './kb-generation.types';
import { KbGenerationService } from './kb-generation.service';

/**
 * 生成 worker。
 *
 * concurrency=1：生成是低频、重 LLM 成本的任务，串行更容易控制
 * 小时配额与 provider 速率；扩容靠加实例，不靠这个数字。
 *
 * process() 永不抛：失败已写进 run.error，抛出去只会让 BullMQ
 * 把同一 run 反复重试到死。补偿扫描按 30 分钟节奏决定是否重跑。
 */
@Processor(KB_GENERATION_QUEUE, { concurrency: 1 })
export class KbGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(KbGenerationProcessor.name);

  constructor(private readonly generationService: KbGenerationService) {
    super();
  }

  async process(job: Job<KbGenerationJobData>): Promise<void> {
    this.logger.log(`[kb-generation] job=${job.id} run=${job.data.runId}`);
    await this.generationService.processRun(job.data.runId);
  }
}
