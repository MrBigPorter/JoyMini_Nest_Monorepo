# Tasks

## 1. 记录层：评测运行落库

- [x] 1.1 在 `apps/api/prisma/schema.prisma` 给 `AiEvalRun` 增加 `datasetSnapshot Json?`、`codeVersion String?`、`gateMode String?`、`judgeSpecVersion String?`、`metricSpecVersion String?`、`isBaseline Boolean @default(false)`；给 `AiEvalResult` 增加 `answerVerdict String?`、`answerScore Float?`、`grounding String?`、`judgeErrorKind String?`、`judgeInputHash String?`、`judgeSpecVersion String?`；现有 `verdict` / `score` 保留给任务成功率并改为 **nullable**（EXTERNAL run 没有任务判定）；`mode` 是 String，无需枚举迁移。验证：`yarn workspace @lucky/api prisma generate` 与 `tsc --noEmit` 通过，并列出所有因 nullable 需要改的读取方。
- [x] 1.2 新增外部运行两段接口：`POST /admin/ai-eval/runs/external`（创建 RUNNING、返回 `runId`）与 `POST /admin/ai-eval/runs/:id/external-results`（写 `cases[]` 并收尾）。外部结果只写 `answerVerdict` / `answerScore`，不写 `verdict` / `score`。首次写入按 `datasetFingerprint` 物化 `AiEvalDataset` + `AiEvalCase`，后续复用；`EXTERNAL` 必须绕开 `recoverStaleRuns` 的 30 分钟清扫与单 RUNNING 守卫，stale 阈值放宽到 24 小时；`startRun`/`executeRun` 显式拒绝或短路 EXTERNAL。验证：service 单测覆盖「首次物化」「同 fingerprint 复用」「数量不一致拒绝」「EXTERNAL 不被 stale 清扫」「EXTERNAL 不被 executeRun 重跑」「verdict/score 为 null 不报错」。
- [x] 1.3 在 run 汇总中计算 `judgeErrorRate`、`accuracy`（`correct/(correct+incorrect)`）与分型分布，写入 `summary`；全部基于 `answerVerdict`，与 `verdict` 的任务成功率分开。验证：单测断言含 `judge_error` 时准确率分母不含该条，且两套指标不互相覆盖。
- [x] 1.4 管理端 run 详情返回新增版本字段与判官错误率；`ai-ops/quality` 与类型定义补 `EXTERNAL` 分支，EXTERNAL 的通过率显示 `summary.accuracy` 而不是 `verdict`；同时修掉 `verdict` / `score` 变 nullable 后的空值处理（基线 `passRate`、对比段、前端类型）。验证：controller 单测 + 页面/类型测试。

## 2. 口径层：判官输入规范

- [x] 2.1 新增 `apps/api/src/admin/rag/judge-input-spec.ts`：导出 `JUDGE_INPUT_SPEC_VERSION` 与 `buildJudgeInput({ question, answer, sources?, expectedDocIds?, citedDocIds? })`；内部完成来源挑选（相关度排序 + 固定 tie-break、单来源 2000 / 总 8000 上限）、回答截断、`redactForJudge()`。同时新增 `RagService.getChunksByDocId(docId, locale='en')`（`docId` 非全局唯一）。验证：单测覆盖「同一邮箱在 answer 与 sources 脱敏形态一致」「超限截断」「无 golden 文档时只用引用文档」「相同输入 hash 稳定」。
- [x] 2.2 改造 `rag-faithfulness.service.ts` 使用该规范；判官请求 DTO 的 `sources` 改可选、新增 `expectedDocIds?` / `citedDocIds?`；响应增加 `judgeInputHash` 与 `judgeSpecVersion`；判官失败返回 `faithful: null` + `errorKind`，不再返回 `faithful: false`；保留 `EVAL_JUDGE_SPEC=v1|v2` 开关，Phase 2 默认 v2、保留 v1 回滚入口。验证：现有 `rag-faithfulness` 单测全绿，新增断言 hash 稳定与失败返回结构。
- [x] 2.3 改造 `tools/eval/e2e/judge.mjs` 与 `rejudge.mjs`：不再自行拼接 sources，只传 `sources` 或 `expectedDocIds/citedDocIds` 原始字段并读取返回的 hash/version；同批更新 `judge.test.mjs` 的 `stubAdmin`（当前按 `sources` 判断）。验证：`node --test tools/eval/e2e/judge.test.mjs` 与一次小样本判官调用通过。
- [x] 2.4 更新 `tools/eval/e2e/README.md`：写明判官输入规范、`judgeSpecVersion` 的意义与 v1/v2 结果不可混比。验证：文档中的命令可照抄执行。

## 3. 判定层：三态与错误分类

- [x] 3.1 改造 `rag-faithfulness.service.ts`（答案准确性判官，不是 `ai-eval-judge.service.ts`）：判官对答案返回 `answerVerdict`（`correct | incorrect | judge_error`），解析失败、超时、鉴权、限流、内容策略分别映射 `judgeErrorKind`；失败返回 `faithful: null + errorKind`。`ai-eval-judge.service.ts` 的 `solved/partial/unsolved` 保持原语义不动。验证：单测覆盖五种错误分类各一条。
- [x] 3.2 更新报告指标计算：`isApplicableJudged` 必须排除 `errorKind != null`（不能只看 `faithful != null`）；`kbAccuracy` 分母使用 `answerVerdict` 且排除 `judge_error`；新增 `judgeErrorRate` 并写入 summary；判官错误率超阈值时报告标注「仅诊断」。验证：`node --test tools/eval/e2e/report.test.mjs` 全绿。
- [x] 3.3 管理端评测报告页显示判官错误率与错误类型分布。验证：控制器返回字段单测。

