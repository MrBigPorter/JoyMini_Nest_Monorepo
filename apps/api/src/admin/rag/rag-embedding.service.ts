import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiService } from '@api/common/ai/ai.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import pLimit from 'p-limit';

// ========== 类型定义 ==========

export interface EmbeddingResult {
  /** 成功处理的 chunk 数量 */
  successCount: number;
  /** 失败的 chunk 数量 */
  failCount: number;
  /** 失败详情（仅返回 chunkIndex 和错误摘要，不包含完整内容以免日志太大） */
  errors: { chunkIndex: number; reason: string }[];
  /** 嵌入的总耗时（毫秒） */
  durationMs: number;
}

export interface EmbeddingOptions {
  /** 并发数：同时调用 generateEmbedding 的最大数量（默认 2） */
  concurrency?: number;
  /**
   * 是否覆盖已有向量。
   * - false（默认）：跳过已经有 embedding 的 chunk
   * - true：无论是否有 embedding，全部重新生成
   */
  force?: boolean;
}

// ========== Service ==========

/**
 * RagEmbeddingService — 文档块向量化服务
 *
 * ## 职责
 * 遍历指定文档的所有 DocumentChunk，调用 AiService.generateEmbedding()
 * 将文本转为 1024 维向量（bge-m3 模型），存入 pgvector 的 embedding 列。
 *
 * ## 为什么需要这个服务？
 * RAG（检索增强生成）的核心是"先检索后生成"。
 * 检索阶段需要把用户问题转成向量，然后和文档向量的相似度搜索。
 * 所以文档在上传/更新时必须先向量化，否则检索时找不到。
 *
 * ## 架构位置
 * rag-sync.service.ts (uploadFile)  ──→  RagChunkService (切片)
 *                                         └──→  RagEmbeddingService (向量化) ←── 你在这里
 *                                                  └──→  AiService.generateEmbedding()
 *                                                           └──→  Ollama bge-m3 (1024维)
 *
 * ## 为什么用 raw SQL 而不是 Prisma？
 * DocumentChunk.embedding 是 Unsupported("vector(1024)") 类型，
 * Prisma 不直接支持 vector 类型的写入。
 * 所以必须用 $executeRawUnsafe 执行原生 SQL，把向量数组转成 PostgreSQL vector 格式。
 *
 * 参考：intent-classifier.ts 第 149-157 行用的就是同样的模式。
 *
 * ## 错误隔离策略
 * 每个 chunk 的向量化是独立的。
 * 如果某个 chunk 的 AI 调用失败（比如 Ollama 暂时不可用），
 * 不会影响其他 chunk，也不会回滚。
 * 失败的 chunk 可以通过 reindex 重新处理。
 *
 * ## 你需要做的事（TODO）
 * 在 embedChunk() 方法中调用 this.aiService.generateEmbedding(content)。
 * 调用方式和 intent-classifier.ts 第 132 行完全一样。
 *
 * @example
 * const ragEmbeddingService = new RagEmbeddingService(prisma, aiService);
 * const result = await ragEmbeddingService.embedDocument('doc-123');
 * // → { successCount: 12, failCount: 0, errors: [], durationMs: 3456 }
 */
@Injectable()
export class RagEmbeddingService {
  private readonly logger = new Logger(RagEmbeddingService.name);

