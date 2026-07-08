import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { UpdateRagDocDto } from './dto/update-rag-doc.dto';
import { QueryRagDocDto } from './dto/query-rag-doc.dto';
import { CreateRagDocDto } from '@api/admin/rag/dto/create-rag-doc.dto';
import { RagChunkService } from './rag-chunk.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import { RAG_EMBEDDING_QUEUE } from './rag-embedding-queue.constants';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragChunkService: RagChunkService,
    private readonly ragEmbeddingService: RagEmbeddingService,
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

    // 同步删除 Meilisearch 中的 chunks
    // 软删除前把该文档所有 chunk 从 BM25 索引中清理掉
    await this.deleteMeilisearchChunks(id);

    return this.prisma.knowledgeDocument.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getDomains(): Promise<string[]> {
    const result = await this.prisma.knowledgeDocument.findMany({
      where: { isActive: true },
      select: { domain: true },
      distinct: ['domain'],
    });
    return result.map((r) => r.domain).filter(Boolean);
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
}
