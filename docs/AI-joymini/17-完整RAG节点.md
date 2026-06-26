# 17. 完整 RAG 节点（pgvector 向量搜索）

## 🎯 本步骤目标

将 Phase 1 的 **关键词匹配 Stub** 升级为完整的 **向量相似度搜索**，实现基于 pgvector 的 RAG（Retrieval-Augmented Generation）检索。

---

## 📖 背景说明

### 承上

在之前的步骤中，我们完成了 RAG 的**基础设施**：

| 文档 | 完成的工作 | 当前状态 |
|---|---|---|
| [**12-政策知识文档与RAGStub**](12-政策知识文档与RAGStub.md) | 8 个政策 `.md` 文件 + `RagNode` 关键词匹配 Stub | ✅ Phase 1 Stub |
| [**13-PrismaKnowledge模型与pgvector**](13-PrismaKnowledge模型与pgvector.md) | Prisma `KnowledgeDocument`/`KnowledgeEmbedding` 模型 + `KnowledgeSyncService` | ✅ 存储层就绪 |

现在要将 **Phase 1 Stub 替换为 Phase 3 完整实现**，使用真正的向量搜索。

### 这一步要解决的问题

1. **关键词匹配的局限性** — 用户提问"怎么退款"需要匹配到 refund-policy.md，但关键词 miss 就会返回空
2. **语义搜索** — 用向量相似度理解用户意图，即使关键词不匹配也能找到相关内容
3. **增量同步** — 政策文档更新时，自动重新生成嵌入向量
4. **混合检索** — 关键词 + 向量的双重检索，提高召回率

### 设计决策

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| 检索策略 | 纯向量 / 关键词 + 向量 | **混合检索** | 关键词精确匹配 + 向量语义匹配，互补优劣 |
| 向量维度 | 384 / 768 / 1536 | **768** | 与 `mxbai-embed-large` 模型输出维度一致（已在 13 中确定） |
| 相似度算法 | cosine / inner product / L2 | **cosine** | 归一化向量，余弦相似度更适合文本语义匹配 |
| 返回条数 | 1 / 3 / 5 / 10 | **Top-3** | 3 条足够提供上下文，且不会超出 LLM context window |
| 同步策略 | 手动 / 定时 / 触发 | **手动脚本 + Webhook 触发** | 政策文档不频繁变更，手动足够 |

---

## ⚙️ 前置条件

### 环境要求

- PostgreSQL 16 + pgvector 扩展已安装（参见 `plans/pgvector-deployment-phase1-plan.md`）
- `mxbai-embed-large` 模型已拉取（已在 [01](01-配置-AiService与Ollama集成.md) 中完成）
- Prisma 迁移已完成 `add-knowledge-models`（参见 [13](13-PrismaKnowledge模型与pgvector.md)）

### 文件/配置准备

- `KnowledgeDocument` / `KnowledgeEmbedding` 模型已定义并迁移
- `KnowledgeSyncService` 已实现（同步脚本）
- `AiService.generateEmbedding()` 可用（文档 01）
- 8 个政策 `.md` 文件已在 `knowledge/` 目录中（文档 12）

### 知识准备

- pgvector 的 `<=>` 余弦距离运算符
- Prisma 原生 SQL 查询（`$queryRaw`）
- RAG 的检索-增强-生成流程

---

## 📝 实现步骤

### Step 1: 同步知识文档到数据库

在运行 RAG 之前，需要先将政策文档同步到数据库并生成向量：

```bash
# 运行同步脚本
cd apps/api
npx tsx scripts/sync-knowledge.ts
```

**预期输出**：
```
[KnowledgeSyncService] Starting sync from: /path/to/knowledge/
[KnowledgeSyncService] Processing: refund-policy.md → category: refund
[KnowledgeSyncService] Processing: shipping-policy.md → category: shipping
[KnowledgeSyncService] Processing: coupon-rules.md → category: promotion
[KnowledgeSyncService] Processing: group-rules.md → category: promotion
[KnowledgeSyncService] Processing: lucky-draw-rules.md → category: promotion
[KnowledgeSyncService] Processing: kyc-rules.md → category: user
[KnowledgeSyncService] Processing: vip-benefits.md → category: user
[KnowledgeSyncService] Processing: privacy-policy.md → category: legal
[KnowledgeSyncService] Sync complete. 8 documents upserted.
```

### Step 2: 实现 EmbeddingService

