# Proposal

## Why

知识库更新后，现有回归分数无法判断是否可信：

- `AiEvalRun` 只记录 `codeVersion`、`judgeSpecVersion`、`metricSpecVersion` 与用例快照，没有任何知识库版本标识；`contentHash` 只在生成候选时惰性写入，正文更新不刷新。两次运行看起来「同版本」，指标变化无法归因到知识库。
- golden 用例按业务 `docId` 标注（27 篇、195 条），但 harness 只能按 kind/action/limit 过滤。改两篇文档，要么跑全量 20–35 分钟，要么不跑。
- 发布链路没有知识库证据：CI 只守 lint/type-check/单测/契约，后端部署只跑 lint+type-check，每日评测是 advisory，`promote` 只能调接口。发版时没有人能回答「这次要发的代码，在当时的语料上跑过没有」。
- 正文写路径不完整：普通 `PATCH :id` 接受 `content` 却不升版本、不重建 chunk；`updateContent` 与 `reindex` 先删旧 chunk，回滚窗口被销毁。只有上传路径保留 7 天旧版本。

结果是「改知识库 → 跑一次回归」这个动作既可观测性不足、又太贵、也没有门禁，最终退化为不可验证的人工判断。

## What Changes

- 新增**语料指纹**：只对正在服务的内容取哈希（`activeVersion` + 活跃 chunk 文本），时间戳、关键词、更新时间不入哈希；待激活版本单独标记。提供只读端点与每条文档的指纹明细。
- 扩展**评测运行记录**：`AiEvalRun` 增加 `knowledgeFingerprint`、`knowledgeSnapshot`、`scope`（`full` / `subset`）；harness 开跑与收尾各取一次指纹，由服务端判定 `stable`。运行记录的代码版本优先采用被测服务端 `health` 返回的 `commitSha`。
- 新增**受影响子集执行**：`cases.mjs` 提供纯函数 `selectCasesForDocIds()`，harness 支持 `E2E_DOC_IDS` 与 `E2E_SCOPE=subset`；映射来源是上次全量 run 的 `datasetSnapshot.cases`，不解析 golden。子集落在独立的 `e2e:<指纹>` 数据集，不能登记基线。
- 新增**知识库回归状态视图**：实时对比当前语料快照与上次全量 run，返回变更文档、受影响用例数、待激活文档与最近一次子集结果；事件只做通知，不作为状态源。
- 新增**发布证据**：`GET /v1/admin/ai-eval/runs/:id/evidence` 校验运行模式、scope、指纹一致性与完成度；`deploy-backend.yml` 增加 `eval-evidence` job，默认 `advisory`，可选 `enforce`。
- `/api/health` 返回 `commitSha`，让证据能证明「跑的就是要发的 commit」。
- **BREAKING**：`PATCH /v1/admin/rag/documents/:id` 不再接受 `content`；正文修改必须走上传播入或 `:id/content`，避免绕过版本与指纹。`docId`、`locale` 在创建后不可修改。
- 正文写入统一维护 `contentHash = sha256(content)`；`updateContent` 改为追加版本并保留旧 chunk 至保留期，不再先删后建。
- 新增 `docs/release-checklist.md`：明确必须跑全量的条件与人工核验项。
- 新增内容正确性诊断：知识质量页展示新旧 chunk diff；`verify-citations.mjs` 抽样核验回答引用；发版清单要求人工抽检。

## Capabilities

### New Capabilities

- `admin-ai/knowledge-lifecycle`: 知识文档正文写入的版本化契约——内容哈希、不可变业务键、更新保留旧版本、元数据编辑不改变语料。
- `admin-ai/kb-regression`: 知识库变更的回归契约——语料指纹、变更与用例映射、子集执行与隔离、回归状态视图、发布证据。

### Modified Capabilities

- `ai-customer/quality-loop`: 评测运行必须保存知识库快照与 scope；基线登记与跨运行比较必须校验知识库指纹；运行代码版本来自被测服务端。
- `admin-ai/quality-loop`: 管理端必须展示知识库回归状态与受影响用例，并能查看一次运行的发布证据。

## Impact

- 代码：`apps/api/src/admin/rag/{rag.controller.ts,rag.service.ts,rag-sync.service.ts,dto/}`、`apps/api/src/admin/ai-eval/ai-eval-dataset.service.ts`、`apps/api/src/app.controller.ts`。
- 数据库：`AiEvalRun` 增加三个可空字段（一次小迁移）；知识文档写入路径复用现有 `KnowledgeDocument` / `DocumentChunk` 版本字段。
- 评测工具：`tools/eval/e2e/{run.mjs,cases.mjs,external-sync.mjs,verify-citations.mjs(新)}` 与对应纯函数测试。
- 管理端：`apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx`（回归状态卡片、受影响用例、证据入口）。
- CI/CD：`.github/workflows/{ci.yml,deploy-backend.yml,eval-regression.yml(新)}`；新增纯函数测试进 CI，新增手动触发的回归 workflow。
- 流程：新增 `docs/release-checklist.md`；不改每日 advisory 评测的定位。
- 兼容性：`PATCH` 正文写入是 API 行为变更，需同步检查管理端调用方；历史 run 无指纹字段，只作历史，不参与新证据链。
