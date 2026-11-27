import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { redactJudgeRawCapture } from '@api/common/ai/judge-raw-output';
import { JudgeAttemptQueryDto } from './dto/judge-attempt.dto';

/**
 * 判官尝试留痕的读侧与保留期。
 *
 * 单独成服务而不是塞进 dataset service：留痕表只对管理员开放，
 * 读权限与保留节奏都跟评测主链路无关，混在一起会让「谁能读」变模糊。
 */

/** 默认保留 30 天：够复盘一轮基线切换，又不至于无限累积原始输出。 */
export const DEFAULT_JUDGE_ATTEMPT_RETENTION_DAYS = 30;

/** 单批删除条数：小批多次，避免一次大删长时间持锁。 */
export const JUDGE_ATTEMPT_PURGE_BATCH_SIZE = 1000;

const DEFAULT_PAGE_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AiEvalJudgeAttemptService {
  private readonly logger = new Logger(AiEvalJudgeAttemptService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 按运行分页读取尝试明细；返回前再脱敏一次（旧行可能写于脱敏上线前）。 */
  async list(runId: string, query: JudgeAttemptQueryDto) {
    const run = await this.prisma.aiEvalRun.findUnique({
      where: { id: runId },
      select: { id: true },
    });
    if (!run) throw new NotFoundException('Eval run not found');

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where = {
      runId,
      ...(query.caseId ? { caseId: query.caseId } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.aiEvalJudgeAttempt.count({ where }),
      this.prisma.aiEvalJudgeAttempt.findMany({
        where,
        // 显式 tiebreaker（id）：createdAt 同毫秒时也要分页稳定。
        orderBy: [
          { caseId: 'asc' },
          { attemptIndex: 'asc' },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      runId,
      page,
      pageSize,
      total,
      items: rows.map((row) => {
        const raw = redactJudgeRawCapture(row.rawOutput ?? '', row.rawTruncated);
        return {
          ...row,
          rawOutput: raw.rawOutput,
          rawTruncated: raw.rawTruncated,
        };
      }),
    };
  }

  /**
   * 按保留期分批清理。0 表示不清理（显式关闭），负数与非法值回落到默认。
   * 返回删除条数与实际使用的截止时间，便于手动运行核对。
   */
  async purgeExpired(
    options: { now?: Date; batchSize?: number } = {},
  ): Promise<{ deleted: number; cutoff: Date | null }> {
    const days = this.retentionDays();
    if (days <= 0) return { deleted: 0, cutoff: null };

    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const batchSize = Math.max(
      1,
      options.batchSize ?? JUDGE_ATTEMPT_PURGE_BATCH_SIZE,
    );

    let deleted = 0;
    for (;;) {
      // 先只取 id 再按 id 批删：`deleteMany({ createdAt: { lt } })` 在
      // 大表上是一条长事务，会挡住同一时间段的正常写入。
      const batch = await this.prisma.aiEvalJudgeAttempt.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      });
      if (batch.length === 0) break;

      const { count } = await this.prisma.aiEvalJudgeAttempt.deleteMany({
        where: { id: { in: batch.map((item) => item.id) } },
      });
      deleted += count;
      if (batch.length < batchSize) break;
    }

    this.logger.log(
      `[eval] judge attempts purged: deleted=${deleted}, cutoff=${cutoff.toISOString()}`,
    );
    return { deleted, cutoff };
  }

  private retentionDays(): number {
    const raw = process.env.AI_EVAL_JUDGE_ATTEMPT_RETENTION_DAYS;
    if (raw === undefined || raw.trim() === '') {
      return DEFAULT_JUDGE_ATTEMPT_RETENTION_DAYS;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      this.logger.warn(
        `[eval] AI_EVAL_JUDGE_ATTEMPT_RETENTION_DAYS=${raw} invalid; using ${DEFAULT_JUDGE_ATTEMPT_RETENTION_DAYS}`,
      );
      return DEFAULT_JUDGE_ATTEMPT_RETENTION_DAYS;
    }
    return Math.floor(parsed);
  }
}
