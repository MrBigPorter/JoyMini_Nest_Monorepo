# Proposal

## Why

中文问题在进入检索前就被丢掉：`tokenize()` 的正则 `[^\w\s]` 把 CJK 全部替换成空格，`怎么退货？` 得到空 token。结果是 Layer 2（chunk 关键字）被整层跳过、Layer 3（文档 keywords）拿到空 token 返回空——中文 query 实际只剩向量检索和重排在工作。

同时，现有 RAG 评测只有 40 题（中文 33、英文 7），中文只剩 4 题可修，配对检验最好也只有 p=0.125，**无法证明任何改进**。不先补分层指标和中文样本，改完分词也只能报“看起来变好了”。

## What Changes

- **中文分词**：`tokenize()` 同时保留 Latin token 与 CJK 二元组（bigram），支持中英混排；去重并设上限。
- **Layer 2 修复**：同时匹配 `document_chunks.content` 与 `knowledge_documents.keywords`；按命中 token 数排序而不是 `chunk_index`；显式防御空 tokens。
- **Meilisearch**：把 `keywords` 加入可搜字段，让现成英文正文 + 中文 keywords 的文档能被中文 query 命中。
- **分层可观测**：检索报告记录 vector / meili / chunk / doc 四层各自的候选与排名，并记录代码版本、golden 哈希、文档/chunk 数量、模型与索引版本。
- **评测扩容**：补中文改写/语序变体、英文对照题、无答案负样本；验收看分层 Recall 与端到端非退化，并用 Wilson + McNemar 明确“显著/不显著”。
- **不在本次强实施**：向量/rerank 的最终相关性门槛。它需要足够负样本才能验收，列为后续步骤；本次只补负样本与分数分布，不改线上阈值。

## Capabilities

### New Capabilities

- `ai-customer/rag-retrieval`: RAG 检索的召回与可观测契约——中文与中英混排如何分词、关键词层如何匹配与排序、各层结果如何合并、检索质量必须如何分层报告。

### Modified Capabilities

- `ai-customer/quality-loop`: 增加 RAG 检索质量的评测要求——分层 Recall、负样本、版本快照与配对检验，避免只凭端到端 Hit@K 下结论。

## Impact

**代码**

- `apps/api/src/client/ai-customer/knowledge/rag-retrieval.service.ts` — tokenizer、Layer 2、分层日志
- `apps/api/src/common/meilisearch/meilisearch.service.ts` — `keywords` 可搜字段
- `apps/api/src/admin/rag/` — 检索接口的可选 debug 分层返回（不改变默认行为）
- `tools/eval/rag/` — 分层指标、版本快照、补题、配对检验适配

**数据**

- 不新增表、不新增迁移。`knowledge_documents.keywords` 已存在且含中文；`document_chunks` 已有 pg_trgm 扩展但无 GIN 索引，本次不加。

**兼容性**

- 检索接口请求/响应默认字段不变；debug 分层信息为可选字段。
- `minScore` 现有语义（Layer 3 过滤）本次不变，避免悄悄改变调用方行为。

**不涉及**

- 不改知识文档内容与切片策略、不重新向量化、不换 embedding/reranker 模型。
- 不改 AI 对话编排与转人工逻辑。
