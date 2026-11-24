import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import { detectInjection } from '@api/client/ai-customer/injection-detector';
import {
  isKeywordAutoApplyEnabled,
  keywordAutoApplyLimits,
} from './kb-generation.constants';

export interface KeywordCandidateLike {
  id: string;
  documentId: string;
  documentVersion: number;
  text: string;
}

export interface AutoApplyOutcome {
  applied: number;
  pending: number;
  failed: number;
}

/**
 * 单条候选的处理结果。
 * 带上 reason：自动生效走后台批量，没人看日志；但人工批准失败时，
 * 「document state/quota」这种笼统提示根本没法定位，必须说清是哪道护栏。
 */
export interface ApplyCandidateResult {
  outcome: keyof AutoApplyOutcome;
  reason?: string;
}

interface DocumentRow {
  id: string;
  version: number;
  domain: string;
  title: string;
  keywords: string[];
  auto_keywords: string[];
}

/** 大小写不敏感去重，保留首次出现的拼写 */
export function effectiveKeywords(
  keywords: string[],
  autoKeywords: string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const keyword of [...keywords, ...autoKeywords]) {
    const key = keyword.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

/**
 * M2a：关键词自动生效。
 *
 * 只做「可逆项」：追加到独立的 autoKeywords 列（不动人工/frontmatter 的
 * keywords），保存生效前快照，30 天内可按候选粒度回滚。
 * 任何一步失败都退回 PENDING/FAILED，交给人审或补偿任务——
 * 绝不因为 Meili 不可用就把文档标成「已生效」。
 */
@Injectable()
export class KbKeywordAutoApplyService {
  private readonly logger = new Logger(KbKeywordAutoApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meilisearchService: MeilisearchService,
  ) {}

  /** 生成完成后调用：把本次 run 的 PENDING 关键词逐条尝试自动生效 */
  async applyForRun(runId: string): Promise<AutoApplyOutcome> {
    const outcome: AutoApplyOutcome = { applied: 0, pending: 0, failed: 0 };
    if (!isKeywordAutoApplyEnabled()) {
      return outcome;
    }

    const candidates = await this.prisma.kbGenerationCandidate.findMany({
      where: { runId, kind: 'KEYWORD', status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        documentId: true,
        documentVersion: true,
        text: true,
      },
    });

    for (const candidate of candidates) {
      const result = await this.applyCandidate(candidate);
      outcome[result.outcome] += 1;
      if (result.outcome !== 'applied') {
        this.logger.log(
          `[kb-keyword] candidate=${candidate.id} ${result.outcome}: ${
            result.reason ?? 'unknown'
          }`,
        );
      }
    }

    if (outcome.applied > 0) {
      this.logger.log(
        `[kb-keyword] run=${runId} auto-applied=${outcome.applied}, ` +
          `pending=${outcome.pending}, failed=${outcome.failed}`,
      );
    }
    return outcome;
  }

  /**
   * 人工批准入口：绕过 KB_KEYWORD_AUTO_APPLY 开关，但仍走同一套
   * 配额/快照/Meili 写入逻辑，避免两套生效路径语义漂移。
   */
  async applyPendingCandidate(
    candidateId: string,
    actorId: string,
  ): Promise<ApplyCandidateResult> {
    const candidate = await this.prisma.kbGenerationCandidate.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        documentId: true,
        documentVersion: true,
        text: true,
        status: true,
      },
    });
    if (!candidate) {
      throw new NotFoundException('Candidate not found');
    }
    if (candidate.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING candidates can be applied');
    }

    const result = await this.applyCandidate(candidate, { enforceQuota: false });
    if (result.outcome === 'applied') {
      await this.prisma.kbGenerationCandidate.update({
        where: { id: candidate.id },
        data: {
          appliedBy: actorId,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
      });
    }
    return result;
  }

  /** 补偿任务入口：Meili 短暂不可用导致的 FAILED，隔一段时间幂等重试 */
  async retryFailed(limit = 50): Promise<AutoApplyOutcome> {
    const outcome: AutoApplyOutcome = { applied: 0, pending: 0, failed: 0 };
    if (!isKeywordAutoApplyEnabled()) return outcome;

    const { retryAfterMinutes } = keywordAutoApplyLimits();
    const failed = await this.prisma.kbGenerationCandidate.findMany({
      where: {
        kind: 'KEYWORD',
        status: 'FAILED',
        updatedAt: { lt: new Date(Date.now() - retryAfterMinutes * 60_000) },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        documentId: true,
        documentVersion: true,
        text: true,
      },
    });

    for (const candidate of failed) {
      // 先回到 PENDING 才能走同一套 CAS 逻辑；updateMany 保证只有一个实例抢到。
      const reclaimed = await this.prisma.kbGenerationCandidate.updateMany({
        where: { id: candidate.id, status: 'FAILED' },
        data: { status: 'PENDING' },
      });
      if (!reclaimed.count) continue;

      const result = await this.applyCandidate(candidate);
      outcome[result.outcome] += 1;
    }

    return outcome;
  }

  /**
   * 单条候选的生效流程。
   *
   * `enforceQuota` 分两种口径：自动生效无人值守，必须严守单文档关键词上限；
   * 人工批准是人看过的决定，上限只当建议——把审核者卡在一个他界面上根本
   * 改不掉的配额上（frontmatter 来自源文件，没有删词入口），这份文档就永远
   * 批不动了。超限时记 warn，行为本身仍然走同一套 CAS/快照/回滚逻辑。
   */
  private async applyCandidate(
    candidate: KeywordCandidateLike,
    options: { enforceQuota: boolean } = { enforceQuota: true },
  ): Promise<ApplyCandidateResult> {
    const limits = keywordAutoApplyLimits();
    const word = candidate.text.trim();

    if (
      word.length < limits.minLength ||
      word.length > limits.maxLength ||
      detectInjection(word).detected
    ) {
      return {
        outcome: 'pending',
        reason: `keyword "${word}" failed the length/injection filter`,
      };
    }

    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id: candidate.documentId },
      select: {
        id: true,
        version: true,
        domain: true,
        title: true,
        keywords: true,
        autoKeywords: true,
        processStatus: true,
        deletedAt: true,
      },
    });

    // 只有「已索引、未删除、版本未过期」的文档才允许自动生效。
    if (
      !doc ||
      doc.deletedAt ||
      doc.processStatus !== 'indexed' ||
      doc.version !== candidate.documentVersion
    ) {
      return {
        outcome: 'pending',
        reason: `document is not ready (deleted, processStatus=${
          doc?.processStatus ?? 'missing'
        }, doc version=${doc?.version ?? '?'} vs candidate version=${
          candidate.documentVersion
        })`,
      };
    }

    const current = effectiveKeywords(doc.keywords, doc.autoKeywords);
    const alreadyPresent = current.some(
      (keyword) => keyword.toLowerCase() === word.toLowerCase(),
    );
    if (!alreadyPresent && current.length >= limits.maxTotal) {
      if (options.enforceQuota) {
        return {
          outcome: 'pending',
          reason: `keyword quota reached (${current.length}/${limits.maxTotal}); remove some keywords from the document first`,
        };
      }
      this.logger.warn(
        `[kb-keyword] manual approval exceeds the quota for doc=${doc.id} ` +
          `(${current.length}/${limits.maxTotal}); applying "${word}" anyway`,
      );
    }

    // CAS：同一候选只允许一个执行者。
    const claimed = await this.prisma.kbGenerationCandidate.updateMany({
      where: { id: candidate.id, status: 'PENDING' },
      data: { status: 'AUTO_APPLIED', autoApplied: true, appliedBy: 'SYSTEM' },
    });
    if (!claimed.count) {
      return {
        outcome: 'pending',
        reason: 'candidate was already claimed by another worker',
      };
    }

    let updated: Array<{ auto_keywords: string[]; keywords: string[] }> = [];
    if (!alreadyPresent) {
      updated = await this.prisma.$queryRawUnsafe<
        Array<{ auto_keywords: string[]; keywords: string[] }>
      >(
        `UPDATE knowledge_documents d
            SET auto_keywords = array_append(d.auto_keywords, $2),
                updated_at = now()
          WHERE d.id = $1
            AND d.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM unnest(d.keywords || d.auto_keywords) k
               WHERE lower(k) = lower($2)
            )
          RETURNING d.auto_keywords, d.keywords`,
        doc.id,
        word,
      );
    }

    let keywords: string[];
    if (updated.length > 0) {
      keywords = effectiveKeywords(
        updated[0].keywords,
        updated[0].auto_keywords,
      );
    } else {
      // 词已存在（幂等重试）或文档刚被删除/改版：以最新状态为准。
      const latest = await this.prisma.knowledgeDocument.findUnique({
        where: { id: doc.id },
        select: {
          keywords: true,
          autoKeywords: true,
          deletedAt: true,
          version: true,
        },
      });
      if (!latest || latest.deletedAt || latest.version !== doc.version) {
        await this.prisma.kbGenerationCandidate.update({
          where: { id: candidate.id },
          data: { status: 'PENDING', autoApplied: false, appliedBy: null },
        });
        return {
          outcome: 'pending',
          reason: 'document was deleted or re-versioned during apply',
        };
      }
      keywords = effectiveKeywords(latest.keywords, latest.autoKeywords);
    }

    try {
      const chunks = await this.prisma.documentChunk.findMany({
        where: { documentId: doc.id },
        select: { id: true },
      });
      await this.meilisearchService.updateChunkMetadata(
        chunks.map((chunk) => chunk.id),
        { keywords },
      );
    } catch (error) {
      // Meili 没写成功就不算生效：标 FAILED，补偿任务稍后重试。
      await this.prisma.kbGenerationCandidate.update({
        where: { id: candidate.id },
        data: { status: 'FAILED', autoApplied: false, appliedBy: null },
      });
      this.logger.warn(
        `[kb-keyword] Meili update failed for candidate=${candidate.id}: ${
          (error as Error).message
        }`,
      );
      return {
        outcome: 'failed',
        reason: `Meilisearch update failed: ${(error as Error).message}`,
      };
    }

    await this.prisma.kbGenerationCandidate.update({
      where: { id: candidate.id },
      data: {
        appliedAt: new Date(),
        rollbackableUntil: new Date(
          Date.now() + limits.rollbackDays * 24 * 60 * 60 * 1000,
        ),
        previousValue: {
          keywords: doc.keywords,
          autoKeywords: doc.autoKeywords,
        },
        needsReview: false,
      },
    });

    return { outcome: 'applied' };
  }

  /**
   * 按候选粒度回滚：只移除这一条候选加的词，不恢复整个数组，
   * 避免覆盖此后的人工编辑。
   */
  async rollbackKeyword(
    candidateId: string,
    actorId: string,
  ): Promise<{ documentId: string; keywords: string[] }> {
    const candidate = await this.prisma.kbGenerationCandidate.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        documentId: true,
        kind: true,
        status: true,
        text: true,
        autoApplied: true,
        rollbackableUntil: true,
      },
    });

    if (
      !candidate ||
      candidate.kind !== 'KEYWORD' ||
      candidate.status !== 'AUTO_APPLIED' ||
      !candidate.autoApplied
    ) {
      throw new BadRequestException(
        'Only auto-applied keyword candidates can be rolled back',
      );
    }
    if (
      candidate.rollbackableUntil &&
      candidate.rollbackableUntil.getTime() < Date.now()
    ) {
      throw new BadRequestException('Rollback window has expired');
    }

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ auto_keywords: string[]; keywords: string[] }>
    >(
      `UPDATE knowledge_documents d
          SET auto_keywords = COALESCE(
                (SELECT array_agg(k)
                   FROM unnest(d.auto_keywords) k
                  WHERE lower(k) <> lower($2)),
                '{}'
              ),
              updated_at = now()
        WHERE d.id = $1
        RETURNING d.auto_keywords, d.keywords`,
      candidate.documentId,
      candidate.text,
    );

    if (rows.length === 0) {
      throw new BadRequestException('Document no longer exists');
    }

    const keywords = effectiveKeywords(rows[0].keywords, rows[0].auto_keywords);
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId: candidate.documentId },
      select: { id: true },
    });
    await this.meilisearchService.updateChunkMetadata(
      chunks.map((chunk) => chunk.id),
      { keywords },
    );

    await this.prisma.kbGenerationCandidate.update({
      where: { id: candidate.id },
      data: {
        status: 'ROLLED_BACK',
        autoApplied: false,
        rejectReason: 'rolled_back',
        reviewedBy: actorId,
        reviewedAt: new Date(),
      },
    });

    this.logger.log(
      `[kb-keyword] rolled back candidate=${candidate.id} by=${actorId}`,
    );
    return { documentId: candidate.documentId, keywords };
  }
}
