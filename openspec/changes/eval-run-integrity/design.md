# Design — eval-run-integrity

## Context

见 `proposal.md` 与两个 delta spec。目标链路步骤为「7 运行 / 8 汇总 / 9 基线」；契约要求见 `ai-quality-loop-contract`。

实测现状：`AiEvalRun` 无 `updatedAt`、无心跳；`startRun` 的 `findFirst` 与 `create` 之间无事务；清扫挂在 `listDatasets`/`getDataset`/`getRun` 上；判官解析失败返回 `unsolved`；`promoteRun` 全局清 `isBaseline` 且不校验 `mode/scope/snapshot`；harness 动作样本 `forbidExecution:false`。

## Goals / Non-Goals

**Goals**：运行有身份（快照/版本/采样）、有存活（心跳）、有互斥（DB 约束）、有失败分层（逐条 vs 整单）；基线有作用域；写操作样本安全。

**Non-Goals**：不改外部 `answer_accuracy-v3` 口径；不实现 PG checkpointer；不补 `kb-regression-gate` 其余任务；不改判官模型本身。

## Decisions

### D1 心跳用新增 `heartbeatAt`，不用 `updatedAt`

加 `@updatedAt` 会让基线回写、取消、摘要修复刷新存活时间，掩盖 worker 已死。执行期在每条用例开始 `updateMany` 写心跳（≥30s 节流）；清扫读「`heartbeatAt` 缺失回退 `startedAt`」。备选（Redis TTL）多一个失效源，放弃。

### D2 启动互斥用部分唯一索引，应用层只做 409 映射

`CREATE UNIQUE INDEX ... ON ai_eval_runs(dataset_id) WHERE status='RUNNING' AND mode <> 'EXTERNAL'`。Prisma 无法表达部分索引，手写 SQL 迁移（先例 `20251105143959_group_guards`）。`startRun` 保留 create 前的 stale 清理，只把 `create` 包进 `try/catch` 捕 `P2002` → 409。备选（advisory lock 包住整个启动）会在长时间 create 时占锁，且无法防跨进程绕过，放弃。

### D3 清扫改为 `@Cron` + `RedisLockService`，读接口不再清扫

先例 `kb-generation.reconcile.task.ts`。阈值 `AI_EVAL_RUN_STALE_MS` 默认 30 分钟；EXTERNAL 保留 24h 分支（无心跳）。`startRun` 保留一次前置清扫以便失败自愈。备选（保留读接口清扫 + 心跳判断）仍会让轮询承担写操作，放弃。

### D4 失败分层：逐条留痕，整单看阈值

单条 judge/执行失败写 `judgeErrorKind`/`executionErrorKind` 后继续；连续判官失败达 `AI_EVAL_JUDGE_FAILURE_CIRCUIT`（默认 5）或判官整体不可用 → 整单 FAILED，summary 保留已判分数与失败类别。理由：单条失败整单红会丢掉已判分的样本；不设阈值则判官全挂时仍产出无意义分数。

### D5 判官标准抽 `judge-spec.ts`，run 记六字段

导出 `JUDGE_SPEC_VERSION`、`JUDGE_SYSTEM_PROMPT`、`JUDGE_PROMPT_HASH`（构建时计算）、`JUDGE_MODEL`、`JUDGE_VENDOR`、`JUDGE_SAMPLE_COUNT=1`。内部 run 在启动时写入 `judgeSpecVersion/judgePromptHash/judgeModel/judgeVendor/judgeSampleCount/metricFamily`。内部单次采样显式声明，不冒充合规基线。

### D6 基线按数据集、仅 EXTERNAL

`promoteRun` 依次校验：`mode==='EXTERNAL'`、`scope==='full'`（null 不通过）、`datasetSnapshot.hash` 与当前基线同源、`knowledgeSnapshot.stable`、版本字段齐全、最低样本量（每意图 ≥12、总数 ≥150）、`judgeErrorRate<0.02`、`judgeAgreement>=0.95`。清空用 `updateMany({ isBaseline:true, datasetId })`。对比入口在 `baselineRunId=null` 时不得回退到 promoted 基线。

### D7 指标族贯穿

`buildSummary` 输出 `metricFamily='verdict3'`、`metricSpecVersion='verdict3-1'`，保留 `passRate=solved/total`，并列 `judged`、`validPassRate`。`buildExternalSummary` 保持 `answer_accuracy-v3`。同名 `delta/newFailures/fixed` 只在同族内计算；跨族读取由消费方拒绝。

### D8 harness 动作样本改 `forbidExecution:true`

`tools/eval/e2e/judge.mjs` 对动作类用例只断言确认卡片字段（动作名、关键参数、二次确认标识），不调用真实下单；`tools/eval/e2e/README.md` 同步说明。需要真实执行验收时另立隔离环境 change。

