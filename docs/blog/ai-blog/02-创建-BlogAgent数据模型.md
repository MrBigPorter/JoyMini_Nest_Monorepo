# 02. 创建 BlogAgent 数据模型

## 🎯 本步骤目标

1. 创建知识库 Prisma 模型 `KnowledgeDocument` — 存储 Agent 可检索的策展知识（政策/FAQ/规则/指南）
2. 创建文章向量模型 `ArticleEmbedding` — 为 BlogArticle 内容提供语义向量搜索（博客特有需求）
3. 创建 Agent 交互日志模型 `AgentInteraction` — 追踪 Agent 决策过程
4. 配置 `pgvector` 扩展 — 支持向量语义搜索
5. 创建 `KnowledgeService` — 知识库 CRUD + 向量搜索
6. 创建 `ArticleEmbeddingService` — 文章 embedding 生命周期管理

---

## 📖 背景说明

### 承上

[01-配置-BlogAgent基础设施](01-配置-BlogAgent基础设施.md) 完成了 BlogAgentModule、GraphState、BlogAgentService 的骨架搭建。

### 这一步要解决的问题

Agent 需要知识来源和记忆能力：
- **知识库**：博客政策、FAQ、翻译规范等结构化知识
- **向量搜索**：语义级信息检索（超越关键词匹配）
- **交互日志**：Agent 决策审计、调试分析、质量评估

### 设计决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 向量存储 | pgvector vs Pinecone/Weaviate | **pgvector** | 与 PostgreSQL 同库，无需额外基础设施 |
| 嵌入模型 | 本地 vs API | **AiService.generateEmbedding** | 复用现有嵌入能力，mxbai-embed-large |
| 日志存储 | Prisma vs 独立日志系统 | **Prisma** | 与现有数据模型一致，查询方便 |
| 知识库粒度 | 整篇文档 vs 分段 | **分段 + 元数据** | 提高检索精度，支持局部更新 |
| **KnowledgeDocument 是否存文章** | 存 vs 不存 | **不存文章** | KnowledgeDocument 是人工策展知识库（policy/faq/translation_rule/agent_guide），不自动同步文章内容。文章向量搜索由独立的 ArticleEmbedding 模型负责。|
| **文章 embedding 存储** | BlogArticle 直接加字段 vs 独立表 | **独立 ArticleEmbedding 表** | 避免修改现有 BlogArticle 模型，支持版本控制和独立重建 |

---

## ⚙️ 前置条件

- [x] PostgreSQL 支持 pgvector 扩展
- [x] AiService 已实现 `generateEmbedding(text: string): number[]`
- [x] Prisma Schema 位于 `apps/api/prisma/schema.prisma`

---

## 📝 实现步骤

### Step 1: 添加 Prisma 模型

**文件**: `apps/api/prisma/schema.prisma`

