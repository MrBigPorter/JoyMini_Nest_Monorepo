# Proposal

## Why

`kbAccuracy` 目前只把 golden 文档交给判官。回答在本轮检索后合法引用了其它真实文档时，判官看不到依据，会把正确回答判成「无依据」（113254 的 19 条 false 中 15 条属此类）。同时判官对同一输入会翻转（2/97），89 条样本的 95% CI 约 ±7pp，大于 6.2 的验收差距（1 条）。

结果是这个指标在量判官的视野与漂移，而不是回答质量；继续用现口径重跑，只会把判官噪声当成产品变化。

## What Changes

- 判官输入从 golden-only 扩为 **golden ∪ 回答本轮实际引用的文档**；由服务端合并，golden 优先，仍限制 10 篇、8000 字符预算与对称脱敏。
- 每题**重复判定 3 次**（`EVAL_JUDGE_REPEATS`，只接受奇数），按多数聚合；返回逐次判定与 `judgeAgreement`。
- 平票或成功次数不足时记 `judge_error`，reason 标 `judge_disagreement`，并单列「判官分歧」，不混入回答错误。
- 新增 `judgeAgreement` 指标与基线登记门槛（默认 ≥ 95%，`EVAL_MIN_JUDGE_AGREEMENT`）；缺失或不达标不得登记基线。
- 严格 golden-only 口径降为**离线诊断**（`rejudge --with-strict`），不再作为实时验收口径。
- **BREAKING（口径）**：`METRIC_SPEC_VERSION` 2 → 3。v2 与 v3 的 `kbAccuracy` 不得直接比较，历史报告保留不覆盖。
- 不新增数据库列；`judgeAgreement` / `judgeDisagreement` 写入 `AiEvalRun.summary`（Json）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ai-customer/quality-loop`: 判官输入范围、重复判定与一致性报告、基线登记的稳定性门槛。

## Impact

- 代码：`apps/api/src/admin/rag/`（判官服务、DTO、controller）、`apps/api/src/admin/ai-eval/ai-eval-dataset.service.ts`（promote 校验）。
- 评测工具：`tools/eval/e2e/` 的 `judge.mjs`、`rejudge.mjs`、`report.mjs`、`metrics-spec.mjs`、`external-sync.mjs`、`METRICS.md`、`README.md`。
- 运行成本：判官用例的 LLM 调用 ×3；无 Prisma 迁移。
- 兼容性：v2 历史结果只作历史；回滚用 `EVAL_JUDGE_REPEATS=1` 恢复单次判定，但指标版本仍以 v3 为准。
