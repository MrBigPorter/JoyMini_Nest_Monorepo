import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Meilisearch } from 'meilisearch';

// =============================================================================
// Meilisearch 服务 — BM25 关键词搜索引擎
// =============================================================================
//
// 🏪 餐厅类比
// =============================================================================
// 整个 AI 知识库就像一家餐厅的后厨：
//
//   PostgreSQL (pgvector) = 食材仓库（按食材编号找）
//     你要取款 → 仓库管理员想一想 → "取款 ≈ withdrawal" → 到 withdrawal 区找
//     → 这是语义搜索（向量匹配），像人一样"理解"你的意思
//
//   Meilisearch (BM25)   = 菜单索引本（按菜名翻）
//     你要 ₱15 → 直接翻索引本 → "₱15" → 第3页 GCash withdrawal
//     → 这是关键词搜索（精确匹配），像字典一样"翻"到你的词
//
//   ILIKE (备用)          = 在后厨翻箱倒柜找
//     实在找不到 → 每个角落翻一遍
//     → 这是全表扫描（最慢但一定找到）
//
// ────────────────
//
// Meilisearch 就是那本"菜单索引本"。
// 你把每道菜（chunk 原文）登记上去，它自动编好目录（倒排索引）。
// 客人点菜时一翻就找到了，不需要去仓库里翻食材。
//
// =============================================================================

/**
 * Meilisearch 服务
 * =================
 *
 * 翻译成人话:
 *   这是一个"关键词搜索工具"。你把文档存进去，它帮你建好索引，
 *   以后搜关键词就能秒级找到匹配的段落。
 *
 * 为什么需要它?
 *   pgvector（语义搜索）能理解"取钱 → withdrawal"的跨语言关系，
 *   但它搞不定精确匹配——比如搜"₱15"它分不清和"₱25"的差别。
 *   Meilisearch 正好补上这个短板：搜"₱15"就精确命中"₱15"。
 *
 * 和 pgvector 的分工:
 *   pgvector  = 理解意思（"怎么拿回我的钱" → Withdrawal Guide）✅
 *   Meilisearch = 精确匹配（"₱15"、"TSHIRT-001"、"订单#123"）✅
 *
 * 如果 Meilisearch 连不上会怎样?
 *   不会崩。所有方法都有 try-catch，失败了返回空数组，
 *   上游 RagRetrievalService 会自动跳到下一层（ILIKE 搜索）。
 *   只是搜索精确度下降，功能不受影响。
 */
@Injectable()
export class MeilisearchService implements OnModuleInit {
  private readonly logger = new Logger(MeilisearchService.name);

  /**
   * Meilisearch 客户端
   * 连不上时为 null，后续所有方法都会跳过
   */
  private client: Meilisearch | null = null;

  /** Meilisearch 服务地址（Docker 内部域名） */
  private readonly meiliUrl: string;

  /** 访问密钥（相当于数据库密码） */
  private readonly masterKey: string;

  /**
   * 索引名称
   *
   * 翻译成人话:
   *   相当于 PostgreSQL 的"表名"。
   *   我们把知识库的 chunk 都存在这个"表"里。
   */
  private readonly indexName = 'document_chunks';

  constructor(private readonly configService: ConfigService) {
    this.meiliUrl =
      this.configService.get<string>('MEILISEARCH_URL') ||
      'http://joymini-meilisearch:7700';
    this.masterKey =
      this.configService.get<string>('MEILISEARCH_MASTER_KEY') || '';
  }

