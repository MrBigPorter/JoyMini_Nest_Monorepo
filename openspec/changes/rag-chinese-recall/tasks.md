# Tasks

## 1. 中文分词

- [ ] 1.1 重写 `tokenize()`：Latin 词项保持现状，CJK 连续片段生成二元组并保留单字兜底；验证：新增单测覆盖纯中文、中英混排、标点、空输入，且纯英文词项集合与变更前一致
- [ ] 1.2 增加中文停用二元组、去重与词项上限；验证：单测断言 `怎么退货` 含 `退货`、超长输入词项数不超上限且无重复

## 2. 关键词层与全文索引

- [ ] 2.1 Layer 2 同时匹配 `document_chunks.content` 与 `knowledge_documents.keywords`，按命中 token 数排序；验证：单测断言 SQL 含 keywords 条件与命中数排序，中文关键词用例返回文档
- [ ] 2.2 Layer 2 入口防御空 tokens；验证：直接调用 `keywordSearchChunks([])` 返回空且不执行 `$queryRawUnsafe`
- [ ] 2.3 Meilisearch 把 `keywords` 加入 searchable attributes 与 `attributesToSearchOn`；验证：用中文 query 调用检索接口能命中 keywords 含中文的英文正文文档

## 3. 分层可观测

- [ ] 3.1 管理端检索 DTO 增加可选 `debug`，开启时返回四层各自的 docId 与层内排名；验证：默认响应结构不变，`debug=true` 时四层字段齐全
- [ ] 3.2 检索日志补充分层命中数与最终 topScore，区分 rerank 前/后；验证：本地跑一题中文 query，日志可读到四层计数

## 4. 评测集与脚本

- [ ] 4.1 golden 增加 `lang` / `sourceType` / `expectedLayers` / `note` 字段并保持旧 40 题可读；验证：`run.py --dry-run` 或等价校验通过
- [ ] 4.2 中文补到 ≥60 题（含改写/语序变体，至少 10 道当前失败）、英文补到 ≥30 题、负样本 ≥20 题；验证：分语言/来源/负样本计数达标，查重通过
- [ ] 4.3 `run.py` 输出分层 Recall@K、负样本误召回与版本快照（git SHA、golden 哈希、文档/chunk 数、模型与索引）；验证：报告 JSON 含这些字段
- [ ] 4.4 让 RAG 报告兼容 `compare.py` 的配对检验输入；验证：用两份报告跑出 McNemar 的 b/c/p

## 5. 回放验收

- [ ] 5.1 改前基线跑两次（topK=3 与 topK=5，含 `--compare-rerank`）；验证：两次无错误/无 429，结果落盘
- [ ] 5.2 改后重跑同样口径；验证：全局/中文/英文 Hit@1、Hit@3、MRR 不低于基线，中文关键词层 Recall@K 提升
- [ ] 5.3 出具对比表：Wilson CI、McNemar b/c/p、翻转题清单、分层 Recall；验证：p≥0.05 时明确写「不显著」，不以点差代替结论
- [ ] 5.4 跑全量 API 测试与 `tsc --noEmit`；验证：全绿，无新增失败

## Workflow follow-up

- 满足评审后归档：`openspec archive rag-chinese-recall`
- 归档后确认 `openspec/specs/ai-customer/rag-retrieval/spec.md` 生成，`quality-loop` 增量已同步