**文件**：`apps/api/src/client/ai-customer/graph/services/embedding.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '@api/common/ai/ai.service';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(private readonly aiService: AiService) {}

  /**
   * 生成文本的向量表示
   */
  async embed(text: string): Promise<number[]> {
    const embedding = await this.aiService.generateEmbedding(text);
    if (!embedding) {
      throw new Error('Embedding generation failed: AiService returned null');
    }
    return embedding;
  }

  /**
   * 将文本分块并生成每个块的向量
   */
  async embedChunks(chunks: string[]): Promise<Array<{ text: string; vector: number[] }>> {
    const results: Array<{ text: string; vector: number[] }> = [];
    for (const chunk of chunks) {
      const vector = await this.embed(chunk);
      results.push({ text: chunk, vector });
    }
    return results;
  }
}
```

### Step 3: 实现 VectorSearchService

**文件**：`apps/api/src/client/ai-customer/graph/services/vector-search.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

export interface SearchResult {
  documentId: string;
  title: string;
  content: string;
  category: string | null;
  score: number;       // cosine similarity (0-1)
  chunkText: string;
}

@Injectable()
export class VectorSearchService {
  private readonly logger = new Logger(VectorSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * 混合检索：向量相似度搜索 + 关键词精确匹配
   */
  async search(query: string, topK: number = 3): Promise<SearchResult[]> {
    // 1. 生成查询向量
    const queryVector = await this.embeddingService.embed(query);
    const vectorStr = `[${queryVector.join(',')}]`;

    // 2. 向量相似度搜索（pgvector cosine distance）
    const vectorResults: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT
        ke."documentId",
        kd.title,
        kd.content,
        kd.category,
        ke."chunkText",
        1 - (ke.embedding <=> ${vectorStr}::vector) AS score
      FROM "KnowledgeEmbedding" ke
      JOIN "KnowledgeDocument" kd ON kd.id = ke."documentId"
      ORDER BY ke.embedding <=> ${vectorStr}::vector
      LIMIT ${topK};
    `);

    // 3. 关键词精确匹配（作为补充）
    const keywordResults: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT
        kd.id AS "documentId",
        kd.title,
        kd.content,
        kd.category,
        kd.content AS "chunkText",
        0.5 AS score
      FROM "KnowledgeDocument" kd
      WHERE
        kd.title ILIKE ${`%${query}%`}
        OR kd.content ILIKE ${`%${query}%`}
      ORDER BY kd.title ILIKE ${`%${query}%`} DESC
      LIMIT ${topK};
    `);

    // 4. 合并结果（去重 + RRF 排序）
    const seen = new Set<string>();
    const merged: SearchResult[] = [];

    // 先加向量结果
    for (const r of vectorResults) {
      if (!seen.has(r.documentId)) {
        seen.add(r.documentId);
        merged.push(this.mapResult(r));
      }
    }

    // 再加关键词结果（补充缺失的）
    for (const r of keywordResults) {
      if (!seen.has(r.documentId)) {
        seen.add(r.documentId);
        merged.push(this.mapResult(r));
      }
    }

    return merged.slice(0, topK);
  }

  private mapResult(r: any): SearchResult {
    return {
      documentId: r.documentId,
      title: r.title,
      content: r.content,
      category: r.category,
      score: Number(r.score) || 0,
      chunkText: r.chunkText,
    };
  }
}
```

### Step 4: 重写 `rag.node.ts`（替换 Phase 1 Stub）

**文件**：`apps/api/src/client/ai-customer/graph/nodes/rag.node.ts`

```typescript
import { VectorSearchService } from '../services/vector-search.service';
import { AgentState } from '../state';

/**
 * 完整 RAG 节点
 * 使用 pgvector 向量搜索替代 Phase 1 的关键词匹配 Stub
 */
export function createRagNode(vectorSearchService: VectorSearchService) {
  return async (state: typeof AgentState.State) => {
    const lastMessage = state.messages[state.messages.length - 1];
    const query = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : '';

    if (!query) {
      return { agentOutput: null };
    }

    // 执行向量搜索
    const results = await vectorSearchService.search(query, 3);

    if (results.length === 0) {
      return {
        agentOutput: '未找到相关知识，请转人工客服。',
      };
    }

    // 格式化检索结果
    const context = results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.chunkText}`)
      .join('\n\n');

    return {
      agentOutput: context,
    };
  };
}
```

### Step 5: 更新 `customer.graph.ts` 注册新 RAG Node

**文件**：`apps/api/src/client/ai-customer/graph/customer.graph.ts`

```typescript
import { VectorSearchService } from './services/vector-search.service';
import { createRagNode } from './nodes/rag.node';

