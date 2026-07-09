import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragChunkService: RagChunkService,
    private readonly ragEmbeddingService: RagEmbeddingService,
    private readonly ragQualityService: RagQualityService,
    private readonly meilisearchService: MeilisearchService,
    @InjectQueue(RAG_EMBEDDING_QUEUE)
    private readonly ragEmbeddingQueue: Queue,
  ) {}

  async create(dto: CreateRagDocDto) {
    return this.prisma.knowledgeDocument.create({
      data: {
        title: dto.title,
        domain: dto.domain,
        docId: dto.docId,
        keywords: dto.keywords,
        locale: dto.locale ?? 'en',
        contentType: dto.contentType ?? 'policy',
        priority: dto.priority ?? 'P2',
        content: dto.content,
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
    await this.getById(id);
    return this.prisma.knowledgeDocument.update({
      where: { id },
      data: {
        ...dto,
        version: { increment: 1 },
      },
    });
  }

  async delete(id: string) {
    const doc = await this.getById(id);

    // 1. 同步删除 Meilisearch 中的 chunks
    await this.deleteMeilisearchChunks(id);

    // 2. 物理删除文档（CASCADE 会自动删除关联的 chunks 和向量）
    await this.prisma.knowledgeDocument.delete({
      where: { id },
    });

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
  }> {
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { isActive: true },
      select: {
        id: true,
        title: true,
        qualityScore: true,
        qualityFlags: true,
        createdAt: true,
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

    for (const doc of docs) {
      const score = doc.qualityScore;

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

    const needReview = byScore.suspicious + byScore.fair;

    return { total, needReview, byScore, recentFlags };
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

  async reindex(documentId: string) {
    const doc = await this.getById(documentId);

    // 1. 同步删除 Meilisearch 中的旧 chunks（防止孤儿数据残留）
    await this.deleteMeilisearchChunks(documentId);

    // 2. 删除 PostgreSQL 中的旧 chunks
    await this.prisma.documentChunk.deleteMany({
      where: { documentId },
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
  private async updateStatus(documentId: string, status: string): Promise<void> {
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
  async processStepChunk(documentId: string): Promise<{ chunksCreated: number }> {
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
    await this.updateStatus(documentId, 'embedded');
    try {
      await this.ragEmbeddingQueue.add('embed', {
        documentId,
        force: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to submit embedding job: ${message}`);
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
    const chunkInfo = await this.ragEmbeddingService.getEmbeddingStatus(documentId);
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
      const oldChunks = await this.prisma.documentChunk.findMany({
        where: { documentId },
        select: { id: true },
      });

      if (oldChunks.length === 0) return;

      for (const chunk of oldChunks) {
        await this.meilisearchService.deleteChunk(chunk.id);
      }

      this.logger.log(
        `Deleted ${oldChunks.length} chunks from Meilisearch for document ${documentId}`,
      );
    } catch (error) {
      // 删除失败不抛异常，Meilisearch 不可用时跳过
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
      this.logger.warn(`Failed to persist auditResult for ${documentId}: ${message}`);
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
    const doc = await this.getById(documentId);

    if (!newContent || newContent.trim().length === 0) {
      throw new BadRequestException('Content cannot be empty');
    }

    // 1. 更新 content 和版本号
    const updated = await this.prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        content: newContent,
        version: { increment: 1 },
      },
    });

    // 2. 重新切片（删除旧 chunks，创建新 chunks）
    await this.prisma.documentChunk.deleteMany({
      where: { documentId },
    });

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
        `[updateContent] Re-chunked ${documentId} → ${chunks.length} chunks (v${updated.version})`,
      );
    }

    // 3. 提交向量化任务
    try {
      await this.ragEmbeddingQueue.add('embed', {
        documentId,
        force: true,
      });
      this.logger.log(
        `[updateContent] Submitted embedding job for ${documentId}`,
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
