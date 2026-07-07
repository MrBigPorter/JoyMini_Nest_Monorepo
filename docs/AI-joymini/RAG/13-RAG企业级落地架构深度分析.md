# 13. RAG 企业级落地架构深度分析

> **状态**: 定稿 | **最后更新**: 2026-07-06  
> **关联文档**: [`12-知识文档RAG架构分析.md`](12-知识文档RAG架构分析.md) | [`PROGRESS.md`](../PROGRESS.md)

---

## 📋 目录

1. [背景与现状](#1-背景与现状)
2. [RAG 七维深度分析](#2-rag-七维深度分析)
   - 2.1 准确性
   - 2.2 缓存
   - 2.3 切片
   - 2.4 幻觉
   - 2.5 更新
   - 2.6 删除
   - 2.7 读写
3. [大厂 RAG 落地参考](#3-大厂-rag-落地参考)
4. [JoyMini RAG 成熟度模型](#4-joymini-rag-成熟度模型)
5. [Phase 1 实施计划](#5-phase-1-实施计划keyword-rag)
6. [验证清单](#6-验证清单)
7. [RAG Admin 管理面板完整设计](#7-rag-admin-管理面板完整设计)
   - 7.1 设计目标
   - 7.2 Prisma 数据模型（含 Prompt 管理）
   - 7.3 Admin API 端点设计
   - 7.4 Prisma Migration 规划
   - 7.5 Admin 后端模块结构
   - 7.6 Admin 前端页面结构
   - 7.7 企业级功能清单（18 项差距全覆盖）
   - 7.8 管理面板 UI 设计
   - 7.9 实施阶段
   - 7.10 与现有系统集成
   - 7.11 Prompt 管理系统设计
   - 7.12 企业级差距分析文档
   - 7.13 内容日历
   - 7.14 通知系统
   - 7.15 多语言同步工作流
8. [完整文件修改清单](#8-完整文件修改清单)

---

## 1. 背景与现状

### 1.1 为什么需要这篇文档

[`Doc 12`](12-知识文档RAG架构分析.md) 已经完成了 Phase 1（Keyword RAG）的完整规划——包括 8 个 P0 文档、文档加载器、RagNode 和 orchestrator 集成。但在实际推进 RAG 到企业级生产环境时，还需要回答更深层的问题：

1. **准确性**：仅靠关键词匹配能到多少准确率？何时需要向量检索？
2. **缓存**：RAG 响应慢，如何缓存？缓存失效怎么处理？
3. **切片**：长文档怎么切？切片策略如何选择？
4. **幻觉**：LLM 基于检索内容编造答案怎么办？
5. **更新**：文档更新后，缓存和 embedding 如何同步？
6. **删除**：文档删除后，如何确保 AI 不再引用？
7. **读写**：管理面板写入 + AI 读取的并发控制怎么设计？

此外，还需要参考大厂（Amazon、Shopee、Lazada、Pinduoduo）在电商场景下如何落地 RAG，以避免踩坑。

**本文档的目标**：一次性回答上述所有问题，为 JoyMini 的 RAG 系统提供从 Phase 1 到 Phase 3 的完整架构蓝图。

### 1.2 当前现状

- **Phase 0（当前）**：无 RAG 系统。AI 回答仅依赖 Agent prompt 中的预置规则和工具调用返回的实时数据。
- **Phase 1（进行中）**：Keyword RAG。通过关键词匹配检索本地 Markdown 文档作为 LLM 上下文。
- **Phase 2（规划中）**：Semantic RAG。引入 pgvector + bge-m3 embedding 实现语义检索。
- **Phase 3（规划中）**：Hybrid RAG。关键词 + 向量混合检索 + 重排序（Rerank）。

### 1.3 参考的大厂实践

| 大厂 | 场景 | 核心方案 |
|:----|:-----|:---------|
| Amazon | 客服知识库 | Bedrock Agent + Knowledge Base：分片策略 + 向量检索 + 引用溯源 |
| Shopee | 政策问答 | 关键词 + 向量混合检索，Policy Card 模式 |
| Lazada | 退货/退款 FAQ | 多级检索（ES 关键词 → 向量 → LLM），人工审核兜底 |
| Pinduoduo | 拼团规则咨询 | 垂直领域专业化 RAG，规则库 + 推理链 |

> 详见第 [3 节](#3-大厂-rag-落地参考) 的深入分析。

---

## 2. RAG 七维深度分析

### 2.1 准确性

#### 2.1.1 问题定义

RAG 的准确性 = 检索到的文档与用户问题的相关程度 + LLM 正确使用检索内容的能力。

**三个阶段**：
1. **检索阶段**：找到正确的文档 → 关键词/向量/混合
2. **阅读阶段**：LLM 从检索内容中提取正确答案 → prompt 设计 + 引用规范
3. **生成阶段**：LLM 生成忠实于检索内容的回答 → 约束生成 + 幻觉检测

#### 2.1.2 大厂的三阶段检索架构

```
三阶段检索（Amazon Bedrock / Shopee 参考）：
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Stage 1:    │    │ Stage 2:    │    │ Stage 3:    │
│ Candidate   │ →  │ Reranking   │ →  │ Answer      │
│ Generation  │    │             │    │ Generation  │
└─────────────┘    └─────────────┘    └─────────────┘

Stage 1: 关键词 + 向量混合检索，快速召回 Top-K（K=20~50）
Stage 2: Cross-encoder 重排序，精排 Top-N（N=3~5）
Stage 3: LLM + 检索内容 → 带引用的回答
```

#### 2.1.3 JoyMini 三阶段实施路径

| 阶段 | 检索方式 | 准确率预期 | 延迟 | 依赖 |
|:----|:---------|:----------|:-----|:-----|
| Phase 1 | 关键词检索（Fuse.js 或自定义） | 60-75% | <100ms | Phase 1 文档 |
| Phase 2 | 语义检索（pgvector + bge-m3） | 75-88% | ~200ms | Prisma pgvector 扩展 |
| Phase 3 | 混合检索 + Cross-encoder Rerank | 85-95% | ~500ms | GPU/ONNX 推理 |

#### 2.1.4 准确率保障措施

**Phase 1 保障**：
1. **关键词同义词扩展**：每个文档配置 `keywords` 数组，包含同义词和多语言变体
2. **文档分级匹配**：精确匹配 > 部分匹配 > 同义词匹配 > 兜底文档
3. **边界决策树**（见 Doc 12 Section 3.2）：Domain 优先匹配 → 关键词匹配 → 最小粒度选择

**Phase 2 保障**：
1. **语义相似度阈值**：低于阈值（如 0.65）的文档不提供给 LLM
2. **多语言 Embedding**：bge-m3 原生支持中日韩英，无需翻译
3. **Embedding 预热**：启动时预加载所有已发布文档的 embedding

**Phase 3 保障**：
1. **Cross-encoder 二次排序**：修正向量检索的误匹配
2. **混合检索权重动态调整**：关键词 + 向量权重根据 Domain 动态配置
3. **A/B 测试框架**：对比不同检索策略的准确率

### 2.2 缓存

#### 2.2.1 三层缓存模型

```
                    ┌──────────────────┐
                    │  用户查询 "退款"   │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ L1: Query Cache  │─── 命中 → 直接返回
                    │ (Redis, TTL 5m)  │
                    └────────┬─────────┘
                             │ 未命中
                    ┌────────▼─────────┐
                    │ L2: Embedding    │─── 命中 → 跳过向量计算
                    │ Cache (本地 LRU)  │
                    └────────┬─────────┘
                             │ 未命中
                    ┌────────▼─────────┐
                    │ L3: Document     │─── 缓存文档内容
                    │ Content Cache     │     减少文件 I/O
                    │ (Memory Map)     │
                    └──────────────────┘
```

#### 2.2.2 Level 1: 查询结果缓存

```typescript
// 缓存结构 (Redis)
interface QueryCacheEntry {
  query: string;          // 归一化后的查询
  result: RetrievedDoc[];
  generatedAnswer?: string;
  policyVersion: number;  // 文档版本号，用于缓存失效
  expiresAt: number;      // TTL 时间戳
}
```

**缓存键设计**：
```
rag:query:${normalize(query)}:${locale}:${domain}
```

**缓存失效策略**：
- **TTL 失效**：默认 5 分钟
- **写失效**：文档更新/删除时，递增全局 `policyVersion`，匹配的缓存自动过期
- **预热**：高频查询（Top-100）定期刷新

#### 2.2.3 Level 2: Embedding 缓存（Phase 2+）

```typescript
// 本地 LRU 缓存
class EmbeddingCache {
  private cache = new Map<string, Float32Array>();
  private maxSize = 10000;  // 约 30MB (768维 * 4字节 * 10000)
  
  get(docId: string): Float32Array | undefined { ... }
  set(docId: string, embedding: Float32Array): void { ... }
  invalidate(docId: string): void { ... }
}
```

#### 2.2.4 Level 3: 文档内容缓存

```typescript
// 文档内容内存缓存
class DocumentContentCache {
  private cache = new Map<string, { content: string; frontmatter: any }>();
  
  // 在应用启动时预加载所有已发布文档
  async warmUp(): Promise<void> { ... }
  
  get(docId: string): DocumentContent | undefined { ... }
}
```

#### 2.2.5 新鲜度感知缓存（Freshness-Aware Cache）

为解决缓存与文档更新的冲突，使用"新鲜度感知"策略：

```typescript
interface FreshnessAwareEntry {
  data: any;
  policyVersion: number;      // 创建时的全局版本
  cachedAt: number;           // 缓存时间
}

// 全局版本计数器
let globalPolicyVersion = 1;

// 文档更新时递增
function onDocumentUpdated() {
  globalPolicyVersion++;
}

// 读取缓存时检查版本
function getCache(key: string): FreshnessAwareEntry | null {
  const entry = cache.get(key);
  if (entry && entry.policyVersion === globalPolicyVersion) {
    return entry;  // 缓存仍有效
  }
  cache.delete(key);
  return null;  // 缓存过期
}
```

### 2.3 切片（Chunking）

#### 2.3.1 常见错误

| 错误 | 后果 | 大厂做法 |
|:----|:-----|:---------|
| 固定大小切片（256 tokens） | 切断语义单元，LLM 理解错误 | 语义感知切片 |
| 切片无重叠 | 关键上下文丢失 | 10-20% 重叠 |
| 所有文档用同一策略 | 不同类型的文档需要不同策略 | 按 content type 配置策略 |

#### 2.3.2 企业级语义切片

**Phase 1**：基于 Markdown 标题的语义切片（无需 embedding）

```
文档: refund-policy.md
─────────────────────────────────
## Refund Process               ← Chunk 1 (heading-based)
To request a refund...

## Refund Amount                ← Chunk 2
The refund amount depends on...

## Refund Timeline              ← Chunk 3 (含子标题)
### Standard Refund
### Express Refund
─────────────────────────────────
```

**Phase 2+**：语义感知切片策略

```typescript
interface ChunkingStrategy {
  type: 'heading-based' | 'sentence-based' | 'hybrid';
  maxTokens: number;       // 最大 token 数
  overlapTokens: number;   // 重叠 token 数
  breakpoints: string[];   // 分割点模式
}

const strategies: Record<string, ChunkingStrategy> = {
  'policy': {
    type: 'heading-based',
    maxTokens: 512,
    overlapTokens: 64,
    breakpoints: ['## ', '### ']
  },
  'how-to': {
    type: 'hybrid',
    maxTokens: 384,
    overlapTokens: 48,
    breakpoints: ['## ', 'Step \\d+', '•']
  },
  'reference': {
    type: 'sentence-based',
    maxTokens: 256,
    overlapTokens: 32,
    breakpoints: ['\n\n']
  }
};
```

#### 2.3.3 JoyMini 特定建议

| 文档类型 | 建议切片策略 | 原因 |
|:---------|:------------|:-----|
| Policy（退款/发货） | 按 ## 标题切，每段 200-500 tokens | 每段自包含，用户通常只问一个点 |
| How-to（操作指南） | 按步骤切，每步 100-200 tokens | 用户需要完整步骤 |
| FAQ（常见问题） | 一问一答为一个 Chunk | 问答对天然独立 |
| Troubleshooting | 按问题类型切 | 每个问题独立 |

### 2.4 幻觉（Hallucination）

#### 2.4.1 五层防御模型

```
Layer 1 [Prompt Engineering]  → 强制引用 + 格式约束
Layer 2 [Context Gating]      → 检索内容相关性过滤
Layer 3 [Grounding Check]     → 二次 LLM 验证
Layer 4 [Consistency Check]   → 多角度交叉验证（Phase 3）
Layer 5 [HITL]                → 人工审核兜底
```

#### 2.4.2 Layer 1: Prompt Engineering（Phase 1 可实施）

<system_prompt>
You are an AI assistant for JoyMini platform.

**Rules**:
1. ONLY answer based on the provided context documents below.
2. If the context doesn't contain enough information, say: "I don't have enough information about that. Let me transfer you to our support team."
3. Always cite the source document: "[Source: document-title.md > Section Name]"
4. NEVER make up policies, numbers, or procedures.
5. If the user asks in Tagalog or Cebuano, still answer based on English context but respond in their language.

**Context Documents**:
{retrieved_documents}

**User Question**: {user_question}
</system_prompt>

#### 2.4.3 Layer 2: Context Gating（Phase 1 可实施）

```typescript
interface RetrievedDoc {
  docId: string;
  title: string;
  content: string;
  score: number;       // 关键词匹配得分 0-1
  threshold: number;   // Domain 阈值
}

function gateContext(docs: RetrievedDoc[]): RetrievedDoc[] {
  return docs.filter(doc => doc.score >= doc.threshold);
}

// Domain 阈值配置
const thresholds = {
  'order': 0.3,       // 订单政策宽松
  'wallet': 0.5,      // 钱包政策严格
  'kyc': 0.7,         // KYC 非常严格（合规风险）
  'product': 0.4,
  'coupon': 0.3,
  'lucky-draw': 0.4,
  'user': 0.5,
  'rag': 0.3,
  'default': 0.4
};
```

#### 2.4.4 Layer 3: Grounding Check（Phase 2+）

```typescript
async function groundingCheck(
  answer: string,
  contextDocs: RetrievedDoc[]
): Promise<{ passed: boolean; ungroundedClaims: string[] }> {
  
  const checkPrompt = `
    You are a grounding verifier. Given the answer and the context documents,
    identify any claims in the answer that are NOT supported by the context.
    
    Context Documents:
    ${contextDocs.map(d => d.content).join('\n---\n')}
    
    Answer: ${answer}
    
    Output:
    - List each ungrounded claim, or
    - "ALL_CLAIMS_GROUNDED" if all claims are supported.
  `;
  
  const result = await llm.complete(checkPrompt);
  return parseGroundingResult(result);
}
```

#### 2.4.5 Layer 4: Consistency Check（Phase 3）

```typescript
async function consistencyCheck(answer: string): Promise<number> {
  // 从不同角度问同一个问题，检查答案是否一致
  const variants = [
    `Summarize the key points: ${answer}`,
    `What would happen if a customer asks about: ${answer}`,
    `Extract all policy statements from: ${answer}`
  ];
  
  const responses = await Promise.all(variants.map(v => llm.complete(v)));
  return computeConsistencyScore(responses);
}
```

#### 2.4.6 Layer 5: HITL（已有计划）

- 用户反馈（👍/👎）→ 低分文档自动标记审查
- 管理面板中的"知识盲区"列表 → 运营人员手动添加文档
- 敏感操作（退款/账户变更）→ 转接人工客服

#### 2.4.7 幻觉防御对比

| 防御层 | 实施阶段 | 幻觉降低率 | 延迟增加 | 维护成本 |
|:------|:--------|:----------|:---------|:---------|
| L1: Prompt Engineering | Phase 1 | ~40% | 0ms | 低 |
| L2: Context Gating | Phase 1 | ~20% | <5ms | 低 |
| L3: Grounding Check | Phase 2 | ~30% | ~500ms | 中 |
| L4: Consistency Check | Phase 3 | ~5% | ~1000ms | 高 |
| L5: HITL | 已计划 | 接近 100% | 人工延迟 | 高 |

### 2.5 更新

#### 2.5.1 问题定义

文档更新后，需要同步更新：
1. **文件系统**：.md 文件内容
2. **数据库记录**：KnowledgeDocument 表
3. **缓存**：Query Cache + Embedding Cache
4. **Embedding 向量**（Phase 2+）：重新生成 embedding

#### 2.5.2 企业级更新流水线

```
文档更新请求
     │
     ▼
┌─────────────────┐
│ 1. 创建新版本    │  ← 自动创建版本快照
└────────┬────────┘
         │
┌────────▼────────┐
│ 2. 更新文档内容  │
└────────┬────────┘
         │
┌────────▼────────┐
│ 3. 递增版本号    │
└────────┬────────┘
         │
┌────────▼────────┐
│ 4. 使缓存失效    │  ← globalPolicyVersion++
└────────┬────────┘
         │
┌────────▼────────┐
│ 5. 重新切片      │  ← Phase 2+: 触发异步重新切片
└────────┬────────┘
         │
┌────────▼────────┐
│ 6. 重新生成      │  ← Phase 2+: 异步生成 embedding
│    Embedding     │
└────────┬────────┘
         │
┌────────▼────────┐
│ 7. 同步翻译版本  │  ← 标记翻译状态为 outdated
└─────────────────┘
```

#### 2.5.3 JoyMini 更新策略

| 更新场景 | Phase 1 | Phase 2+ |
|:---------|:--------|:---------|
| 运营编辑文档 | 直接写文件 | API → DB → 版本快照 → 异步 reindex |
| 批量更新文档 | 手动编辑多个文件 | 批量 API → 队列异步处理 |
| 紧急修复 | 直接编辑文件 | 跳过审核流程，强制发布 |
| 定时发布 | 不支持 | 设置 scheduledPublishAt，定时任务检查 |

#### 2.5.4 增量更新 vs 全量更新

```typescript
// Phase 2+: 增量更新（仅更新变化的切片）
async function incrementalReindex(documentId: string) {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
  const oldChunks = await prisma.knowledgeEmbedding.findMany({ where: { documentId } });
  const newChunks = chunkDocument(doc.content, getStrategy(doc.contentType));
  
  // 找出变化的切片
  const changedChunks = diffChunks(oldChunks, newChunks);
  
  // 仅重新生成变化切片的 embedding
  for (const chunk of changedChunks) {
    const embedding = await generateEmbedding(chunk.content);
    await upsertEmbedding(documentId, chunk, embedding);
  }
  
  // 删除不存在的切片
  const deletedChunks = oldChunks.filter(
    o => !newChunks.find(n => n.chunkIndex === o.chunkIndex)
  );
  for (const chunk of deletedChunks) {
    await prisma.knowledgeEmbedding.delete({ where: { id: chunk.id } });
  }
}
```

#### 2.5.5 原子交换模式

为避免更新过程中出现脏读，使用**原子交换（Atomic Swap）**：

```
触发更新
     │
     ▼
┌──────────────────────┐
│ BEGIN TRANSACTION     │
├──────────────────────┤
│ 1. 创建新版本记录      │
│ 2. 更新文档内容        │
│ 3. 标记旧缓存为脏      │
│ 4. COMMIT              │
└──────────────────────┘
     │
     ▼  (异步)
┌──────────────────────┐
│ 5. 生成新 embedding   │ ← 使用 staging 表
│    (staging 表)       │
├──────────────────────┤
│ 6. BEGIN TRANSACTION  │
│ 7. DELETE old emb     │
│ 8. INSERT new emb     │ ← staging → production
│ 9. COMMIT             │
└──────────────────────┘
```

### 2.6 删除

#### 2.6.1 删除场景

| 场景 | 影响 | 处理方式 |
|:----|:-----|:---------|
| 政策过期 | AI 不应再回答 | 软删除（ARCHIVED） |
| 内容错误 | 需要紧急移除 | 软删除 + 缓存立即失效 |
| 合规要求 | 需要彻底删除 | 硬删除（保留审计日志） |
| 测试文档清理 | 不留痕迹 | 硬删除 |

#### 2.6.2 软删除 vs 硬删除

```
Phase 1（仅文件系统）：
- 软删除：文件移动到 knowledge/_archived/ 目录
- 硬删除：文件直接删除

Phase 2+（数据库管理）：
- 软删除：status → ARCHIVED, deletedAt 不设置（过滤 WHERE status != 'ARCHIVED'）
- 硬删除：实际删除记录，但操作日志保留
```

**软删除的优势**：
1. 可恢复：运营误操作可撤回
2. 历史查询：统计时可包含已归档文档
3. 审计合规：保留所有修改历史

#### 2.6.3 JoyMini Phase 1 删除策略

```typescript
// Phase 1: 文件系统级别的删除处理
async function deleteDocument(docId: string, hardDelete: boolean = false) {
  const filePath = findDocumentPath(docId);
  
  if (hardDelete) {
    await fs.unlink(filePath);
    await cache.invalidate(docId);
  } else {
    // 移动到归档目录
    const archivePath = filePath.replace('/knowledge/', '/knowledge/_archived/');
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    await fs.rename(filePath, archivePath);
    
    // 缓存失效
    await cache.invalidate(docId);
    
    // 记录操作日志
    await logOperation('DELETE', docId, `Document archived: ${docId}`);
  }
}
```

### 2.7 读写

#### 2.7.1 当前状态（Phase 0）

```
只读模式：
AI 查询 → 无 RAG → 仅依赖 Agent Prompt + Tool Calls
```

#### 2.7.2 Phase 1 读写架构

```
写入（开发者手动）：
开发者编辑 .md → git commit → 部署 → 重启应用

读取（AI 自动）：
用户问题 → Intent Router → RagNode:
  1. 读取文件系统缓存
  2. 关键词匹配
  3. LLM 生成回答
```

**写入延迟**：分钟级（需要重新部署）

#### 2.7.3 Phase 2 读写架构

```
┌─────────────────────────────────────────────────────────────┐
│                         Admin Panel                          │
│  (运营人员) → KnowledgeController → KnowledgeService        │
│                                      │                      │
│                                      ▼                      │
│                               Prisma DB                      │
│                          KnowledgeDocument                   │
│                          KnowledgeDocumentVersion            │
│                          KnowledgeEmbedding                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      AI Service (读取端)                     │
│                                                              │
│  RagNode → 读取 DB → 关键词/向量检索 → LLM                   │
│              │                                                │
│              ▼                                               │
│          Cache Layer                                         │
│          L1: Redis Query Cache                               │
│          L2: Embedding Cache (本地 LRU)                      │
└─────────────────────────────────────────────────────────────┘
```

#### 2.7.4 读写分离模式

```
写入端（管理面板）      读取端（AI Service）
┌──────────────┐      ┌──────────────┐
│ Primary DB   │ ──→  │ Cache Layer  │
│ (写)          │      │ (读)          │
└──────────────┘      └──────────────┘

写入流程：
管理面板更新 → Primary DB 写入 → 触发 Cache Invalidation

读取流程：
用户查询 → 检查 Cache → Cache 命中? → 返回
                      → Cache 未命中? → 读取 DB → 更新 Cache → 返回
```

**关键设计**：
- 写入端总是直接操作 DB（通过 Prisma）
- 读取端走缓存（Redis L1 + 内存 L2）
- 写入后通过递增 `policyVersion` 使缓存失效
- 缓存未命中时自动回源 DB

#### 2.7.5 Phase 3 管理面板设计

```
┌─────────────────────────────────────────────────────────────┐
│                     RAG Admin Dashboard                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Document │  │ Version  │  │ Preview  │  │ Analysis │    │
│  │ Manager  │  │ History  │  │ Console  │  │ Dashboard│    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Prompt   │  │ Audit    │  │ Content  │  │ Webhook  │    │
│  │ Manager  │  │ Log      │  │ Calendar │  │ Config   │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 大厂 RAG 落地参考

### 3.1 Amazon — Customer Service RAG

| 方面 | 做法 | JoyMini 借鉴 |
|:----|:-----|:------------|
| 分片 | 语义感知分片，按章节/段落自然边界 | 按 Markdown 标题分片 |
| 检索 | Bedrock Knowledge Base: 向量 + 关键词混合 | Phase 3 混合检索 |
| 引用 | 严格引用溯源，每个回答带文档引用 | Layer 1 Prompt 强制引用 |
| 更新 | S3 触发 → 自动重新切片 + 索引 | 管理面板更新 → 异步 reindex |
| 缓存 | DAX + ElastiCache 多级缓存 | Redis L1 + 内存 L2 + L3 |
| 幻觉 | Grounding Check + 人工审核 HITL | 五层防御模型 |

### 3.2 Shopee / Lazada — Policy Card 模式

| 方面 | 做法 | JoyMini 借鉴 |
|:----|:-----|:------------|
| Policy Card | 每张 Policy Card 包含完整政策描述 + 示例 | 每个文档独立完备 |
| 多语言 | 英语为主，关键政策翻译成当地语言 | Translation 关联表 |
| 检索 | ES 关键词 + embedding 混合 | Phase 3 混合检索 |
| 版本 | 多版本共存，新版本自动生效 | KnowledgeDocumentVersion |
| 审核 | 政策变更需法务审核 | KnowledgeDocumentStatus.IN_REVIEW |

### 3.3 Pinduoduo — Group Buying 专业化 RAG

| 方面 | 做法 | JoyMini 借鉴 |
|:----|:-----|:------------|
| 垂直 RAG | 拼团规则独立 RAG，不与其他混合 | 每个 Domain 独立切片/检索 |
| 规则推理 | 组合多条规则 = 答案 | 多文档组合检索 |
| 实时性 | 规则变更即时生效 | 管理面板写入 → 实时生效 |

---

## 4. JoyMini RAG 成熟度模型

| Level | 名称 | 检索方式 | 缓存 | 管理面板 | 幻觉防御 | 适用场景 |
|:------|:-----|:---------|:-----|:---------|:---------|:---------|
| 0 | No RAG | 无 | 无 | 无 | 仅 Prompt | MVP |
| 1 | Keyword RAG | Fuse.js 模糊搜索 | L1 Query Cache | 无（手动编辑 .md） | L1+L2 | Phase 1 |
| 2 | Semantic RAG | pgvector + bge-m3 | L1+L2+L3 | 基础 CRUD | L1+L2+L3 | Phase 2 |
| 3 | Hybrid RAG | 关键词 + 向量 + Cross-encoder | 全量 | 完整管理面板 | L1-L5 | Phase 3 |

### 各 Level 能力矩阵

| 能力 | Level 0 | Level 1 | Level 2 | Level 3 |
|:----|:--------|:--------|:--------|:--------|
| 政策文档检索 | ❌ | ✅ 关键词 | ✅ 语义 | ✅ 混合 |
| 实时更新 | ❌ | ❌ 需部署 | ✅ API 更新 | ✅ 实时 |
| 版本管理 | ❌ | ❌ | ✅ 基础 | ✅ 完整 |
| 多语言支持 | ❌ | ❌ | ✅ 翻译关联 | ✅ 自动翻译 |
| 幻觉检测 | ❌ | L1+L2 | L1+L2+L3 | L1-L5 |
| 缓存 | ❌ | L1 Query | L1+L2+L3 | 全量 |
| 管理面板 | ❌ | ❌ | ✅ 基础 CRUD | ✅ 完整 |
| A/B 测试 | ❌ | ❌ | ❌ | ✅ |
| 数据分析 | ❌ | ❌ | 基础统计 | ✅ 完整 |

---

## 5. Phase 1 实施计划（Keyword RAG）

### Step 1: 创建 `knowledge/` 目录结构

```
apps/api/src/client/ai-customer/knowledge/
├── order/
│   ├── refund-policy.en.md
│   ├── shipping-policy.en.md
│   ├── order-management.en.md
│   └── order-troubleshooting.en.md
├── coupon/
│   └── coupon-rules.en.md
├── lucky-draw/
│   └── lucky-draw-rules.en.md
├── kyc/
│   └── kyc-guide.en.md
├── product/
│   └── group-buying-guide.en.md
├── user/
│   └── account-guide.en.md
├── common/
│   └── contact-support.en.md
└── _archived/           # 软删除归档目录
```

### Step 2: 实现 RAG 文档加载器

```typescript
// apps/api/src/client/ai-customer/graph/utils/rag-document-loader.ts

interface RAGDocument {
  id: string;
  domain: string;
  title: string;
  content: string;
  keywords: string[];
  locale: string;
}

class RAGDocumentLoader {
  private docs: Map<string, RAGDocument> = new Map();
  private rootPath: string;
  
  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }
  
  async loadAll(): Promise<void> {
    const files = await glob(`${this.rootPath}/**/*.md`, {
      ignore: ['**/_archived/**']
    });
    
    for (const file of files) {
      const doc = await this.parseDocument(file);
      this.docs.set(doc.id, doc);
    }
  }
  
  async reload(docId?: string): Promise<void> {
    if (docId) {
      // 增量加载单个文档
      const file = this.findDocumentFile(docId);
      const doc = await this.parseDocument(file);
      this.docs.set(doc.id, doc);
    } else {
      // 全量重新加载
      await this.loadAll();
    }
  }
  
  private async parseDocument(filePath: string): Promise<RAGDocument> {
    const content = await fs.readFile(filePath, 'utf-8');
    const frontmatter = this.parseFrontmatter(content);
    const body = this.stripFrontmatter(content);
    
    return {
      id: this.extractDocId(filePath),
      domain: this.extractDomain(filePath),
      title: frontmatter.title || this.extractTitle(body),
      content: body,
      keywords: frontmatter.keywords || [],
      locale: frontmatter.locale || 'en'
    };
  }
}
```

### Step 3: 实现关键词检索器

```typescript
// apps/api/src/client/ai-customer/graph/utils/keyword-retriever.ts

interface SearchResult {
  docId: string;
  title: string;
  domain: string;
  matchedSnippet: string;
  score: number;
}

class KeywordRetriever {
  private documents: RAGDocument[];
  
  constructor(documents: RAGDocument[]) {
    this.documents = documents;
  }
  
  search(query: string, domain?: string): SearchResult[] {
    const normalizedQuery = this.normalize(query);
    const queryTerms = normalizedQuery.split(/\s+/);
    
    const results = this.documents
      .filter(doc => !domain || doc.domain === domain)
      .map(doc => ({
        doc,
        score: this.computeRelevance(doc, queryTerms)
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    
    return results.map(({ doc, score }) => ({
      docId: doc.id,
      title: doc.title,
      domain: doc.domain,
      matchedSnippet: this.extractSnippet(doc.content, queryTerms),
      score
    }));
  }
  
  private computeRelevance(doc: RAGDocument, terms: string[]): number {
    let score = 0;
    
    // Title 匹配加权
    for (const term of terms) {
      if (doc.title.toLowerCase().includes(term)) score += 0.4;
    }
    
    // Content 匹配
    for (const term of terms) {
      if (doc.content.toLowerCase().includes(term)) score += 0.2;
    }
    
    // Keywords 匹配
    for (const term of terms) {
      if (doc.keywords.some(k => k.toLowerCase().includes(term))) score += 0.3;
    }
    
    // Domain 匹配加分
    if (doc.domain.toLowerCase().includes(terms[0])) score += 0.1;
    
    return Math.min(score, 1.0);
  }
  
  private normalize(query: string): string {
    return query.toLowerCase().trim();
  }
  
  private extractSnippet(content: string, terms: string[]): string {
    // 找到第一个匹配的关键词附近的一段文字
    for (const term of terms) {
      const idx = content.toLowerCase().indexOf(term);
      if (idx >= 0) {
        const start = Math.max(0, idx - 50);
        const end = Math.min(content.length, idx + 150);
        return (start > 0 ? '...' : '') + content.slice(start, end) + '...';
      }
    }
    return content.slice(0, 200) + '...';
  }
}
```

### Step 4: 实现 RagNode 集成

```typescript
// apps/api/src/client/ai-customer/graph/nodes/rag.node.ts

async function ragNode(
  state: AgentState,
  config: RunnableConfig
): Promise<Partial<AgentState>> {
  const query = state.currentMessage;
  const domain = state.intent?.domain;
  
  // 1. 检索相关文档
  const docs = await retriever.search(query, domain);
  
  // 2. Context Gating (Layer 2)
  const relevantDocs = docs.filter(d => d.score >= threshold);
  
  if (relevantDocs.length === 0) {
    // 无匹配 → 使用兜底文档
    return {
      retrievedDocs: [],
      answer: "I don't have enough information..."
    };
  }
  
  // 3. 构建增强上下文
  const context = relevantDocs
    .map(d => `[${d.docId}]\n${d.matchedSnippet}\n`)
    .join('\n---\n');
  
  // 4. 交给 LLM 生成回答
  const answer = await llm.generate({
    system: buildRAGPrompt(context),
    user: query
  });
  
  return {
    retrievedDocs: relevantDocs,
    answer
  };
}
```

### Step 5: 集成 orchestrator

在 [`orchestrator.node.ts`](../../apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts) 中的 `handleGeneralChat` 函数中，当 intent 路由到 `rag` domain 时调用 RagNode：

```typescript
async function handleGeneralChat(
  state: AgentState,
  config: RunnableConfig
): Promise<Partial<AgentState>> {
  // ... 现有逻辑
  
  if (state.intent?.domain === 'rag' || state.retrievedDocs?.length > 0) {
    // 调用 RagNode
    return ragNode(state, config);
  }
  
  // ... 其他处理
}
```

### Step 6: 修复 Doc 12 Section 2.1

> ✅ **已完成**：`product` Domain 的 RAG 需求从 "≈ 0" 修正为 "3 documents"（拼团指南、团购 FAQ、Product Request 流程）。

详见 [`Doc 12 Section 2.1`](12-知识文档RAG架构分析.md#21-product-domain--rag-需求3-个文档)。

### Step 7: 实现缓存层

```typescript
// apps/api/src/client/ai-customer/graph/utils/rag-cache.ts

class RAGCache {
  private queryCache: Map<string, QueryCacheEntry> = new Map();
  private policyVersion = 1;
  
  async getQuery(query: string, locale: string): Promise<RetrievedDoc[] | null> {
    const key = this.buildKey(query, locale);
    const entry = this.queryCache.get(key);
    
    if (entry && entry.policyVersion === this.policyVersion) {
      return entry.result;
    }
    
    this.queryCache.delete(key);
    return null;
  }
  
  async setQuery(query: string, locale: string, result: RetrievedDoc[]): Promise<void> {
    const key = this.buildKey(query, locale);
    this.queryCache.set(key, {
      query,
      result,
      policyVersion: this.policyVersion,
      expiresAt: Date.now() + 5 * 60 * 1000  // 5 min TTL
    });
  }
  
  invalidateAll(): void {
    this.policyVersion++;
    // 不立即清空缓存，而是让版本检查自然过期
  }
}
```

---

## 6. 验证清单

### Phase 1 验证

| # | 验证项 | 预期结果 |
|:-:|:------|:---------|
| 1 | 文档加载 | 启动时加载所有文档到内存 |
| 2 | 关键词匹配"退款" | 返回 refund-policy 文档 |
| 3 | 关键词匹配"shipping" | 返回 shipping-policy 文档 |
| 4 | 关键词匹配"团购" | 返回 group-buying-guide 文档 |
| 5 | 无匹配查询 | 返回 contact-support 兜底内容 |
| 6 | Domain 过滤 | 设置 domain=order 时只匹配 order 域文档 |
| 7 | 缓存命中 | 相同查询第二次响应时间 < 10ms |
| 8 | 文档更新 | 重启后新文档生效 |
| 9 | 软删除 | 移动到 _archived 后不再被检索 |

**测试命令**：
```typescript
// 1. 测试退款政策查询
const result1 = await retriever.search('How to return an item?', 'order');
assert(result1[0].docId === 'refund-policy');

// 2. 测试运费查询
const result2 = await retriever.search('How much is shipping?', 'order');
assert(result2[0].docId === 'shipping-policy');

// 3. 测试拼团规则查询
const result3 = await retriever.search('How does group buying work?', 'product');
assert(result3[0].docId === 'group-buying-guide');

// 4. 测试兜底
const result4 = await retriever.search('What is the meaning of life?', 'general');
assert(result4[0].docId === 'contact-support');
```

### 长期验证

| 指标 | Phase 1 目标 | Phase 2 目标 | Phase 3 目标 |
|:----|:------------|:------------|:------------|
| 检索准确率 | > 60% | > 75% | > 85% |
| 检索延迟 P50 | < 100ms | < 200ms | < 500ms |
| 检索延迟 P99 | < 500ms | < 1000ms | < 2000ms |
| 用户满意度 | > 70% | > 80% | > 90% |
| 幻觉率 | < 15% | < 8% | < 3% |

---

## 7. RAG Admin 管理面板完整设计

> 本节设计 RAG 的后台管理面板，确保系统达到 **生产级别** 而非 Demo。  
> **审核状态**：经过两轮企业级差距分析，共识别并填补 **18 项差距**。

### 7.1 设计目标

| 目标 | 说明 |
|:----|:-----|
| 零代码操作 | 运营人员无需编辑代码、无需重启服务即可管理知识文档 |
| 端到端生命周期 | 从创建 → 编辑 → 预览 → 审核 → 发布 → 版本管理 → 归档的全流程覆盖 |
| 数据驱动决策 | 提供检索分析、知识盲区发现、用户反馈等数据，帮助运营优化文档质量 |
| 安全可控 | 基于角色的权限控制 + 操作审计日志，符合企业合规要求 |
| 可扩展 | 支持多语言、多版本、批量操作，适应业务增长 |

### 7.2 Prisma 数据模型

```prisma
enum KnowledgeDocumentStatus {
  DRAFT              // 草稿 — 仅管理员可见，AI 不检索
  IN_REVIEW          // 审核中 — 提交给 reviewer 审核
  CHANGES_REQUESTED  // 需修改 — reviewer 退回并要求修改
  APPROVED           // 已批准 — reviewer 批准，等待发布
  PUBLISHED          // 已发布 — AI 可检索
  ARCHIVED           // 已归档 — AI 不再检索，但保留历史
}

/// 文档可见范围：控制哪些用户群体可以看到此文档
enum KnowledgeDocumentVisibility {
  PUBLIC         // 所有用户可见
  AUTHENTICATED  // 仅登录用户可见
  VIP_ONLY       // 仅 VIP 或特定用户段可见
}

model KnowledgeDocument {
  id          String   @id @default(cuid())
  docId       String   @db.VarChar(64)     // 逻辑 ID: refund-policy 不变，版本变化
  domain      String   @db.VarChar(32)     // order / wallet / product / coupon / kyc / lucky-draw / user / rag
  title       String   @db.VarChar(256)
  contentType String   @default("policy")  // policy / how-to / troubleshooting / reference
  status      KnowledgeDocumentStatus @default(DRAFT)
  version     Int      @default(1)         // 递增版本号
  locale      String   @default("en")      // en / tl / ceb
  authorId    String?                       // 最后编辑者
  reviewerId  String?                       // 当前审核人，IN_REVIEW 或 CHANGES_REQUESTED 时有效
  approvedAt  DateTime?                     // 批准时间
  content     String   @db.Text            // Markdown 正文不含 frontmatter
  frontmatter Json?                         // YAML frontmatter 的 JSON 表示
  keywords    String[]                      // 同义词标签数组

  // --- 企业级新增: 内容锁定 ---
  lockedBy      String?                     // 锁定人 ID，防止并发编辑
  lockedAt      DateTime?                   // 锁定时间
  lockExpiresAt DateTime?                   // 锁自动过期时间，默认 30 分钟防死锁

  // --- 企业级新增: 内容排期 ---
  scheduledPublishAt   DateTime?            // 定时发布时间
  scheduledUnpublishAt DateTime?            // 定时下架时间

  // --- 企业级新增: 合规审查 ---
  nextReviewDate DateTime?                  // 计划审核日期，合规要求定期审查
  lastReviewedAt DateTime?                  // 最后审核时间
  expiresAt      DateTime?                  // 文档过期时间，过期后自动 ARCHIVED

  // --- 企业级新增: 文档关系 ---
  parentDocId   String?                     // 父文档 ID, policy 到 sub-policy 层级
  relatedDocIds String[]                    // 相关文档 ID 列表, see also 链接

  // --- 企业级新增: 可见范围控制 ---
  visibility   KnowledgeDocumentVisibility @default(PUBLIC)
  segmentIds   String[]                     // 目标用户段 ID, VIP 策略定向投放

  // --- 企业级新增: 内容健康度 ---
  healthScore   Float    @default(0)        // 0-100, 由 freshness x feedback x search 计算
  chunkCount    Int      @default(0)        // 切片数量, Phase 2+
  searchCount   Int      @default(0)        // 检索次数统计
  feedbackPos   Int      @default(0)        // 正面反馈数
  feedbackNeg   Int      @default(0)        // 负面反馈数

  // 索引与时间
  lastIndexed DateTime?                      // 最后一次生成 embedding 的时间
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // 关联
  translations KnowledgeDocumentTranslation[]
  versions     KnowledgeDocumentVersion[]
  embeddings   KnowledgeEmbedding[]
  reviews      KnowledgeReview[]             // 审核历史
  relations    KnowledgeRelation[]           // 文档关系 from 端
  relatedFrom  KnowledgeRelation[]           // 文档关系 to 端

  @@unique([docId, version])
  @@index([domain, status])
  @@index([status, locale])
  @@index([nextReviewDate])                  // 合规审查查询索引
  @@index([healthScore])                     // 健康度排序
  @@map("knowledge_documents")
}

/// --- 企业级新增模型 ---

/// 文档关系: 支持 see-also / parent-child / supersedes
model KnowledgeRelation {
  id          String @id @default(cuid())
  fromDocId   String                          // 源文档
  toDocId     String                          // 目标文档
  relationType String @db.VarChar(32)         // see-also / parent / child / supersedes

  fromDoc KnowledgeDocument @relation("DocRelationFrom", fields: [fromDocId], references: [id], onDelete: Cascade)
  toDoc   KnowledgeDocument @relation("DocRelationTo", fields: [toDocId], references: [id], onDelete: Cascade)

  @@unique([fromDocId, toDocId, relationType])
  @@index([fromDocId])
  @@index([toDocId])
  @@map("knowledge_relations")
}

/// 文档模板: 预定义每种 content type 的结构
model KnowledgeTemplate {
  id             String @id @default(cuid())
  contentType    String @unique @db.VarChar(32) // policy / how-to / troubleshooting / reference
  name           String @db.VarChar(128)        // 模板名称
  description    String? @db.VarChar(512)       // 模板说明
  structure      Json                           // 模板结构定义, 章节列表
  placeholderDefs Json?                         // 占位符定义, 如 {{business_name}}
  example        String? @db.Text               // 示例文档

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@map("knowledge_templates")
}

/// AI 变更请求: 无匹配查询自动生成草稿建议
model KnowledgeChangeRequest {
  id               String @id @default(cuid())
  sourceQuery      String @db.VarChar(512)      // 触发变更的用户查询
  locale           String @db.VarChar(8)
  domain           String? @db.VarChar(32)      // 推测的 domain
  suggestedTitle   String? @db.VarChar(256)     // AI 建议的标题
  suggestedContent String? @db.Text             // AI 生成的内容草稿
  confidence       Float?                       // AI 置信度
  status           String @default("pending")   // pending / in_progress / completed / rejected
  assignedTo       String?                      // 分配给哪个运营人员
  resultDocId      String?                      // 最终创建的文档 ID
  hitCount         Int @default(1)              // 该查询出现的次数
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([status, assignedTo])
  @@index([domain])
  @@map("knowledge_change_requests")
}

/// Webhook 配置: 文档变更时通知外部系统
model KnowledgeWebhookConfig {
  id        String   @id @default(cuid())
  name      String   @db.VarChar(128)
  url       String   @db.VarChar(1024)
  events    String[]                           // publish / update / archive / review
  secret    String?                            // HMAC 签名密钥
  enabled   Boolean  @default(true)
  lastFired DateTime?
  failCount Int      @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("knowledge_webhook_configs")
}

/// 审核历史: 记录每次审核操作
model KnowledgeReview {
  id          String   @id @default(cuid())
  documentId  String
  version     Int                              // 审核时的文档版本
  reviewerId  String
  action      String   @db.VarChar(32)         // submitted / approved / changes_requested / rejected
  notes       String?  @db.VarChar(1024)
  createdAt   DateTime @default(now())

  document    KnowledgeDocument @relation(fields: [documentId], references: [id])

  @@index([documentId])
  @@index([reviewerId])
  @@map("knowledge_reviews")
}

/// --- ⭐ Prompt 管理系统（企业级新增） ---

/// Prompt 配置: 存储在 DB 中, 替代硬编码的 AgentPromptConfig
model KnowledgePrompt {
  id            String @id @default(cuid())
  name          String @unique @db.VarChar(64)   // prompt 标识名: order-agent / wallet-agent
  displayName   String @db.VarChar(128)          // 显示名: "Order Agent Prompt"
  description   String? @db.VarChar(512)         // 用途说明
  category      String @db.VarChar(32)           // agent / system / intent / auto-reply / rag
  domain        String? @db.VarChar(32)          // 关联的 domain, 可为 null（系统级 prompt）

  // 当前生效版本
  activeVersion Int @default(1)
  // 当前 A/B 测试版本（如启用）
  abTestVersion Int?                              // A/B 测试版本号
  abTraffic     Int? @default(0)                  // A/B 流量百分比 0-100, null=disabled

  status       String @default("active")         // active / inactive / draft / archived
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  versions     KnowledgePromptVersion[]
  testRuns     KnowledgePromptTestRun[]

  @@index([category, status])
  @@index([domain])
  @@map("knowledge_prompts")
}

/// Prompt 版本: 每次编辑自动创建新版本
model KnowledgePromptVersion {
  id            String @id @default(cuid())
  promptId      String
  version       Int                              // 版本号, 递增
  content       String @db.Text                  // prompt 内容（含 {{variable}} 占位符）
  variables     Json?                            // 变量定义: [{name: "tools_list", type: "dynamic", description: "..."}]
  changeLog     String? @db.VarChar(512)         // 编辑备注
  authorId      String?
  metrics       Json?                            // {avgScore, totalRuns, avgLatency, hallucinationRate}
  isActive      Boolean @default(false)          // 是否为当前活跃版本

  prompt        KnowledgePrompt @relation(fields: [promptId], references: [id], onDelete: Cascade)
  createdAt     DateTime @default(now())

  @@unique([promptId, version])
  @@index([promptId])
  @@map("knowledge_prompt_versions")
}

/// Prompt 测试运行: 记录每次 Prompt 测试的结果
model KnowledgePromptTestRun {
  id            String @id @default(cuid())
  promptId      String
  version       Int                              // 测试的版本
  testQuery     String @db.VarChar(512)          // 测试输入
  expectedOutcome String? @db.Text               // 预期输出（可选）
  actualOutput  String? @db.Text                 // 实际 LLM 输出
  score         Float?                           // 人工评分 0-100
  latencyMs     Int?
  passed        Boolean?                         // 是否通过
  createdBy     String?
  createdAt     DateTime @default(now())

  prompt        KnowledgePrompt @relation(fields: [promptId], references: [id], onDelete: Cascade)

  @@index([promptId, version])
  @@map("knowledge_prompt_test_runs")
}

/// --- 原有模型 ---

/// 翻译关联表: 同一篇文档的不同语言版本
model KnowledgeDocumentTranslation {
  id            String @id @default(cuid())
  documentId    String                        // 主文档通常是英文版
  translatedId  String  @unique               // 翻译文档的 ID
  locale        String  @db.VarChar(8)        // tl / ceb
  syncStatus    String  @default("synced")    // synced / outdated / untranslated
  lastSyncedAt  DateTime?
  
  document      KnowledgeDocument @relation(fields: [documentId], references: [id])
  
  @@index([documentId])
  @@map("knowledge_doc_translations")
}

/// 版本历史: 每次编辑自动创建快照
model KnowledgeDocumentVersion {
  id          String   @id @default(cuid())
  documentId  String
  version     Int
  content     String   @db.Text
  frontmatter Json?
  changeLog   String?  @db.VarChar(512)       // 编辑备注
  authorId    String?
  createdAt   DateTime @default(now())

  document    KnowledgeDocument @relation(fields: [documentId], references: [id])

  @@unique([documentId, version])
  @@index([documentId])
  @@map("knowledge_doc_versions")
}

/// 向量 embedding, Phase 2+
model KnowledgeEmbedding {
  id          String   @id @default(cuid())
  documentId  String
  chunkIndex  Int                             // 切片序号
  content     String   @db.Text               // 切片原文
  embedding   Vector?                          // pgvector, 维度 768 bge-m3
  
  document    KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  
  @@index([documentId])
  @@map("knowledge_embeddings")
}

/// 检索日志: 用于分析知识盲区和监控
model KnowledgeQueryLog {
  id          String   @id @default(cuid())
  query       String   @db.VarChar(512)       // 用户原始查询
  locale      String   @db.VarChar(8)
  matchedDoc  String?  @db.VarChar(64)        // 匹配到的 docId, null 表示无匹配
  confidence  Float?                           // 匹配得分
  latencyMs   Int?
  userFeedback String? @default(null)          // helpful / not_helpful / null
  createdAt   DateTime @default(now())
  
  @@index([matchedDoc])
  @@index([createdAt])
  @@map("knowledge_query_logs")
}
```

### 7.3 Admin API 端点设计

遵循项目现有模式：[`apps/api/src/admin/knowledge/`](../../apps/api/src/admin/knowledge/) 目录，使用 `AdminJwtAuthGuard` + `RolesGuard`。

```
Controller: admin/knowledge
Base path:  /admin/knowledge
Auth:       AdminJwtAuthGuard + RolesGuard
```

#### 7.3.1 文档 CRUD

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| GET | `/admin/knowledge` | VIEWER+ | 文档列表，支持分页、按 domain/status/locale 筛选、搜索 |
| GET | `/admin/knowledge/:id` | VIEWER+ | 单个文档详情 |
| POST | `/admin/knowledge` | EDITOR+ | 创建新文档 |
| PUT | `/admin/knowledge/:id` | EDITOR+ | 更新文档内容 |
| DELETE | `/admin/knowledge/:id` | ADMIN+ | 软删除（status → ARCHIVED） |
| PATCH | `/admin/knowledge/:id/status` | EDITOR+ | 变更状态：DRAFT ↔ PUBLISHED |
| POST | `/admin/knowledge/batch` | ADMIN+ | 批量操作（发布/归档/删除） |

#### 7.3.2 版本管理

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| GET | `/admin/knowledge/:id/versions` | VIEWER+ | 版本列表 |
| GET | `/admin/knowledge/:id/versions/:version` | VIEWER+ | 特定版本内容 |
| GET | `/admin/knowledge/:id/versions/:v1/diff/:v2` | VIEWER+ | 两个版本的 diff |
| POST | `/admin/knowledge/:id/rollback/:version` | EDITOR+ | 回滚到指定版本 |

#### 7.3.3 预览与测试

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| POST | `/admin/knowledge/preview` | EDITOR+ | 模拟问答：传入 query，返回检索结果 + AI 回答 |

**Preview 请求体**：
```json
{
  "query": "How to return an item?",
  "locale": "en",
  "content": "# 测试文档\n\nTest content to simulate..."
}
```

**Preview 响应**：
```json
{
  "retrievedDocs": [
    { "docId": "refund-policy", "title": "Refund Policy", "score": 0.92 }
  ],
  "answer": "According to our Refund Policy... [Source: refund-policy.md]",
  "latencyMs": 1250
}
```

#### 7.3.4 分析与监控

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| GET | `/admin/knowledge/stats/overview` | VIEWER+ | 总文档数、发布/草稿/归档数、检索总数 |
| GET | `/admin/knowledge/stats/top-queried` | VIEWER+ | 检索最多的 Top-10 文档 |
| GET | `/admin/knowledge/stats/no-match-queries` | VIEWER+ | 无匹配查询（知识盲区） |
| GET | `/admin/knowledge/stats/feedback` | VIEWER+ | 文档反馈统计（正面/负面） |

#### 7.3.5 Embedding 管理（Phase 2+）

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| POST | `/admin/knowledge/:id/reindex` | ADMIN+ | 重新生成单个文档的 embedding |
| POST | `/admin/knowledge/reindex-all` | ADMIN+ | 重新生成所有文档的 embedding |
| GET | `/admin/knowledge/:id/index-status` | VIEWER+ | 查看索引状态（chunk 数、最后索引时间） |

#### 7.3.6 内容锁定（企业级新增）

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| POST | `/admin/knowledge/:id/lock` | EDITOR+ | 锁定文档，防止并发编辑 |
| POST | `/admin/knowledge/:id/unlock` | EDITOR+ | 解锁文档（拥有者或 ADMIN） |
| GET | `/admin/knowledge/locked` | VIEWER+ | 查看所有锁定中的文档 |

**锁定逻辑**：
```typescript
async function lockDocument(docId: string, userId: string) {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id: docId } });
  
  if (doc.lockedBy && doc.lockedBy !== userId && doc.lockExpiresAt > new Date()) {
    throw new ConflictException(`Document is locked by user ${doc.lockedBy}`);
  }
  
  // 自动续期或锁定
  return prisma.knowledgeDocument.update({
    where: { id: docId },
    data: {
      lockedBy: userId,
      lockedAt: new Date(),
      lockExpiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 分钟
    },
  });
}
```

#### 7.3.7 审核工作流（企业级新增）

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| POST | `/admin/knowledge/:id/submit-review` | EDITOR+ | 提交审核（DRAFT → IN_REVIEW） |
| POST | `/admin/knowledge/:id/approve` | ADMIN+ | 批准（IN_REVIEW → APPROVED → PUBLISHED） |
| POST | `/admin/knowledge/:id/request-changes` | ADMIN+ | 要求修改（IN_REVIEW → CHANGES_REQUESTED） |
| POST | `/admin/knowledge/:id/reject` | ADMIN+ | 拒绝（IN_REVIEW → DRAFT） |
| GET | `/admin/knowledge/reviews/pending` | ADMIN+ | 待审核文档列表 |
| GET | `/admin/knowledge/:id/reviews` | VIEWER+ | 审核历史 |

**审核状态机**：
```
                    ┌──────────────┐
                    │    DRAFT     │
                    └──────┬───────┘
                           │ submit-review
                           ▼
                    ┌──────────────┐
             ┌─────│  IN_REVIEW   │──────┐
             │     └──────┬───────┘      │
             │            │              │
      request-changes    approve     reject
             │            │              │
             ▼            ▼              ▼
    ┌──────────────┐ ┌──────────┐ ┌──────────────┐
    │CHANGES_REQ   │ │ APPROVED │ │    DRAFT     │
    └──────┬───────┘ └────┬─────┘ └──────────────┘
           │              │ auto-publish
           ▼              ▼
      (回到 EDIT)    ┌──────────┐
                     │PUBLISHED │
                     └──────────┘
```

#### 7.3.8 文档关系（企业级新增）

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| POST | `/admin/knowledge/:id/relations` | EDITOR+ | 添加文档关联 |
| DELETE | `/admin/knowledge/:id/relations/:relationId` | EDITOR+ | 删除文档关联 |
| GET | `/admin/knowledge/:id/relations` | VIEWER+ | 查看文档关系图谱 |

**关系类型**：
| 类型 | 含义 | 用途 |
|:----|:-----|:-----|
| see-also | 相关推荐 | "您可能还想了解..." |
| parent | 父子关系 | policy → sub-policy 层级 |
| child | 子文档 | sub-policy → policy |
| supersedes | 替代关系 | 新政策替代旧政策 |

#### 7.3.9 AI 变更请求（企业级新增）

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| GET | `/admin/knowledge/change-requests` | VIEWER+ | 变更请求列表，支持按 status/domain 筛选 |
| GET | `/admin/knowledge/change-requests/:id` | VIEWER+ | 单个变更请求详情 |
| PATCH | `/admin/knowledge/change-requests/:id/assign` | EDITOR+ | 分配给自己或他人 |
| POST | `/admin/knowledge/change-requests/:id/convert` | EDITOR+ | 转换为草稿文档 |
| PATCH | `/admin/knowledge/change-requests/:id/status` | ADMIN+ | 标记为 completed/rejected |

#### 7.3.10 Webhook 配置（企业级新增）

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| GET | `/admin/knowledge/webhooks` | ADMIN+ | Webhook 列表 |
| POST | `/admin/knowledge/webhooks` | ADMIN+ | 创建 Webhook |
| PUT | `/admin/knowledge/webhooks/:id` | ADMIN+ | 更新 Webhook |
| DELETE | `/admin/knowledge/webhooks/:id` | ADMIN+ | 删除 Webhook |
| POST | `/admin/knowledge/webhooks/:id/test` | ADMIN+ | 发送测试事件 |

#### 7.3.11 影响分析（企业级新增）

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| GET | `/admin/knowledge/:id/impact` | VIEWER+ | 文档变更影响分析 |

**影响分析响应**：
```json
{
  "documentId": "refund-policy",
  "versionsAhead": 1,
  "translationsOutdated": [
    { "locale": "tl", "lastSyncedAt": "2026-06-01" },
    { "locale": "ceb", "lastSyncedAt": "2026-05-15" }
  ],
  "relatedDocs": [
    { "docId": "shipping-policy", "relation": "see-also" }
  ],
  "linkedAgents": ["order", "rag"],
  "recentQueriesLast7d": 234,
  "healthScore": 85
}
```

#### 7.3.12 Prompt 管理端点（企业级新增）

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| GET | `/admin/knowledge/prompts` | VIEWER+ | Prompt 列表，按 category/domain/status 筛选 |
| GET | `/admin/knowledge/prompts/:id` | VIEWER+ | Prompt 详情（含当前活跃版本内容） |
| POST | `/admin/knowledge/prompts` | EDITOR+ | 创建新 Prompt |
| PUT | `/admin/knowledge/prompts/:id` | EDITOR+ | 更新 Prompt 元信息 |
| DELETE | `/admin/knowledge/prompts/:id` | ADMIN+ | 软删除 Prompt |

**Prompt 版本端点**：

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| GET | `/admin/knowledge/prompts/:id/versions` | VIEWER+ | 版本列表 |
| GET | `/admin/knowledge/prompts/:id/versions/:version` | VIEWER+ | 特定版本内容 |
| POST | `/admin/knowledge/prompts/:id/versions` | EDITOR+ | 创建新版本 |
| POST | `/admin/knowledge/prompts/:id/activate/:version` | ADMIN+ | 激活指定版本 |
| GET | `/admin/knowledge/prompts/:id/versions/:v1/diff/:v2` | VIEWER+ | 两个版本 diff |
| POST | `/admin/knowledge/prompts/:id/rollback/:version` | ADMIN+ | 回滚到指定版本 |

**Prompt A/B 测试端点**：

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| POST | `/admin/knowledge/prompts/:id/ab-test/start` | ADMIN+ | 启动 A/B 测试 |
| POST | `/admin/knowledge/prompts/:id/ab-test/stop` | ADMIN+ | 停止 A/B 测试 |
| GET | `/admin/knowledge/prompts/:id/ab-test/results` | VIEWER+ | A/B 测试结果 |

**Prompt 测试端点**：

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| POST | `/admin/knowledge/prompts/:id/test` | EDITOR+ | 运行 Prompt 测试 |
| GET | `/admin/knowledge/prompts/:id/test-runs` | VIEWER+ | 测试历史 |

#### 7.3.13 内容日历端点（企业级新增）

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| GET | `/admin/knowledge/calendar` | VIEWER+ | 获取日历事件（定时发布/审核到期/合规审查） |
| GET | `/admin/knowledge/calendar/upcoming` | VIEWER+ | 获取即将到来事件（7 天内） |

#### 7.3.14 通知端点（企业级新增）

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| GET | `/admin/knowledge/notifications` | VIEWER+ | 通知列表 |
| PATCH | `/admin/knowledge/notifications/:id/read` | VIEWER+ | 标记已读 |
| POST | `/admin/knowledge/notifications/read-all` | VIEWER+ | 全部已读 |

**通知类型**：
| 类型 | 触发条件 | 接收者 |
|:----|:---------|:-------|
| review_requested | 文档被提交审核 | REVIEWER 角色用户 |
| changes_requested | 审核退回 | 文档编辑者 |
| approved | 文档被批准 | 文档编辑者 |
| translation_outdated | 源文档更新，翻译过期 | 翻译人员 |
| review_due | 合规审查即将到期 | ADMIN |
| document_expiring | 文档即将过期 | ADMIN/EDITOR |
| ab_test_completed | A/B 测试达到统计显著 | ADMIN |

#### 7.3.15 健康度与合规端点（企业级新增）

| 方法 | 端点 | 角色 | 说明 |
|:----|:-----|:----|:-----|
| GET | `/admin/knowledge/health` | VIEWER+ | 知识库整体健康度概览 |
| GET | `/admin/knowledge/health/low-score` | VIEWER+ | 低健康度文档列表（评分 < 50） |
| GET | `/admin/knowledge/compliance/upcoming-reviews` | VIEWER+ | 即将到期审核文档 |
| GET | `/admin/knowledge/compliance/expired` | VIEWER+ | 已过期文档 |

### 7.4 Prisma Migration 规划

```bash
# Step 1: 在 schema.prisma 中添加所有 Knowledge 模型
# Step 2: 生成迁移
cd apps/api && npx prisma migrate dev --name add_knowledge_models
# Step 3: 生成 Prisma Client
npx prisma generate
# Step 4: 手动创建 pgvector 扩展（Phase 2+）
psql -d joymini -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 7.5 Admin 后端模块结构

```
apps/api/src/admin/knowledge/
├── knowledge.module.ts          # @Module 定义
├── knowledge.controller.ts      # REST API 端点
├── knowledge.service.ts         # 核心业务逻辑
├── knowledge-lock.service.ts    # 内容锁定服务
├── knowledge-review.service.ts  # 审核工作流服务
├── knowledge-webhook.service.ts # Webhook 触发服务
├── knowledge-prompt.service.ts  # Prompt 管理服务
├── knowledge-calendar.service.ts# 内容日历服务
├── knowledge-notification.service.ts # 通知服务
├── dto/
│   ├── create-knowledge.dto.ts
│   ├── update-knowledge.dto.ts
│   ├── query-knowledge.dto.ts
│   ├── preview-knowledge.dto.ts
│   ├── batch-operation.dto.ts
│   ├── create-prompt.dto.ts
│   ├── update-prompt.dto.ts
│   ├── create-prompt-version.dto.ts
│   ├── ab-test.dto.ts
│   ├── create-webhook.dto.ts
│   └── review-action.dto.ts
├── guards/
│   └── knowledge-lock.guard.ts   # 内容锁定守卫
├── interceptors/
│   └── knowledge-audit.interceptor.ts # 审计日志拦截器
└── knowledge.guard.ts           # (可选) 额外的权限校验
```

### 7.6 Admin 前端页面结构

遵循 admin-next 项目模式，在 `apps/admin-next/src/app/(dashboard)/` 下创建页面：

```
apps/admin-next/src/app/(dashboard)/knowledge/
├── page.tsx                        # 文档列表页（主页面）
├── [id]/
│   ├── page.tsx                    # 文档详情 + 编辑页
│   └── versions/
│       └── page.tsx                # 版本历史页
├── prompts/
│   ├── page.tsx                    # Prompt 列表页
│   ├── [id]/
│   │   ├── page.tsx                # Prompt 编辑页
│   │   └── versions/
│   │       └── page.tsx            # Prompt 版本历史页
├── change-requests/
│   └── page.tsx                    # AI 变更请求管理页
├── analytics/
│   └── page.tsx                    # 数据统计 / 健康度仪表盘
├── calendar/
│   └── page.tsx                    # 内容日历视图
└── webhooks/
    └── page.tsx                    # Webhook 配置页

apps/admin-next/src/components/knowledge/
├── KnowledgeListClient.tsx         # 文档列表（表格 + 筛选器）
├── KnowledgeEditor.tsx             # Markdown 编辑器 + Frontmatter 编辑
├── KnowledgePreview.tsx            # 问答预览面板
├── KnowledgeVersionDiff.tsx        # 版本 diff 查看器
├── KnowledgeStats.tsx              # 数据统计面板
├── KnowledgeFeedbackPanel.tsx      # 反馈分析面板
├── KnowledgeHealthScore.tsx        # 健康度评分组件
├── KnowledgeReviewBadge.tsx        # 审核状态徽章
├── KnowledgeLockIndicator.tsx      # 锁定状态指示器
├── KnowledgeImpactPanel.tsx        # 影响分析面板
├── KnowledgeCalendar.tsx           # 内容日历组件
├── KnowledgeNotificationBell.tsx   # 通知铃铛组件
├── PromptEditor.tsx                # Prompt 编辑器（CodeMirror 6）
├── PromptVersionDiff.tsx           # Prompt 版本对比
├── PromptABTestPanel.tsx           # A/B 测试配置面板
├── PromptTestRunner.tsx            # Prompt 测试运行器
└── ChangeRequestList.tsx           # 变更请求列表组件
```

### 7.7 企业级功能清单（18 项差距全覆盖）

#### 7.7.1 P0 — 基础 CRUD（Phase 2 实施）

| 功能 | 描述 | 覆盖差距 |
|:----|:------|:---------|
| 文档列表 | 表格展示所有文档，支持按 domain/status/locale 筛选 + 搜索 | — |
| 创建文档 | Markdown 编辑器 + Frontmatter 表单（title/domain/keywords/type） | — |
| 编辑文档 | 实时 Markdown 预览，自动保存版本快照 | — |
| 软删除 | 标记为 ARCHIVED，AI 不再检索 | — |
| 状态管理 | DRAFT ↔ PUBLISHED 切换 | — |
| 角色权限 | VIEWER 只能查看，EDITOR 可编辑，ADMIN 可删除 | — |

#### 7.7.1 P1 — 提升体验（Phase 2 实施）

| 功能 | 描述 | 覆盖差距 |
|:----|:------|:---------|
| 版本管理 | 每次编辑自动创建版本快照，可查看/回滚 | — |
| 版本 Diff | 两个版本间的内容差异高亮显示 | — |
| 问答预览 | 输入用户问题，模拟 RAG 检索 + LLM 回答 | — |
| 批量操作 | 批量发布/归档/删除 | — |
| 编辑备注 | 每次编辑时记录变更原因 | — |
| ✅ **内容锁定** | 编辑时锁定文档，防止并发编辑冲突 | **差距 1** |
| ✅ **发布工作流** | DRAFT → IN_REVIEW → APPROVED → PUBLISHED | **差距 2** |
| ✅ **内容模板** | 预置文档模板（policy/how-to/troubleshooting/reference） | **差距 3** |

#### 7.7.2 P2 — 数据驱动（Phase 3 实施）

| 功能 | 描述 | 覆盖差距 |
|:----|:------|:---------|
| 检索统计 | 展示每个文档的检索次数、趋势图 | — |
| 知识盲区 | 列出所有无匹配的用户查询，帮助运营发现缺失文档 | — |
| 用户反馈 | 每个文档的 "Was this helpful?" 正面/负面反馈统计 | — |
| Embedding 管理 | 查看索引状态，手动触发重新索引 | — |
| 多语言管理 | 显示翻译进度，标记过期翻译，提示更新 | — |
| ✅ **文档关系** | see-also / parent-child / supersedes 关系管理 | **差距 4** |
| ✅ **全文搜索** | 搜索文档标题和内容，支持高亮关键词 | **差距 5** |
| ✅ **搜索高亮** | 搜索结果中高亮匹配的关键词 | **差距 6** |
| ✅ **影响分析** | 编辑文档时显示影响范围（引用文档、关联 agent） | **差距 7** |

#### 7.7.3 P3 — 高级功能（Phase 3 实施）

| 功能 | 描述 | 覆盖差距 |
|:----|:------|:---------|
| 导入/导出 | 批量导入文档（JSON/MD），导出全部文档 | — |
| 自动翻译 | 调用翻译 API 自动生成多语言版本（人工审核后发布） | — |
| 定时发布 | 设置文档的预定发布时间 | — |
| AI 辅助写作 | 根据已有文档和业务数据，AI 建议文档内容 | — |
| ✅ **Prompt 管理系统** | DB 存储 prompt，版本管理，A/B 测试，可视化编辑器 | **差距 8** |
| ✅ **Prompt 自动化分析** | 自动对比 prompt 版本效果，推荐优化方案 | **差距 9** |
| ✅ **Prompt 版本对比** | 可视化的 prompt 版本 diff | **差距 10** |
| ✅ **合规审查计划** | 设置 nextReviewDate，到期提醒自动审查 | **差距 11** |
| ✅ **文档到期管理** | expiresAt 自动归档过期文档 | **差距 12** |
| ✅ **用户段/可见性** | PUBLIC / AUTHENTICATED / VIP_ONLY 细粒度控制 | **差距 13** |
| ✅ **AI 变更请求** | 无匹配查询自动生成文档草稿建议 | **差距 14** |
| ✅ **Webhook 通知** | 文档变更触发外部系统通知 | **差距 15** |

#### 7.7.4 P3+ — 企业增强（Phase 3 延伸）

| 功能 | 描述 | 覆盖差距 |
|:----|:------|:---------|
| ✅ **内容健康度** | 0-100 评分，由 freshness × feedback × search 自动计算 | **差距 16** |
| ✅ **内容日历** | 日历视图展示定时发布、审核到期、合规审查 | **差距 17** |
| ✅ **通知系统** | 文档变更、审核请求、到期提醒等站内通知 | **差距 18** |
| ✅ **多语言同步工作流** | 源文档更新自动标记翻译为 outdated，提示更新 | **差距 19** |
| ✅ **操作审计日志 UI** | 管理面板内查看知识库操作日志，可追溯 | **差距 20** |
| ✅ **内容分析仪表盘** | 健康度总览、检索趋势、盲区分析、反馈趋势 | **差距 21** |

> **总计识别 21 项企业级差距，全部覆盖。** 其中初始设计已覆盖 12 项，两轮差距分析新识别 9 项。

### 7.8 管理面板 UI 设计

#### 7.8.1 文档列表页（含企业增强）

```
┌─────────────────────────────────────────────────────────────────┐
│  Knowledge Base                                [+ New Doc] [🔔] │
├─────────────────────────────────────────────────────────────────┤
│  [All Domains ▼] [All Status ▼] [All Lang ▼] [Search...] [🔍] │
├───┬──────┬──────┬───────┬──────┬──────┬──────┬────────┬────────┤
│ # │ Title│Status│ Lock  │ Lang │Score │Health│ Actions │        │
├───┼──────┼──────┼───────┼──────┼──────┼──────┼────────┼────────┤
│ 1 │Refund│✅ Pub│  —    │ en    │1,234 │ ████ │ ✏️ 🗑️ │        │
│   │      │      │       │       │      │  92  │        │        │
│ 2 │Ship  │✅ Pub│ 🔒 u2│ en    │ 892  │ ███  │ ✏️ 🗑️ │        │
│   │      │      │       │       │      │  71  │        │        │
│ 3 │Group │📝 Dft│  —    │ en    │   0  │ █    │ ✏️ 🗑️ │        │
│   │      │      │       │       │      │  15  │        │        │
│ 4 │KYC   │🔍 Rev│  —    │ en    │  —   │ ██   │ 📝👁️  │        │
│   │      │ (u3) │       │       │      │  38  │        │        │
│ 5 │KYC TL│📦Arch│  —    │ tl    │  —   │ ██   │ 👁️    │ ⚠️ outdated│
│   │      │      │       │       │      │  25  │        │        │
├───┴──────┴──────┴───────┴──────┴──────┴──────┴────────┴────────┤
│  Page 1 of 3                         [<] [1] [2] [3] [>]       │
│  Knowledge Health: ████████ 78/100  │  Pending Reviews: 3 🟡   │
└─────────────────────────────────────────────────────────────────┘
```

**UI 组件说明**：
- 🔒 = 内容锁定中（悬停显示锁定人和到期时间）
- 🔍 Rev = 审核中状态（IN_REVIEW）
- (u3) = reviewer 为 user3
- ████ = 健康度进度条
- ⚠️ outdated = 翻译版本落后于源文档
- 🔔 = 通知铃铛，显示未读数量

#### 7.8.2 文档编辑页（含企业增强）

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Back to List    Editing: Refund Policy    [Save] [Actions ▼]  │
├──────────────────────────────────────────────────────────────────┤
│  Properties:                              🔒 Locked by: porter   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Domain: [order ▼]  │  Status: [Published ▼]               │  │
│  │ Doc ID: refund-policy │  Version: 3                       │  │
│  │ Keywords: [refund] [return] [退款] [+ Add]                │  │
│  │ Type: [policy ▼]   │  Locale: [en ▼]                     │  │
│  │ Visibility: [PUBLIC ▼]  │  Segment: [All Users ▼]        │  │
│  │ Scheduled Publish: [2026-07-10] [⏰]                      │  │
│  │ Scheduled Unpublish: [2026-12-31] [⏰]                    │  │
│  │ Next Review: [2026-10-01] [📅]  │ Health: ████ 92         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Impact Analysis:                                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ⚠️ 2 translations are outdated (tl, ceb)                   │  │
│  │ ℹ️ Used by agents: order, rag                               │  │
│  │ ℹ️ Related docs: shipping-policy (see-also)                 │  │
│  │ 📊 234 queries in last 7 days                                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Content:                                                         │
│  ┌─────────────── Editor ───────────────┬── Preview ────────────┐ │
│  │ # Refund Policy                     │ # Refund Policy       │ │
│  │                                      │                       │ │
│  │ ## Refund Process                   │ ## Refund Process     │ │
│  │                                      │                       │ │
│  │ To request a refund, contact our     │ To request a...       │ │
│  │ support team within 30 days of       │                       │ │
│  │ delivery.                            │                       │ │
│  └──────────────────────────────────────┴───────────────────────┘ │
│                                                                   │
│  Version History:  [v3 (current)] [v2] [v1]  [Compare]           │
│  Changes from v2: "Updated refund timeline from 14 to 30..."      │
└──────────────────────────────────────────────────────────────────┘
```

#### 7.8.3 问答预览面板

```
┌──────────────────────────────────────────────────────────────────┐
│  Preview: How would AI answer this question?                     │
├──────────────────────────────────────────────────────────────────┤
│  User Query:                                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ How to return an item I bought?                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                         [Test with current]      │
│                                         [Test with unsaved]      │
├──────────────────────────────────────────────────────────────────┤
│  Retrieved Documents:                                            │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ✅ refund-policy (score: 0.92) — Matched keywords:         │  │
│  │    return, refund                                          │  │
│  │ ℹ️  shipping-policy (score: 0.15) — Below threshold        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  AI Response:                                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ To request a refund, please contact our support team       │  │
│  │ within 30 days of delivery. You can start the process      │  │
│  │ by going to your Orders page and selecting "Return".       │  │
│  │                                                             │  │
│  │ [Source: Refund Policy > Refund Process]                    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                          Latency: 1.2s  👍 👎     │
└──────────────────────────────────────────────────────────────────┘
```

#### 7.8.4 Prompt 编辑器 UI

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Back to Prompts    Editing: order-agent    v3 [ACTIVE ▼]      │
├──────────────────────────────────────────────────────────────────┤
│  Properties:                                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Name: order-agent    │  Category: [agent ▼]               │  │
│  │ Display: Order Agent Prompt │  Domain: [order ▼]          │  │
│  │ Status: [active ▼]   │  Version: 3                        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Variables:                                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ {{tools_list}}     → Dynamically resolved from ToolRegistry │  │
│  │ {{domain_name}}    → "order"                                │  │
│  │ {{workflow_steps}} → Dynamically resolved from config       │  │
│  │ {{user_locale}}    → Dynamically resolved from state        │  │
│  │ [Add Variable]                                               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Prompt Content (CodeMirror 6):                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ You are the {{domain_name}} assistant for JoyMini.         │  │
│  │                                                             │  │
│  │ ## Current User                                             │  │
│  │ User ID: {{user_id}}                                        │  │
│  │                                                             │  │
│  │ ## Your Workflow                                            │  │
│  │ {{workflow_steps}}                                          │  │
│  │                                                             │  │
│  │ ## Available Tools                                          │  │
│  │ {{tools_list}}                                              │  │
│  │                                                             │  │
│  │ ## Hard Rules                                               │  │
│  │ 1. Always respond in {{user_locale}}                       │  │
│  │ 2. Never make up information                                │  │
│  │ 3. Always cite sources                                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  A/B Testing:        [Current: v3] [Test: v4] [10% traffic]      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Metric          │ v3 (current) │ v4 (test) │ Status        │  │
│  │ Avg Score       │ 87.2         │ 89.1      │ ✅ Leading    │  │
│  │ Total Runs      │ 1,234        │ 123       │ ⚠️ Low sample │  │
│  │ Avg Latency     │ 1.2s         │ 1.1s      │ —             │  │
│  │ Hallucination % │ 3.1%         │ 2.8%      │ ✅ Lower      │  │
│  │ [Start A/B Test] │ [Stop]       │ [Promote v4] │           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Version History:                                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ v3 (current) │ "Added Tagalog support"         │ 2026-07-05 │  │
│  │ v2           │ "Fixed hallucination rates"     │ 2026-07-01 │  │
│  │ v1           │ "Initial prompt"                │ 2026-06-15 │  │
│  │ [Compare v2 vs v3]                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 7.9 实施阶段

| 阶段 | 后端工作 | 前端工作 | 前置条件 |
|:----|:---------|:---------|:--------|
| Phase 1 | 无管理面板（开发者手动编辑 .md） | 无 | — |
| Phase 2a | Prisma schema + Migration + Admin Module + CRUD API + **内容锁定 + 审核工作流** | 文档列表 + 编辑器（P0+P1 功能） | Phase 1 完成 |
| Phase 2b | 版本管理 API + Preview API + **文档关系 + 模板** | 版本历史 + Diff + 预览面板 + 关系图谱 | Phase 2a 完成 |
| Phase 3a | 检索日志 + 统计 API + Embedding 管理 API + **AI 变更请求 + 影响分析** | 数据统计 + 知识盲区 + 反馈面板 + 影响分析面板 | Phase 2b 完成 |
| Phase 3b | **Prompt 管理系统 + Webhook + 通知 + 内容日历 + 健康度计算** | Prompt 编辑器 + A/B 测试 + Webhook 配置 + 日历视图 + 通知中心 | Phase 3a 完成 |

### 7.10 与现有系统集成

**Admin 模块注册**：
```typescript
// apps/api/src/admin/admin.module.ts
import { KnowledgeModule } from './knowledge/knowledge.module';

@Module({
  imports: [
    // ... existing imports
    KnowledgeModule,  // <-- 新增
  ],
})
```

**Auth Guard 复用**：直接使用现有的 `AdminJwtAuthGuard` + `RolesGuard`，无需新认证逻辑。

**Swagger 文档**：使用 `@ApiTags('Admin - Knowledge Base')` 自动生成 API 文档。

**Operation Log 集成**：所有写操作（创建/编辑/删除/回滚）写入操作日志表，可审计追溯：

```typescript
// knowledge.service.ts 中的示例
async update(id: string, dto: UpdateKnowledgeDto, adminId: string) {
  const old = await this.prisma.knowledgeDocument.findUnique({ where: { id } });
  
  const updated = await this.prisma.knowledgeDocument.update({ ... });
  
  // 记录操作日志
  await this.operationLogService.log({
    action: 'KNOWLEDGE_UPDATE',
    targetId: id,
    detail: `Updated ${old.title}: ${JSON.stringify(changes)}`,
    operatorId: adminId,
  });
  
  // 创建版本快照
  await this.prisma.knowledgeDocumentVersion.create({
    data: {
      documentId: id,
      version: old.version + 1,
      content: dto.content,
      frontmatter: dto.frontmatter,
      authorId: adminId,
    },
  });
  
  // 使缓存失效
  await this.cacheService.invalidateByDocId(id);
  
  return updated;
}
```

**Prompt 集成（Phase 3b）**：修改 `agent-factory.ts` 中的 [`runStandardAgent`](../../apps/api/src/client/ai-customer/graph/nodes/agent-factory.ts) 函数，在构建 prompt 前先检查 DB：

```typescript
// agent-factory.ts 修改点 (Phase 3b)
async function getActivePrompt(promptName: string): Promise<string | null> {
  // 1. 从 DB 获取活跃 prompt
  const prompt = await prisma.knowledgePrompt.findUnique({
    where: { name: promptName },
    include: {
      versions: {
        where: { isActive: true },
        take: 1,
      },
    },
  });
  
  if (prompt?.versions[0]) {
    // 2. 解析 {{variable}} 占位符
    return resolvePromptVariables(prompt.versions[0].content);
  }
  
  // 3. DB 无数据时降级到硬编码
  return null;
}
```

---

### 7.11 Prompt 管理系统设计

> **背景**：当前所有 Agent prompt 硬编码在 TypeScript 文件中（如 [`order-prompt.ts`](../../apps/api/src/client/ai-customer/graph/agents/prompts/order-prompt.ts)、[`wallet-prompt.ts`](../../apps/api/src/client/ai-customer/graph/agents/prompts/wallet-prompt.ts) 等），运营人员无法自行修改。根据企业级需求，prompt 必须存储在 DB 中，并通过管理面板提供编辑能力。

#### 7.11.1 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Prompt 管理系统架构                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  运营人员                                                          │
│     │                                                             │
│     ▼                                                             │
│  ┌──────────────────────────────────────┐                        │
│  │      Admin 管理面板 (PromptEditor)    │                        │
│  │  - CodeMirror 6 编辑器                │                        │
│  │  - 变量面板（{{variable}} 管理）       │                        │
│  │  - A/B 测试配置                       │                        │
│  │  - 版本对比                           │                        │
│  │  - 测试运行器                         │                        │
│  └──────────────┬───────────────────────┘                        │
│                 │                                                │
│                 ▼                                                │
│  ┌──────────────────────────────────────┐                        │
│  │      Prompt Service (Backend)         │                        │
│  │  - CRUD API                          │                        │
│  │  - 版本管理                           │                        │
│  │  - A/B 测试流量分配                   │                        │
│  │  - 性能指标收集                       │                        │
│  └──────────────┬───────────────────────┘                        │
│                 │                                                │
│                 ▼                                                │
│  ┌──────────────────────────────────────┐                        │
│  │      Prisma DB                        │                        │
│  │  KnowledgePrompt                      │                        │
│  │  KnowledgePromptVersion               │                        │
│  │  KnowledgePromptTestRun               │                        │
│  └──────────────────────────────────────┘                        │
│                                                                   │
│  AI Service (运行时)                                               │
│     │                                                             │
│     ▼                                                             │
│  ┌──────────────────────────────────────┐                        │
│  │      PromptResolver (运行时引擎)       │                        │
│  │  - 从 DB 加载 prompt                  │                        │
│  │  - 替换 {{variable}} 占位符            │                        │
│  │  - A/B 测试流量分配                   │                        │
│  │  - 降级到硬编码（DB 不可用）            │                        │
│  └──────────────┬───────────────────────┘                        │
│                 │                                                │
│                 ▼                                                │
│  ┌──────────────────────────────────────┐                        │
│  │      Agent Runner / Intent Builder    │                        │
│  │  - 使用解析后的 prompt 执行 agent      │                        │
│  └──────────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

#### 7.11.2 PromptResolver 运行时引擎

```typescript
// apps/api/src/client/ai-customer/graph/utils/prompt-resolver.ts

interface VariableResolver {
  name: string;
  resolve: (context: ResolutionContext) => Promise<string> | string;
}

interface ResolutionContext {
  userId: string;
  locale: string;
  domain: string;
  state: AgentState;
  config: RunnableConfig;
}

class PromptResolver {
  private variableResolvers: Map<string, VariableResolver> = new Map();
  
  constructor() {
    this.registerBuiltinResolvers();
  }
  
  registerResolver(resolver: VariableResolver): void {
    this.variableResolvers.set(resolver.name, resolver);
  }
  
  async resolve(
    template: string,
    context: ResolutionContext
  ): Promise<string> {
    // 匹配所有 {{variable}} 占位符
    const variablePattern = /\{\{(\w+)\}\}/g;
    const matches = template.matchAll(variablePattern);
    
    let resolved = template;
    for (const match of matches) {
      const [placeholder, varName] = match;
      const resolver = this.variableResolvers.get(varName);
      
      if (resolver) {
        const value = await resolver.resolve(context);
        resolved = resolved.replace(placeholder, value);
      }
      // 未知变量保留原样（或告警）
    }
    
    return resolved;
  }
  
  private registerBuiltinResolvers(): void {
    // 工具列表: 从 ToolRegistry 获取当前 agent 的可用工具
    this.registerResolver({
      name: 'tools_list',
      resolve: (ctx) => {
        const tools = toolRegistry.getToolsByTag(ctx.domain);
        return tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
      },
    });
    
    // 用户 ID
    this.registerResolver({
      name: 'user_id',
      resolve: (ctx) => ctx.userId,
    });
    
    // 用户区域设置
    this.registerResolver({
      name: 'user_locale',
      resolve: (ctx) => ctx.locale || 'en',
    });
    
    // Domain 名称
    this.registerResolver({
      name: 'domain_name',
      resolve: (ctx) => ctx.domain,
    });
    
    // 工作流步骤: 从 agent config 获取
    this.registerResolver({
      name: 'workflow_steps',
      resolve: (ctx) => {
        const agentConfig = AGENT_MAP[ctx.domain];
        return agentConfig?.promptConfig?.workflow || '';
      },
    });
  }
}

// 全局单例
export const promptResolver = new PromptResolver();
```

#### 7.11.3 A/B 测试框架

```typescript
// apps/api/src/client/ai-customer/graph/utils/prompt-ab-test.ts

class PromptABTestManager {
  async getActiveVersion(promptName: string): Promise<{
    version: number;
    content: string;
  }> {
    const prompt = await prisma.knowledgePrompt.findUnique({
      where: { name: promptName },
    });
    
    if (!prompt || !prompt.abTestVersion) {
      // 无 A/B 测试，返回当前活跃版本
      return this.getVersionContent(promptName, prompt.activeVersion);
    }
    
    // 根据流量百分比决定使用哪个版本
    const roll = Math.random() * 100;
    if (roll < prompt.abTraffic) {
      // 命中测试版本
      return this.getVersionContent(promptName, prompt.abTestVersion);
    }
    
    // 命中当前版本
    return this.getVersionContent(promptName, prompt.activeVersion);
  }
  
  async recordMetrics(
    promptName: string,
    version: number,
    metrics: {
      score: number;
      latencyMs: number;
      hallucinationDetected: boolean;
    }
  ): Promise<void> {
    const versionRecord = await prisma.knowledgePromptVersion.findFirst({
      where: {
        prompt: { name: promptName },
        version,
      },
    });
    
    if (!versionRecord) return;
    
    const currentMetrics = (versionRecord.metrics as any) || {
      avgScore: 0,
      totalRuns: 0,
      avgLatency: 0,
      hallucinationRate: 0,
    };
    
    const totalRuns = currentMetrics.totalRuns + 1;
    const newMetrics = {
      avgScore: (currentMetrics.avgScore * currentMetrics.totalRuns + metrics.score) / totalRuns,
      totalRuns,
      avgLatency: (currentMetrics.avgLatency * currentMetrics.totalRuns + metrics.latencyMs) / totalRuns,
      hallucinationRate:
        (currentMetrics.hallucinationRate * currentMetrics.totalRuns + (metrics.hallucinationDetected ? 1 : 0)) /
        totalRuns,
    };
    
    await prisma.knowledgePromptVersion.update({
      where: { id: versionRecord.id },
      data: { metrics: newMetrics },
    });
  }
}
```

#### 7.11.4 当前 Prompt 迁移清单

以下是在 TypeScript 中硬编码、需要迁移到 DB 的 prompt：

| # | 当前文件 | Prompt 名称 | Category | 变量 |
|:-:|:---------|:------------|:---------|:-----|
| 1 | `order-prompt.ts` | order-agent | agent | `{{tools_list}}`, `{{workflow_steps}}`, `{{domain_name}}` |
| 2 | `wallet-prompt.ts` | wallet-agent | agent | `{{tools_list}}`, `{{workflow_steps}}`, `{{domain_name}}` |
| 3 | `coupon-prompt.ts` | coupon-agent | agent | `{{tools_list}}`, `{{workflow_steps}}`, `{{domain_name}}` |
| 4 | `user-prompt.ts` | user-agent | agent | `{{tools_list}}`, `{{workflow_steps}}`, `{{domain_name}}` |
| 5 | `product-prompt.ts` | product-agent | agent | `{{tools_list}}`, `{{workflow_steps}}`, `{{domain_name}}` |
| 6 | `lucky-prompt.ts` | lucky-draw-agent | agent | `{{tools_list}}`, `{{workflow_steps}}`, `{{domain_name}}` |
| 7 | `kyc-prompt.ts` | kyc-agent | agent | `{{tools_list}}`, `{{workflow_steps}}`, `{{domain_name}}` |
| 8 | `intent-prompt-builder.ts` | intent-classifier | system | `{{examples}}`, `{{domains}}` |
| 9 | `synthesizer-prompt.ts` | answer-synthesizer | system | `{{answers}}`, `{{format}}` |
| 10 | `general-chat-prompt.ts` | general-chat | system | — |
| 11 | `intent-examples/*.ts` | intent-examples-* | intent | `{{examples}}` |
| 12 | `auto-reply/*.ts` | auto-reply-* | auto-reply | — |
| 13 | RAG prompt (TBD) | rag-retriever | rag | `{{retrieved_docs}}`, `{{user_question}}` |

#### 7.11.5 实现难度评估

| 组件 | 难度 | 工时估算 | 说明 |
|:----|:-----|:---------|:-----|
| Backend: Prisma 模型 | 低 | 0.5 天 | 标准 CRUD 模式 |
| Backend: CRUD API | 低 | 1 天 | 与 KnowledgeDocument 类似的模式 |
| Backend: PromptResolver | 中 | 1.5 天 | 变量解析引擎，需注入 AgentState 上下文 |
| Backend: A/B 测试框架 | 中 | 1 天 | 流量分配 + 指标收集 |
| Frontend: PromptEditor | 中-高 | 2 天 | CodeMirror 6 集成 + 变量高亮 + 分段编辑 |
| Frontend: 版本对比 | 中 | 1 天 | diff 视图 + 回滚操作 |
| Frontend: A/B 测试面板 | 中 | 1 天 | 配置 + 结果展示 |
| Frontend: 测试运行器 | 中 | 1 天 | 输入查询 → 显示输出 → 评分 |
| Prompt 数据迁移 | 中 | 1 天 | 将现有 ~25 个 prompt 迁移到 DB seed |
| Agent 运行时集成 | 中 | 1 天 | 修改 agent-factory.ts 集成 PromptResolver |
| **总计** | | **~11 天** | |

### 7.12 企业级差距分析文档

> 本节记录两轮差距分析的完整结果。

#### 7.12.1 第一轮差距分析（12 项）

| # | 差距 | 影响 | 优先级 | 解决方案 |
|:-:|:-----|:-----|:-------|:---------|
| 1 | **无发布审核工作流** | 运营可直接发布，无 QA 环节，错误政策影响用户体验 | P1 | 添加 IN_REVIEW/CHANGES_REQUESTED/APPROVED 状态 + 审核 API |
| 2 | **无内容锁定** | 多人同时编辑同一文档导致内容覆盖丢失 | P1 | 添加 lockedBy/lockedAt/lockExpiresAt 字段 + lock/unlock API |
| 3 | **无定时发布/下架** | 运营需手动在指定时间发布，易遗漏 | P2 | 添加 scheduledPublishAt/scheduledUnpublishAt 字段 + cron job |
| 4 | **无合规审查计划** | 政策文档可能过期却不自知，合规风险 | P2 | 添加 nextReviewDate/expiresAt 字段 + 审查提醒通知 |
| 5 | **无文档模板** | 每种文档类型结构不一致，运营使用困难 | P2 | 添加 KnowledgeTemplate 模型 + 模板选择 UI |
| 6 | **无文档关系** | 无法设置 see-also/parent-child 关联 | P2 | 添加 KnowledgeRelation 模型 + 关系图谱 UI |
| 7 | **无全文搜索** | 文档列表仅支持 domain/status 筛选，无法搜索 | P1 | 添加 Prisma 全文搜索 + search highlight |
| 8 | **无搜索高亮** | 搜索结果中看不到匹配关键词位置 | P2 | 后端返回 snippet + 前端高亮 |
| 9 | **无健康度评分** | 无法量化文档质量，不知道哪些文档需要优化 | P3 | 根据 freshness × feedback × search 计算 0-100 分 |
| 10 | **无可见性控制** | 所有文档对所有用户可见，无法做 VIP 策略 | P3 | 添加 KnowledgeDocumentVisibility + segmentIds |
| 11 | **无 AI 变更请求** | 知识盲区的用户查询无法自动转化为文档需求 | P3 | 添加 KnowledgeChangeRequest 模型 + convert API |
| 12 | **无 Webhook** | 文档变更时无法通知外部系统（CMS/翻译平台） | P3 | 添加 KnowledgeWebhookConfig 模型 + 事件触发 |

#### 7.12.2 第二轮差距分析（9 项）

| # | 差距 | 影响 | 优先级 | 解决方案 |
|:-:|:-----|:-----|:-------|:---------|
| 13 | **无 Prompt 管理系统** | Prompt 硬编码在 TypeScript 中，运营无法修改 | P1 | 添加 KnowledgePrompt + KnowledgePromptVersion 模型 + 管理面板 |
| 14 | **无 Prompt 版本对比** | 无法追踪 prompt 变更历史，回滚困难 | P2 | 版本对比 UI + rollback API |
| 15 | **无 Prompt A/B 测试** | 无法量化 prompt 改动对用户体验的影响 | P3 | A/B 测试框架 + 指标收集 |
| 16 | **无操作审计日志 UI** | 管理面板中看不到知识库操作日志 | P2 | 添加审计日志页面 + 操作可追溯 |
| 17 | **无多语言同步工作流** | 源文档更新后翻译版本不同步，用户看到过时信息 | P2 | syncStatus + 过期标记 + 提醒通知 |
| 18 | **无内容分析仪表盘** | 缺少健康度总览、检索趋势等可视化数据 | P3 | 添加 KnowledgeHealthScore + analytics dashboard |
| 19 | **无通知系统** | 审核请求/到期提醒无法触达运营人员 | P2 | 站内通知 + 通知 API |
| 20 | **无内容日历** | 无法在日历视图上看到定时发布和审查计划 | P3 | Calendar API + 日历 UI 组件 |
| 21 | **无影响分析** | 编辑文档时不知道会影响哪些翻译/agent/引用 | P2 | 影响分析 API + 编辑页面嵌入面板 |

### 7.13 内容日历

> 企业级内容运营需要日历视图来规划文档发布、审查和过期管理。

**功能需求**：

| 功能 | 描述 |
|:----|:------|
| 日历视图 | 月视图/周视图展示所有知识库事件 |
| 事件类型 | 定时发布、定时下架、合规审查到期、文档过期 |
| 过滤器 | 按 domain/status/事件类型 筛选 |
| 操作 | 从日历事件直接跳转到文档编辑页 |
| 概览统计 | 本月发布数、即将到期数、待审核数 |

**数据源**：
```
SELECT id, title, scheduledPublishAt AS eventDate, 'publish' AS eventType
FROM knowledge_documents WHERE scheduledPublishAt IS NOT NULL

UNION ALL

SELECT id, title, scheduledUnpublishAt, 'unpublish'
FROM knowledge_documents WHERE scheduledUnpublishAt IS NOT NULL

UNION ALL

SELECT id, title, nextReviewDate, 'review'
FROM knowledge_documents WHERE nextReviewDate IS NOT NULL

UNION ALL

SELECT id, title, expiresAt, 'expire'
FROM knowledge_documents WHERE expiresAt IS NOT NULL
```

### 7.14 通知系统

> 站内通知系统，确保运营人员不会错过审核请求和到期提醒。

**通知模型（复用或独立）**：

```prisma
/// 知识库通知（可复用现有的通知机制）
model KnowledgeNotification {
  id          String   @id @default(cuid())
  type        String   @db.VarChar(64)     // review_requested / approved / changes_requested / review_due / document_expiring / translation_outdated
  title       String   @db.VarChar(256)
  message     String?  @db.VarChar(1024)
  targetId    String?                       // 关联的文档 ID
  targetType  String?  @db.VarChar(32)     // document / prompt / change_request
  recipientId String                        // 接收人 ID
  isRead      Boolean  @default(false)
  createdAt   DateTime @default(now())
  
  @@index([recipientId, isRead])
  @@index([type])
  @@map("knowledge_notifications")
}
```

**通知触发场景**：

| 触发条件 | 时机 | 接收者 |
|:---------|:-----|:-------|
| 文档提交审核 (IN_REVIEW) | 即时 | 所有 REVIEWER 角色 |
| 审核通过/拒绝 | 即时 | 文档编辑者 |
| 翻译过期 | 检测到源文档更新时 | 翻译管理人员 |
| 合规审查前 7 天 | 每日 cron 检查 | ADMIN |
| 文档到期前 3 天 | 每日 cron 检查 | 文档编辑者 |
| A/B 测试完成 | 统计显著时 | ADMIN |

### 7.15 多语言同步工作流

> 确保多语言文档在源文档更新后保持同步。

**状态流转**：

```
源文档更新
     │
     ▼
┌──────────────────────┐
│ 标记翻译为 outdated   │ ← syncStatus = "outdated"
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 创建通知给翻译人员     │ ← 通知: translation_outdated
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 翻译人员更新内容       │
├──────────────────────┤
│ 或点击 "自动翻译"      │ ← 调用翻译 API 生成草稿
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 标记为 synced         │ ← syncStatus = "synced"
└──────────────────────┘
```

**前端 UI 指示**：
- 文档列表中：翻译版本旁显示 ⚠️ outdated 徽章
- 编辑器影响分析中：列出所有过期的翻译版本
- 翻译管理页面：按 syncStatus 筛选，批量操作

---

## 8. 完整文件修改清单

### Phase 1 文件清单（当前步骤）

| # | 文件 | 操作 | 说明 |
|:-:|:----|:----|:-----|
| 1 | `apps/api/src/client/ai-customer/knowledge/` | **新建目录** | 知识文档根目录 |
| 2 | `knowledge/order/refund-policy.en.md` | **新建** | P0 文档 |
| 3 | `knowledge/order/shipping-policy.en.md` | **新建** | P0 文档 |
| 4 | `knowledge/order/order-management.en.md` | **新建** | P0 文档 |
| 5 | `knowledge/order/order-troubleshooting.en.md` | **新建** | P0 文档 |
| 6 | `knowledge/coupon/coupon-rules.en.md` | **新建** | P0 文档 |
| 7 | `knowledge/lucky-draw/lucky-draw-rules.en.md` | **新建** | P0 文档 |
| 8 | `knowledge/kyc/kyc-guide.en.md` | **新建** | P0 文档 |
| 9 | `knowledge/product/group-buying-guide.en.md` | **新建** | P0 文档 |
| 10 | `knowledge/user/account-guide.en.md` | **新建** | P0 文档 |
| 11 | `knowledge/common/contact-support.en.md` | **新建** | P0 文档（兜底） |
| 12 | `apps/api/src/client/ai-customer/graph/utils/rag-document-loader.ts` | **新建** | 文档加载器 |
| 13 | `apps/api/src/client/ai-customer/graph/utils/keyword-retriever.ts` | **新建** | 关键词检索器 |
| 14 | `apps/api/src/client/ai-customer/graph/utils/rag-cache.ts` | **新建** | RAG 缓存层 |
| 15 | `apps/api/src/client/ai-customer/graph/nodes/rag.node.ts` | **新建** | RagNode 实现 |
| 16 | `apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts` | **修改** | 集成 RagNode |

### Phase 2 文件清单（管理面板 + 企业级功能）

| # | 文件 | 操作 | 说明 |
|:-:|:----|:----|:-----|
| 1 | `apps/api/prisma/schema.prisma` | **修改** | 添加所有 Knowledge 模型（含 Prompt 模型） |
| 2 | `apps/api/src/admin/knowledge/knowledge.module.ts` | **新建** | Admin 模块 |
| 3 | `apps/api/src/admin/knowledge/knowledge.controller.ts` | **新建** | REST API（含企业级端点） |
| 4 | `apps/api/src/admin/knowledge/knowledge.service.ts` | **新建** | 核心业务逻辑 |
| 5 | `apps/api/src/admin/knowledge/knowledge-lock.service.ts` | **新建** | 内容锁定服务 |
| 6 | `apps/api/src/admin/knowledge/knowledge-review.service.ts` | **新建** | 审核工作流服务 |
| 7 | `apps/api/src/admin/knowledge/knowledge-webhook.service.ts` | **新建** | Webhook 触发服务 |
| 8 | `apps/api/src/admin/knowledge/knowledge-prompt.service.ts` | **新建** | Prompt 管理服务 |
| 9 | `apps/api/src/admin/knowledge/knowledge-calendar.service.ts` | **新建** | 内容日历服务 |
| 10 | `apps/api/src/admin/knowledge/knowledge-notification.service.ts` | **新建** | 通知服务 |
| 11 | `apps/api/src/admin/knowledge/dto/*.ts` | **新建** | 10-12 个 DTO 文件 |
| 12 | `apps/api/src/admin/knowledge/guards/knowledge-lock.guard.ts` | **新建** | 内容锁定守卫 |
| 13 | `apps/api/src/admin/knowledge/interceptors/knowledge-audit.interceptor.ts` | **新建** | 审计日志拦截器 |
| 14 | `apps/api/src/admin/admin.module.ts` | **修改** | 注册 KnowledgeModule |
| 15 | `apps/api/src/client/ai-customer/graph/utils/prompt-resolver.ts` | **新建** | Prompt 运行时解析引擎 |
| 16 | `apps/api/src/client/ai-customer/graph/utils/prompt-ab-test.ts` | **新建** | A/B 测试框架 |
| 17 | `apps/api/src/client/ai-customer/graph/nodes/agent-factory.ts` | **修改** | 集成 PromptResolver |

### Phase 2 前端文件清单

| # | 文件 | 操作 | 说明 |
|:-:|:----|:----|:-----|
| 1 | `apps/admin-next/src/app/(dashboard)/knowledge/page.tsx` | **新建** | 文档列表页 |
| 2 | `apps/admin-next/src/app/(dashboard)/knowledge/[id]/page.tsx` | **新建** | 编辑页 |
| 3 | `apps/admin-next/src/app/(dashboard)/knowledge/prompts/page.tsx` | **新建** | Prompt 列表 |
| 4 | `apps/admin-next/src/app/(dashboard)/knowledge/prompts/[id]/page.tsx` | **新建** | Prompt 编辑器 |
| 5 | `apps/admin-next/src/app/(dashboard)/knowledge/change-requests/page.tsx` | **新建** | 变更请求管理 |
| 6 | `apps/admin-next/src/app/(dashboard)/knowledge/analytics/page.tsx` | **新建** | 分析仪表盘 |
| 7 | `apps/admin-next/src/app/(dashboard)/knowledge/calendar/page.tsx` | **新建** | 内容日历 |
| 8 | `apps/admin-next/src/app/(dashboard)/knowledge/webhooks/page.tsx` | **新建** | Webhook 配置 |
| 9 | `apps/admin-next/src/components/knowledge/KnowledgeListClient.tsx` | **新建** | 文档列表组件 |
| 10 | `apps/admin-next/src/components/knowledge/KnowledgeEditor.tsx` | **新建** | 编辑器组件 |
| 11 | `apps/admin-next/src/components/knowledge/KnowledgePreview.tsx` | **新建** | 预览面板 |
| 12 | `apps/admin-next/src/components/knowledge/KnowledgeVersionDiff.tsx` | **新建** | 版本对比 |
| 13 | `apps/admin-next/src/components/knowledge/KnowledgeStats.tsx` | **新建** | 统计面板 |
| 14 | `apps/admin-next/src/components/knowledge/KnowledgeFeedbackPanel.tsx` | **新建** | 反馈面板 |
| 15 | `apps/admin-next/src/components/knowledge/KnowledgeHealthScore.tsx` | **新建** | 健康度评分 |
| 16 | `apps/admin-next/src/components/knowledge/KnowledgeReviewBadge.tsx` | **新建** | 审核状态徽章 |
| 17 | `apps/admin-next/src/components/knowledge/KnowledgeLockIndicator.tsx` | **新建** | 锁定指示器 |
| 18 | `apps/admin-next/src/components/knowledge/KnowledgeImpactPanel.tsx` | **新建** | 影响分析面板 |
| 19 | `apps/admin-next/src/components/knowledge/KnowledgeCalendar.tsx` | **新建** | 日历组件 |
| 20 | `apps/admin-next/src/components/knowledge/KnowledgeNotificationBell.tsx` | **新建** | 通知铃铛 |
| 21 | `apps/admin-next/src/components/knowledge/PromptEditor.tsx` | **新建** | Prompt 编辑器 |
| 22 | `apps/admin-next/src/components/knowledge/PromptVersionDiff.tsx` | **新建** | Prompt 版本对比 |
| 23 | `apps/admin-next/src/components/knowledge/PromptABTestPanel.tsx` | **新建** | A/B 测试面板 |
| 24 | `apps/admin-next/src/components/knowledge/PromptTestRunner.tsx` | **新建** | 测试运行器 |
| 25 | `apps/admin-next/src/components/knowledge/ChangeRequestList.tsx` | **新建** | 变更请求列表 |
| 26 | `apps/admin-next/src/api/knowledge.ts` | **新建** | API 客户端 |

---

## 🔜 下一步

1. **Phase 1 实施**：创建 11 个 P0 文档 + RagNode + 关键词检索 + 缓存
2. **Phase 2a 实施**：Prisma schema migration + Admin CRUD API + 基础管理面板（含内容锁定 + 审核工作流）
3. **Phase 2b 实施**：版本管理 + 预览面板 + 文档关系 + 模板
4. **Phase 3a 实施**：检索日志 + 统计 API + Embedding 管理 + AI 变更请求 + 影响分析
5. **Phase 3b 实施**：Prompt 管理系统 + Webhook + 通知 + 内容日历 + 健康度计算
