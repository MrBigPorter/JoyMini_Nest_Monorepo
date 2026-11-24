# Tasks

## 1. 判官服务（重复判定与聚合）

- [x] 1.1 在 `dto/judge-rag.dto.ts` 增加 `repeats?: number`（允许 1/3/5），并在 `rag.controller.ts` 透传到 `FaithfulnessJudgeParams`。验证：`yarn workspace @lucky/api tsc --noEmit --pretty` 通过，现有 controller 测试不回归。
- [x] 1.2 在 `rag-faithfulness.service.ts` 实现 N 次并行判定与多数聚合，返回 `judgeAttempts`、`judgeAgreement`、`judgeDisagreement` 标记；平票或成功不足记 `judge_error`（reason `judge_disagreement`）。验证：`rag-faithfulness.service.spec.ts` 覆盖三次一致、2:1、平票、仅 1 次成功、全部失败五条。
- [x] 1.3 读取 `EVAL_JUDGE_REPEATS`（默认 3，仅 1/3/5），非法值回落 3 并告警；N=1 行为与旧实现等价。验证：单测断言非法值与 N=1。
- [x] 1.4 确认 `not_applicable`（无来源）路径不发起重复调用。验证：单测断言该路径下判官链调用次数为 0。

## 2. Harness 与指标

- [x] 2.1 `judge.mjs` 的 `judgeGoldenAgreement` 分别传 `expectedDocIds` 与 `citedDocIds`（取自本轮 `reply.sources` 去掉 golden），由服务端合并。验证：`judge.test.mjs` 新增「引用文档被传入」与「无引用时为空」两条。
- [x] 2.2 `rejudge.mjs` 默认按合并口径判；新增 `--with-strict` 额外产出 `rejudge.strictAgreement`；`meta.rejudge` 记录 `judgeRepeats` 与全票一致率。验证：`rejudge.test.mjs` 覆盖默认口径、`--with-strict`、版本字段。
- [x] 2.3 `external-sync.mjs` 的 `summarizeExternalResults` 增加 `judgeAgreement`（全票一致用例 / 有 ≥2 次成功的用例）与 `judgeDisagreement`，并纳入 `compareSummaryWithRecord`。验证：对应测试覆盖汇总与不一致检测。
- [x] 2.4 `report.mjs` 主 `kbAccuracy` 用 v3 合并口径，存在 `strictAgreement` 时并列严格诊断行，新增 `judgeAgreement` 行（带 CI）与判官分歧计数。验证：`report.test.mjs` 断言三种行都出现且数字来自对应口径。
- [x] 2.5 `metrics-spec.mjs` 升 `METRIC_SPEC_VERSION = 3`，新增 `judgeAgreement(judges)` 纯函数。验证：`metrics-spec.test.mjs` 覆盖全票、2:1、成功不足三种输入。
- [x] 2.6 更新 `tools/eval/e2e/METRICS.md`（v3 定义、严格口径仅诊断、agreement 分母、promote 第 6 条、版本历史）与 `README.md`（重判命令、三个版本号）。验证：README 中命令可照抄执行；`node --test tools/eval/e2e/*.test.mjs` 全绿。

## 3. 基线规则

- [x] 3.1 `ai-eval-dataset.service.ts` 的 `CURRENT_METRIC_SPEC_VERSION` 升 `'3'`；promote 读取 `summary.judgeAgreement`，阈值取 `EVAL_MIN_JUDGE_AGREEMENT`（默认 0.95），缺失或不达标给出可读原因。验证：`ai-eval-dataset.service.spec.ts` 覆盖缺失、90% 拒绝、97% 通过。
- [x] 3.2 确认外部 run 写入路径保留 `summary.judgeAgreement` / `judgeDisagreement`，不被白名单裁掉。验证：外部 run 测试断言入库 summary 含这两个字段。

## 4. 集成与复测

- [x] 4.1 `docker restart lucky-backend-dev` 后，用 v3 + 3 次重判 `reports/20261124-113254/detail.json`（带 `--with-strict`）。验证：合并口径约 95%、`judgeAgreement ≥ 95%`、严格诊断行存在、`r79`/`rz28` 仍判 false。
- [x] 4.2 同口径重判 `reports/20261124-005755/detail.json`。验证：合并口径约 95%、`r14`/`r16`/`rz21` 仍判 false、agreement 达标。
- [x] 4.3 按 4.1/4.2 结果更新 `openspec/changes/ai-answer-grounding/tasks.md` 6.2：达标才勾选并登记基线，不达标保留未勾并记录原因。验证：结案文字包含数字与报告路径。
- [x] 4.4 更新 `docs/current-task.md` 与两份 memory（`ai-answer-grounding-progress`、`ai-eval-loop-progress`）。验证：状态与新口径一致，不残留 v2 结论。
- [x] 4.5 全量验证：`yarn workspace @lucky/api tsc --noEmit --pretty`、判官与 promote 相关 Jest、`node --test tools/eval/e2e/*.test.mjs`、`openspec validate ai-eval-metric-v3 --strict` 全部通过。

## Workflow follow-up

- 代码与复测完成后提交；`ai-answer-grounding` 与 `ai-eval-loop` 的归档按项目流程另行处理。
- 若 4.1/4.2 的 agreement 低于 95%，先按用例排查判官分歧，不调低门槛。