  // 默认并发数：2
  // 为什么是 2 不是 10？因为 generateEmbedding 调用 Ollama API，
  // Ollama 的 bge-m3 模型在普通硬件上单次推理 ~200-500ms，
  // 并发太高会导致 Ollama 过载甚至 OOM。
  // 如果服务器性能好（比如有 GPU），可以调高到 4 或 8。
  private readonly DEFAULT_CONCURRENCY = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly meilisearchService: MeilisearchService,
  ) {}

  /**
   * 为指定文档的所有 chunk 生成向量。
   *
   * @param documentId  KnowledgeDocument 的 ID
   * @param options      可选配置（并发数、是否强制覆盖）
   * @returns            EmbeddingResult 包含成功/失败统计
   *
   * ## 流程
   * 1. 查数据库获取文档的所有 chunk（只查没有 embedding 的，除非 force=true）
   * 2. 如果没有需要处理的 chunk，直接返回
   * 3. 用并发控制逐个调用 generateEmbedding
   * 4. 每次调用成功后立即更新数据库（不要攒一批再更新，避免成功了一半断电丢失）
   * 5. 记录失败但不中断整体流程
   */
  async embedDocument(
    documentId: string,
    options?: EmbeddingOptions,
  ): Promise<EmbeddingResult> {
    const startTime = Date.now();
    const force = options?.force ?? false;
    const concurrency = options?.concurrency ?? this.DEFAULT_CONCURRENCY;

    // ---------- 第一步：查询需要处理的 chunks ----------

    // 为什么用 raw SQL 而不是 Prisma？
    // DocumentChunk.embedding 是 Unsupported("vector(1024)") 类型，
    // Prisma 不允许在 findMany 的 where 里使用 Unsupported 列。
    // 所以必须用 $queryRawUnsafe 来查询（因为我们是动态拼接 SQL 字符串）。
    // $queryRaw 只接受模板字面量标签，不接受普通字符串变量。
    //
    // 参考 intent-classifier.ts 第 149-157 行使用 $executeRawUnsafe 的模式。
    const sql = force
      ? `SELECT id, chunk_index, content FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index ASC`
      : `SELECT id, chunk_index, content FROM document_chunks WHERE document_id = $1 AND embedding IS NULL ORDER BY chunk_index ASC`;

    const chunks = await this.prisma.$queryRawUnsafe<
      {
        id: string;
        chunk_index: number;
        content: string;
      }[]
    >(sql, documentId);

    if (chunks.length === 0) {
      this.logger.log(
        `embedDocument(${documentId}): no chunks need embedding ` +
          `(force=${force})`,
      );
      return {
        successCount: 0,
        failCount: 0,
        errors: [],
        durationMs: Date.now() - startTime,
      };
    }

    this.logger.log(
      `embedDocument(${documentId}): embedding ${chunks.length} chunks ` +
        `(concurrency=${concurrency}, force=${force})`,
    );

    // ---------- 第二步：查询文档元数据（用于 ES 索引） ----------
    // 需要文档的 title、domain、docId、keywords、priority、contentType、locale
    // 以便在向量化完成后同步索引到 Elasticsearch。
    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        domain: true,
        docId: true,
        keywords: true,
        priority: true,
        contentType: true,
        locale: true,
        isActive: true,
      },
    });

    if (!document) {
      this.logger.warn(
        `embedDocument(${documentId}): document not found, skipping ES indexing`,
      );
    }

    // ---------- 第三步：并发控制处理所有 chunks ----------

    const result: EmbeddingResult = {
      successCount: 0,
      failCount: 0,
      errors: [],
      durationMs: 0,
    };

    // 把 raw SQL 返回的字段映射成 camelCase（PostgreSQL 返回的是 snake_case）
    const chunksMapped = chunks.map((c) => ({
      id: c.id,
      chunkIndex: c.chunk_index,
      content: c.content,
    }));

    // 用 p-limit 做并发控制（已存在于项目依赖中）
    // 原理：p-limit 创建一个限制器，每次调用 limit(() => task) 最多允许 concurrency 个同时执行
    // 比手写 Promise.race + findIndex 更简洁、更安全
    const limit = pLimit(concurrency);

    const tasks = chunksMapped.map((chunk) =>
      limit(() => this.embedSingleChunk(chunk, result, document)),
    );

    await Promise.all(tasks);

    result.durationMs = Date.now() - startTime;

    this.logger.log(
      `embedDocument(${documentId}): done — ` +
        `${result.successCount} success, ${result.failCount} failed ` +
        `in ${result.durationMs}ms`,
    );

    return result;
  }

  /**
   * 处理单个 chunk 的向量化 + ES 索引。
   * 包在 try/catch 里，失败只影响这一个 chunk。
   *
   * 为什么在同一个方法里做向量化和 ES 索引？
   *   1. 向量化成功后立即索引到 ES，保持数据一致性
   *   2. ES 索引失败不影响向量化结果（降级策略）
   *   3. 避免额外的遍历开销
   *
   * @param chunk    当前处理的 chunk
   * @param result   累加器，用来记录成功/失败
   * @param document 文档元数据（用于 ES 索引）
   */
  private async embedSingleChunk(
    chunk: { id: string; chunkIndex: number; content: string },
    result: EmbeddingResult,
    document?: {
      id: string;
      title: string;
      domain: string;
      docId: string;
      keywords: string[];
      priority: string;
      contentType: string;
      locale: string;
      isActive: boolean;
    } | null,
  ): Promise<void> {
    try {
      // 调用 AiService.generateEmbedding() 将文本转为 1024 维向量
      // 参考 intent-classifier.ts 第 132 行同样的用法
      const vec = await this.aiService.generateEmbedding(chunk.content);

      if (!vec || vec.length === 0) {
        this.logger.warn(
          `Chunk ${chunk.chunkIndex}: generateEmbedding returned null`,
        );
        result.failCount++;
        result.errors.push({
          chunkIndex: chunk.chunkIndex,
          reason: 'generateEmbedding returned null (AI service unavailable)',
        });
        return;
      }

      // 将向量数组转成 pgvector SQL 格式：方括号包起来的逗号分隔数字
      // 参考 intent-classifier.ts 第 143 行同样的格式
      const vectorStr = `[${vec.join(',')}]`;

      // 写入 pgvector 的 embedding 列
      // 必须用 $executeRawUnsafe 因为 Prisma 不支持 Unsupported("vector(1024)") 类型
      // 参考 intent-classifier.ts 第 149-157 行同样的模式
      await this.prisma.$executeRawUnsafe(
        `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2`,
        vectorStr,
        chunk.id,
      );

      // ---------- 同步索引到 Meilisearch ----------
      // 向量化成功后，将 chunk 内容同步到 Meilisearch 的 BM25 索引。
      // Meilisearch 索引失败不会影响向量化结果（降级策略）。
      if (document) {
        await this.meilisearchService.indexChunk({
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          documentId: document.id,
          title: document.title,
          domain: document.domain,
          docId: document.docId,
          keywords: document.keywords,
          priority: document.priority,
          contentType: document.contentType,
          locale: document.locale,
          isActive: document.isActive,
        });
      }

      result.successCount++;
    } catch (error) {
      // 单个 chunk 失败：记录错误，不抛异常
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to embed chunk ${chunk.chunkIndex}: ${message}`,
      );
      result.failCount++;
      result.errors.push({
        chunkIndex: chunk.chunkIndex,
        reason: message,
      });
    }
  }

  /**
   * 检查文档的向量化状态。
   * 用于前端显示"3/12 chunks 已向量化"。
   *
   * @param documentId KnowledgeDocument 的 ID
   * @returns { total: number; embedded: number; pending: number }
   */
  async getEmbeddingStatus(documentId: string): Promise<{
    total: number;
    embedded: number;
    pending: number;
  }> {
    // 总数用 Prisma 查（不涉及 Unsupported 类型）
    const total = await this.prisma.documentChunk.count({
      where: { documentId },
    });

    // 有 embedding 的数量必须用 raw SQL，因为 embedding 是 Unsupported 类型
    const result = await this.prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*)::bigint as count FROM document_chunks WHERE document_id = ${documentId} AND embedding IS NOT NULL`;

    const embeddedCount = Number(result[0]?.count ?? 0);

    return {
      total,
      embedded: embeddedCount,
      pending: total - embeddedCount,
    };
  }
}