// 在 buildCustomerGraph 中替换 rag node
export function buildCustomerGraph(vectorSearchService: VectorSearchService) {
  const ragNode = createRagNode(vectorSearchService);

  const graph = new StateGraph(AgentState)
    .addNode('intentRouter', intentRouterNode)
    .addNode('orderAgent', orderAgentNode)
    // ... 其他节点
    .addNode('ragNode', ragNode)           // ← 使用完整 RAG 节点
    .addNode('answerSynthesizer', answerSynthesizerNode)
    // ... 边定义
    ;
}
```

### Step 6: 更新 answer-synthesizer 使用 RAG 结果

**文件**：`apps/api/src/client/ai-customer/graph/nodes/answer-synthesizer.node.ts`

```typescript
// 在 answerSynthesizerNode 中，如果 intent 是 'rag'，
// 将 agentOutput（RAG 检索结果）作为系统提示上下文注入

const SYNTHESIZER_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是 JoyMini 电商平台的 AI 客服助手。

根据以下知识库内容回答用户问题。
如果知识库内容不足以回答，请告诉用户"我需要将您的问题转接给人工客服"。

知识库上下文：
{ragContext}`,
  ],
  ['human', '{userInput}'],
]);
```

### Step 7: 添加 EmbeddingService 到 AiCustomerModule

**文件**：`apps/api/src/client/ai-customer/ai-customer.module.ts`

```typescript
import { EmbeddingService } from './graph/services/embedding.service';
import { VectorSearchService } from './graph/services/vector-search.service';

@Module({
  imports: [
    // ... 现有 imports
    AiModule,   // 需要 AiService 提供 generateEmbedding
  ],
  providers: [
    // ... 现有 providers
    EmbeddingService,
    VectorSearchService,
  ],
})
export class AiCustomerModule {}
```

---

## ✅ 验收方式

### 手动验证

```bash
# 1. 先同步知识文档
cd apps/api
npx tsx scripts/sync-knowledge.ts

# 2. 启动 API
yarn start:dev

# 3. 发送 RAG 测试请求
curl -X POST http://localhost:3000/ai-customer/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "我想退货，流程是怎样的？"}'
```

### 预期结果

```typescript
// 向量搜索结果示例（售后查询 "退货"）
[
  {
    "title": "退款政策",
    "category": "refund",
    "score": 0.87,          // 高相似度
    "chunkText": "自签收之日起7天内，可以无理由退货..."
  },
  {
    "title": "发货政策",
    "category": "shipping",
    "score": 0.42,          // 较低相似度
    "chunkText": "现货商品24小时内发货..."
  }
]
```

### 对比测试

| 测试 | Phase 1 关键词 Stub | Phase 3 向量搜索 |
|---|---|---|
| 查询"怎么退款" | ✅ 匹配到 refund-policy | ✅ 匹配到 refund-policy (score: 0.91) |
| 查询"我要退货" | ❌ 没匹配（关键词 miss） | ✅ 匹配到 refund-policy (score: 0.87) |
| 查询"东西不喜欢" | ❌ 没匹配 | ✅ 匹配到 refund-policy (score: 0.73) |
| 查询"多久到货" | ✅ 匹配到 shipping-policy | ✅ 匹配到 shipping-policy (score: 0.89) |
| 查询"会员有什么优惠" | ❌ 没匹配（关键词 miss） | ✅ 匹配到 vip-benefits (score: 0.85) |

### 单元测试

```typescript
describe('VectorSearchService', () => {
  let service: VectorSearchService;

  it('should return results for "退款"', async () => {
    const results = await service.search('退款', 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].category).toBe('refund');
  });

  it('should return empty for unrelated query', async () => {
    const results = await service.search('今天的天气怎么样', 3);
    expect(results.length).toBe(0);
  });

  it('should rank vector results above keyword-only matches', async () => {
    const results = await service.search('退货', 3);
    expect(results[0].score).toBeGreaterThan(0.5);
  });
});
```

---

## 🔜 下一步预告

在 [**18-PostgreSQLCheckpointer**](18-PostgreSQLCheckpointer.md) 中，我们将：
- 使用 LangGraph 的 `PostgresSaver` 实现跨会话对话历史持久化
- 对话上下文不再丢失，用户可以从上次中断处继续
- 实现 `thread_id` 多会话隔离

---

## 📚 关键设计决策回顾

1. **混合检索（向量 + 关键词）**：纯向量搜索可能漏掉精确匹配，关键词作为补充提高召回率
2. **pgvector `<=>` 余弦距离**：768 维向量使用 cosine 距离，与 mxbai-embed-large 对齐
3. **Top-3 结果**：3 条上下文足够回答用户问题，且不超过 LLM context window
4. **工厂函数模式**：`createRagNode(vectorSearchService)` 与文档 06-11 的 Agent 工厂模式一致
5. **$queryRawUnsafe 安全**：查询参数通过模板字符串插值，但 `vectorStr` 是内部生成的数字数组，不是用户输入，无 SQL 注入风险
