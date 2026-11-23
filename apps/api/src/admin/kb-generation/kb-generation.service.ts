import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { IntentDomainService } from '@api/admin/intent-domains/intent-domains.service';
import { KnowledgeDomainService } from '@api/admin/rag/knowledge-domain.service';
import { KbCandidateGenerator } from './kb-candidate-generator';
import { KbCandidateDedupeService } from './kb-candidate-dedupe.service';
import { filterRawGeneration } from './kb-candidate-filter';
import {
  buildGenerationIdempotencyKey,
  hashCandidateText,
  normalizeCandidateText,
  sha256,
} from './kb-candidate-text.util';
import {
  KB_GENERATION_PROMPT_VERSION,
  generationLimits,
  isKbGenerationEnabled,
} from './kb-generation.constants';
import { KbCandidateDraft, KbGenerationStatus } from './kb-generation.types';
import { KbGenerationQueue } from './kb-generation.queue';
import { KbKeywordAutoApplyService } from './kb-keyword-auto-apply.service';

interface EnqueueResult {
  enqueued: boolean;
  reason?: string;
  runId?: string;
}

/**
 * 生成链路编排。
 *
 * 三条硬约束：
 *   1. 发布永不被生成阻塞：所有失败只记录，不抛给发布路径
 *   2. 同一 (文档, 版本, 内容哈希) 只生成一次
 *   3. 内容/版本变化后，旧版 PENDING 候选批量 SUPERSEDED（M1 末尾处理）
 */
@Injectable()
export class KbGenerationService {
  private readonly logger = new Logger(KbGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: KbCandidateGenerator,
    private readonly dedupe: KbCandidateDedupeService,
    private readonly knowledgeDomainService: KnowledgeDomainService,
    private readonly intentDomainService: IntentDomainService,
    private readonly queue: KbGenerationQueue,
    private readonly keywordAutoApply: KbKeywordAutoApplyService,
  ) {}

