import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisLockService } from '@api/common/redis/redis-lock.service';
import { AiEvalJudgeAttemptService } from './ai-eval-judge-attempt.service';

/**
 * 判官尝试留痕的每日清理。
 *
 * 原始输出按保留期删除（保留期见 `AI_EVAL_JUDGE_ATTEMPT_RETENTION_DAYS`），
 * 多实例由 Redis 锁互斥，抢不到锁静默跳过；单次失败只记日志，
 * 不抛给调度器——清理是后台维护，不能影响服务。
 */
@Injectable()
export class AiEvalJudgeAttemptRetentionTask {
  private readonly logger = new Logger(AiEvalJudgeAttemptRetentionTask.name);

  constructor(
    private readonly lockService: RedisLockService,
    private readonly attemptService: AiEvalJudgeAttemptService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purge(): Promise<void> {
    try {
      const result = await this.lockService.runWithLock(
        'cron:ai_eval_judge_attempt_purge',
        10 * 60 * 1000,
        () => this.attemptService.purgeExpired(),
        false,
      );
      // undefined = 没抢到锁，本次由其他实例负责。
      if (result) {
        this.logger.log(
          `[eval] judge attempt retention: deleted=${result.deleted}, cutoff=${result.cutoff?.toISOString() ?? 'disabled'}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[eval] judge attempt retention failed: ${message}`);
    }
  }
}
