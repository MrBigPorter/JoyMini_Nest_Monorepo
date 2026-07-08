import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiService } from '@api/common/ai/ai.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';

// =============================================================================
// 检索结果类型
// =============================================================================

/**
 * 检索到的知识片段（chunk 级别，不是整篇文档）。
 *
 * 为什么用 chunk 级别而不是 document 级别？
 *   1. Chunk 更短（~500 字），LLM 上下文中可以塞更多相关片段
 *   2. 向量检索天然是 chunk 级别的（embedding 存在 document_chunks 表）
 *   3. 不同 chunk 可能属于文档的不同章节，LLM 可以交叉引用
 */
export interface RetrievedChunk {
  /** document_chunks.id */
  chunkId: string;
  /** 在文档中的序号 */
  chunkIndex: number;
  /** 匹配到的段落内容（短而精确） */
  content: string;
  /** 所属文档 ID */
  documentId: string;
  /** 文档标题 */
  title: string;
  /** 文档域（product / order / wallet / ...） */
  domain: string;
  /** 文档唯一标识（用于去重） */
  docId: string;
  /** 关键词列表 */
  keywords: string[];
  /** 优先级（P0 / P1 / P2） */
  priority: string;
  /** 内容类型（policy / how-to / faq / ...） */
  contentType: string;
  /** 相似度分数（pgvector: 0~1 余弦相似度 / ES BM25: 0~∞ / 关键字: 0.5 固定值） */
  score: number;
}

// =============================================================================
// Service
// =============================================================================

/**
 * RAG 知识库检索服务。
 *
 * 4 层降级策略（优雅降级，不抛异常）：
 *   Layer 1 — pgvector 语义检索（bge-m3 多语言 embedding）
 *     跨语言："退货" → vector → 匹配 "Refund Policy" 段落
 *     查询粒度：chunk 级别（~500 字），精准定位
 *     失败场景：Ollama 宕机、chunk 未向量化、查询太短
 *
 *   Layer 1.5 — Elasticsearch BM25 全文检索（新增）
 *     概率检索模型，比 ILIKE 更智能（IDF 自动降权常见词）
 *     多字段加权搜索（title^3 + content^1）
 *     失败场景：ES 容器未启动、索引不存在
 *
 *   Layer 2 — Chunk 关键字检索（ILIKE 模糊匹配）
 *     精确命中：用户提到具体数字/货号时比向量准确
 *     覆盖场景：ES 不可用但 PostgreSQL 正常
 *
 *   Layer 3 — 完整文档关键字检索（原始 Phase 1 逻辑）
 *     兜底：前三层都找不到时，在整篇文档里搜索
 *     场景：新文档刚上传、chunk 还没生成
 */
@Injectable()
export class RagRetrievalService {
  private readonly logger = new Logger(RagRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly meilisearchService: MeilisearchService,
    private readonly configService: ConfigService,
  ) {}

  // ===========================================================================
  // 公有方法：4 层降级检索
  // ===========================================================================