```prisma
// ── AI Agent 知识库文档 ──
model KnowledgeDocument {
  id          String   @id @default(cuid())
  // 文档类型: policy/faq/translation_rule/agent_guide
  docType     String   @default("policy")
  // 标题（用于检索摘要）
  title       String
  // 内容（Markdown 格式）
  content     String   @db.Text
  // 内容摘要（用于搜索摘要显示）
  summary     String?
  // 向量嵌入（dimension=768，mxbai-embed-large 输出）
  embedding   Unsupported("vector(768)")?
  // 元数据（JSON，可存来源、作者、版本等）
  metadata    Json?
  // 支持的语言（JSON array, e.g. ["zh","en"]）
  locales     Json?    @default("[\"zh\"]")
  // 来源链接（指向相关文章/页面）
  sourceUrl   String?
  // 启用状态
  enabled     Boolean  @default(true)
  // 权重（优先级排序 1-10）
  weight      Int      @default(5)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([docType])
  @@index([enabled])
  @@map("knowledge_documents")
}

// ── 文章向量嵌入（独立于知识库，用于语义搜索）──
model ArticleEmbedding {
  id          String   @id @default(cuid())
  // 关联文章
  articleId   String
  // 语言（同一文章不同语言独立嵌入）
  locale      String   @default("zh")
  // 内容哈希（用于检测内容变更，避免重复生成）
  contentHash String
  // 向量嵌入（dimension=768，mxbai-embed-large 输出）
  embedding   Unsupported("vector(768)")?
  // 版本号（递增，文章每次更新后生成新版本）
  version     Int      @default(1)
  // 分段索引（文章过长时分段嵌入，0=全文/标题级）
  chunkIndex  Int      @default(0)
  // 元数据（可存标题、摘要、标签等搜索辅助信息）
  metadata    Json?
  // 状态: active/stale/regenerating
  status      String   @default("active")

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([articleId, locale])
  @@index([status])
  @@index([embedding], type: IvffloatList withIndexConfig(lists: 100))
  @@map("article_embeddings")
}

// ── Agent 交互日志 ──
model AgentInteraction {
  id             String   @id @default(cuid())
  // 会话 ID（关联多轮交互）
  sessionId      String
  // 用户输入
  userInput      String   @db.Text
  // 识别到的意图
  detectedIntent String?
  // 执行的 Agent 名称
  agentName      String?
  // Agent 的中间思考（JSON array）
  agentThoughts  Json?
  // 调用的工具列表（JSON array）
  toolsCalled    Json?
  // 最终输出
  agentOutput    String?  @db.Text
  // 是否成功
  success        Boolean  @default(true)
  // 处理耗时（ms）
  processingMs   Int?
  // 用户反馈（thumbs up/down）
  userFeedback   String?
  // 语言
  locale         String   @default("zh")

  createdAt      DateTime @default(now())

  @@index([sessionId])
  @@index([detectedIntent])
  @@index([createdAt])
  @@map("agent_interactions")
}
```

**设计决策**：
- `vector(768)` 与 `mxbai-embed-large` 嵌入维度一致
- 使用 `Unsupported` 类型避免 Prisma Migrate 对 pgvector 的原生限制
- `ArticleEmbedding` 独立于 `KnowledgeDocument`：前者同步文章内容用于语义搜索，后者是人工策展知识库
- `contentHash` 用于增量更新：文章内容未变时不重新生成嵌入
- `chunkIndex` 支持分段嵌入：长文章分段存储，提高检索精度
- `@@index([embedding], type: IvffloatList)` 创建 IVF 索引加速向量搜索（需 pgvector 0.5.0+）
- `AgentInteraction` 记录完整的决策链路，便于审计和优化

### Step 2: 创建 KnowledgeService

**文件**: `apps/api/src/blog/agent/services/knowledge.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiService } from '@api/common/ai/ai.service';

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  /**
   * 向量搜索知识库
   * 使用 AiService 生成查询嵌入，然后执行 pgvector 相似度搜索
   */
  async searchSimilar(
    query: string,
    options: {
      topK?: number;
      docType?: string;
      locale?: string;
      minScore?: number;
    } = {},
  ) {
    const { topK = 5, docType, locale = 'zh', minScore = 0.7 } = options;

    // 1. 生成查询向量
    const embedding = await this.aiService.generateEmbedding(query);

    // 2. 构建过滤条件
    const conditions = ['k.enabled = true'];
    const params: any[] = [JSON.stringify(embedding), topK];

    if (docType) {
      conditions.push(`k.doc_type = $${params.length + 1}`);
      params.push(docType);
    }

    // 3. 执行向量搜索
    const sql = `
      SELECT
        k.id, k.title, k.summary, k.doc_type, k.metadata,
        k.source_url, k.weight,
        1 - (k.embedding <=> $1::vector) as similarity
      FROM knowledge_documents k
      WHERE ${conditions.join(' AND ')}
        AND (k.locales IS NULL OR k.locales::jsonb ? $${params.length + 1})
      ORDER BY k.embedding <=> $1::vector
      LIMIT $2
    `;

    const results = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);

    return results
      .filter((r) => r.similarity >= minScore)
      .map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        docType: r.doc_type,
        metadata: r.metadata,
        sourceUrl: r.source_url,
        similarity: Number(r.similarity),
        weight: r.weight,
      }));
  }

  /**
   * 创建知识库文档
   */
  async createDocument(data: {
    docType: string;
    title: string;
    content: string;
    summary?: string;
    metadata?: any;
    locales?: string[];
    sourceUrl?: string;
    weight?: number;
  }) {
    // 生成嵌入向量
    const embedding = await this.aiService.generateEmbedding(
      `${data.title}\n${data.summary || data.content.slice(0, 500)}`,
    );

    return this.prisma.$executeRawUnsafe(
      `INSERT INTO knowledge_documents 
        (id, doc_type, title, content, summary, embedding, metadata, locales, source_url, weight)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8::jsonb, $9, $10)`,
      [
        undefined, // auto-generate id
        data.docType,
        data.title,
        data.content,
        data.summary || null,
        JSON.stringify(embedding),
        JSON.stringify(data.metadata || {}),
        JSON.stringify(data.locales || ['zh']),
        data.sourceUrl || null,
        data.weight || 5,
      ],
    );
  }
}
```

