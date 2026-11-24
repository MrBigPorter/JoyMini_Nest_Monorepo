# Design

## Context

现状与约束见 `proposal.md`。实现相关的既有事实：

- `AiEvalRun` 已有 `codeVersion`、`datasetSnapshot`、`judgeSpecVersion`、`metricSpecVersion`、`gateMode`，promote 在 `ai-eval-dataset.service.ts` 内做硬校验；没有知识库相关字段。
- 知识版本由 `KnowledgeDocument.activeVersion` 与 `DocumentChunk.documentVersion` 表达；上传路径已是「追加新版本 → 入队 `rag-embedding`（带 `targetVersion`）→ Meili 翻转 `isActiveVersion` → `KbVersionService.activate()` CAS 激活」，旧分块由 `RagVersionPurgeTask` 保留 7 天。
- 普通 `PATCH /v1/admin/rag/documents/:id` 当前接受 `content`，只重算质量分，不升版本、不重建分块；`updateContent` 与 `reindex` 使用不区分版本的 `deleteMany`。
- harness 的 `E2E_KINDS=knowledge,multi` 会跳过 fixtures（`run.mjs` 的 `needsFixtures`），外部数据集以 `e2e:<用例指纹>` 命名，控制台不能启动，promote 只能调接口。
- `/api/health` 只返回 `{ ok: true }`，没有服务端版本标识。

## Goals / Non-Goals

**Goals:**

- 让「知识库变了没有」「变了哪几篇」「要跑哪些用例」三个问题都有确定答案。
- 让一次运行能证明自己跑在稳定语料与指定代码版本上，并成为可核验的发布证据。
- 复用现有 harness、版本机制与 promote 规则，不引入第二套评测或状态存储。

**Non-Goals:**

- 不自动判断知识内容是否符合业务真相；内容正确性只做 diff 与引用抽样诊断。
- 不在上传后自动触发全量运行，不改每日 advisory 评测的定位。
- 不把 GitHub 凭据放进生产 API；控制台只提供命令与 workflow 链接。
- 不为历史 run 回填指纹，不把子集结果纳入基线。

## Decisions

### D1. 指纹只由「正在服务的内容」构成

每篇文档取 `docId|locale|activeVersion|activeChunkHash|activeChunkCount`，排序后整体 `sha256`。活跃分块指 `documentVersion = activeVersion` 的分块；`updatedAt`、名称、关键词、`contentHash` 都不进哈希。

- 理由：`contentHash` 可能在候选生成时惰性写入，`updatedAt` 会被激活等操作刷新，二者都不能代表用户实际检索到的内容。
- 备选：对整篇 `content` 取哈希。被否，未激活的新版本会提前改变指纹，运营会以为线上已生效。
- 待激活：`version > activeVersion`、`processStatus != indexed` 或分块数不一致的文档列入 `pendingActivation`，不参与指纹，但让证据不通过。

### D2. 指纹是只读派生视图，不落存储

`GET /v1/admin/rag/documents/meta/corpus-fingerprint` 实时计算并返回整体指纹、逐文档明细、待激活列表与 `generatedAt`。响应不包含正文；不查询 Meilisearch，避免索引最终一致造成抖动。

- 备选：定时物化到表里。被否，27 篇文档的计算成本可以忽略，物化只会引入过期与第二个事实源。

### D3. run 记录三个可空字段，快照放 Json

`AiEvalRun` 增加 `knowledgeFingerprint String?`、`knowledgeSnapshot Json?`、`scope String?`（`full`/`subset`）。`knowledgeSnapshot` 存 `{ fingerprint, docs, pendingActivation, before, after, stable, stableReason }`，与 metric-v3 的 `summary` 做法一致。

- 理由：证据链需要一次运行的完整语料上下文，而不只是一个哈希；可空字段对历史 run 无影响。
- 备选：新建 `AiEvalRunKnowledgeSnapshot` 表。被否，当前只需要读整块快照，独立表增加联表与迁移面。

### D4. 稳定判定由服务端完成

`createExternalRun` 与 `ingestExternalResults` 各取一次当前指纹；harness 也上报开跑前、收尾前的指纹。`stable = 服务端两次一致 && harness 两次一致 && 二者相等`。任一处缺失按不稳定处理。

- 理由：只信 harness 等于让被测方自证；只信服务端则无法发现「开跑前就已漂移」。
- 备选：只在 ingest 时取一次。被否，无法区分「运行中变化」与「运行前已不同」。

### D5. 子集映射来自上次全量 run 的用例快照

`selectCasesForDocIds(cases, docIds, options)` 为纯函数：知识题按 `expectedDocIds` 取交集，多轮题按生成后的并集取交集；负样本默认排除，`includeNegatives` 时纳入；期望文档已被删除或停用的用例强制纳入。映射输入是 `datasetSnapshot.cases`，不解析 golden 文件。

- 理由：快照就是上次实际跑过的内容，包含多轮与负样本的生成结果；解析 golden 会漏掉生成用例并与快照漂移。
- 备选：服务端维护 docId→caseId 表。被否，需要同步维护，且与 harness 装配逻辑重复。
- 无全量快照时返回明确错误，不猜测映射。

### D6. 子集靠独立数据集 + scope 双重隔离

