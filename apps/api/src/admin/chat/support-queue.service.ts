import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisService } from '@api/common/redis/redis.service';
import { HandoffLifecycleService } from '@api/common/chat/handoff/handoff-lifecycle.service';

/** Redis 锁 TTL 要小于 cron 周期，避免上一轮卡住导致下一轮永远抢不到 */
const SWEEP_LOCK_TTL_SECONDS = 50;

/**
 * 转人工超时的统一调度入口。
 *
 * 历史上这里自己实现了「已认领 10 分钟回收 + 排队超时提醒」，而
 * `ChatService.sendMessage` 里还有一套懒释放，两套阈值与语义都不一致。
 * 现在只保留一个 cron，真正的判定、CAS、系统消息与广播全部交给
 * `HandoffLifecycleService.sweepTimedOut()`：
 *
 *   - WAITING_HUMAN 超过 `SUPPORT_WAIT_TIMEOUT_MINUTES`（默认 10）→ 回 AI
 *   - HUMAN_ACTIVE  超过 `SUPPORT_IDLE_TIMEOUT_MINUTES`（默认 60）无人工活动 → 回 AI
 *   - 任一配置为 0 → 关闭该项
 *
 * 多实例安全：Redis 锁只让一个实例跑；每条转换在生命周期服务里仍是 CAS，
 * 重复执行也不会误伤。
 */
@Injectable()
export class SupportQueueService {
  private readonly logger = new Logger(SupportQueueService.name);

  constructor(
    private readonly handoffLifecycleService: HandoffLifecycleService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const acquired = await this.redisService.setNx(
      'cron:support-queue-sweep',
      String(Date.now()),
      SWEEP_LOCK_TTL_SECONDS,
    );
    if (!acquired) return;

    try {
      const { returned, skipped } =
        await this.handoffLifecycleService.sweepTimedOut();
      if (returned.length > 0) {
        this.logger.log(
          `[SupportQueueSweep] returned ${returned.length} conversation(s) to AI`,
        );
      }
      if (skipped > 0) {
        // 候选在扫描后被认领/关闭，CAS 没抢到属于正常竞态
        this.logger.debug(
          `[SupportQueueSweep] skipped ${skipped} conversation(s) changed concurrently`,
        );
      }
    } catch (err: unknown) {
      this.logger.error(
        `[SupportQueueSweep] failed: ${this.errorMessage(err)}`,
      );
    }
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