  /**
   * 启动时自动连接 Meilisearch
   *
   * 做什么:
   *   1. 创建客户端，连上 Meilisearch 服务
   *   2. 检查 document_chunks "表"是否存在
   *   3. 不存在就自动创建并配好搜索/过滤字段
   *
   * 连不上会怎样:
   *   只打一行警告日志，不影响应用启动。
   *   client 设为 null，后续搜索自动跳过。
   */
  async onModuleInit() {
    try {
      this.client = new Meilisearch({
        host: this.meiliUrl,
        apiKey: this.masterKey,
      });

      // 测试连接
      const health = await this.client.health();
      this.logger.log(
        `✅ Connected to Meilisearch at ${this.meiliUrl} (status: ${health.status})`,
      );

      // 确保索引存在并配置
      await this.ensureIndex();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `⚠️  Meilisearch not available at ${this.meiliUrl}: ${message}`,
      );
      this.logger.warn(
        '  → BM25 search will be skipped, falling back to ILIKE',
      );
      this.client = null;
    }
  }

  // ===========================================================================
  // 初始化配置（建表 + 配索引）
  // ===========================================================================
  //
  // 翻译成人话:
  //   就像开餐厅前先准备好菜单索引本：
  //   1. 买一本空白的本子（创建索引）
  //   2. 决定按什么方式查：按菜名（content）和按分类（title）
  //      → searchableAttributes
  //   3. 决定可以按什么筛选：川菜/粤菜（domain）、价格等级（priority）
  //      → filterableAttributes
  // ===========================================================================

  /**
   * 确保索引存在并配置好搜索/过滤字段
   *
   * 流程:
   *   1. 检查 document_chunks 索引是否存在
   *   2. 不存在 → 自动创建（插入一条假数据触发建索引，然后删掉）
   *   3. 配置 searchableAttributes — 搜索时在哪些字段里找
   *   4. 配置 filterableAttributes — 搜索时可以按哪些字段过滤
   *
   * 类比:
   *   就像买一本新的菜单索引本，先画好目录结构：
   *   - 按"菜名"和"分类"两个维度查（searchable）
   *   - 可以按"菜系"、"价格"来筛选（filterable）
   */
  private async ensureIndex(): Promise<void> {
    if (!this.client) return;

    try {
      // ── 第一步：获取或创建索引 ──
      // 相当于：拿起菜单索引本，看看有没有写"document_chunks"这一章
      const index = this.client.index(this.indexName);

      // 检查索引是否存在
      try {
        await index.getRawInfo();
        this.logger.debug(`Index "${this.indexName}" already exists`);
      } catch {
        // 索引不存在 → 自动创建
        // 技巧：Meilisearch 没有单独的"CREATE TABLE"命令，
        // 插入一条数据就会自动建索引。我们插一条再删掉。
        // 就像在空本子上写一行字，本子就"存在"了，然后擦掉那行字。
        await index.addDocuments([{ id: '__init__' }]);
        await index.deleteDocument('__init__');
        this.logger.log(`✅ Created index "${this.indexName}" in Meilisearch`);
      }

      // ── 第二步：配置搜索字段（searchableAttributes）──
      //
      // 翻译成人话:
      //   告诉 Meilisearch："用户搜词的时候，只在 content 和 title 里找"
      //
      // 为什么是 content 和 title？
      //   content = chunk 正文（"GCash withdrawal fee is ₱15"）
      //   title   = 文档标题（"Withdrawal Guide"）
      //
      // 相当于告诉服务员：
      //   "客人点菜的时候，只看菜名和菜品描述，不用看别的"
      await index.updateSearchableAttributes(['content', 'title']);

      // ── 第三步：配置过滤字段（filterableAttributes）──
      //
      // 翻译成人话:
      //   告诉 Meilisearch："搜索时可以用这些字段做 WHERE 过滤"
      //
      // 每个字段的用途:
      //   domain      → WHERE domain = 'wallet'（只看钱包相关的文档）
      //   docId       → WHERE docId = 'withdrawal-guide'（只看某篇文档）
      //   documentId  → WHERE documentId = 'abc-123'（只看某个 ID）
      //   chunkIndex  → WHERE chunkIndex < 5（只看前几段）
      //   priority    → WHERE priority = 'P0'（只看最高优先级）
      //   contentType → WHERE contentType = 'how-to'（只看操作指南）
      //   keywords    → WHERE keywords CONTAINS 'refund'（只看含退款关键词的）
      //   locale      → WHERE locale = 'en'（只看英文）
      //   isActive    → WHERE isActive = true（只看活跃文档）
      await index.updateFilterableAttributes([
        'domain',
        'docId',
        'documentId',
        'chunkIndex',
        'priority',
        'contentType',
        'keywords',
        'locale',
        'isActive',
      ]);

      // ── 第四步：配置排序字段（sortableAttributes）──
      //
      // 告诉 Meilisearch："结果可以按 chunk 序号排序"
      // 这样同一个文档的多个 chunk 可以按顺序排列
      await index.updateSortableAttributes(['chunkIndex']);

      this.logger.log(
        `✅ Configured index "${this.indexName}" (searchable: content, title; filterable: domain, docId, ...)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`[ensureIndex] Failed to configure index: ${message}`);
    }
  }

  // ===========================================================================
  // BM25 搜索（查）
  // ===========================================================================
  //
  // 翻译成人话:
  //   客人说"我要找₱15" → 你翻菜单索引本 → 找到"₱15 → GCash withdrawal"
  //   → 把结果告诉客人
  //
  // Meilisearch 内部做了什么:
  //   1. 分词：把"₱15"拆成单个词
  //   2. 查倒排索引：找到所有含"₱15"的文档
  //   3. BM25 算分：根据词频、文档长度算相关度
  //   4. 按分数降序排列，返回 TOP-N
  // ===========================================================================

  /**
   * BM25 关键词搜索
   *
   * 做什么:
   *   在 Meilisearch 里搜关键词，返回匹配的 chunk 列表。
   *
   * 怎么搜:
   *   - 在 content 和 title 两个字段里同时搜
   *   - Meilisearch 自动分词、BM25 算分
   *   - 可以按 domain 过滤（比如只看 wallet 域的文档）
   *
   * 类比:
   *   客人说"有没有关于 withdrawal 的内容"
   *   → 你在菜单索引本的 content 和 title 里找 "withdrawal"
   *   → 找到 5 条结果，按相关度排好
   *   → 如果客人说"只看钱包相关"，你就只翻 wallet 那一页
   *
   * @param query  用户输入的问题（如 "取款手续费"）
   * @param domain 可选，只搜某个域（如 'wallet'）
   * @param topK   返回几条结果（默认 5）
   * @returns 匹配的 chunk 数组，按 BM25 分数降序
   */
  async searchChunks(
    query: string,
    domain?: string,
    topK: number = 5,
  ): Promise<
    Array<{
      chunkId: string;
      chunkIndex: number;
      content: string;
      documentId: string;
      title: string;
      domain: string;
      docId: string;
      keywords: string[];
      priority: string;
      contentType: string;
      score: number;
    }>
  > {
    // Meilisearch 连不上 → 返回空，让上层降级
    if (!this.client) return [];

    try {
      // 拿 document_chunks 这个"表"
      const index = this.client.index(this.indexName);

      // 构建过滤条件
      // 相当于 SQL 的 WHERE 子句
      const filterParts: string[] = ['isActive = true'];
      if (domain) {
        filterParts.push(`domain = "${domain}"`);
      }

      const searchParams: any = {
        limit: topK,
        filter: filterParts,
        // 只在 content 和 title 两个字段里搜
        attributesToSearchOn: ['content', 'title'],
      };

      // 调用 Meilisearch API 搜索
      // 底层发的是: POST /indexes/document_chunks/search
      const response = await index.search(query, searchParams);

      const hits = response.hits || [];
      if (hits.length === 0) return [];

      this.logger.log(
        `[Meili BM25] ${hits.length} chunks match (top score: ${typeof hits[0]._rankingScore === 'number' ? hits[0]._rankingScore.toFixed(4) : 'N/A'})`,
      );

      // 把 Meilisearch 返回的结果转成我们系统统一的格式
      return hits.map((hit: any) => ({
        chunkId: hit.chunkId || '',
        chunkIndex: typeof hit.chunkIndex === 'number' ? hit.chunkIndex : 0,
        content: hit.content || '',
        documentId: hit.documentId || '',
        title: hit.title || '',
        domain: hit.domain || '',
        docId: hit.docId || '',
        keywords: Array.isArray(hit.keywords) ? hit.keywords : [],
        priority: hit.priority || '',
        contentType: hit.contentType || '',
        // _rankingScore 是 Meilisearch 的 BM25 分数
        score: typeof hit._rankingScore === 'number' ? hit._rankingScore : 0,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`[Meili BM25] Search failed: ${message}`);
      return [];
    }
  }

  // ===========================================================================
  // 数据同步（增删改）
  // ===========================================================================
  //
  // 当知识库上传/更新文档时，需要同步到 Meilisearch。
  // 这些方法在 RagEmbeddingService 里被调用。
  //
  // 流程:
  //   upload → chunkText → generateEmbedding → UPDATE pgvector
  //                                           → indexChunk (Meilisearch)  ← 这
  // ===========================================================================

  /**
   * 存入一个 chunk 到 Meilisearch
   *
   * 做什么:
   *   把一个 chunk 的原文存到 Meilisearch 里。
   *   Meilisearch 收到后会自动分词、建倒排索引。
   *
   * 什么时候调用:
   *   在 embedding 生成之后调用。
   *   每个 chunk 向量化成功后立刻调用这个方法。
   *
   * 类比:
   *   新写了一页菜单内容，抄到菜单索引本上：
   *   "GCash withdrawal fee is ₱15" → Meilisearch 自动编好目录
   *   以后搜"₱15"就能找到了。
   *
   * 存的是什么:
   *   - 不是向量（向量在 pgvector 里）
   *   - 是 chunk 原文（Meilisearch 自己分词建索引）
   *
   * @param data chunk 的所有信息（原文 + 元数据）
   */
  async indexChunk(data: {
    chunkId: string;
    chunkIndex: number;
    content: string;
    documentId: string;
    title: string;
    domain: string;
    docId: string;
    keywords: string[];
    priority: string;
    contentType: string;
    locale: string;
    isActive: boolean;
  }): Promise<void> {
    // Meilisearch 连不上 → 跳过，不影响主流程
    if (!this.client) return;

    try {
      const index = this.client.index(this.indexName);
      // Meilisearch 强制要求每个文档有个 id 字段作为主键
      // 我们用 chunkId 作为 id
      await index.addDocuments([
        {
          id: data.chunkId,
          chunkId: data.chunkId,
          chunkIndex: data.chunkIndex,
          content: data.content,
          documentId: data.documentId,
          title: data.title,
          domain: data.domain,
          docId: data.docId,
          keywords: data.keywords,
          priority: data.priority,
          contentType: data.contentType,
          locale: data.locale,
          isActive: data.isActive,
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `[indexChunk] Failed to index chunk ${data.chunkId}: ${message}`,
      );
    }
  }

  /**
   * 从 Meilisearch 删除一个 chunk
   *
   * 什么时候调用:
   *   删除文档或重新切片时调用。
   *   旧的 chunk 需要从 Meilisearch 里删掉。
   */
  async deleteChunk(chunkId: string): Promise<void> {
    if (!this.client) return;

    try {
      const index = this.client.index(this.indexName);
      await index.deleteDocument(chunkId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `[deleteChunk] Failed to delete chunk ${chunkId}: ${message}`,
      );
    }
  }

  /**
   * 批量存入 chunks（一次性存多个）
   *
   * 什么时候用:
   *   初始化/重建时用。
   *   比如 Reindex All 按钮，需要把所有文档的 chunks 重新存一遍。
   *
   * 和 indexChunk 的区别:
   *   indexChunk     → 一次存 1 个 chunk（上传文档时用）
   *   bulkIndexChunks → 一次存 N 个 chunk（批量重建时用，更快）
   */
  async bulkIndexChunks(
    chunks: Array<{
      chunkId: string;
      chunkIndex: number;
      content: string;
      documentId: string;
      title: string;
      domain: string;
      docId: string;
      keywords: string[];
      priority: string;
      contentType: string;
      locale: string;
      isActive: boolean;
    }>,
  ): Promise<void> {
    if (!this.client || chunks.length === 0) return;

    try {
      const index = this.client.index(this.indexName);
      const documents = chunks.map((chunk) => ({
        id: chunk.chunkId,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        documentId: chunk.documentId,
        title: chunk.title,
        domain: chunk.domain,
        docId: chunk.docId,
        keywords: chunk.keywords,
        priority: chunk.priority,
        contentType: chunk.contentType,
        locale: chunk.locale,
        isActive: chunk.isActive,
      }));

      const response = await index.addDocuments(documents);

      this.logger.log(
        `[bulkIndexChunks] Indexed ${chunks.length} chunks into Meilisearch (task: ${response.taskUid})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`[bulkIndexChunks] Failed: ${message}`);
    }
  }

  /**
   * 检查 Meilisearch 是否可用
   *
   * 翻译成人话:
   *   看看菜单索引本能不能用。
   *   如果 Meilisearch 挂了，返回 false，上层会跳过 BM25 搜索。
   */
  get isAvailable(): boolean {
    return this.client !== null;
  }
}
