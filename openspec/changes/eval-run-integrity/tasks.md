# Tasks

## 1. 模型与启动

- [ ] 1.1 在 `apps/api/prisma/schema.prisma` 的 `AiEvalRun` 增 `heartbeatAt`、`executionErrorKind`、`judgeSampleCount`、`metricFamily`（`judgeErrorKind` 已存在，不重复加），并生成手写迁移：清理重复 RUNNING（按 `started_at` 保留最新，其余 FAILED，注明不可逆）、回填 `heartbeat_at = started_at`、建部分唯一索引 `(dataset_id) WHERE status='RUNNING' AND mode <> 'EXTERNAL'`；验证：迁移在本地跑通、`\d ai_eval_runs` 见索引、`prisma generate` 与 `yarn workspace @lucky/api tsc --noEmit --pretty` 通过 [Req: 评测启动必须互斥且幂等]
- [ ] 1.2 改造 `startRun`：保留 create 前的 stale 清理，只把 `create` 包进 `try/catch`，捕获 `P2002` 返回 409 并带已有 run 信息；验证：jest 并发两次启动一成功一 409，且只投递一个 job [Req: 评测启动必须互斥且幂等]
- [ ] 1.3 心跳并入 `ensureRunning`（`updateMany` 取 count 判断 CANCELLED），按 ≥30s 节流；验证：jest 心跳随用例推进增长，取消后立即停止 [Req: 运行存活必须由心跳判定]
- [ ] 1.4 新增后台清扫任务（`@Cron` + `RedisLockService`，先例 `kb-generation.reconcile.task.ts`），按心跳空闲超 `AI_EVAL_RUN_STALE_MS`（默认 30 分钟）标 FAILED，EXTERNAL 保留 24h 分支；从 `listDatasets`/`getDataset`/`getRun` 移除清扫调用；验证：假时钟三例（长跑仍 RUNNING、真死转 FAILED、EXTERNAL 不误杀），grep 读方法无清扫 [Req: 运行存活必须由心跳判定]
- [ ] 1.5 前端启动按钮加 `starting` 禁用与 409 文案；验证：vitest 双击只调用一次，409 显示「已有运行」 [Req: 评测启动必须互斥且幂等]
- [ ] 1.6 新建 `apps/api/src/admin/ai-eval/judge-spec.ts`（版本、prompt、hash、模型、供应商、采样数），内部 run 启动时写全六字段；验证：jest 六字段齐全且 hash 与 prompt 文本一致 [Req: 评测标准必须版本化且随运行留存]
- [ ] 1.7 内部运行完成时写 `datasetSnapshot`（用例 id 集合 + hash）与 `codeVersion`；验证：jest COMPLETED 后快照非空，按同批用例可复算出相同 hash [Req: 评测运行必须保存可复现快照]

## 2. 判官与汇总

