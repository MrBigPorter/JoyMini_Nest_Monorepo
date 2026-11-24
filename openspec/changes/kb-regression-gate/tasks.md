# Tasks

## 1. 知识写入路径收口

- [x] 1.1 `UpdateRagDocDto` 移除 `content`，`PATCH /v1/admin/rag/documents/:id` 收到正文时返回 400 并提示走上传播入或 `:id/content`。验证：`yarn workspace @lucky/api tsc --noEmit --pretty` 通过；新增单测断言带 `content` 的 PATCH 返回 400。
- [x] 1.2 在上传、`updateContent`、管理端正文编辑三条路径统一写入 `contentHash = sha256(content)`。验证：单测断言三条路径写入的哈希都等于正文 sha256，纯元数据编辑不改变原值。
- [x] 1.3 创建后禁止修改 `docId` 与 `locale`，非法请求返回可读错误。验证：单测覆盖改 `docId`、改 `locale` 两种拒绝。
- [x] 1.4 `updateContent` 改为追加新版本分块并保留旧版本，入队 `targetVersion`，不再先删后建。验证：单测断言旧版本分块在保留期内仍可读、队列任务带目标版本。
- [x] 1.5 `reindex` 的删除范围收窄到当前版本，保留可回滚的旧版本分块。验证：单测断言重建后旧版本分块仍存在。

## 2. 语料指纹与运行记录

- [x] 2.1 实现语料指纹纯函数：按 `docId|locale|activeVersion|activeChunkHash|activeChunkCount` 排序取 sha256，排除时间戳、名称、关键词。验证：单测覆盖幂等、元数据编辑不变、上传未激活只进待激活、激活后变化四条。
- [x] 2.2 新增只读端点 `GET /v1/admin/rag/documents/meta/corpus-fingerprint`，放在 `:id` 之前的静态路由区。验证：controller 测试断言响应含整体指纹、逐文档明细、待激活列表，且不含正文。
- [x] 2.3 Prisma 为 `AiEvalRun` 增加 `knowledgeFingerprint`、`knowledgeSnapshot`、`scope` 三个可空字段并生成迁移。验证：`yarn workspace @lucky/api prisma migrate dev` 成功，既有行保持 NULL，`tsc` 通过。
- [x] 2.4 `createExternalRun` 与 `ingestExternalResults` 各取一次指纹，结合 harness 上报的 before/after 计算 `stable` 与 `stableReason`。验证：单测覆盖四项一致、仅服务端一致、仅 harness 一致、任一处缺失四种输入。
- [x] 2.5 扩展外部 run 的 DTO 与入库逻辑，保存 `knowledgeFingerprint`、`knowledgeSnapshot`、`scope`，不被白名单裁掉。验证：外部 run 测试断言入库字段完整。
- [x] 2.6 `/api/health` 返回部署注入的 `commitSha`，缺失时为 `unknown`。验证：controller 测试覆盖有值与缺失两态；本地 `docker restart lucky-backend-dev` 后 `curl /api/health` 可见字段。
- [x] 2.7 harness 开跑前与收尾前采集指纹，并优先记录服务端返回的 `commitSha`；写入 `external-sync` 上送。验证：`node --test tools/eval/e2e/*.test.mjs` 覆盖采集与上送字段。

## 3. 受影响子集执行

- [x] 3.1 在 `cases.mjs` 新增纯函数 `selectCasesForDocIds(cases, docIds, options)`：知识题取交集、多轮取并集交集、负样本默认排除、已删除文档的用例强制纳入。验证：新增 `cases.test.mjs` 覆盖上述四类与空映射。
- [x] 3.2 支持 `E2E_DOC_IDS` 与 `E2E_SCOPE=subset`：`buildCases` 末尾过滤，配置校验非法值并输出选中/排除计数。验证：`run.test.mjs` 断言只保留受影响用例、scope 标记正确、缺全量快照时给出「需先跑全量」。
- [x] 3.3 子集结果落在独立 `e2e:<指纹>` 数据集，`summarizeExternalResults` 记录 `scope` 与选中用例数。验证：外部同步测试断言子集与全量数据集名不同、summary 含 scope。
- [x] 3.4 `promoteRun` 拒绝 `scope=subset`，并返回可读原因。验证：Jest 覆盖子集拒绝与全量放行。
- [x] 3.5 `.github/workflows/ci.yml` 增加 `node --test tools/eval/e2e/*.test.mjs`。验证：本地同命令全绿，CI 的 eval-contract job 通过。

## 4. 回归状态与发布证据