`E2E_DOC_IDS` 触发过滤，`E2E_SCOPE=subset` 只做标记；由于数据集指纹已包含 caseId 集合，子集天然落在独立的 `e2e:<指纹>` 数据集。`scope` 落库是为了让证据、列表与 promote 不必反解析数据集名。`promoteRun` 拒绝 `scope=subset`，控制台不跨数据集算 delta。

- 备选：复用全量数据集并给结果打 subset 标记。被否，聚合与基线比较会被污染。

### D7. 子集只跑知识与多轮

子集固定 `E2E_KINDS=knowledge,multi`，自动跳过 fixtures，账号数降到 4；动作、读类、边界不纳入。目标是 2–5 分钟完成。

- 理由：知识库变更不改变工具执行与边界规则；把这些一起跑会重新引入 fixtures、写操作与限流风险。
- 备选：按文档关联度把动作类也纳入。被否，动作用例与知识文档没有可靠映射。

### D8. 证据是 promote 规则的超集，用纯函数实现

新增 `evaluateRunEvidence(run, dataset, currentFingerprint, config)`，在 promote 条件之上增加：`mode=EXTERNAL`、`scope=full`、`knowledgeSnapshot.stable=true`、`knowledgeFingerprint` 等于当前值、`pendingActivation` 为空、harness 失败率 ≤5%、实际执行用例数等于数据集用例数。证据端点与部署 job 共用该函数；部署 job 只调用端点，不复制规则。

- 备选：部署 workflow 内联脚本检查。被否，规则会与服务端漂移。

### D9. 门禁先 advisory，后切 enforce

`deploy-backend.yml` 在 quality 之后增加 `eval-evidence` job，运行标识来自 `workflow_dispatch.eval_run_id`，否则读提交信息 `Eval-Run: <id>`。`EVAL_GATE_MODE=advisory|enforce`，默认 advisory。

- 理由：QA 语料与生产语料的同步责任尚未自动化，先积累证据再阻断。
- 备选：一开始 enforce。被否，会把流程问题变成发布故障。

### D10. 服务端版本由部署注入

`/api/health` 返回 `commitSha`，取值来自部署注入的环境变量，缺失时返回 `unknown`。harness 优先记录该值；证据要求它与待发布版本一致。

- 备选：用镜像 tag 推断。被否，tag 在本地与 CI 中不一致。

### D11. 正文写入统一走版本化路径

`UpdateRagDocDto` 移除 `content`；正文修改必须走上传或 `:id/content`。所有正文路径写 `contentHash = sha256(content)`。`updateContent` 改为「追加新版本分块 → 入队 `targetVersion`」，不删除旧版本；`reindex` 的删除范围收窄到当前版本，避免误删可回滚的旧版本。

- 理由：否则运营走 `PATCH` 改正文，指纹不变、子集不触发，整个方案静默失效。
- 备选：保留 `PATCH` 但在内部转发到版本化路径。被否，字段语义仍然混乱，且容易漏掉调用方。

### D12. 内容正确性只做诊断

知识质量页用保留期内的旧分块做新旧 diff；`verify-citations.mjs` 抽样读取结果，用现有判官核对回答引用与当前文档是否一致，输出诊断文件；发版清单要求人工抽检。三者都不改 `kbAccuracy`、不升 metric 版本。

- 理由：自动判官只能发现「回答与文档不一致」，不能证明文档符合业务真相。
- 备选：把引用核验结果并入准确率。被否，会引入新的指标口径与版本迁移，超出本变更范围。

## Risks / Trade-offs

- **QA 语料与生产语料不同** → 证据只证明 QA 语料；清单要求发布前对比两侧指纹，门禁保持 advisory 直到同步自动化。
- **文档变更但没有对应用例** → 受影响用例为 0 会静默通过；状态视图必须单列「未覆盖的变更文档」，清单要求人工补例或确认无需覆盖。
- **60 次/分共享限流与账号配额** → 子集 4 账号、跳过 fixtures、CI `concurrency=1`；全量仍走既有 12 账号配置。
- **7 天清理窗口** → 激活后 7 天内完成 diff 与人工复核；过期后只能重传。
- **运行中激活新版本** → `stable=false`，证据不通过，必须重跑；这是预期行为，不做自动重试。
- **指纹计算随文档增长变慢** → 当前 27 篇可忽略；超过阈值时再改为增量缓存，不提前优化。
- **历史 run 无指纹** → 一律视为「仅诊断」，不参与比较；第一次全量运行负责建立新基线。

## Migration Plan

1. Prisma 增加三个可空字段与迁移；历史行保持 `NULL`。
2. 先发布 API（新字段可选、端点只读），再更新 harness 与 CI，最后上控制台卡片。
3. 用一次全量外部运行写入首个 `knowledgeFingerprint` 与 `knowledgeSnapshot`，作为后续比较基准。
4. 部署 workflow 以 advisory 上线；连续通过若干次后再切换 `enforce`。
5. 回滚：API 字段可空，回滚代码不影响已有数据；harness 用 `E2E_SCOPE` 缺省值退回全量；门禁用 `EVAL_GATE_MODE=advisory` 立即降级。

## Open Questions

- 生产知识库与 QA 知识库的同步由谁负责、以什么频率执行：先按清单人工核对，不阻塞本次实现。
- `verify-citations.mjs` 的抽样比例（子集全查、全量 10 条）是否足够：先按此执行，用两三次发版的命中情况再调。