## 4. 归因层：trace 与 run 双向可查

- [x] 4.1 在 `graph/state.ts` 增加 `promptBinding`（reducer 后写覆盖、默认 null）；`PromptResolverService` 的结果在 `orchestrator.node.ts` 写入 state，无 DB override 时 `name` 回退 `entry.tag`、`source='code'`。所有 orchestrator 返回路径必须显式写 `promptBinding`（含 null），多 agent 取第一个成功执行的标准 agent 为主绑定，全部绑定存 `metadata.promptBindings[]`。验证：`orchestrator.node.spec.ts` 断言 DB 覆盖、代码内置、多 agent 主绑定与跨轮不残留。
- [x] 4.2 `ai-customer.service.ts` 的 `recordReplyTrace` 从 `finalState.values.promptBinding` 读取并写入 `promptName` / `promptVersion`。验证：`ai-customer.trace.spec.ts` 断言两种来源的 trace 入参。
- [x] 4.3 harness 在 run 开始时记录 `codeVersion`（`GIT_SHA` 或 `git rev-parse HEAD`）、`gateMode`、`judgeSpecVersion`、`metricSpecVersion`，随外部运行接口写入。验证：`run.test.mjs` 断言 run 元数据完整。

## 5. 指标规范

- [x] 5.1 新增 `tools/eval/e2e/METRICS.md`：逐条写明 `answeredRate`、`kbAccuracy`、`ungroundedRisk`、`hitAt3`、`judgeErrorRate`、`p95Latency` 的定义、分母、排除项、数据来源（见 design.md D5 表）。
- [x] 5.2 新增 `tools/eval/e2e/metrics-spec.mjs`：导出 `METRIC_SPEC_VERSION = 2` 与各指标计算函数；`report.mjs` 改为调用它，删除内联公式。验证：`report.test.mjs` 与新增 `metrics-spec.test.mjs` 全绿。

## 6. 基线规则

- [x] 6.1 新增 `POST /admin/ai-eval/runs/:id/promote`：校验 COMPLETED、`judgeErrorRate < EVAL_MAX_JUDGE_ERROR_RATE`（默认 0.02）、四个版本字段齐全、`metricSpecVersion` 与当前一致；失败返回可读原因。验证：单测覆盖四条拒绝原因与一条成功。
- [x] 6.2 提升基线时在事务内把其他 run 的 `isBaseline` 置 false；`startRun` / `loadBaseline` 在未显式传 `baselineRunId` 时回退到当前 `isBaseline` run。验证：单测断言全局只有一条基线，且未传 baselineRunId 时比较用的是它。
- [x] 6.3 报告读取库中的 run 记录生成对比段，`detail.json` 仍导出；不复用现有的 `EvalReportsController`（它读的是 `tools/eval/conversation/reports`，与 e2e harness 无关）。验证：一次外部 run 写入后，报告核心指标与库内 summary 一致。

## 7. 6.2 收口

- [x] 7.1 用 `JUDGE_INPUT_SPEC_VERSION=v2` 重判 `20261124-005755` 与 `20261124-113254` 的既有回答，不重跑用例；两次重判使用同一 `metricSpecVersion`。验证：产出 `reports/20261124-113254-rejudged-v2/summary.md`，含 kbAccuracy、judgeErrorRate 与判官错误分布。
  - 2026-11-24 已重判（judgeSpecVersion `v2`、metricSpecVersion `2`，未重跑用例）：
    - `reports/20261124-005755-rejudged-v2/summary.md`：kbAccuracy 72/83 = 86.7%，judgeErrorRate 0/273 = 0.0%，错误分布为空。
    - `reports/20261124-113254-rejudged-v2/summary.md`：kbAccuracy 78/89 = 87.6%，judgeErrorRate 0/302 = 0.0%，错误分布为空。
- [x] 7.2 对重判结果抽 10 条人工核对判官理由，记录一致率。验证：报告列出抽检清单与结论。
  - 2026-11-24 分层抽检 10 条（5 条不一致、3 条翻真、2 条一致）：一致 **7/10 = 70%**；3 条不一致全部是判官过宽（把无来源/错误归属判成支持），无反向误判。清单与逐条证据见 `reports/20261124-113254-rejudged-v2/manual-review.md`，摘要已并入同目录 `summary.md`。按抽检修正后 kbAccuracy 为 **75/89 = 84.3%**。
- [x] 7.3 依据 7.1/7.2 决定 `ai-answer-grounding` 6.2 是否勾选并登记基线；同步更新 `tasks.md`、memory 与 `docs/current-task.md`。验证：6.2 的结论有数字与链接支撑。
  - 决定（2026-11-24）：**6.2 不勾选，不登记新基线**。v2 表面 kbAccuracy 87.6% 达标，但 3 条翻真在人工复核中均不成立，修正后 84.3% 低于 85.5%；在判官一致率稳定前，任何 v2 数字都不能作为验收依据。
  - 阻塞项：判官对「事实断言归属到错误文档/错误路径」仍过宽（`r63` 闪购细节、`r79`/`rz28` Privacy Settings）。下一步先收紧判官提示词（每条断言必须同上下文支持、错误归属即不支持），再重判同一批回答并重新抽检。已同步 `ai-answer-grounding/tasks.md`、memory 与 `docs/current-task.md`。

## Workflow follow-up

- 归档前执行 `openspec validate ai-eval-loop --strict`。
- 文档评审通过后再开始 Phase 1 代码实现。
