import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiEvalDatasetService } from './ai-eval-dataset.service';
import { AI_EVAL_QUEUE, AI_EVAL_RUN_JOB, AiEvalJobData } from './ai-eval.queue';

/**
 * 评测 run 消费者。
 *
 * 只做一件事：把 job 交给 executeRun。并发度保持 1 —— 一次评测本身会
 * 串行调用 judge / 客服 graph，单进程内并行多份 run 只会放大 token 抖动。
 */
@Processor(AI_EVAL_QUEUE, { concurrency: 1 })
export class AiEvalProcessor extends WorkerHost {
  private readonly logger = new Logger(AiEvalProcessor.name);

  constructor(private readonly datasetService: AiEvalDatasetService) {
    super();
  }

  async process(job: Job<AiEvalJobData>): Promise<void> {
    if (job.name !== AI_EVAL_RUN_JOB) return;
    await this.datasetService.executeRun(job.data.runId);
  }

  /**
   * executeRun 失败时已经把 run 落成 FAILED + summary.error，
   * 这里只补一条 worker 日志，不重复改库。
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<AiEvalJobData>, error: Error): void {
    this.logger.error(
      `[AiEval] job failed: jobId=${job.id}, run=${job.data.runId}, reason=${error.message}`,
    );
  }
}
