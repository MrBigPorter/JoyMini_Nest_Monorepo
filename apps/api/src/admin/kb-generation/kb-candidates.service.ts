import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { IntentExamplesService } from '@api/admin/intent-examples/intent-examples.service';
import { IntentDomainService } from '@api/admin/intent-domains/intent-domains.service';
import { KbGenerationService } from './kb-generation.service';
import { KbKeywordAutoApplyService } from './kb-keyword-auto-apply.service';
import { hashCandidateText } from './kb-candidate-text.util';
import {
  ApproveKbCandidateDto,
  BatchKbCandidatesDto,
  ListKbCandidatesDto,
  RetargetKbCandidateDto,
} from './dto/kb-candidate.dto';

const GROWTH_LIMIT = 0.1;

@Injectable()
export class KbCandidatesService {
  private readonly logger = new Logger(KbCandidatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentExamplesService: IntentExamplesService,
    private readonly intentDomainService: IntentDomainService,
    private readonly keywordAutoApply: KbKeywordAutoApplyService,
    private readonly generationService: KbGenerationService,
  ) {}

  async list(query: ListKbCandidatesDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.KbGenerationCandidateWhereInput = {};
    if (query.kind) where.kind = query.kind;
    if (query.status) where.status = query.status;
    if (query.targetDomain) where.targetDomain = query.targetDomain;
    if (query.documentId) where.documentId = query.documentId;
    if (query.needsReview !== undefined) where.needsReview = query.needsReview;
    if (query.search) {
      where.text = { contains: query.search, mode: 'insensitive' };
    }

    const statsWhere: Prisma.KbGenerationCandidateWhereInput = { ...where };
    delete statsWhere.status;

    const [items, total, byStatus, byKind] = await Promise.all([
      this.prisma.kbGenerationCandidate.findMany({
        where,
        orderBy: [{ needsReview: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.kbGenerationCandidate.count({ where }),
      this.prisma.kbGenerationCandidate.groupBy({
        by: ['status'],
        where: statsWhere,
        _count: { _all: true },
      }),
      this.prisma.kbGenerationCandidate.groupBy({
        by: ['kind'],
        where: statsWhere,
        _count: { _all: true },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      stats: {
        byStatus: Object.fromEntries(
          byStatus.map((row) => [row.status, row._count._all]),
        ),
        byKind: Object.fromEntries(
          byKind.map((row) => [row.kind, row._count._all]),
        ),
        pendingTotal:
          byStatus.find((row) => row.status === 'PENDING')?._count._all ?? 0,
      },
    };
  }

  async get(id: string) {
    const candidate = await this.prisma.kbGenerationCandidate.findUnique({
      where: { id },
    });
    if (!candidate) {
      throw new NotFoundException('Candidate not found');
    }

    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { id: candidate.documentId },
      select: {
        id: true,
        title: true,
        docId: true,
        domain: true,
        version: true,
      },
    });

    return { ...candidate, document };
  }

  async approve(id: string, dto: ApproveKbCandidateDto, actorId: string) {
    const candidate = await this.prisma.kbGenerationCandidate.findUnique({
      where: { id },
    });
    if (!candidate) {
      throw new NotFoundException('Candidate not found');
    }
    if (candidate.status !== 'PENDING') {
      throw new BadRequestException(
        `Only PENDING candidates can be approved (current: ${candidate.status})`,
      );
    }

    const text = (dto.text ?? candidate.text).trim();
    if (text.length < 2) {
      throw new BadRequestException('Candidate text is too short');
    }
    const targetDomain = dto.targetDomain ?? candidate.targetDomain;

    try {
      switch (candidate.kind) {
        case 'KEYWORD':
          return await this.applyKeyword(candidate, text, actorId);
        case 'INTENT_EXAMPLE':
          return await this.applyIntentExample(
            candidate,
            text,
            targetDomain,
            actorId,
          );
        case 'GOLDEN_QUERY':
          return await this.applyGoldenQuery(candidate, text, actorId);
        default:
          throw new BadRequestException(
            `Approval for kind ${candidate.kind} is not supported yet`,
          );
      }
    } catch (error) {
      // 校验类错误（域不存在等）保持 PENDING 让审核者改派；
      // 只有真正的应用失败才落 FAILED。
      if (error instanceof BadRequestException) {
        throw error;
      }
      // 应用失败：候选不能停在 PENDING 假装没发生，也不能假装生效。
      await this.prisma.kbGenerationCandidate.update({
        where: { id: candidate.id },
        data: {
          status: 'FAILED',
          rejectReason:
            error instanceof Error
              ? error.message.slice(0, 200)
              : 'apply_failed',
        },
      });
      throw error;
    }
  }

  async reject(id: string, reason: string, actorId: string) {
    const result = await this.prisma.kbGenerationCandidate.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        rejectReason: reason,
        reviewedBy: actorId,
        reviewedAt: new Date(),
        needsReview: false,
      },
    });
    if (!result.count) {
      throw new BadRequestException('Only PENDING candidates can be rejected');
    }
    return this.get(id);
  }

  async retarget(id: string, dto: RetargetKbCandidateDto) {
    const candidate = await this.prisma.kbGenerationCandidate.findUnique({
      where: { id },
    });
    if (!candidate) {
      throw new NotFoundException('Candidate not found');
    }
    if (candidate.kind !== 'INTENT_EXAMPLE') {
      throw new BadRequestException(
        `Only INTENT_EXAMPLE candidates can be retargeted (current: ${candidate.kind})`,
      );
    }
    await this.intentDomainService.assertEnabled(dto.targetDomain);

    const result = await this.prisma.kbGenerationCandidate.updateMany({
      where: { id, status: 'PENDING' },
      data: { targetDomain: dto.targetDomain },
    });
    if (!result.count) {
      throw new BadRequestException(
        'Only PENDING candidates can be retargeted',
      );
    }
    return this.get(id);
  }

  async batch(dto: BatchKbCandidatesDto, actorId: string) {
    if (!dto.confirm) {
      throw new BadRequestException('Batch requires confirm=true');
    }
    if (dto.action === 'reject' && !dto.reason?.trim()) {
      throw new BadRequestException('Batch reject requires a reason');
    }

    const ids = Array.from(new Set(dto.ids));
    const candidates = await this.prisma.kbGenerationCandidate.findMany({
      where: { id: { in: ids } },
    });
    if (candidates.length !== ids.length) {
      throw new BadRequestException('Some candidate IDs do not exist');
    }

    const kinds = new Set(candidates.map((candidate) => candidate.kind));
    if (kinds.size > 1) {
      throw new BadRequestException(
        'Batch operations cannot mix candidate kinds',
      );
    }

    const eligible = candidates.filter(
      (candidate) =>
        candidate.status === 'PENDING' &&
        // 「重点复核」只是批准的前置：驳回本来就是把可疑候选清掉，不需要再加一道门槛。
        (dto.action === 'reject' ||
          dto.includeNeedsReview ||
          !candidate.needsReview),
    );
    const skipped = candidates.length - eligible.length;

    if (dto.action === 'approve') {
      await this.assertBatchGrowth(eligible, dto.allowDomainGrowth ?? false);
    }

    const failed: Array<{ id: string; error: string }> = [];
    let applied = 0;
    let rejected = 0;

    for (const candidate of eligible) {
      try {
        if (dto.action === 'approve') {
          await this.approve(candidate.id, {}, actorId);
          applied += 1;
        } else {
          await this.reject(candidate.id, dto.reason!.trim(), actorId);
          rejected += 1;
        }
      } catch (error) {
        failed.push({
          id: candidate.id,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    return { applied, rejected, skipped, failed };
  }

  async runs(documentId: string) {
    return this.prisma.kbGenerationRun.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async regenerate(documentId: string) {
    return this.generationService.regenerate(documentId);
  }

  // ── apply handlers ────────────────────────────────────────────

  private async applyKeyword(
    candidate: { id: string; text: string },
    text: string,
    actorId: string,
  ) {
    if (text !== candidate.text) {
      await this.prisma.kbGenerationCandidate.update({
        where: { id: candidate.id },
        data: { text, normalizedHash: hashCandidateText(text) },
      });
    }

    const result = await this.keywordAutoApply.applyPendingCandidate(
      candidate.id,
      actorId,
    );
    if (result.outcome === 'pending') {
      // 直接把是哪道护栏告诉你：配额满了要删词、文档没索引要先跑索引。
      throw new BadRequestException(
        result.reason ?? 'Keyword did not pass apply guards',
      );
    }
    if (result.outcome === 'failed') {
      throw new BadRequestException(
        result.reason ??
          'Meilisearch update failed; candidate marked FAILED for retry',
      );
    }
    return this.get(candidate.id);
  }

  private async applyIntentExample(
    candidate: {
      id: string;
      locale: string;
      normalizedHash: string;
    },
    text: string,
    targetDomain: string,
    actorId: string,
  ) {
    await this.intentDomainService.assertEnabled(targetDomain);

    const normalizedHash = hashCandidateText(text);
    const applied = await this.intentExamplesService.appendCandidateExample(
      targetDomain,
      text,
      {
        id: candidate.id,
        locale: candidate.locale,
        normalizedHash,
      },
      actorId,
    );

    await this.prisma.kbGenerationCandidate.update({
      where: { id: candidate.id },
      data: {
        status: 'APPLIED',
        targetDomain,
        text,
        normalizedHash,
        appliedRef: candidate.id,
        appliedAt: new Date(),
        appliedBy: actorId,
        reviewedBy: actorId,
        reviewedAt: new Date(),
        needsReview: false,
      },
    });

    this.logger.log(
      `[kb-candidates] approved example=${candidate.id} → ${targetDomain} ` +
        `(embedding jobs: ${applied.count})`,
    );
    return this.get(candidate.id);
  }

  private async applyGoldenQuery(
    candidate: {
      id: string;
      documentId: string;
      documentVersion: number;
      locale: string;
      payload: Prisma.JsonValue | null;
    },
    text: string,
    actorId: string,
  ) {
    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { id: candidate.documentId },
      select: { id: true, docId: true, domain: true, deletedAt: true },
    });
    if (!document || document.deletedAt) {
      throw new BadRequestException(
        'Source document no longer exists; cannot create a golden query',
      );
    }

    const expectedDocIds = this.expectedDocIds(
      candidate.payload,
      document.docId,
    );
    const normalizedHash = hashCandidateText(text);
    const payload = (candidate.payload ?? {}) as Record<string, unknown>;

    const golden = await this.prisma.kbSyntheticGolden.create({
      data: {
        candidateId: candidate.id,
        documentId: candidate.documentId,
        query: text,
        normalizedHash,
        expectedDocIds,
        domain: document.domain,
        lang:
          typeof payload.lang === 'string' ? payload.lang : candidate.locale,
        sourceType: 'synthetic',
        enabled: true,
        approvedBy: actorId,
        approvedAt: new Date(),
      },
    });

    await this.prisma.kbGenerationCandidate.update({
      where: { id: candidate.id },
      data: {
        status: 'APPLIED',
        text,
        normalizedHash,
        appliedRef: golden.id,
        appliedAt: new Date(),
        appliedBy: actorId,
        reviewedBy: actorId,
        reviewedAt: new Date(),
        needsReview: false,
      },
    });

    return this.get(candidate.id);
  }

  private expectedDocIds(
    payload: Prisma.JsonValue | null,
    fallbackDocId: string,
  ): string[] {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const value = (payload as Record<string, unknown>).expectedDocIds;
      if (Array.isArray(value)) {
        const ids = value.filter(
          (item): item is string => typeof item === 'string' && item.length > 0,
        );
        if (ids.length > 0) return ids;
      }
    }
    return [fallbackDocId];
  }

  private async assertBatchGrowth(
    candidates: Array<{ kind: string; targetDomain: string }>,
    allowGrowth: boolean,
  ): Promise<void> {
    if (allowGrowth) return;

    const examples = candidates.filter(
      (candidate) => candidate.kind === 'INTENT_EXAMPLE',
    );
    if (examples.length === 0) return;

    const perDomain = new Map<string, number>();
    for (const candidate of examples) {
      perDomain.set(
        candidate.targetDomain,
        (perDomain.get(candidate.targetDomain) ?? 0) + 1,
      );
    }

    for (const [domain, incoming] of perDomain) {
      const existing = await this.prisma.intentExample.count({
        where: { domain },
      });
      if (existing > 0 && incoming / existing > GROWTH_LIMIT) {
        throw new BadRequestException(
          `Approving ${incoming} example(s) would grow "${domain}" by more than 10% ` +
            `(existing: ${existing}). Pass allowDomainGrowth=true to override.`,
        );
      }
    }
  }
}