### Step 3: 创建 AgentInteractionService

**文件**: `apps/api/src/blog/agent/services/interaction.service.ts`

记录和查询 Agent 交互日志的服务：

```typescript
@Injectable()
export class AgentInteractionService {
  constructor(private readonly prisma: PrismaService) {}

  async logInteraction(data: {
    sessionId: string;
    userInput: string;
    detectedIntent?: string;
    agentName?: string;
    agentThoughts?: any[];
    toolsCalled?: any[];
    agentOutput?: string;
    success?: boolean;
    processingMs?: number;
    locale?: string;
  }) {
    return this.prisma.agentInteraction.create({ data });
  }

  async getSessionHistory(sessionId: string) {
    return this.prisma.agentInteraction.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
```

### Step 4: 创建 ArticleEmbeddingService

**文件**: `apps/api/src/blog/agent/services/article-embedding.service.ts`

管理文章向量的生命周期：生成、搜索、同步、清理。

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiService } from '@api/common/ai/ai.service';
import { createHash } from 'crypto';

@Injectable()
export class ArticleEmbeddingService {
  private readonly logger = new Logger(ArticleEmbeddingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  /**
   * 为文章生成语义嵌入
   * 1. 计算内容哈希，检测是否已有最新的嵌入
   * 2. 调用 AiService.generateEmbedding() 生成向量
   * 3. 写入 article_embeddings 表
   */
  async generateEmbedding(
    articleId: string,
    locale: string = 'zh',
  ): Promise<void> {
    // 1. 获取文章内容
    const article = await this.prisma.blogArticle.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        title: true,
        content: true,
        summary: true,
        tags: { select: { name: true } },
        categories: { select: { name: true } },
        localizedFields: true,
      },
    });

    if (!article) {
      this.logger.warn(`Article ${articleId} not found, skipping embedding`);
      return;
    }

    // 2. 提取本地化内容
    const localized = (article.localizedFields as any) || {};
    const title =
      localized[locale]?.title || article.title;
    const content =
      localized[locale]?.content || article.content || '';
    const summary =
      localized[locale]?.summary || article.summary || '';

    // 3. 计算内容哈希
    const contentHash = createHash('md5')
      .update(`${title}\n${summary}\n${content}`)
      .digest('hex');

    // 4. 检查现有嵌入是否已是最新
    const existing = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, content_hash, version FROM article_embeddings
       WHERE article_id = $1 AND locale = $2 AND status = 'active'
       ORDER BY version DESC LIMIT 1`,
      [articleId, locale],
    );

    if (existing.length > 0 && existing[0].content_hash === contentHash) {
      this.logger.debug(
        `Article ${articleId} [${locale}] embedding is up-to-date`,
      );
      return;
    }

    // 5. 生成嵌入向量
    const embedText = `Title: ${title}\nSummary: ${summary}\nContent: ${content.slice(0, 8000)}`;
    const embedding = await this.aiService.generateEmbedding(embedText);

    if (!embedding) {
      this.logger.warn(
        `Failed to generate embedding for article ${articleId} [${locale}]`,
      );
      return;
    }

    const newVersion = existing.length > 0 ? existing[0].version + 1 : 1;

    // 6. 标记旧嵌入为 stale
    if (existing.length > 0) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE article_embeddings SET status = 'stale'
         WHERE article_id = $1 AND locale = $2 AND status = 'active'`,
        [articleId, locale],
      );
    }

    // 7. 写入新嵌入
    const metadata = JSON.stringify({
      title,
      summary,
      tags: article.tags?.map((t) => t.name) || [],
      categories: article.categories?.map((c) => c.name) || [],
    });

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO article_embeddings
        (id, article_id, locale, content_hash, embedding, version, chunk_index, metadata, status)
       VALUES ($1, $2, $3, $4, $5::vector, $6, 0, $7::jsonb, 'active')`,
      [
        undefined,
        articleId,
        locale,
        contentHash,
        JSON.stringify(embedding),
        newVersion,
        metadata,
      ],
    );

    this.logger.log(
      `Generated embedding v${newVersion} for article ${articleId} [${locale}]`,
    );
  }

  /**
   * 语义搜索相似文章
   * 使用 pgvector <=> (余弦距离) 排序
   */
  async searchSimilar(
    query: string,
    options: {
      topK?: number;
      locale?: string;
      minScore?: number;
    } = {},
  ) {
    const { topK = 10, locale = 'zh', minScore = 0.6 } = options;

    const embedding = await this.aiService.generateEmbedding(query);
    if (!embedding) return [];

    const results = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT
        e.article_id, e.locale, e.version,
        e.metadata->>'title' as title,
        e.metadata->>'summary' as summary,
        1 - (e.embedding <=> $1::vector) as similarity
      FROM article_embeddings e
      WHERE e.locale = $2 AND e.status = 'active'
      ORDER BY e.embedding <=> $1::vector
      LIMIT $3`,
      [JSON.stringify(embedding), locale, topK],
    );

    return results
      .filter((r) => r.similarity >= minScore)
      .map((r) => ({
        articleId: r.article_id,
        locale: r.locale,
        title: r.title,
        summary: r.summary,
        similarity: Number(r.similarity),
        version: r.version,
      }));
  }

  /**
   * 删除文章的所有嵌入（文章删除时调用）
   */
  async deleteArticleEmbeddings(articleId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM article_embeddings WHERE article_id = $1`,
      [articleId],
    );
    this.logger.log(`Deleted all embeddings for article ${articleId}`);
  }

  /**
   * 同步单篇文章嵌入（发布/更新时调用）
   * 支持多语言：为目标语言生成嵌入
   */
  async syncArticle(
    articleId: string,
    locales: string[] = ['zh'],
  ): Promise<void> {
    for (const locale of locales) {
      await this.generateEmbedding(articleId, locale);
    }
  }
}
```

---

## ✅ 验收方式

### 手动验证

1. **数据库迁移**
   - 运行 `npx prisma migrate dev --name add-agent-models`
   - 预期：新表 `knowledge_documents`、`article_embeddings` 和 `agent_interactions` 创建成功

2. **知识库向量搜索测试**
   - 插入测试文档到 `knowledge_documents`
   - 调用 `knowledgeService.searchSimilar('如何翻译文章')`
   - 预期：返回语义相关的结果

3. **文章向量嵌入测试**
   - 对一篇文章调用 `articleEmbeddingService.generateEmbedding(articleId, 'zh')`
   - 调用 `articleEmbeddingService.searchSimilar('相关主题关键词')`
   - 预期：返回语义相似的文章

4. **内容变更检测测试**
   - 对同一篇文章再次调用 `generateEmbedding`
   - 预期：内容未变时不生成新嵌入（contentHash 匹配跳过）

5. **交互日志测试**
   - 调用 `interactionService.logInteraction(...)`
   - 查询 `interactionService.getSessionHistory(sessionId)`
   - 预期：日志正确记录和查询

---

## 🔜 下一步预告

下一步 [03-实现-BlogIntentRouter节点](03-实现-BlogIntentRouter节点.md) 将：
- 实现意图识别节点（intentRouter）
- 定义博客相关意图：search/translate/moderate/recommend/generate/faq
- 创建意图到 Agent 的条件路由边
- 集成 LangGraph 的条件边路由逻辑

后续 [09-实现-文章向量搜索增强](09-实现-文章向量搜索增强.md) 将：
- 实现 `AiService.generateEmbedding()` 完整逻辑（当前为 stub）
- 创建批量嵌入脚本（为所有已发布文章生成嵌入）
- 添加文章生命周期 Hook（发布/更新/删除自动同步）
- 构建 `article_vector` 搜索工具与三源 RRF 融合