  /**
   * 检索知识库，自动执行 4 层降级。
   *
   * @param query   用户问题原文（中文/英文/混合）
   * @param options
   *   - domain    按域过滤（不传则搜索所有域）
   *   - topK      最多返回几条结果（默认 5）
   *   - minScore  最低相似度阈值（Layer 3 使用，默认 0.1）
   * @returns RetrievedChunk[] 按相似度降序排列
   *
   * @example
   *   const results = await ragRetrievalService.retrieve("怎么退货？", { topK: 3 });
   *   // → [{ content: "Refund Policy: ...", title: "退款政策", score: 0.87 }, ...]
   */
  async retrieve(
    query: string,
    options?: { domain?: string; topK?: number; minScore?: number },
  ): Promise<RetrievedChunk[]> {
    const { domain, topK = 5, minScore = 0.1 } = options ?? {};

    if (!query || query.trim().length === 0) return [];

    // =====================================================================
    // Hybrid Retrieval: 从所有层收集结果，合并去重，再重排序
    // =====================================================================
    // 为什么不是 early-return（找到一层就返回）？
    //   不同检索层擅长不同场景：
    //   - pgvector: 跨语言语义匹配（"退货" ↔ "Refund Policy"）
    //   - ES BM25: 关键词精确匹配，IDF 降权常见词
    //   - ILIKE: 精确子串匹配（货号、数字）
    //   - 全文搜索: 兜底（新文档无 chunk）
    //   合并后 reranker 能从更多候选中选出最相关的 topK。
    //
    // topK 放大系数：每层请求 topK * 4 个候选，给 reranker 更多选择空间。
    // =====================================================================
    const collectK = Math.max(topK * 4, 20); // 至少收集 20 个候选

    // -------------------- Layer 1: pgvector 语义检索 --------------------
    const vectorResults = await this.vectorSearch(query, domain, collectK);

    // -------------------- Layer 1.5: Meilisearch BM25 全文检索 --------------------
    const meiliResults = await this.meilisearchService.searchChunks(
      query,
      domain,
      collectK,
    );

    // 分词用于 Layer 2 / Layer 3
    const tokens = this.tokenize(query);

    // -------------------- Layer 2: Chunk 关键字检索 --------------------
    let chunkResults: RetrievedChunk[] = [];
    if (tokens.length > 0) {
      chunkResults = await this.keywordSearchChunks(tokens, domain, collectK);
    }

    // -------------------- Layer 3: 完整文档关键字检索 --------------------
    const docResults = await this.keywordSearchDocs(
      query,
      tokens,
      domain,
      collectK,
      minScore,
    );

    // =====================================================================
    // Merge & Deduplicate: 按 chunkId 去重，保留最高分
    // =====================================================================
    const mergedMap = new Map<string, RetrievedChunk>();

    const addToMap = (chunks: RetrievedChunk[]) => {
      for (const chunk of chunks) {
        const key = chunk.chunkId || chunk.docId; // chunkId 为空时用 docId
        const existing = mergedMap.get(key);
        if (!existing || chunk.score > existing.score) {
          mergedMap.set(key, chunk);
        }
      }
    };

    addToMap(vectorResults);
    addToMap(meiliResults);
    addToMap(chunkResults);
    addToMap(docResults);

    let merged = Array.from(mergedMap.values());

    if (merged.length === 0) {
      this.logger.debug('[retrieve] No results from any layer');
      return [];
    }

    this.logger.log(
      `[retrieve] Layer raw results (before dedup): ` +
        `vec:${vectorResults.length}, meili:${meiliResults.length}, ` +
        `chunk:${chunkResults.length}, doc:${docResults.length}` +
        ` | merged: ${merged.length} unique chunks`,
    );

    // =====================================================================
    // Reranker: 用 bge-reranker-v2-m3 对合并结果重排序
    // =====================================================================
    merged = await this.rerank(query, merged, topK);

    return merged;
  }

  // ===========================================================================
  // Layer 1: pgvector 语义检索
  // ===========================================================================
  //
  // 查询 document_chunks 表，用 pgvector 的 <=> 算子做余弦距离排序。
  // 参考 intent-classifier.ts:209-218 的 pattern。
  //
  // 为什么用 raw SQL 而不是 Prisma？
  //   DocumentChunk.embedding 是 Unsupported("vector(1024)") 类型，
  //   Prisma 不支持在 where / orderBy 中使用 Unsupported 列。
  //   参考 rag-embedding.service.ts:112-118 的说明。
  // ===========================================================================

