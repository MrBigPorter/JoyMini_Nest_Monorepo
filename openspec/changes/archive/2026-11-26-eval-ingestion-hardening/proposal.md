# Proposal

## Why

一次真实 harness 运行的 225 条用例中，有 131 条被记为 `judge_error`。其中 3 条是**从未被判过**的 negative 用例（本身没有 golden 文档），却因为收录层伪造了「golden 适用」状态，被兜底归类为判官输出格式故障 `output_format`。这个虚假失败把判官失败率推到 3.09% / 3.13%，两次运行都因此被基线 promote 门禁拒绝，A/B 基线独立性验证无法完成。

根因不是判官模型，而是收录判定树从未被写成契约：三个分支（没判过、判官调用失败、判官给了结论）在代码里靠文本猜测区分。同一片代码上还叠着五个同源缺口——未判条数不可见、判官原始输出不留痕、判官输出靠自由文本解析、用量是字符估算、跨运行比较只校验「同 datasetId」。六项共用判官链路、summary 与 ingest 三段代码，一起做才不用同一处改两遍。

## What Changes

- **收录判定穷尽化**：每条用例必须落到 `correct` / `incorrect` / `judge_error(kind)` / `not_applicable` 四态之一；**没调过判官**的用例不再记为判官失败；收录层不得伪造「golden 适用」。不新增第六类失败枚举。
- **覆盖率可见**：运行 summary 新增 `judgedCases` 与 `coverage`，分母为本次入库条数，0 条时为 `null`。harness 生成本地副本仅用于对账，权威值由服务端单点计算。
- **判官原始输出可审计**：每次判官尝试落独立表（有长度上限、落库前脱敏、仅 ADMIN 及以上可读、按保留期清理）。成功路径不再直接丢弃原始输出。
- **判官输出结构化约束**：优先请求 JSON 模式并做 schema 校验，解析失败回退现有文本解析；provider 不支持时可关开关退回，不得整链失败。判官侧版本号随之上调。
- **用量区分真实与估算**：usage 标明 `real` / `estimated` / `mixed` 并按角色分账；provider 不返回时标 `unavailable`，不得补 0 当真实值；预算口径必须可解释。
- **跨运行比较校验可比性**：差异接口在给出四类差异之外，必须校验两次运行的可比性并给出翻转率；不可比时明示原因而非给数字。

**BREAKING**：无对外接口删除；`run.summary` 为新增字段，旧 run 缺字段时按「未记录」呈现。

## Capabilities

### New Capabilities

无。六项都是既有评测闭环能力的契约补全，不引入新 capability。

### Modified Capabilities

- `admin-ai/quality-loop`：新增「收录判定必须状态穷尽」「评测覆盖率必须可见」「判官原始输出必须可审计且受保留期约束」「判官输出必须受结构化约束且可降级」「评测用量必须区分真实与估算」五条 Requirement；修改「回归用例必须可解释」，加入可比性校验与翻转率。
- `admin-ai/quality-console`：修改「管理端页面必须如实呈现失败、禁用与未知」，要求覆盖率与抖动按同一口径呈现，旧数据缺字段显示「未记录」而不是 0。

## Impact

- **harness**（`tools/eval/e2e/`）：`traces.mjs` 依据分型不再伪造 golden 适用；`external-sync.mjs` 判定改为穷尽映射并要求结构化错误类优先；`summarizeExternalResults` 新增覆盖率字段。
- **api**（`apps/api/src/admin/ai-eval/`、`apps/api/src/admin/rag/`）：判官响应带上限内原始输出；新增判官尝试表与迁移；外部结果 ingest 与内部执行写尝试记录；run summary 增字段；差异与历史接口接入可比性校验；新增只读查询接口与保留期清理任务。
- **admin-next**：质量台外部运行摘要展示覆盖率，差异卡片展示翻转率与不可比原因；旧 run 显示「未记录」。
- **db**：新增一张判官尝试表及其索引，`ai_eval_results` 与 `ai_eval_runs` 结构不变。
- **指标版本**：不升 `METRIC_SPEC_VERSION`（分母口径本身未变，只是把「没判过」正确排除）；判官侧 `JUDGE_PROMPT_VERSION` / `JUDGE_SPEC_VERSION` 需上调，既有基线需重跑一次。
- **不影响**：在线聊天链路、发布门禁判定阈值、既有 promote 规则、`judge_error` 枚举集合。

## Out of Scope

- 不修「没有 trace 的 negative 仍可能进入准确率分母」这一残留缺口——它改变准确率总体口径，必须单独升 `METRIC_SPEC_VERSION` 并重跑基线，另开变更。
- 不做 per-case 用量与 per-case 判官抖动的持久化迁移（本批只做运行级与尝试级）。
- 不引入第六类 `judge_error` 枚举。
