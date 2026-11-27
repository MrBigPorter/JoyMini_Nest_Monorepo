import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisLockService } from '@api/common/redis/redis-lock.service';
import { AiEvalDatasetService } from './ai-eval-dataset.service';

/**
 * 僵死评测运行的后台清扫。
 *
 * 为什么单独成 cron：判定存活要读心跳，读接口（列表/详情）不该为了刷新状态
 * 而在 GET 里写库；worker 进程被杀后也没有别的路径会写这条运行。
 *
 * 多实例并发由 Redis 锁互斥，抢不到就跳过一次；单次失败只记日志，
 * 不能把异常抛给调度器（否则下一次 tick 也可能被拖垮）。
 */
@Injectable()
export class AiEvalRunSweepTask {
  private readonly logger = new Logger(AiEvalRunSweepTask.name);

  constructor(
    private readonly lockService: RedisLockService,
    private readonly datasetService: AiEvalDatasetService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    try {
      await this.lockService.runWithLock(
        'cron:ai_eval_run_sweep',
        5 * 60 * 1000,
        () => this.datasetService.sweepStaleRuns(),
        false,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[eval] run sweep failed: ${message}`);
    }
  }
}
