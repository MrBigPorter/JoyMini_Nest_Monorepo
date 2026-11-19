# Design

## Context

现状与约束见 `proposal.md` 的 Why。实现侧的关键事实：

- `tokenize()` 只保留 `[A-Za-z0-9_]`，CJK 被整段丢弃；它是四层检索共用的唯一分词入口。
- Layer 2 只查 `document_chunks.content`，按 `chunk_index` 排序，固定分 0.5；空 tokens 会生成非法 `WHERE ()`。
- Layer 3 在 JS 里对 `keywords/title/content` 做 `includes`，空 tokens 时分数恒为 0。
- Meilisearch 的 searchable attributes 只有 `content/title`，虽然索引文档里已经带 `keywords`。
- 现成 27 篇知识文档正文均为英文，`keywords` 为双语；因此本次最确定的收益在 Layer 3 与 Meili 的 keywords 匹配。
- 现有 RAG golden 40 题（中文 33、英文 7），没有负样本，也没有分层召回数据。

## Goals / Non-Goals

**Goals:**

- 中文与中英混排 query 能产生可匹配的词项，关键词层从“对中文恒空”变为可用。
- 检索报告能区分四层各自的召回与排名，验收不再只看端到端 Hit@K。
- 用补题与配对检验把“改前/改后”变成可判定的结论。

**Non-Goals:**

- 不做真正的词法分析（jieba 等），不引入新依赖。
- 不改切片、不重新向量化、不换 embedding/reranker 模型。
- 本次不启用向量/rerank 的最终相关性阈值；只补负样本与分数分布，供后续变更定阈值。
- 不改线上默认 topK（生产仍为 3），只在评测中增加 topK=3 口径。

## Decisions

### D1. 中文用二元组（bigram），不按字切分

CJK 连续片段长度 ≥2 时生成相邻二元组，长度 1 保留单字（用于“退款”这类短词之外的兜底）；Latin token 沿用现有规则。词项去重，上限 32–40。

- **为什么不用按字切分**：`退` 会命中“退休/退回”，`款` 会命中“款式”，误召回和维护中文停用字表的成本都更高。
- **为什么不用 jieba**：新增依赖与词典体积；项目当前没有中文 NLP 依赖，bigram 已足够覆盖 FAQ 关键词。
- **代价**：token 数约为 CJK 字数的 2 倍；用去重、上限与中文停用 bigram（“怎么/什么/如何/请问/可以”）控制噪声与 SQL 条件数量。

### D2. Layer 2 同时匹配正文与 keywords，并按命中数排序

SQL 条件从“只 `content ILIKE`”扩展为 `content ILIKE OR keywords ILIKE`；`ORDER BY` 改为“命中 token 数 DESC, chunk_index ASC”。入口显式判断 `tokens.length === 0` 直接返回，不生成空 WHERE。

- **为什么必须加 keywords**：现成文档正文是英文，中文 query 只能靠 `keywords` 命中；只改分词不解决这一层。
- **为什么不直接用 `pg_trgm`**：扩展已装但无 GIN 索引；本次是正确性问题，不是性能问题。等 Layer 2 实测变慢再加索引，避免写放大。
- **为什么按命中数排序**：`OR + LIMIT` 按 `chunk_index` 会先返回“任意文档的前几个 chunk”，相关 chunk 可能进不了候选集。

### D3. Meilisearch 把 keywords 加入可搜字段

`updateSearchableAttributes` 与 `attributesToSearchOn` 都加入 `keywords`。Meili 会重建索引，无迁移。

- **为什么顺手做**：现成索引文档已带 `keywords`，成本极低；它能让中文 query 在 Layer 1.5 就命中英文正文文档。
- **风险**：keywords 很短，BM25 分数可能偏高；靠 reranker 与最终合并兜住，不改权重。

### D4. 分层观测通过可选 debug 字段暴露

管理端检索接口增加可选 `debug`（默认关闭）。开启时返回四层各自的 `docId` 列表与该层排名；默认响应结构不变。

- **为什么不用日志**：评测脚本需要结构化数据，日志解析脆弱。
- **为什么不默认返回**：避免线上响应体变大、暴露内部结构；默认行为与 `agent-trust-boundary` 的出网白名单一致。

### D5. 评测扩容到可判定的规模

golden 增加 `lang`、`sourceType`、`expectedLayers`、`note` 字段；中文补到 ≥60（含改写/语序变体，至少 10 道当前失败），英文补到 ≥30，负样本 ≥20。主口径用 topK=3（对齐生产），保留 topK=5 与旧基线对比。

- **为什么不是只补几道**：33 道中文题只剩 4 道可修，McNemar 最好 p=0.125；至少需要 6 个净翻转才可能显著。
- **为什么负样本单独列**：正样本只能证明“能召回”，证明不了“该不该召回”；相关性门槛的验收依赖负样本误召回率。

### D6. 相关性门槛不在本次强实施

本次只补负样本与 top1 分数分布；阈值、gate 位置与 fallback 分层阈值留给后续变更。验收报告必须写明“门槛类改动未验收”。

- **为什么拆开**：没有负样本时加阈值只可能降低 Hit@K，无法证明收益；先有数据再定阈值。

## Risks / Trade-offs

- **[bigram 噪声拉低 Layer 3 分数]** → 中文停用 bigram 不计入分母；用覆盖度而非简单除以全部 token 的方案作为备选，回放验证后再定。
- **[英文行为回归]** → tokenizer 单测固定纯英文词项集合；评测保留英文对照题与 `rerank=false` 路径。
- **[Layer 2 变慢]** → 条件数量增加；先用 `EXPLAIN` 与 p95 验证，必要时再加 `pg_trgm` GIN 索引，不在本次强加。
- **[文档正文仍是英文]** → 本次验收明确以关键词层为主；中文正文匹配的收益等后续中文文档上传后再评估。
- **[评测样本人工标注成本]** → 补题分批合入；每批先跑分层指标，不要求一次到 150。
- **[单次运行波动]** → 改前/改后各跑 2 次，错误或 429 直接判无效；单题波动已在 r40 出现过。

## Migration Plan

1. tokenizer + 单测（行为变化，但只影响中文；英文词项集合不变）
2. Layer 2 + Meili keywords（低风险，可单独回滚）
3. 分层 debug 字段（默认关闭）
4. 评测脚本与补题（只影响工具）
5. 改前/改后回放，出对比表

**存量 Meili 文档回填**：本地验证发现 317 条 chunk 缺少 `isActiveVersion` 字段，而检索过滤条件是 `isActiveVersion = true`，导致 Meili 层一直返回空。本次已在本地用 `PUT /indexes/document_chunks/documents` 补齐（`{id, isActiveVersion: true}`，317 条）。上线时必须执行同样的回填或全量重建，否则 keywords 可搜也不会生效。

回滚：第 1–3 步按提交单独 revert；评测数据与报告不回滚，保留历史。
