---
name: ai-intent-debug
description: Step-by-step guide for debugging AI customer service intent classification issues — data integrity, BM25 search, embedding provider chain, pgvector similarity analysis
user-invocable: true
---

# AI 意图分类排查 Skill（教学模式）

## 适用场景

用户反馈消息被错误路由到人工客服，或意图分类不准。

## 排查流程（4 层检查法）

---

### 第一层：数据完整性检查

**问题**：intent_examples 表的数据是否完整？

执行 SQL：

```sql
-- 检查各 domain 的行数和 embedding 是否正常
SELECT domain, COUNT(*) as count,
       COUNT(embedding) as with_embedding,
       COUNT(*) - COUNT(embedding) as null_embedding
FROM intent_examples
GROUP BY domain ORDER BY count DESC;

-- 检查向量维度是否一致（应该全是 1024）
SELECT domain, COUNT(*) as cnt
FROM intent_examples
WHERE vector_dims(embedding) != 1024
GROUP BY domain;
```

**判断**：

- ✅ 所有 domain 都有数据，embedding 非 NULL → 进入第二层
- ❌ 某个 domain 缺失或 embedding 为 NULL → 需要 reindex 该 domain
- ❌ 维度不一致 → embedding 模型切换导致，需要全部 reindex

**实际案例**：本次排查确认所有 511 条数据完整、维度都是 1024 → 排除数据丢失

---

### 第二层：BM25/Meilisearch 索引检查

**问题**：Meilisearch 是否正确索引了意图例句？

```bash
# 查 human_support 有没有被索引
curl -s "http://localhost:7700/indexes/intent_examples/search?q=transfer&limit=3" \
  -H 'Authorization: Bearer dev-master-key'

# 查中文查询能不能匹配到任何内容
curl -s "http://localhost:7700/indexes/intent_examples/search?q=%E4%BC%98%E6%83%A0&limit=3" \
  -H 'Authorization: Bearer dev-master-key'

# 查看索引中的文档列表
curl -s "http://localhost:7700/indexes/intent_examples/documents" \
  -H 'Authorization: Bearer dev-master-key'
```

**判断**：

- ✅ 英文关键词（transfer）能命中 human_support → BM25 索引正常
- ❌ 中文查询 0 命中 → 这是正常的，因为例句全是英文

**实际案例**：搜索 "transfer me" 返回 human_support 第1名 ✅；搜索 "优惠" 返回 0 命中 ✅（正常，例句是英文）

---

### 第三层：Embedding Provider 链路检查

**问题**：当前用什么模型生成向量？和存储向量时用的模型一致吗？

检查 `.env.dev`：

```bash
grep -E "INFINITY|JINA|OLLAMA" deploy/.env.dev
```

检查 `apps/api/src/common/ai/ai.service.ts` 中 providers 顺序：

```typescript
this.providers = [
  this.geminiProvider, // 无 generateEmbedding
  this.groqProvider, // 无 generateEmbedding
  this.infinityProvider, // ← 第一个有 generateEmbedding 的 provider
  this.jinaProvider,
  this.ollamaProvider,
  this.deepSeekProvider,
];
```

`AiService.generateEmbedding()` 用 `.find()` 找第一个 `isAvailable()` 且支持 embedding 的 provider。

**判断**：

- ✅ 当前 provider = 存储时的 provider → 向量空间一致 → 进第四层
- ❌ 当前 provider ≠ 存储时的 provider → 向量空间不兼容 → 全部 reindex

**实际案例**：Infinity 排在 Jina 前面，`INFINITY_EMBEDDING_BASE_URL` 已配置 → 当前用 Infinity(bge-m3)。用户确认所有向量都是 Infinity 生成 → 排除模型不兼容

---

### 第四层：运行时 pgvector TOP-5 分析

**问题**：用户消息到底匹配到了什么？

在服务端日志中搜索 `[IntentClassifier] pgvector raw TOP-5`：

```
[Nest] ... LOG [IntentClassifier] pgvector raw TOP-5:
  1. human_support (0.5334) "Connect me with customer service"
  2. human_support (0.5319) "I want to make a complaint"
```

同时搜索 `[IntentClassifier] BM25 search`：

```
[Nest] ... LOG [IntentClassifier] BM25 search took 1287ms, 0 results
```

**判断**：

| pgvector TOP-5                | BM25 结果          | 问题                                               | 修复               |
| ----------------------------- | ------------------ | -------------------------------------------------- | ------------------ |
| 全是 human_support（0.5~0.6） | 0 命中             | 中文查询在英文例句中走语义匹配，误入 human_support | 加翻译或加中文例句 |
| 全是 human_support（0.5~0.6） | 命中其他 domain    | BM25 能纠正，但 pgvector 分数高过了 BM25           | 调整融合逻辑       |
| 正常多 domain 分布            | 正常命中           | 系统正常                                           | 检查其他环节       |
| 全是 human_support（0.8+）    | 命中 human_support | 用户确实在转人工                                   | 正常 ✅            |

**实际案例**：

- "优惠" → pgvector TOP-5 全是 human_support(0.51~0.53) + BM25 0 命中 → **中文查询误匹配**
- "KYC状态" → pgvector TOP-5 全是 human_support(0.41~0.48) + BM25 命中 rag/kyc → **BM25 兜底成功**
- "便宜的商品" → pgvector TOP-5 全是 human_support(0.50~0.54) + BM25 0 命中 → **中文查询误匹配**

---

## 常见根因速查表

| 症状                                 | 根因                                   | 修复方案                             |
| ------------------------------------ | -------------------------------------- | ------------------------------------ |
| 某 domain 永远不匹配                 | `intent_examples` 表中该 domain 无向量 | Reindex 该 domain                    |
| 所有查询 → human_support             | embedding 模型切换（Jina→Infinity 等） | 全部 reindex                         |
| 中文查询 → human_support（英文正常） | BM25 无法匹配中文 vs 英文例句          | 在 BM25 前加 LLM 翻译                |
| 分数刚过 0.5 阈值导致误判            | 阈值过低                               | 提高阈值或加 BM25 惩罚               |
| 某 domain 分数异常低                 | 向量维度不一致或模型不同               | 检查 `vector_dims()` + provider 链路 |

## 本次排查完整流程（参考）

```
用户反馈 "优惠" 走了人工
  ↓ 第1层：SQL 查 intent_examples → 511条数据完整 ✅
  ↓ 第2层：curl 查 Meilisearch → human_support 已索引 ✅
  ↓ 第3层：检查 provider 顺序 → Infinity 排 Jina 前面
           用户确认全用 Infinity 生成 → 模型一致 ✅
  ↓ 第4层：查日志 TOP-5 → 全是 human_support(0.51~0.53)
           BM25 0 命中 → 中文 vs 英文例句不匹配
  ↓ 根因：中文"优惠"在 bge-m3 语义空间中离 human_support 最近
           BM25 无中文例句可匹配，pgvector 分数刚过 0.5 阈值
  ↓ 修复：BM25 搜索前加 LLM 翻译（"优惠"→"discount"）
           翻译失败时用 BM25 惩罚降权 human_support
```