  private async vectorSearch(
    query: string,
    domain?: string,
    topK: number = 5,
  ): Promise<RetrievedChunk[]> {
    try {
      // 调用 bge-m3 模型生成查询文本的 embedding
      const vec = await this.aiService.generateEmbedding(query);
      if (!vec || vec.length === 0) {
        this.logger.warn(
          '[vectorSearch] generateEmbedding returned null (Ollama down?)',
        );
        return [];
      }

      // pgvector 格式：方括号包起来的逗号分隔数字
      const vectorStr = `[${vec.join(',')}]`;

      // 构建 SQL 查询
      // 使用 1 - (embedding <=> $1::vector) 计算余弦相似度
      // （<=> 是余弦距离，1 - 距离 = 相似度）
      let sql = `
        SELECT
          dc.id               AS chunk_id,
          dc.chunk_index      AS chunk_index,
          dc.content          AS content,
          kd.id               AS document_id,
          kd.title            AS title,
          kd.domain           AS domain,
          kd.doc_id           AS doc_id,
          kd.keywords         AS keywords,
          kd.priority         AS priority,
          kd.content_type     AS content_type,
          1 - (dc.embedding <=> $1::vector) AS similarity
        FROM document_chunks dc
        JOIN knowledge_documents kd ON kd.id = dc.document_id
        WHERE dc.embedding IS NOT NULL
          AND kd.is_active = true
      `;
      const params: any[] = [vectorStr];

      if (domain) {
        params.push(domain);
        sql += ` AND kd.domain = $${params.length}::varchar`;
      }

      sql += ` ORDER BY similarity DESC LIMIT $${params.length + 1}::smallint`;
      params.push(topK);

      const rows: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);

      if (!rows || rows.length === 0) return [];

      this.logger.log(
        `[vectorSearch] ${rows.length} chunks match (top score: ${Number(rows[0].similarity).toFixed(4)})`,
      );

      return rows.map((r) => ({
        chunkId: r.chunk_id,
        chunkIndex: r.chunk_index,
        content: r.content,
        documentId: r.document_id,
        title: r.title,
        domain: r.domain,
        docId: r.doc_id,
        keywords: this.parsePgArray(r.keywords),
        priority: r.priority,
        contentType: r.content_type,
        score: Number(r.similarity),
      }));
    } catch (error) {
      // 所有异常都被捕获并记录，不会向上传播
      // 这是设计决定：Ollama 宕机时检索应降级，而不是让用户看到 500
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`[vectorSearch] pgvector query failed: ${message}`);
      return [];
    }
  }

  // ===========================================================================
  // Layer 2: Chunk 关键字检索
  // ===========================================================================
  //
  // 在 document_chunks.content 上用 ILIKE 做模糊匹配。
  // 为什么用 ILIKE 而不是全文索引（tsvector）？
  //   - ILIKE 足够快（知识库 < 1000 篇文档）
  //   - 不需要维护全文索引
  //   - 支持任意语言的子串匹配（中文无需分词）
  // 如果未来知识库增长到 > 10000 条，应该换成 tsvector 或 pg_bigm。
  // ===========================================================================

  private async keywordSearchChunks(
    tokens: string[],
    domain?: string,
    topK: number = 5,
  ): Promise<RetrievedChunk[]> {
    try {
      // 为每个 token 生成 ILIKE 条件
      // 使用 content ILIKE '%token%' 做子串匹配
      const conditions = tokens.map(
        (_, i) => `dc.content ILIKE $${i + 2}::varchar`,
      );

      let sql = `
        SELECT
          dc.id               AS chunk_id,
          dc.chunk_index      AS chunk_index,
          dc.content          AS content,
          kd.id               AS document_id,
          kd.title            AS title,
          kd.domain           AS domain,
          kd.doc_id           AS doc_id,
          kd.keywords         AS keywords,
          kd.priority         AS priority,
          kd.content_type     AS content_type,
          0.5::float8         AS similarity
        FROM document_chunks dc
        JOIN knowledge_documents kd ON kd.id = dc.document_id
        WHERE (${conditions.join(' OR ')})
          AND kd.is_active = true
      `;
      const params: any[] = [];

      // $1 is used for the first token pattern (all tokens combined as a simple phrase)
      // $2, $3, ... are used for individual token patterns
      // Actually, let me simplify - just search for any token matching
      const likeParams = tokens.map((t) => `%${t}%`);
      params.push(...likeParams);

      if (domain) {
        params.push(domain);
        sql += ` AND kd.domain = $${params.length}::varchar`;
      }

      sql += ` ORDER BY dc.chunk_index ASC LIMIT $${params.length + 1}::smallint`;
      params.push(topK);

      const rows: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);

      if (!rows || rows.length === 0) return [];

      this.logger.log(
        `[keywordSearchChunks] ${rows.length} chunks match keyword (tokens: ${tokens.join(', ')})`,
      );

      return rows.map((r) => ({
        chunkId: r.chunk_id,
        chunkIndex: r.chunk_index,
        content: r.content,
        documentId: r.document_id,
        title: r.title,
        domain: r.domain,
        docId: r.doc_id,
        keywords: this.parsePgArray(r.keywords),
        priority: r.priority,
        contentType: r.content_type,
        score: 0.5,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`[keywordSearchChunks] failed: ${message}`);
      return [];
    }
  }

  // ===========================================================================
  // Layer 3: 完整文档关键字检索
  // ===========================================================================
  //
  // 原始 Phase 1 retrieve() 逻辑的保留版。
  // 在 KnowledgeDocument 上做全表扫描 + JS 评分。
  // 性能最差但覆盖最全：即使 chunk 完全不存在也能查到。
  // ===========================================================================

  private async keywordSearchDocs(
    query: string,
    tokens: string[],
    domain?: string,
    topK: number = 3,
    minScore: number = 0.1,
  ): Promise<RetrievedChunk[]> {
    try {
      const where: any = { isActive: true };
      if (domain) where.domain = domain;

      const docs = await this.prisma.knowledgeDocument.findMany({ where });

      if (docs.length === 0) return [];

      const scored = docs.map((doc) => {
        const keywordsLower = doc.keywords.map((k) => k.toLowerCase());
        const titleLower = doc.title.toLowerCase();
        const contentLower = doc.content.toLowerCase();

        let keywordHits = 0;
        let titleHits = 0;
        let contentHits = 0;

        for (const token of tokens) {
          if (keywordsLower.some((k) => k.includes(token))) keywordHits++;
          if (titleLower.includes(token)) titleHits++;
          if (contentLower.includes(token)) contentHits++;
        }

        const score =
          tokens.length > 0
            ? (keywordHits * 1.0 + titleHits * 0.5 + contentHits * 0.2) /
              tokens.length
            : 0;

        return { doc, score };
      });

      const filtered = scored
        .filter((r) => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      if (filtered.length === 0) return [];

      this.logger.log(
        `[keywordSearchDocs] ${filtered.length} docs match (top score: ${filtered[0].score.toFixed(4)})`,
      );

      return filtered.map((r) => ({
        chunkId: '', // 整篇文档不是 chunk
        chunkIndex: -1, // 无 chunk 索引
        content: r.doc.content, // 返回整篇文档内容
        documentId: r.doc.id,
        title: r.doc.title,
        domain: r.doc.domain,
        docId: r.doc.docId,
        keywords: r.doc.keywords,
        priority: r.doc.priority,
        contentType: r.doc.contentType,
        score: r.score,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`[keywordSearchDocs] failed: ${message}`);
      return [];
    }
  }

  // ===========================================================================
  // Reranker: bge-reranker-v2-m3 重排序
  // ===========================================================================
  //
  // 调用 Ollama 的 /api/rerank 端点，用 bge-reranker-v2-m3 模型对候选 chunks
  // 进行交叉编码重排序（cross-encoder），比 embedding 余弦相似度更准确。
  //
  // ── 为什么需要 reranker？ ──
  // 各检索层（pgvector / ES BM25 / ILIKE）各自返回独立排序的结果。
  // 合并后 chunks 的 score 来自不同尺度（余弦相似度 0~1、BM25 0~∞、固定 0.5），
  // 无法直接比较。Reranker 用同一个模型对所有候选重新打分，保证排序一致性。
  //
  // ── 优雅降级 ──
  // 如果 Ollama 不可用或模型未拉取，直接按合并后的原始分数降序返回 topK。
  // 不会让检索失败。
  //
  // ── API 文档 ──
  // POST {baseUrl}/api/rerank
  // {
  //   "model": "bge-reranker-v2-m3",
  //   "query": "user query",
  //   "documents": ["chunk1", "chunk2", ...]
  // }
  // Response: { "results": [{"index": 0, "relevance_score": 0.95}, ...] }
  // ===========================================================================

  private async rerank(
    query: string,
    chunks: RetrievedChunk[],
    topK: number,
  ): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) return chunks;

    const documents = chunks.map((c) => c.content);

    const results = await this.aiService.rerank(query, documents);

    if (!results || results.length === 0) {
      this.logger.warn(
        '[rerank] AiService.rerank returned empty/null, falling back to unranked results',
      );
      return this.fallbackSort(chunks, topK);
    }

    // 按 reranker 分数降序排列，取 topK
    const reranked = results
      .filter((r) => r.index >= 0 && r.index < chunks.length)
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, topK)
      .map((r) => ({
        ...chunks[r.index],
        score: r.relevance_score, // 用 reranker 分数覆盖原始分数
      }));

    this.logger.log(
      `[rerank] Reranker re-ranked ${chunks.length} chunks → top ${reranked.length} ` +
        `(top score: ${reranked[0]?.score.toFixed(4) ?? 'N/A'})`,
    );

    return reranked;
  }

  /**
   * fallbackSort — 当 reranker 不可用时的降级排序
   * 按原始 score 降序排列，取 topK。
   */
  private fallbackSort(
    chunks: RetrievedChunk[],
    topK: number,
  ): RetrievedChunk[] {
    return [...chunks]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // ===========================================================================
  // Helper: 分词
  // ===========================================================================

  private tokenize(text: string): string[] {
    const STOPWORDS = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'what',
      'how',
      'can',
      'do',
      'does',
      'my',
      'your',
      'i',
      'me',
      'to',
      'for',
      'of',
      'in',
      'on',
      'with',
      'and',
      'or',
      'not',
      'if',
      'then',
      'else',
      'when',
      'where',
      'why',
      'which',
      'who',
      'this',
      'that',
      'it',
      'its',
      'be',
      'have',
      'has',
      'had',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'shall',
      'need',
      'must',
      'let',
      'please',
      'thanks',
      'thank',
      'help',
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  }

  // ===========================================================================
  // Helper: PostgreSQL 数组解析
  // ===========================================================================
  //
  // PostgreSQL text[] 列在 $queryRawUnsafe 中返回的格式因驱动版本而异：
  //   - 可能是字符串 "{kw1,kw2,kw3}"
  //   - 可能是原生 JS 数组
  // 这个函数兼容两种格式。
  // ===========================================================================

  private parsePgArray(value: any): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((s) => String(s));
    if (typeof value === 'string') {
      const str = value.replace(/^{|}$/g, '');
      if (!str) return [];
      return str.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
    }
    return [];
  }
}
