import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiService } from '@api/common/ai/ai.service';

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
  /** 相似度分数（pgvector: 0~1 余弦相似度 / 关键字: 0.5 固定值） */
  score: number;
}

// =============================================================================
// Service
// =============================================================================

/**
 * RAG 知识库检索服务。
 *
 * 3 层降级策略（优雅降级，不抛异常）：
 *   Layer 1 — pgvector 语义检索（bge-m3 多语言 embedding）
 *     跨语言："退货" → vector → 匹配 "Refund Policy" 段落
 *     查询粒度：chunk 级别（~500 字），精准定位
 *     失败场景：Ollama 宕机、chunk 未向量化、查询太短
 *
 *   Layer 2 — Chunk 关键字检索（ILIKE 模糊匹配）
 *     精确命中：用户提到具体数字/货号时比向量准确
 *     覆盖场景：Ollama 正常但某些 chunk embedding IS NULL
 *
 *   Layer 3 — 完整文档关键字检索（原始 Phase 1 逻辑）
 *     兜底：前两层都找不到时，在整篇文档里搜索
 *     场景：新文档刚上传、chunk 还没生成
 */
@Injectable()
export class RagRetrievalService {
  private readonly logger = new Logger(RagRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  // ===========================================================================
  // 公有方法：3 层降级检索
  // ===========================================================================

  /**
   * 检索知识库，自动执行 3 层降级。
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

    // -------------------- Layer 1: pgvector 语义检索 --------------------
    // 利用 bge-m3 多语言 embedding 实现跨语言语义匹配。
    // 中文问"怎么退款"能匹配英文文档的 "Refund Process" 段落。
    const vectorResults = await this.vectorSearch(query, domain, topK);
    if (vectorResults.length > 0) {
      this.logger.debug(
        `[retrieve] Layer 1 (pgvector): ${vectorResults.length} results`,
      );
      return vectorResults;
    }

    // 分词用于 Layer 2 / Layer 3
    const tokens = this.tokenize(query);

    // -------------------- Layer 2: Chunk 关键字检索 --------------------
    // 在 document_chunks.content 上做 ILIKE 模糊匹配。
    // 覆盖 embedding 失败的 chunk（embedding IS NULL）。
    if (tokens.length > 0) {
      const chunkResults = await this.keywordSearchChunks(tokens, domain, topK);
      if (chunkResults.length > 0) {
        this.logger.debug(
          `[retrieve] Layer 2 (chunk keyword): ${chunkResults.length} results`,
        );
        return chunkResults;
      }
    }

    // -------------------- Layer 3: 完整文档关键字检索 --------------------
    // 最彻底的兜底：在 KnowledgeDocument.content 全文搜索。
    // 即使 chunk 完全不存在（新上传文档），也能查到。
    const docResults = await this.keywordSearchDocs(
      query,
      tokens,
      domain,
      topK,
      minScore,
    );
    if (docResults.length > 0) {
      this.logger.debug(
        `[retrieve] Layer 3 (full doc): ${docResults.length} results`,
      );
    }
    return docResults;
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