- [ ] 2.1 判官解析失败改为抛 `output_format` 并写 `judgeErrorKind`，503 保留并加结构化 body；同步 `rag-faithfulness.service.ts` 的同类调用；验证：`yarn workspace @lucky/api test -- ai-eval-judge` 与 rag 用例通过 [Req: 判官失败必须与回答错误分账]
- [ ] 2.2 单条判官调用 `try/catch` 留痕后继续；连续失败达 `AI_EVAL_JUDGE_FAILURE_CIRCUIT`（默认 5）整单 FAILED，summary 保留已判分计数；验证：jest 1 条失败 → COMPLETED；5 连败 → FAILED 且已判分数非 0 [Req: 评测失败必须可见]
- [ ] 2.3 LIVE 执行失败写 `executionErrorKind='live_call'` 并继续；验证：jest `executionError=1`、`unsolved=0`，运行仍 COMPLETED [Req: 内部评测执行失败必须单独记账]
- [ ] 2.4 `buildSummary` 增 `judged`、`validPassRate`、`judgeErrorRate`、`judgeErrorKinds`、`executionErrorRate`、`processed`、`total`、`failureCategory`；**`passRate` 成分保持 `solved/total` 不变**；验证：jest 10 条 2 条失败 → `judged=8`、`passRate` 按 solved/total、`validPassRate` 按 solved/judged 分别正确 [Req: 指标必须声明族且消费方按族分流]
- [ ] 2.5 `caseVerdicts` 推送前排除空判定，`buildAnswerComparison` 同步跳过；验证：jest 基线对比不把未判定当成失败 [Req: 判官失败必须与回答错误分账]
- [ ] 2.6 `apps/admin-next/src/api/types.ts` 增 `executionErrorKind/metricFamily/judgeSampleCount`，`ai-ops-eval.ts` 头部标注口径；验证：`yarn workspace @lucky/admin-next tsc --noEmit` 通过，vitest ai-ops-eval 通过 [Req: 指标必须声明族且消费方按族分流]
- [ ] 2.7 `promoteRun` 补齐门槛：`mode==='EXTERNAL'`、`scope==='full'`（null 不通过）、`datasetSnapshot.hash` 同源、`knowledgeSnapshot.stable`、版本齐全、最低样本量、`updateMany` 带 `datasetId`；`findBaselineRunId` 在显式「不对比」时不得回退；验证：jest 内部 run 被拒、A 登记后 B 基线仍在、scope 空被拒 [Req: 基线必须按数据集界定且仅 EXTERNAL 可登记]
- [ ] 2.8 前端运行卡展示 `judgeErrorRate/kinds/validPassRate/judged/采样数/runId/scope/processed/total`；验证：vitest AiQuality 快照与断言通过 [Req: 评测失败必须可见]
- [ ] 2.9 指标族贯穿：summary 必带 `metricFamily`；`delta/newFailures/fixed` 按族计算；基线下拉对 EXTERNAL 显示 `accuracy`、对内部显示通过率且禁用登记；验证：jest 族配对断言与 vitest 下拉断言通过 [Req: 指标必须声明族且消费方按族分流]
- [ ] 2.10 把 rubric 写成文：`unsafe/abstain` 处置、score↔verdict 约束、内部单次采样声明，进本 change `design.md` 与判官 spec 注释；验证：spec 内可检索到三段文字 [Req: 评测标准必须版本化且随运行留存]

## 3. harness 与文档

- [ ] 3.1 `tools/eval/e2e/judge.mjs` 动作类用例改 `forbidExecution:true`，通过判据改为确认卡字段断言；`tools/eval/e2e/README.md` 同步；验证：e2e 跑完无写操作记录，`grep -rn "forbidExecution: *false" tools/eval` 为 0 [Req: 写操作样本不得真实执行]
- [ ] 3.2 `tools/eval/e2e/METRICS.md` 增 `verdict3` 族章节（口径、版本、分母），并声明外部 v3 不变；`113/114/119` 的 `passRate` 定义不改；验证：grep 三处文档口径一致，`METRICS.md` 可检索到 `verdict3-1` [Req: 指标必须声明族且消费方按族分流]
- [ ] 3.3 在 `deploy/.env.example` 与 `tools/eval/e2e/README.md` 登记 `AI_EVAL_RUN_STALE_MS`、`AI_EVAL_JUDGE_FAILURE_CIRCUIT`；验证：grep 可检索到两个变量及默认值 [Req: 运行存活必须由心跳判定]

## 4. 集成验证

- [ ] 4.1 全量验证：`openspec validate "eval-run-integrity" --strict`、`yarn workspace @lucky/api tsc --noEmit --pretty`、`yarn workspace @lucky/admin-next tsc --noEmit`、api jest（ai-eval）、admin vitest、手动并发启动与 35 分钟长跑；验证：全部命令以 0 退出，并发一成功一 409，长跑保持 RUNNING [Req: 评测启动必须互斥且幂等]
- [ ] 4.2 基线作用域演练：在本地库为 A、B 两个数据集各登记一次 EXTERNAL 基线，确认互不清空；再对内部 run 发起登记，确认被 mode 拒绝；验证：三组断言均符合预期 [Req: 基线必须按数据集界定且仅 EXTERNAL 可登记]

## Workflow follow-up

- 实现并验证通过后运行 `openspec archive "eval-run-integrity"`。
- 归档前确认 `ai-quality-loop-contract` 已归档，delta 中的契约引用指向归档后的主 spec。
