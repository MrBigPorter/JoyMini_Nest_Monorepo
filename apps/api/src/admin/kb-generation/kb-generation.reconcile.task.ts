import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { RedisLockService } from '@api/common/redis/redis-lock.service';
import { isKbGenerationEnabled } from './kb-generation.constants';
import { KbGenerationQueue } from './kb-generation.queue';
import { KbGenerationService } from './kb-generation.service';
import { KbKeywordAutoApplyService } from './kb-keyword-auto-apply.service';

/** 30 分钟：与 enqueue 的失败重试窗口保持一致 */
const RETRY_WINDOW_MS = 30 * 60 * 1000;
const MAX_DOCS_PER_SCAN = 50;

/**
 * 补偿扫描 —— 因为 EventEmitter2 是进程内、非持久投递。
 *
 * 每 10 分钟做四件事：
 *   1. 崩溃遗留的 RUNNING → FAILED（之后 enqueue 可重试）
 *   2. 旧版本 PENDING 候选 → SUPERSEDED；删除文档的合成用例 → enabled=false
 *   3. 卡住的 QUEUED run 重新入队（建 run 后、入队前进程被杀）
 *   4. 已发布但没生成过候选的文档补入队
 *
 * 全部操作幂等；多实例并发由 Redis 锁互斥，抢不到就跳过一次。
 */
@Injectable()
export class KbGenerationReconcileTask {
  private readonly logger = new Logger(KbGenerationReconcileTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: RedisLockService,
    private readonly queue: KbGenerationQueue,
    private readonly generationService: KbGenerationService,
    private readonly keywordAutoApply: KbKeywordAutoApplyService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcile(): Promise<void> {
    if (!isKbGenerationEnabled()) return;

    try {
      await this.lockService.runWithLock(
        'cron:kb_generation_reconcile',
        5 * 60 * 1000,
        () => this.runScan(),
        false,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[kb-generation] reconcile failed: ${message}`);
    }
  }

  private async runScan(): Promise<void> {
    const staleBefore = new Date(Date.now() - RETRY_WINDOW_MS);

    const [staleRuns, superseded, disabledGolden] = await Promise.all([
      this.prisma.kbGenerationRun.updateMany({
        where: { status: 'RUNNING', startedAt: { lt: staleBefore } },
        data: {
          status: 'FAILED',
          error: 'runner_stale',
          finishedAt: new Date(),
        },
      }),
      this.prisma.$executeRawUnsafe(
        `UPDATE kb_generation_candidates c
            SET status = 'SUPERSEDED'
           FROM knowledge_documents d
          WHERE c.document_id = d.id
            AND c.status = 'PENDING'
            AND c.document_version < d.version`,
      ),
      this.prisma.$executeRawUnsafe(
        `UPDATE kb_synthetic_golden g
            SET enabled = false
           FROM knowledge_documents d
          WHERE g.document_id = d.id
            AND d.deleted_at IS NOT NULL
            AND g.enabled = true`,
      ),
    ]);

    if (staleRuns.count || superseded || disabledGolden) {
      this.logger.log(
        `[kb-generation] reconcile: staleRuns=${staleRuns.count}, ` +
          `superseded=${superseded}, disabledGolden=${disabledGolden}`,
      );
    }

    await this.requeueStuckRuns(staleBefore);
    await this.enqueueMissingDocuments();

    // Meili 短暂故障导致的自动生效失败：隔 10 分钟幂等重试。
    try {
      const retried = await this.keywordAutoApply.retryFailed();
      if (retried.applied > 0) {
        this.logger.log(
          `[kb-generation] keyword retry applied=${retried.applied}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[kb-generation] keyword retry failed: ${(error as Error).message}`,
      );
    }
  }

  /** 建 run 成功、queue.add 前进程被杀 → job 永远不存在 */
  private async requeueStuckRuns(staleBefore: Date): Promise<void> {
    const stuck = await this.prisma.kbGenerationRun.findMany({
      where: { status: 'QUEUED', createdAt: { lt: staleBefore } },
      orderBy: { createdAt: 'asc' },
      take: MAX_DOCS_PER_SCAN,
      select: { id: true, idempotencyKey: true },
    });

    for (const run of stuck) {
      try {
        // 同 jobId 已存在时 BullMQ 会忽略，重复调用安全。
        await this.queue.add(run.id, run.idempotencyKey);
        this.logger.warn(`[kb-generation] requeued stuck run=${run.id}`);
      } catch (error) {
        this.logger.error(
          `[kb-generation] requeue failed for run=${run.id}: ${
            (error as Error).message
          }`,
        );
      }
    }
  }

  /** lastCandidateVersion 用列比较，Prisma findMany 做不到，走原生 SQL */
  private async enqueueMissingDocuments(): Promise<void> {
    const docs = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
         FROM knowledge_documents
        WHERE deleted_at IS NULL
          AND active_version > 0
          AND (last_candidate_version IS NULL OR last_candidate_version < version)
        ORDER BY updated_at DESC
        LIMIT $1::int`,
      MAX_DOCS_PER_SCAN,
    );

    for (const doc of docs) {
      try {
        const result = await this.generationService.enqueue(doc.id);
        if (result.enqueued) {
          this.logger.log(`[kb-generation] reconcile enqueued ${doc.id}`);
        }
      } catch (error) {
        this.logger.error(
          `[kb-generation] reconcile enqueue failed for ${doc.id}: ${
            (error as Error).message
          }`,
        );
      }
    }
  }
}
