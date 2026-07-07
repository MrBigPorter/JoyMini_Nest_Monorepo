import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { UpdateRagDocDto } from './dto/update-rag-doc.dto';
import { QueryRagDocDto } from './dto/query-rag-doc.dto';
import { CreateRagDocDto } from '@api/admin/rag/dto/create-rag-doc.dto';
import { RagChunkService } from './rag-chunk.service';
import { RagEmbeddingService } from './rag-embedding.service';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragChunkService: RagChunkService,
    private readonly ragEmbeddingService: RagEmbeddingService,
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
    await this.getById(id);
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

    // 1. 删除旧 chunks
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
    // ── Phase 4b: 向量化 ──
    // 重新切片后需要重新生成所有 chunk 的向量。
    // force: true 表示覆盖已有向量（因为旧 chunks 已被删除，全新生成）
    await this.ragEmbeddingService.embedDocument(documentId, { force: true });

    return {
      chunksCreated: chunks.length,
      documentVersion: doc.version,
    };
  }
}
