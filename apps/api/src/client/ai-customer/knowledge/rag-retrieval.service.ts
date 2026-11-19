import { Injectable, Logger } from '@nestjs/common';
import { incCounter } from '@api/common/metrics/metrics';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiService } from '@api/common/ai/ai.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import { emitStage } from '@api/common/logger/structured-logger';
import { ConfigService } from '@nestjs/config';

/**
 * CJK 连续片段。JS 的 `\w` 只含 [A-Za-z0-9_]，中文会被当成标点删掉，
 * 所以中文必须单独走一条提取路径。
 */
const CJK_RUN_RE = /[㐀-䶿一-鿿豈-﫿]+/g;
const CJK_RUN_RE_FOR_STRIP = /[㐀-䶿一-鿿豈-﫿]+/g;

/** 单次查询最多保留的词项数，防止长文把 SQL 的 OR 条件撑爆 */
const MAX_QUERY_TOKENS = 40;

/** RRF 平滑常数：标准默认 60，只看排名、不比较跨层原始分 */
const RRF_K = 60;

/**
 * 中文停用二元组：只滤掉纯疑问/客套的组合，不按单字过滤，
 * 避免把「问题」「退货」这类有实义的词误杀。
 */
const CJK_STOP_BIGRAMS = new Set([
  '怎么',
  '什么',
  '如何',
  '请问',
  '可以',
  '能否',
  '是否',
  '我想',
  '想问',
  '一下',
  '帮我',
  '麻烦',
  '谢谢',
]);

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
  /** RRF 融合分（仅内部降级排序使用；reranker 可用时不参与） */
  rrfScore?: number;
}

/** 分层召回明细：每层按返回顺序去重后的 docId，以及该层原始命中数 */
export interface RetrievalLayerDebug {
  count: number;
  docIds: string[];
}

/** 检索的分层调试信息（只在管理端 debug=true 时返回） */
export interface RetrievalDebug {
  layers: {
    vector: RetrievalLayerDebug;
    meili: RetrievalLayerDebug;
    chunk: RetrievalLayerDebug;
    doc: RetrievalLayerDebug;
  };
  /** 合并去重后的候选数（rerank 前） */
  candidates: number;
  /** 最终返回条数 */
  returned: number;
  /** rerank 前的最高原始分（混合量纲，仅供排查） */
  topScoreBeforeRerank: number;
  /** 是否执行了 rerank */
  rerank: boolean;
}