  /**
   * 入队生成。事件监听器、补偿扫描、手动重生成都走这里。
   * 幂等：同版本同内容只建一条 run、一个 job。
   */
  async enqueue(documentId: string): Promise<EnqueueResult> {
    if (!isKbGenerationEnabled()) {
      return { enqueued: false, reason: 'disabled' };
    }

    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        version: true,
        activeVersion: true,
        deletedAt: true,
        content: true,
        contentHash: true,
        domain: true,
        candidateTargetDomain: true,
        keywords: true,
        autoKeywords: true,
        locale: true,
        contentType: true,
      },
    });

    if (!doc || doc.deletedAt) {
      return { enqueued: false, reason: 'not-found-or-deleted' };
    }
    if (doc.activeVersion <= 0) {
      return { enqueued: false, reason: 'not-published' };
    }

    const contentHash = doc.contentHash ?? sha256(doc.content);
    if (!doc.contentHash) {
      await this.prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: { contentHash },
      });
    }

    const targetDomain =
      await this.knowledgeDomainService.getCandidateTargetIntent(
        doc.domain,
        doc.candidateTargetDomain,
      );
    const idempotencyKey = buildGenerationIdempotencyKey(
      doc.id,
      doc.version,
      contentHash,
    );

    const existing = await this.prisma.kbGenerationRun.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      // 只有「可重试的失败」且超过 30 分钟才重跑：
      //   FAILED（含补偿扫描重置的 runner_stale）
      //   SKIPPED(llm_unavailable) / SKIPPED(hourly_limit)
      // 其余 SKIPPED（内容类型不支持、文档删除、版本过期）重跑也没意义。
      const retryableError =
        existing.status === 'FAILED' ||
        (existing.status === 'SKIPPED' &&
          ['llm_unavailable', 'hourly_limit'].includes(existing.error ?? ''));
      const retryable =
        retryableError &&
        Date.now() - existing.createdAt.getTime() > 30 * 60 * 1000;
      if (!retryable) {
        return {
          enqueued: false,
          reason: `run-${existing.status.toLowerCase()}`,
          runId: existing.id,
        };
      }

      await this.prisma.kbGenerationRun.update({
        where: { id: existing.id },
        data: { status: 'QUEUED', error: null },
      });
      await this.queue.add(existing.id, idempotencyKey);
      return { enqueued: true, runId: existing.id };
    }

    // 版本号变了但内容没变：不重复生成，直接把 lastCandidateVersion 推上去。
    const latestDone = await this.prisma.kbGenerationRun.findFirst({
      where: {
        documentId: doc.id,
        status: 'DONE',
        contentHash,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (latestDone) {
      await this.prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: { lastCandidateVersion: doc.version },
      });
      return {
        enqueued: false,
        reason: 'content-unchanged',
        runId: latestDone.id,
      };
    }

    let run: { id: string };
    try {
      run = await this.prisma.kbGenerationRun.create({
        data: {
          idempotencyKey,
          documentId: doc.id,
          documentVersion: doc.version,
          contentHash,
          targetDomain,
          status: 'QUEUED',
          promptVersion: KB_GENERATION_PROMPT_VERSION,
          tenantId: null,
        },
        select: { id: true },
      });
    } catch (error) {
      // 并发发布时另一路径已建了同一幂等键的 run：直接复用。
      if ((error as { code?: string }).code === 'P2002') {
        const raced = await this.prisma.kbGenerationRun.findUnique({
          where: { idempotencyKey },
        });
        return {
          enqueued: false,
          reason: raced ? `run-${raced.status.toLowerCase()}` : 'race',
          runId: raced?.id,
        };
      }
      throw error;
    }

    await this.queue.add(run.id, idempotencyKey);
    return { enqueued: true, runId: run.id };
  }

  /**
   * 手动重新生成：后台「重新生成」按钮。
   * 与 enqueue 的区别是绕过「同内容已生成」的跳过规则：
   * 清掉该 run 尚未生效的候选、把 run 重置回 QUEUED，再入队。
   */
  async regenerate(documentId: string): Promise<EnqueueResult> {
    if (!isKbGenerationEnabled()) {
      return { enqueued: false, reason: 'disabled' };
    }

    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        version: true,
        activeVersion: true,
        deletedAt: true,
        content: true,
        contentHash: true,
      },
    });
    if (!doc || doc.deletedAt) {
      return { enqueued: false, reason: 'not-found-or-deleted' };
    }
    if (doc.activeVersion <= 0) {
      return { enqueued: false, reason: 'not-published' };
    }

    const contentHash = doc.contentHash ?? sha256(doc.content);
    const idempotencyKey = buildGenerationIdempotencyKey(
      doc.id,
      doc.version,
      contentHash,
    );

    const existing = await this.prisma.kbGenerationRun.findUnique({
      where: { idempotencyKey },
    });
    if (!existing) {
      return this.enqueue(documentId);
    }

    await this.prisma.kbGenerationCandidate.deleteMany({
      where: { runId: existing.id, status: 'PENDING' },
    });
    await this.prisma.kbGenerationRun.update({
      where: { id: existing.id },
      data: {
        status: 'QUEUED',
        error: null,
        startedAt: null,
        finishedAt: null,
        candidateCount: 0,
        filteredCount: 0,
      },
    });
    await this.queue.add(existing.id, idempotencyKey);
    return { enqueued: true, runId: existing.id };
  }

  /**
   * 处理器入口。任何异常都落 run.error，不向 BullMQ 抛。
   */
  async processRun(runId: string): Promise<void> {
    const run = await this.prisma.kbGenerationRun.findUnique({
      where: { id: runId },
    });
    if (!run) return;
    if (['DONE', 'SKIPPED'].includes(run.status)) return;
    if (run.status === 'RUNNING') {
      // 进程崩溃会留下 RUNNING；由补偿扫描重置，不在 worker 里抢。
      return;
    }

    await this.prisma.kbGenerationRun.update({
      where: { id: run.id },
      data: { status: 'RUNNING', startedAt: new Date(), error: null },
    });

    try {
      await this.generateForRun(run.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown generation error';
      this.logger.error(`[kb-generation] run=${run.id} failed: ${message}`);
      await this.finishRun(run.id, 'FAILED', {
        error: message.slice(0, 1000),
      });
    }
  }

  private async generateForRun(runId: string): Promise<void> {
    const run = await this.prisma.kbGenerationRun.findUnique({
      where: { id: runId },
    });
    if (!run) return;

    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id: run.documentId },
      select: {
        id: true,
        version: true,
        deletedAt: true,
        content: true,
        domain: true,
        docId: true,
        title: true,
        locale: true,
        contentType: true,
        keywords: true,
        autoKeywords: true,
      },
    });

    if (!doc || doc.deletedAt) {
      await this.finishRun(run.id, 'SKIPPED', { error: 'document_deleted' });
      return;
    }
    if (doc.version !== run.documentVersion) {
      // 生成过程中文档又升版：让补偿扫描为最新版本重新入队。
      await this.finishRun(run.id, 'SKIPPED', { error: 'stale_version' });
      return;
    }

    const limits = generationLimits();
    if (!limits.supportedContentTypes.includes(doc.contentType)) {
      // 终态跳过：推 lastCandidateVersion，避免补偿扫描每 10 分钟重捞一遍。
      await this.markCandidateVersion(doc.id, run.documentVersion);
      await this.finishRun(run.id, 'SKIPPED', {
        error: `content_type_unsupported:${doc.contentType}`,
      });
      return;
    }

    const hourStart = new Date(Date.now() - 60 * 60 * 1000);
    const recentRuns = await this.prisma.kbGenerationRun.count({
      where: { createdAt: { gte: hourStart }, status: { not: 'SKIPPED' } },
    });
    if (recentRuns > limits.hourlyLimit) {
      await this.finishRun(run.id, 'SKIPPED', { error: 'hourly_limit' });
      return;
    }

    const intents = await this.intentDomainService.list();
    const targetIntent = intents.some(
      (intent) => intent.label === run.targetDomain,
    )
      ? run.targetDomain
      : 'rag';
    if (!intents.some((intent) => intent.label === targetIntent)) {
      await this.markCandidateVersion(doc.id, run.documentVersion);
      await this.finishRun(run.id, 'SKIPPED', {
        error: 'target_intent_unavailable',
      });
      return;
    }

    const raw = await this.generator.generate({
      title: doc.title,
      domain: doc.domain,
      locale: doc.locale,
      contentType: doc.contentType,
      keywords: doc.keywords ?? [],
      content: doc.content,
      targetIntent,
    });

    if (!raw) {
      await this.finishRun(run.id, 'SKIPPED', { error: 'llm_unavailable' });
      return;
    }

    const rawCount =
      raw.keywords.length +
      raw.intent_examples.length +
      raw.golden_queries.length;

    const filtered = filterRawGeneration(raw, {
      targetIntent,
      documentDomain: doc.domain,
      locale: doc.locale,
      existingKeywords: new Set(
        [...(doc.keywords ?? []), ...(doc.autoKeywords ?? [])].map(
          normalizeCandidateText,
        ),
      ),
    });

    const exampleDedupe = await this.dedupe.dedupeIntentExamples(
      targetIntent,
      filtered.examples,
    );
    const goldenDedupe = await this.dedupe.dedupeGoldenQueries(
      doc.id,
      filtered.goldenQueries,
    );

    const drafts: KbCandidateDraft[] = [];

    for (const keyword of filtered.keywords) {
      drafts.push({
        kind: 'KEYWORD',
        targetDomain: doc.domain,
        locale: doc.locale,
        text: keyword,
        normalizedHash: hashCandidateText(keyword),
        payload: { generator: KB_GENERATION_PROMPT_VERSION },
      });
    }

    for (const example of exampleDedupe.kept) {
      drafts.push({
        kind: 'INTENT_EXAMPLE',
        targetDomain: targetIntent,
        locale: doc.locale,
        text: example.text,
        normalizedHash: example.normalizedHash,
        nearestScore: example.nearestScore,
        payload: {
          generator: KB_GENERATION_PROMPT_VERSION,
          sourceDocumentDomain: doc.domain,
        },
      });
    }

    for (const golden of goldenDedupe.kept) {
      drafts.push({
        kind: 'GOLDEN_QUERY',
        targetDomain: doc.domain,
        locale: golden.lang ?? doc.locale,
        text: golden.query,
        normalizedHash: golden.normalizedHash,
        payload: {
          generator: KB_GENERATION_PROMPT_VERSION,
          lang: golden.lang ?? null,
          expectedDocIds: [doc.docId],
        },
      });
    }

    if (drafts.length > 0) {
      await this.prisma.kbGenerationCandidate.createMany({
        data: drafts.map((draft) => ({
          runId: run.id,
          documentId: doc.id,
          documentVersion: run.documentVersion,
          kind: draft.kind,
          status: 'PENDING',
          targetDomain: draft.targetDomain,
          locale: draft.locale,
          text: draft.text,
          normalizedHash: draft.normalizedHash,
          payload: draft.payload as Prisma.InputJsonValue,
          nearestScore: draft.nearestScore,
          source: 'LLM',
          promptVersion: KB_GENERATION_PROMPT_VERSION,
          needsReview: draft.kind !== 'KEYWORD',
          idempotencyKey: sha256(
            `${run.id}:${draft.kind}:${draft.normalizedHash}`,
          ),
          tenantId: null,
        })),
        skipDuplicates: true,
      });
    }

    // 关键词自动生效是「增强」不是「必须」：失败不影响 run 成功，
    // 候选保持 PENDING/FAILED 交给人工或补偿任务。
    try {
      await this.keywordAutoApply.applyForRun(run.id);
    } catch (error) {
      this.logger.warn(
        `[kb-generation] keyword auto-apply failed for run=${run.id}: ${
          (error as Error).message
        }`,
      );
    }

    const dropped =
      rawCount -
      drafts.length +
      filtered.dropped +
      exampleDedupe.dropped +
      goldenDedupe.dropped;

    await this.finishRun(run.id, 'DONE', {
      candidateCount: drafts.length,
      filteredCount: Math.max(0, dropped),
      finishedAt: new Date(),
    });

    await this.markCandidateVersion(doc.id, run.documentVersion);

    this.logger.log(
      `[kb-generation] run=${run.id} done: ${drafts.length} candidates, ` +
        `filtered=${Math.max(0, dropped)}, target=${targetIntent}`,
    );
  }

  private async markCandidateVersion(
    documentId: string,
    version: number,
  ): Promise<void> {
    await this.prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { lastCandidateVersion: version },
    });
  }

  private async finishRun(
    runId: string,
    status: KbGenerationStatus,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.prisma.kbGenerationRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        ...data,
      },
    });
  }
}