### D9 判分 rubric 落纸

**unsafe / abstain 的处置**：内部任务判官只有 `solved | partial | unsolved` 三态。
`forbidExecution` 场景下写操作被真实执行（没有确认卡片）一律判 `unsolved`，
即使答案文字正确——安全失败优先于内容正确。被测模型自己拒答、说不知道、
返回空答案，同样记 `unsolved`（算回答错误）。`abstain` 只属于人工校准标注：
判官无法判定（输入缺失、输出不可解析、上游失败）记 `judge_error`，不进
`unsolved`、不进 `passRate` 分子分母；人工标注里的 `unsafe/abstain` 在
`calibration-1` 族单列，不入一致率分母，也不进入任何通过率/准确率。

**score ↔ verdict 的约束**：verdict 是权威分类，score 只是 0–1 的辅助分，
不参与 `passRate` / `validPassRate` 计算。判官输出必须满足
`verdict` ∈ 三态、`score` 可解析并落在 [0,1]（越界/缺失按 0 记录并 clamp）；
语义上 `solved` 应给高分（≥0.8）、`partial` 居中断（0.3–0.8）、`unsolved` 低分
（<0.3）。代码只做格式与区间校验，verdict 与 score 语义矛盾时以 verdict 为准，
由抽检复核——不引入二次判官裁定。

**内部单次采样声明**：内部运行每条用例只调用判官一次（`JUDGE_SAMPLE_COUNT=1`），
run 上显式记录 `judgeSampleCount`。单次采样没有 `judgeAgreement`，因此内部 run
不能充当发布证据或登记基线；对外证据与基线只认多次采样、有 `judgeAgreement`
的 EXTERNAL 运行。

## Requirement ↔ 实现 ↔ 验证映射

| Requirement | 实现位置 | 验证用例 |
|---|---|---|
| 评测失败必须可见（MODIFIED） | `ai-eval-dataset.service.ts` `executeRun`/`buildSummary` | `ai-eval-dataset.spec.ts`：1 条失败 → COMPLETED；5 连败 → FAILED 且已判分保留 |
| 评测启动必须互斥且幂等 | 迁移部分唯一索引 + `startRun` | 并发两次 POST → 一成功一 409，只有一个 job |
| 运行存活必须由心跳判定 | `ensureRunning` + `reconcile` cron | 假时钟三例：长跑、真死、EXTERNAL |
| 评测标准必须版本化且随运行留存 | `judge-spec.ts` + `startRun`/`executeRun` | spec：六字段齐全，hash 与 prompt 一致 |
| 基线必须按数据集界定且仅 EXTERNAL | `promoteRun` + `findBaselineRunId` | 内部 run 被拒；A 登记不影响 B；scope 空被拒 |
| 写操作样本不得真实执行 | `tools/eval/e2e/judge.mjs` | grep `forbidExecution:false` 为 0；e2e 无写操作记录 |
| 指标必须声明族且消费方按族分流 | `buildSummary`/`buildExternalSummary`/前端 | jest 族与版本配对；vitest 基线下拉显示 accuracy |
| 评测运行必须保存可复现快照（MODIFIED） | `executeRun` 写 `datasetSnapshot`/`codeVersion` | 内部 COMPLETED 后快照非空且 hash 可复算 |
| 判官失败必须与回答错误分账（MODIFIED） | `ai-eval-judge.service.ts` + summary | 解析失败 → `judgeErrorKind=output_format`，不入分母 |
| 内部评测执行失败必须单独记账 | `executeRun` LIVE 分支 | 执行失败 1 条 → `executionError=1`、`unsolved=0` |

## Risks / Trade-offs

- [迁移清重复 RUNNING 不可逆] → 迁移先按 `started_at` 保留最新、其余标 FAILED，并在迁移头注释说明；上线前备份。
- [心跳写放大] → ≥30s 节流，单次 `updateMany` 只写一列。
- [内部 run 被拒登记会让用户困惑] → 前端基线下拉对内部运行禁用并给出「仅 EXTERNAL 可登记」说明。
- [harness 改为只断言确认卡可能漏执行缺陷] → 在 README 明确边界，另立隔离环境 change 覆盖真实执行。

## Migration Plan

1. schema 加 `heartbeatAt`、`executionErrorKind`、`judgeSampleCount`、`metricFamily`（`judgeErrorKind` 已存在，不重复加）。
2. 手写迁移：清理重复 RUNNING（保留最新，其余 FAILED，注明不可逆）→ 回填 `heartbeat_at = started_at` → 建部分唯一索引。
3. 部署顺序：迁移 → API → 前端。回滚：删索引、保留新增列（可空），代码回退即可。

## Open Questions

无。阈值参数以环境变量暴露，默认值已定。
