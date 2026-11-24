# Design

## Context

现状与约束见 `proposal.md`。补充三条实现相关事实：

- `RagFaithfulnessService.judge()` 已支持 `expectedDocIds` 与 `citedDocIds`，由 `judge-input-spec.ts` 在服务端合并、去重并限 10 篇；harness 只需传原始字段。
- 指标版本由两处共同声明：`tools/eval/e2e/metrics-spec.mjs` 的 `METRIC_SPEC_VERSION` 与 `apps/api/src/admin/ai-eval/ai-eval-dataset.service.ts` 的 `CURRENT_METRIC_SPEC_VERSION`。
- 外部 run 的 `summary` 是 Json 字段，promote 直接读它；因此稳定性指标可以不加数据库列。

## Goals / Non-Goals

**Goals:**

- 让 `kbAccuracy` 的判官输入与回答实际使用的材料一致，消除 golden-only 视野偏差。
- 让判官噪声可测量、可门禁：逐次判定留痕，`judgeAgreement` 进入报告与基线规则。
- 保持离线重判与在线判定走同一套聚合逻辑，避免两处漂移。

**Non-Goals:**

- 不补 golden 集、不改回答、不改检索。
- 不做数据库迁移，不为逐次判定建表。
- 不在实时评测中同时跑严格与合并两套判定（成本 ×2）。

## Decisions

### D1. 重复判定放在服务端

`RagFaithfulnessService.judge()` 接收 `repeats`，并行发起 N 次相同的 `chain.invoke`，聚合后返回。

- 理由：输入规范已在服务端；聚合若放 harness，在线与离线会各写一份，必然漂移。
- 备选：harness 循环调用 N 次。被否，因为报告、promote、管理端调试会看到三套聚合规则。

### D2. 只接受奇数次数

`EVAL_JUDGE_REPEATS` 默认 3，取值 1/3/5；非法值回落 3 并告警。

- 理由：偶数会出现平票，必须额外定义打破规则；限制奇数让多数票始终存在。
- 备选：允许偶数 + 取首次判定破平。被否，破平规则会引入新的不确定性。

### D3. 聚合与失败分类

- 成功 = 判官返回可解析的 `faithful` 布尔值。
- 成功 ≥2 且有严格多数 → 采用多数结论；`score`、`reason`、`unsupportedClaims` 取多数阵营中首次出现的值。
- 平票或成功 <2 → `faithful: null`、`errorKind: 'output_format'`、`reason: 'judge_disagreement'`，并保留 `judgeAttempts`。
- 全部失败 → 沿用现有 `classifyJudgeError`，`errorKind` 取首个失败类型。
- `judgeAgreement` = 多数阵营票数 / 成功次数；成功 <2 时仍计算，但报告只把 ≥2 次的用例计入稳定性分母。

理由：把「判官意见不一致」与「调用失败」分开记录，避免分歧被误算成回答错误，也不让 API 失败率失真。

### D4. 稳定性指标放 run summary，不加列

`judgeAgreement`、`judgeDisagreement` 写入外部 run 的 `summary` Json；逐次判定留在 `detail.json`。

- 理由：`summary` 已是 promote 的输入；加列需要迁移，且历史 run 无值，收益低。
- 备选：`AiEvalResult` 加 `judgeAgreement` 列。被否，为可推导的汇总值做 schema 变更加大回滚面。

### D5. v3 主口径合并，严格口径只做离线诊断

实时评测与离线重判默认用 golden ∪ cited；`rejudge --with-strict` 额外产出 golden-only 结果，存 `rejudge.strictAgreement`。

- 理由：实时双判会让判官调用再翻一倍；严格口径的用途是对照与防作弊，不需要每轮都跑。
- 报告必须并列展示两者，防止只用合并后的高数字掩盖回归。

### D6. 指标版本 3 与 promote 新门槛

`METRIC_SPEC_VERSION = 3`，`CURRENT_METRIC_SPEC_VERSION = '3'`；promote 增加 `summary.judgeAgreement ≥ EVAL_MIN_JUDGE_AGREEMENT`（默认 0.95）。

- 理由：口径变了，版本必须变；稳定性不足的运行不应成为比较基准。
- 顺序：先校验判官错误率，再校验版本齐全与指标版本一致，最后校验 agreement，保证错误信息按可修复顺序给出。

### D7. 历史结果不迁移

v2 报告与 run 保留原样；v3 只用于新一轮重判。

- 理由：重判可离线完成，且 v2 数字本身不可靠，迁移没有意义。

## Risks / Trade-offs

- **判官调用 ×3** → 降低 harness 并发；`judgeErrorRate < 2%` 仍会兜住超时与限流；必要时把 `EVAL_JUDGE_REPEATS` 调到 1 做诊断跑。
- **翻转可能相关而非独立** → 不假设多数票一定把噪声降到 0.1%；以报告中的 `judgeAgreement` 实测为准，若低于 95% 先查具体用例，不调低门槛。
- **放宽来源可能掩盖「引用了错文档但内容恰好对」** → 严格口径并列、已知真错误必须仍判 false、`hit@3` 独立报告检索质量，三者共同约束。
- **平票被记为 judge_error 会轻微抬高失败率** → 单列 `judgeDisagreement`，并保持 2% 阈值不变；若分歧集中在少数用例，按用例修，不按指标放水。
- **v2/v3 不可比** → 报告头与 run 均记版本；跨版本比较直接标为不可比。

## Migration Plan

1. 后端先上：判官服务支持 `repeats`，默认 3；旧调用方不传时行为变为 3 次，属预期变更。
2. harness 后上：默认按合并口径判，报告与 summary 带 agreement。
3. 指标版本同步升 3；此后任何 v2 run 不能 promote。
4. 复测两批历史回答（离线重判，不重跑用例），再决定 6.2。
5. 回滚：`EVAL_JUDGE_REPEATS=1` 恢复单次判定；严格口径用 `--with-strict` 复现；无数据迁移需要回滚。
