import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { UpdateRagDocDto } from './dto/update-rag-doc.dto';
import { QueryRagDocDto } from './dto/query-rag-doc.dto';
import { CreateRagDocDto } from '@api/admin/rag/dto/create-rag-doc.dto';
import { RagChunkService } from './rag-chunk.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagQualityService } from './rag-quality.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import { RAG_EMBEDDING_QUEUE } from './rag-embedding-queue.constants';
import { KnowledgeDomainService } from './knowledge-domain.service';
import { sha256 } from '@api/common/crypto.util';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragChunkService: RagChunkService,
    private readonly ragEmbeddingService: RagEmbeddingService,
    private readonly ragQualityService: RagQualityService,
    private readonly meilisearchService: MeilisearchService,
    private readonly knowledgeDomainService: KnowledgeDomainService,
    @InjectQueue(RAG_EMBEDDING_QUEUE)
    private readonly ragEmbeddingQueue: Queue,
  ) {}

  /** 直接建/改文档时也跑同一套解析质量检查，避免分数只在上传时更新。 */
  private qualityFields(content: string): {
    qualityScore: number;
    qualityFlags: string | null;
  } {
    const result = this.ragQualityService.check(
      content,
      Buffer.byteLength(content, 'utf8'),
    );
    return {
      qualityScore: result.overallScore,
      qualityFlags: result.flags.length > 0 ? result.flags.join(',') : null,
    };
  }

  async create(dto: CreateRagDocDto) {
    const domain = await this.knowledgeDomainService.resolve(dto.domain);
    return this.prisma.knowledgeDocument.create({
      data: {
        ...this.qualityFields(dto.content),
        title: dto.title,
        domain,
        docId: dto.docId,
        keywords: dto.keywords,
        locale: dto.locale ?? 'en',
        contentType: dto.contentType ?? 'policy',
        priority: dto.priority ?? 'P2',
        content: dto.content,
        // 正文哈希代表"这份正文是哪一版"，供生成幂等与变更检测使用。
        // 每次正文写入都必须刷新，否则内容变了哈希还停在旧值。
        contentHash: sha256(dto.content),
        // 从 0 开始：文档在切片+向量化完成、走到 activate 之前没有任何可读版本。
        // 若与 version 同为 1，activate 会走「already-active」，标记永远是 false。
        activeVersion: 0,
      },
    });
  }

  async list(query: QueryRagDocDto) {
    const {
      page = 1,
      pageSize = 20,
      domain,
      search,
      priority,
      isActive,
    } = query;
    const where: any = {};

    if (domain) where.domain = domain;
    if (priority) where.priority = priority;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, list] = await this.prisma.$transaction([
      this.prisma.knowledgeDocument.count({ where }),
      this.prisma.knowledgeDocument.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { page, pageSize, total, list };
  }

  async getById(id: string) {
    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
    });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateRagDocDto) {
    const doc = await this.getById(id);

    // docId + locale 是 golden 用例映射与检索定位的业务键，创建后不可变。
    // 允许修改会让既有用例外静默指向另一篇文档，评测结果从此不可解释。
    if (dto.docId !== undefined && dto.docId !== doc.docId) {
      throw new BadRequestException(
        'docId 创建后不可修改；如需更换标识请新建文档',
      );
    }
    if (dto.locale !== undefined && dto.locale !== doc.locale) {
      throw new BadRequestException(
        'locale 创建后不可修改；如需其他语言请新建文档',
      );
    }

    const domain =
      dto.domain !== undefined
        ? await this.knowledgeDomainService.resolve(dto.domain)
        : undefined;
    return this.prisma.knowledgeDocument.update({
      where: { id },
      data: {
        ...dto,
        ...(domain !== undefined ? { domain } : {}),
        // 不在这里 +1：这次只改元数据，没有重新切片。
        // 一 +1 就会让 version 跑到 activeVersion 前面，而 chunks 还停在旧版本，
        // 整文档兜底层（activeVersion === version）会把这个文档排除掉。
        // contentHash 也不动：元数据编辑不改变正文。
      },
    });
  }

  async delete(id: string) {
    const doc = await this.getById(id);

    // 1. 同步删除 Meilisearch 中的 chunks
    await this.deleteMeilisearchChunks(id);

    // 2. 物理删除文档（CASCADE 会自动删除关联的 chunks 和向量）。
    //    生成流水线的三张表没有 FK 级联，硬删文档后必须显式清理，
    //    否则 run/候选/合成用例会变成永不回收的孤儿行。
    await this.prisma.$transaction([
      this.prisma.kbGenerationCandidate.deleteMany({
        where: { documentId: id },
      }),
      this.prisma.kbGenerationRun.deleteMany({ where: { documentId: id } }),
      this.prisma.kbSyntheticGolden.deleteMany({ where: { documentId: id } }),
      this.prisma.knowledgeDocument.delete({ where: { id } }),
    ]);

    return doc;
  }

  async getDomains(): Promise<string[]> {
    const result = await this.prisma.knowledgeDocument.findMany({
      where: { isActive: true },
      select: { domain: true },
      distinct: ['domain'],
    });
    return result.map((r) => r.domain).filter(Boolean);
  }

  /**
   * 获取质量统计数据
   * 返回按分数段的文档分布 + 最近的问题标记
   */
  async getQualityStats(): Promise<{
    total: number;
    needReview: number;
    flagged: number;
    byScore: {
      excellent: number;
      good: number;
      fair: number;
      suspicious: number;
    };
    recentFlags: Array<{
      documentId: string;
      title: string;
      score: number | null;
      flags: string | null;
      parsedAt: Date;
    }>;
    /**
     * 最近更新文档：不论有没有质量标记都列出来。
     * 更新正文后标记会被重算（多半清空），只按「有标记」筛会让刚改过的文档
     * 从页面上消失，正好错过该看新旧分块的时候。
     */
    recentUpdated: Array<{
      documentId: string;
      title: string;
      score: number | null;
      flags: string | null;
      activeVersion: number;
      updatedAt: Date;
    }>;
  }> {
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { isActive: true },
      select: {
        id: true,
        title: true,
        qualityScore: true,
        qualityFlags: true,
        createdAt: true,
        updatedAt: true,
        activeVersion: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const total = docs.length;
    const byScore = { excellent: 0, good: 0, fair: 0, suspicious: 0 };
    const recentFlags: Array<{
      documentId: string;
      title: string;
      score: number | null;
      flags: string | null;
      parsedAt: Date;
    }> = [];
    let flagged = 0;
    let flaggedHighScore = 0;

    for (const doc of docs) {
      const score = doc.qualityScore;

      if (doc.qualityFlags) {
        flagged += 1;
        if (score === null || score === undefined || score >= 70) {
          flaggedHighScore += 1;
        }
      }

      if (score === null || score === undefined) {
        // uncheckd — skip
      } else if (score >= 90) byScore.excellent++;
      else if (score >= 70) byScore.good++;
      else if (score >= 50) byScore.fair++;
      else byScore.suspicious++;

      // Collect flagged documents (last 10)
      if (doc.qualityFlags && recentFlags.length < 10) {
        recentFlags.push({
          documentId: doc.id,
          title: doc.title,
          score: doc.qualityScore,
          flags: doc.qualityFlags,
          parsedAt: doc.createdAt,
        });
      }
    }

    // 有标记的文档即使分数 >=70 也要人看一眼；避免“待复核 0、标记 5 篇”。
    const needReview = byScore.suspicious + byScore.fair + flaggedHighScore;

    const recentUpdated = [...docs]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 5)
      .map((doc) => ({
        documentId: doc.id,
        title: doc.title,
        score: doc.qualityScore,
        flags: doc.qualityFlags,
        activeVersion: doc.activeVersion,
        updatedAt: doc.updatedAt,
      }));

    return { total, needReview, flagged, byScore, recentFlags, recentUpdated };
  }

  // ==================== Chunk operations ====================

  async getChunks(documentId: string) {
    await this.getById(documentId);
    return this.prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
      select: {
        id: true,
        chunkIndex: true,
        content: true,
        tokenCount: true,
        documentVersion: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * 新旧版本分块差异：按两版本 chunkIndex 并集逐位比对。
   * 只做诊断（新增/删除/修改/未变），不判断内容对错。
   */
  async getChunksDiff(documentId: string) {
    await this.getById(documentId);
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: [{ documentVersion: 'desc' }, { chunkIndex: 'asc' }],
      select: {
        id: true,
        chunkIndex: true,
        content: true,
        tokenCount: true,
        documentVersion: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const versions = [...new Set(chunks.map((chunk) => chunk.documentVersion))]
      .sort((a, b) => b - a);
    const currentVersion = versions[0] ?? null;
    const previousVersion = versions[1] ?? null;
    const empty = {
      added: 0,
      removed: 0,
      modified: 0,
      unchanged: 0,
    };
    if (currentVersion === null || previousVersion === null) {
      return {
        currentVersion,
        previousVersion,
        changes: [],
        summary: empty,
      };
    }

    const byVersion = new Map<number, Map<number, (typeof chunks)[number]>>();
    for (const chunk of chunks) {
      if (!byVersion.has(chunk.documentVersion)) {
        byVersion.set(chunk.documentVersion, new Map());
      }
      byVersion.get(chunk.documentVersion)!.set(chunk.chunkIndex, chunk);
    }
    const current = byVersion.get(currentVersion)!;
    const previous = byVersion.get(previousVersion)!;
    const indexes = [
      ...new Set([...current.keys(), ...previous.keys()]),
    ].sort((a, b) => a - b);

    const summary = { ...empty };
    const changes = indexes.map((chunkIndex) => {
      const before = previous.get(chunkIndex) ?? null;
      const after = current.get(chunkIndex) ?? null;
      const change = !before
        ? 'added'
        : !after
          ? 'removed'
          : before.content === after.content
            ? 'unchanged'
            : 'modified';
      summary[change] += 1;
      return { chunkIndex, change, previous: before, current: after };
    });

    return { currentVersion, previousVersion, changes, summary };
  }

  /**
   * 按业务 docId 取 chunk（判官输入规范用）。
   *
   * `KnowledgeDocument.docId` 不是全局唯一，唯一约束是 `[docId, locale]`；
   * 先按 `docId + locale + isActive` 定位文档，再取该文档的 chunk。
   * 找不到返回空数组，由调用方决定是「无来源」还是判官错误。
   */
  async getChunksByDocId(docId: string, locale = 'en') {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { docId, locale, isActive: true },
      select: { id: true, title: true, docId: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!doc) return [];

    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId: doc.id },
      orderBy: { chunkIndex: 'asc' },
      select: { chunkIndex: true, content: true, documentVersion: true },
    });
    return chunks.map((chunk) => ({
      docId: doc.docId,
      title: doc.title,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      documentVersion: chunk.documentVersion,
    }));
  }

  async reindex(documentId: string) {
    const doc = await this.getById(documentId);

    // 1. 只删当前版本在 Meilisearch 的条目，旧版本留给回滚与读请求。
    //    删全量会让保留期内本可回滚的旧版本在搜索侧直接消失。
    //    失败时直接抛出：先删 Meili 再删 PG，抛在这里还没有破坏任何一侧。
    await this.meilisearchService.deleteChunkVersion(
      documentId,
      doc.version,
    );

    // 2. 只删除 PostgreSQL 中当前版本的 chunks
    await this.prisma.documentChunk.deleteMany({
      where: { documentId, documentVersion: doc.version },
    });

    // 2. 重新切片
    const chunks = await this.ragChunkService.chunkText(doc.content);

    if (chunks.length === 0) {
      return { chunksCreated: 0, documentVersion: doc.version };
    }

    // 3. 批量创建新 chunks
    await this.prisma.documentChunk.createMany({
      data: chunks.map((chunk) => ({
        documentId,
        chunkIndex: chunk.index,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        documentVersion: doc.version,
      })),
    });
    // ── Phase 4b: 提交向量化任务到队列 ──
    // 改为异步：提交 BullMQ job 到 rag-embedding 队列，立即返回。
    // force: true 表示覆盖已有向量（因为旧 chunks 已被删除，全新生成）
    try {
      await this.ragEmbeddingQueue.add('embed', {
        documentId,
        force: true,
        trigger: 'reindex',
      });
      this.logger.log(
        `Submitted reindex embedding job for document ${documentId} (${chunks.length} chunks)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to submit reindex embedding job for document ${documentId}: ${message}`,
      );
    }

    return {
      chunksCreated: chunks.length,
      documentVersion: doc.version,
    };
  }

  // ==================== 分步处理状态机 ====================

  /**
   * 更新文档处理状态
   */
  private async updateStatus(
    documentId: string,
    status: string,
  ): Promise<void> {
    await this.prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { processStatus: status },
    });
  }

  /**
   * 执行解析步骤: uploaded → parsed
   * 实际解析由 ragSyncService.uploadFile() 完成，此处标记状态
   */
  async processStepParse(documentId: string): Promise<void> {
    // 解析已在 upload 时完成，只需更新状态
    await this.updateStatus(documentId, 'parsed');
  }

  /**
   * 执行切片步骤: parsed → chunked
   */
  async processStepChunk(
    documentId: string,
  ): Promise<{ chunksCreated: number }> {
    const doc = await this.getById(documentId);

    // 删除旧 chunks
    await this.prisma.documentChunk.deleteMany({
      where: { documentId },
    });

    // 切片
    const chunks = await this.ragChunkService.chunkText(doc.content);
    if (chunks.length === 0) {
      await this.updateStatus(documentId, 'chunked');
      return { chunksCreated: 0 };
    }

    // 批量创建新 chunks
    await this.prisma.documentChunk.createMany({
      data: chunks.map((chunk) => ({
        documentId,
        chunkIndex: chunk.index,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        documentVersion: doc.version,
      })),
    });

    await this.updateStatus(documentId, 'chunked');
    return { chunksCreated: chunks.length };
  }

  /**
   * 执行向量化步骤: chunked → embedded
   * 提交 BullMQ 任务异步处理
   */
  async processStepEmbed(documentId: string): Promise<void> {
    try {
      await this.ragEmbeddingQueue.add('embed', {
        documentId,
        force: true,
        trigger: 'manual',
      });
      // 任务提交成功后才更新状态
      await this.updateStatus(documentId, 'embedded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to submit embedding job: ${message}`);
      throw new BadRequestException(
        `Failed to start embedding: ${message}. Make sure Ollama is running.`,
      );
    }
  }

  /**
   * 获取文档处理进度
   */
  async getProcessStatus(documentId: string): Promise<{
    status: string;
    chunkInfo: { total: number; embedded: number; pending: number } | null;
  }> {
    const doc = await this.getById(documentId);
    const chunkInfo =
      await this.ragEmbeddingService.getEmbeddingStatus(documentId);
    return {
      status: doc.processStatus,
      chunkInfo,
    };
  }

  // ==================== Meilisearch 同步 ====================

  /**
   * 删除文档在 Meilisearch 中的所有 chunks
   *
   * 为什么需要这个方法?
   *   知识库删除/重新切片时，PostgreSQL 的 chunks 会被删除或重建，
   *   但 Meilisearch 不会自动同步。必须手动调 deleteChunk。
   *   否则 Meilisearch 里会残留孤儿数据。
   *
   * 什么时候调用:
   *   - delete() 软删除文档时 -> 同步删 Meilisearch
   *   - reindex() 重新切片时 -> 删旧 chunks，后面 indexChunk 加新的
   */
  private async deleteMeilisearchChunks(documentId: string): Promise<void> {
    try {
      // 按 documentId 过滤一次删完（缺陷 B）：不再先查 PG 拿 chunk id 再逐条删。
      // 逐条删有个隐患——如果 PG 里的 chunk 已经先被删掉，就查不到 id、一条也删不掉。
      await this.meilisearchService.deleteChunksByDocument(documentId);

      this.logger.log(
        `Deleted all chunks from Meilisearch for document ${documentId}`,
      );
    } catch (error) {
      // 删除路径不阻断主流程（与更新路径相反：更新必须保证旧条目消失，
      // 否则会让新版向量和旧版 BM25 同时对外）。
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to delete Meilisearch chunks for document ${documentId}: ${message}`,
      );
    }
  }

  // ==================== Bulk operations ====================

  /**
   * reindexAll — 重新索引所有活跃文档（切片 + 向量化 + Meilisearch 索引）
   *
   * 用于批量修复 Meilisearch 存量数据为空的问题。
   * 遍历所有 isActive=true 的文档，逐个提交 reindex 任务到 BullMQ 队列。
   * 所有任务异步执行，不等待完成。
   */
  async reindexAll(): Promise<{
    total: number;
    submitted: number;
    failed: number;
  }> {
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { isActive: true },
      select: { id: true, title: true },
    });

    this.logger.log(`[reindexAll] Found ${docs.length} active documents`);

    let submitted = 0;
    let failed = 0;

    for (const doc of docs) {
      try {
        await this.reindex(doc.id);
        submitted++;
        this.logger.log(
          `[reindexAll] Submitted reindex for "${doc.title}" (${doc.id})`,
        );
      } catch (error) {
        failed++;
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `[reindexAll] Failed to submit reindex for "${doc.title}": ${message}`,
        );
      }
    }

    this.logger.log(
      `[reindexAll] Done: ${submitted} submitted, ${failed} failed (of ${docs.length} total)`,
    );

    return { total: docs.length, submitted, failed };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 双源对撞 — Diff 接口
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * getDiff — 执行双源对撞对比，返回结构化 DiffResult
   * 对比 rawContent（pdf-parse 基准）和 content（Unstructured 解析）的差异。
   * 结果包含：
   *   - diffRanges: 字符级差异范围
   *   - numberErrors: 数字专项检测结果
   *   - wer: 字错率
   *   - contentMatch: 内容是否完全一致
   */
  async getDiff(documentId: string) {
    const doc = await this.getById(documentId);

    if (!doc.rawContent) {
      throw new BadRequestException(
        `Document ${documentId} has no rawContent (pdf-parse baseline). Only PDF documents support diff.`,
      );
    }

    const diffResult = this.ragQualityService.computeDiff(
      doc.rawContent,
      doc.content,
    );

    // 将对比结果存入 auditResult（异步，不阻塞返回）
    try {
      await this.prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          auditResult: diffResult as any,
        },
      });
    } catch (error) {
      // 存储失败不影响前端展示
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to persist auditResult for ${documentId}: ${message}`,
      );
    }

    return {
      documentId,
      rawContent: doc.rawContent,
      content: doc.content,
      ...diffResult,
    };
  }

  /**
   * updateContent — 更新文档 content（人工审核后修改），然后重新切片 + 向量化
   */
  async updateContent(documentId: string, newContent: string) {
    await this.getById(documentId);

    if (!newContent || newContent.trim().length === 0) {
      throw new BadRequestException('Content cannot be empty');
    }

    // 1. 更新正文、哈希与版本号。质量分跟着正文重算。
    const updated = await this.prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        content: newContent,
        contentHash: sha256(newContent),
        ...this.qualityFields(newContent),
        version: { increment: 1 },
        // 新版本分块已写、向量未就绪，状态必须如实回落。
        processStatus: 'chunked',
      },
    });

    // 2. 追加新版本分块。不删旧版本：
    //    旧版本是切换前的读来源，也是保留期内回滚的依据；
    //    统一由 KbVersionService 按保留期清理。
    const chunks = await this.ragChunkService.chunkText(newContent);

    if (chunks.length > 0) {
      await this.prisma.documentChunk.createMany({
        data: chunks.map((chunk) => ({
          documentId,
          chunkIndex: chunk.index,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          documentVersion: updated.version,
        })),
      });
      this.logger.log(
        `[updateContent] Appended ${chunks.length} chunks for ${documentId} (v${updated.version})`,
      );
    }

    // 3. 提交向量化任务，只处理这一版，完成后才能切 activeVersion。
    try {
      await this.ragEmbeddingQueue.add('embed', {
        documentId,
        force: true,
        targetVersion: updated.version,
        trigger: 'manual',
      });
      this.logger.log(
        `[updateContent] Submitted embedding job for ${documentId} (v${updated.version})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[updateContent] Failed to submit embedding job: ${message}`,
      );
    }

    return updated;
  }
}