- [x] 4.1 新增 `GET /v1/admin/ai-eval/kb-regression/status`：比较当前指纹与上次全量快照，返回变更文档、受影响用例数、待激活文档、未覆盖的变更文档与最近子集结果。验证：Jest 覆盖有变更、无变更、无全量基线三种状态。
- [x] 4.2 实现 `evaluateRunEvidence()` 纯函数与 `GET /v1/admin/ai-eval/runs/:id/evidence`：校验完成状态、EXTERNAL、全量、稳定、指纹等于当前、无待激活、判官错误率、执行数完整、harness 失败率。验证：Jest 覆盖通过、子集、不稳定、指纹不一致、大量跳过五条。
- [x] 4.3 管理端 `ai-ops/quality` 回归测试区增加语料指纹卡片、变更文档列表、受影响用例数、未覆盖文档与「复制子集命令」。验证：`yarn workspace @lucky/admin-next tsc --noEmit` 通过；手动确认三种状态文案正确。
- [x] 4.4 管理端增加证据查看入口，逐项展示校验结果与不通过原因。验证：用一次真实 run 打开详情，通过/不通过两种状态都有可读文案。
- [ ] 4.5 新增 `.github/workflows/eval-regression.yml`（仅 `workflow_dispatch`，输入 doc_ids/scope/base_url/ref，`concurrency=1`），上传报告 artifact。验证：在测试分支手动触发一次子集运行，artifact 可在 Actions 页面下载。

## 5. 部署门禁与流程文档

- [ ] 5.1 `deploy-backend.yml` 在 quality 之后增加 `eval-evidence` job，run id 来源为 `workflow_dispatch.eval_run_id` 或提交信息 `Eval-Run: <id>`；`EVAL_GATE_MODE` 默认 advisory。验证：advisory 下用不通过的 run 部署只告警；enforce 下同 run 部署失败并指向证据端点。
- [x] 5.2 新增 `docs/release-checklist.md`：列出必须跑全量的条件（知识库内容或激活版本变化、prompt/意图/检索/embedding/切片变化、判官或 metric 版本变化、距上次全量超过 7 天、生产发版前、promote 前）与人工核验项（引用抽样 ≥3 条、变更段落已核对、QA 与生产指纹对比）。验证：逐条给出可执行命令或页面入口，链接有效。
- [x] 5.3 更新 `tools/eval/e2e/README.md` 与 `METRICS.md`：记录 `E2E_DOC_IDS`、`E2E_SCOPE`、指纹字段、证据规则与子集不可 promote。验证：文档中的命令可照抄执行。

## 6. 内容正确性诊断

- [x] 6.1 知识质量页对最近更新文档展示新旧分块 diff 与质量标记。验证：在保留期内更新一篇文档，页面能并排看到旧版本与新版本差异。
- [x] 6.2 新增 `tools/eval/e2e/verify-citations.mjs`：子集全查、全量抽 10 条，优先抽判决翻转与变更文档相关用例，调用现有判官核对回答引用与当前文档，输出 `citation-review.md`。验证：`node --test` 覆盖抽样选择；对一份既有报告实跑生成诊断文件。
- [x] 6.3 发版清单加入人工抽检项（引用样本 20%、至少 3 条；diff 超阈值文档需人工勾选「内容已核对」）。验证：清单中该项有明确责任人与勾选位置。

## 7. 集成验证

- [ ] 7.1 对 QA 跑一次全量，确认 run 记录含指纹、快照、scope=full，且 `stable=true`。验证：控制台与接口都能读到四项字段。
- [x] 7.2 修改一篇文档并激活后，用 `E2E_DOC_IDS` 跑子集，确认 ≤5 分钟、落在独立数据集、无法 promote。验证：状态页显示受影响用例数，子集结果可查，promote 返回拒绝。
- [ ] 7.3 门禁演练：advisory 与 enforce 各部署一次，确认前者只告警、后者在指纹不一致或子集时阻断。验证：两次 workflow 运行结论符合预期。
- [x] 7.4 全量验证：`yarn workspace @lucky/api tsc --noEmit --pretty`、相关 Jest、`node --test tools/eval/e2e/*.test.mjs`、`openspec validate kb-regression-gate --strict` 全部通过。

## Workflow follow-up

- 证据连续通过若干次发版后再把 `EVAL_GATE_MODE` 切到 `enforce`，切换前记录理由与观察窗口。
- 归档本变更时同步 `admin-ai/knowledge-lifecycle`、`admin-ai/kb-regression` 两个新能力到主规格。