export interface RetrievalOptions {
  domain?: string;
  topK?: number;
  minScore?: number;
  /** false 时跳过 reranker，用原始分排序（评测/降级用） */
  useRerank?: boolean;
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
    options?: RetrievalOptions,
  ): Promise<RetrievedChunk[]> {
    return (await this.retrieveDetailed(query, options)).results;
  }

  /**
   * 与 retrieve 同一条链路，额外返回分层召回明细。
   * 只给管理端评测/调试使用，线上默认不拿这份数据。
   */
  async retrieveDetailed(
    query: string,
    options?: RetrievalOptions,
  ): Promise<{ results: RetrievedChunk[]; debug: RetrievalDebug }> {
    const {
      domain,
      topK = 5,
      minScore = 0.1,
      useRerank = true,
    } = options ?? {};

    if (!query || query.trim().length === 0) {
      return {
        results: [],
        debug: this.buildDebug([], [], [], [], [], 0, 0, useRerank),
      };
    }

    incCounter('ai_retrieval_requests_total', { domain: domain ?? 'all' });

    // 本次检索的起点，两个出口都用它算 latencyMs（#89 FR-6）
    const startedAt = Date.now();

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
    // RRF：每层只贡献排名，不比较跨层原始分。
    // 同一 chunk 被多层命中时累加，降级排序就不会被固定 0.5 的关键词分带偏。
    const rrfMap = new Map<string, number>();

    const chunkKey = (chunk: RetrievedChunk) => chunk.chunkId || chunk.docId;

    const addToMap = (chunks: RetrievedChunk[]) => {
      for (const chunk of chunks) {
        const key = chunkKey(chunk);
        const existing = mergedMap.get(key);
        if (!existing || chunk.score > existing.score) {
          mergedMap.set(key, chunk);
        }
      }
    };

    const addRrf = (chunks: RetrievedChunk[]) => {
      // 层内先按自己的分数降序，再取排名；层内量纲一致，这样不依赖上游数组顺序。
      [...chunks]
        .sort((a, b) => b.score - a.score)
        .forEach((chunk, index) => {
          const key = chunkKey(chunk);
          const score = 1 / (RRF_K + index + 1);
          rrfMap.set(key, (rrfMap.get(key) ?? 0) + score);
        });
    };

    addToMap(vectorResults);
    addToMap(meiliResults);
    addToMap(chunkResults);
    addToMap(docResults);
    addRrf(vectorResults);
    addRrf(meiliResults);
    addRrf(chunkResults);
    addRrf(docResults);

    let merged: RetrievedChunk[] = Array.from(mergedMap.values()).map(
      (chunk) => ({
        ...chunk,
        rrfScore: rrfMap.get(chunkKey(chunk)) ?? 0,
      }),
    );

    // 各层命中数：看"哪一层没货"比看总耗时更能定位问题
    const layers = {
      vector: vectorResults.length,
      meili: meiliResults.length,
      chunk: chunkResults.length,
      doc: docResults.length,
    };

    if (merged.length === 0) {
      this.logger.debug('[retrieve] No results from any layer');
      emitStage('retrieval', {
        layers,
        candidates: 0,
        returned: 0,
        topScore: 0,
        latencyMs: Date.now() - startedAt,
      });
      return {
        results: [],
        debug: this.buildDebug(
          vectorResults,
          meiliResults,
          chunkResults,
          docResults,
          [],
          0,
          0,
          useRerank,
        ),
      };
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
    // 记录重排前的候选数和最高分：reranker 的分数量纲和召回层不同，
    // 混在一起看会误导（召回 0.72 / 重排 0.98 不是同一种分）
    const candidates = merged.length;
    const topScore = Math.max(...merged.map((c) => c.score));

    const rerankOutcome = useRerank
      ? await this.rerank(query, merged, topK)
      : { results: this.fallbackSort(merged, topK), used: false };
    merged = rerankOutcome.results;

    // ── 相关性门卫 ──
    // 关键词层命中 = “这个问题属于知识库”的强信号，直接放行；
    // 没有关键词命中时，才用 reranker 的 0~1 分数卡阈值。
    // reranker 不可用时走 RRF，分数不可比，不套用该阈值。
    const hasKeywordHit = chunkResults.length > 0 || docResults.length > 0;
    const gateThreshold = this.relevanceGateThreshold();
    let gateApplied = false;
    let gateBlocked = 0;
    if (rerankOutcome.used && !hasKeywordHit && merged.length > 0) {
      gateApplied = true;
      const before = merged.length;
      merged = merged.filter((chunk) => chunk.score >= gateThreshold);
      gateBlocked = before - merged.length;
    }

    emitStage('retrieval', {
      layers,
      candidates,
      returned: merged.length,
      // 两个分不能混：rerank 前的分是混合量纲，只看它判断不了最终质量
      topScoreBeforeRerank: Number(topScore.toFixed(4)),
      topScoreAfterRerank: Number((merged[0]?.score ?? 0).toFixed(4)),
      rerank: useRerank,
      relevanceGate: {
        applied: gateApplied,
        threshold: gateThreshold,
        blocked: gateBlocked,
      },
      latencyMs: Date.now() - startedAt,
    });

    return {
      results: merged,
      debug: this.buildDebug(
        vectorResults,
        meiliResults,
        chunkResults,
        docResults,
        merged,
        candidates,
        topScore,
        useRerank,
      ),
    };
  }

  /** 汇总四层的召回明细；docId 按层内出现顺序去重。 */
  private buildDebug(
    vectorResults: RetrievedChunk[],
    meiliResults: RetrievedChunk[],
    chunkResults: RetrievedChunk[],
    docResults: RetrievedChunk[],
    finalResults: RetrievedChunk[],
    candidates: number,
    topScoreBeforeRerank: number,
    rerank: boolean,
  ): RetrievalDebug {
    const layer = (chunks: RetrievedChunk[]) => ({
      count: chunks.length,
      docIds: [...new Set(chunks.map((c) => c.docId))],
    });
    return {
      layers: {
        vector: layer(vectorResults),
        meili: layer(meiliResults),
        chunk: layer(chunkResults),
        doc: layer(docResults),
      },
      candidates,
      returned: finalResults.length,
      topScoreBeforeRerank: Number.isFinite(topScoreBeforeRerank)
        ? Number(topScoreBeforeRerank.toFixed(4))
        : 0,
      rerank,
    };
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
      // 调用 embedding 模型生成查询文本的向量
      const vec = await this.aiService.generateEmbedding(query, {
        task: 'retrieval.query',
      });
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
          AND dc.document_version = kd.active_version
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
      // 没有词项就不要生成 `WHERE ()`：那会变成 SQL 语法错误，
      // 只能靠 catch 吞掉，看起来像"没命中"，实际是查询根本没执行。
      if (tokens.length === 0) return [];

      // 每个 token 同时匹配分块正文与文档关键词。
      // 现成知识文档正文是英文、keywords 是双语，只查 content 的话
      // 中文 query 永远命不中。
      const conditions = tokens.map(
        (_, i) =>
          `(dc.content ILIKE $${i + 1}::varchar OR array_to_string(kd.keywords, ' ') ILIKE $${i + 1}::varchar)`,
      );

      // 命中词项越多越靠前；只按 chunk_index 排会让 OR + LIMIT
      // 先返回"任意文档的前几个 chunk"，相关 chunk 反而进不了候选集。
      const hitScore = tokens
        .map(
          (_, i) =>
            `(CASE WHEN dc.content ILIKE $${i + 1}::varchar THEN 1 ELSE 0 END` +
            ` + CASE WHEN array_to_string(kd.keywords, ' ') ILIKE $${i + 1}::varchar THEN 1 ELSE 0 END)`,
        )
        .join(' + ');

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
          AND dc.document_version = kd.active_version
      `;
      // 参数顺序必须与 SQL 占位符严格一致：
      //   $1..$N   → 各 token 的 ILIKE 模式
      //   $N+1     → domain（可选）
      //   最后一位 → LIMIT topK
      const params: any[] = [];

      const likeParams = tokens.map((t) => `%${t}%`);
      params.push(...likeParams);

      if (domain) {
        params.push(domain);
        sql += ` AND kd.domain = $${params.length}::varchar`;
      }

      sql += ` ORDER BY (${hitScore}) DESC, dc.chunk_index ASC LIMIT $${params.length + 1}::smallint`;
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

      const allDocs = await this.prisma.knowledgeDocument.findMany({ where });

      // 版本过滤：这一层读的是 Document.content（最新写入的正文），不是某一版的 chunk。
      // 正在暂存新版本的文档（version > activeVersion）如果参与，就会把还没上线的
      // 正文提前返回给用户——那正是"规则改了但用户看到的是新版/旧版对不上"的另一条路径。
      const docs = allDocs.filter((d) => d.activeVersion === d.version);

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

  /**
   * 相关性阈值：由正负样本校准（20 负样本最高 0.131），可配置。
   * 只用于 reranker 分数，不影响 RRF/召回层。
   */
  private relevanceGateThreshold(): number {
    const raw = Number(
      this.configService.get<string>('RAG_RERANK_MIN_SCORE', '0.131'),
    );
    return Number.isFinite(raw) && raw >= 0 ? raw : 0.131;
  }

  private async rerank(
    query: string,
    chunks: RetrievedChunk[],
    topK: number,
  ): Promise<{ results: RetrievedChunk[]; used: boolean }> {
    if (chunks.length === 0) return { results: chunks, used: false };

    const documents = chunks.map((c) => c.content);

    const results = await this.aiService.rerank(query, documents);

    if (!results || results.length === 0) {
      this.logger.warn(
        '[rerank] AiService.rerank returned empty/null, falling back to unranked results',
      );
      return { results: this.fallbackSort(chunks, topK), used: false };
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

    return { results: reranked, used: true };
  }

  /**
   * fallbackSort — reranker 不可用时的降级排序
   *
   * 优先用 RRF 分：各层原始分量纲不同（余弦 0~1、BM25 0~∞、关键词固定 0.5），
   * 直接比大小会让关键词候选压过更相关的向量候选。
   * 没有 RRF 分时（直接调用/旧数据）才退回原始分。
   */
  private fallbackSort(
    chunks: RetrievedChunk[],
    topK: number,
  ): RetrievedChunk[] {
    return [...chunks]
      .sort((a, b) => (b.rrfScore ?? b.score) - (a.rrfScore ?? a.score))
      .slice(0, topK);
  }

  // ===========================================================================
  // Helper: 分词
  // ===========================================================================

  private tokenize(text: string): string[] {    const STOPWORDS = new Set([
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

    // ── Latin 词项：保持变更前行为 ──
    // 先把 CJK 片段替换成空格，再走原来的标点清理 + split + 停用词过滤。
    // 这样纯英文 query 的词项集合与改动前完全一致。
    const cjkRuns = text.match(CJK_RUN_RE) ?? [];
    const latinTokens = text
      .replace(CJK_RUN_RE_FOR_STRIP, ' ')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t));

    // ── CJK 词项：二元组为主，单字兜底 ──
    // 为什么不用按字切分：单字「退」会命中「退休」，「款」会命中「款式」，
    // 误召回比二元组多；二元组能覆盖「退货」「邮费」这类 FAQ 关键词。
    const cjkTokens: string[] = [];
    for (const run of cjkRuns) {
      if (run.length === 1) {
        cjkTokens.push(run);
        continue;
      }
      for (let i = 0; i < run.length - 1; i++) {
        const bigram = run.slice(i, i + 2);
        if (!CJK_STOP_BIGRAMS.has(bigram)) {
          cjkTokens.push(bigram);
        }
      }
    }

    // 去重（保持出现顺序）+ 上限：长 query 不能让 SQL 的 OR 条件无限增长
    const seen = new Set<string>();
    const tokens: string[] = [];
    for (const token of [...latinTokens, ...cjkTokens]) {
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
      if (tokens.length >= MAX_QUERY_TOKENS) break;
    }
    return tokens;
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
