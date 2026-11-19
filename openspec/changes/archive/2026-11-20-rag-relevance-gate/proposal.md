# Proposal

## Why

当前 RAG 对域外问题仍返回候选并编造回答：129 题评测中 20 道负样本误召回率 100%。负样本没有任何关键词层命中，而正样本 98/109 有关键词命中；结合 rerank 分数可以在不引入新模型的前提下拒答。

## What Changes

- 增加相关性门卫：**关键词层无候选且 rerank 最高分 < 阈值**时返回空结果
- 阈值可配置：`RAG_RERANK_MIN_SCORE`，默认 **0.131**（由正/负样本分布校准）
- 门卫只在 rerank 成功时生效；reranker 不可用走 RRF 时不套用该阈值
- 检索日志记录门卫拦截与原因

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ai-customer/rag-retrieval`: 增加「无关问题必须拒答」的行为要求

## Impact

- `apps/api/src/client/ai-customer/knowledge/rag-retrieval.service.ts`
- 评测报告 `tools/eval/rag/`
- 不新增依赖、不改数据库、不影响关键词/向量召回本身
