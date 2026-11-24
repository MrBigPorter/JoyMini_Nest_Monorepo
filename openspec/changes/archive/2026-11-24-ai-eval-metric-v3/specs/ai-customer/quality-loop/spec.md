# Spec Delta

## ADDED Requirements

### Requirement: 答案准确率必须覆盖回答实际引用的来源

计算知识问答准确率时，判官可见的来源 SHALL 包含 golden 文档与回答本轮实际引用的文档。服务端 MUST 按 golden 优先合并、去重，并沿用篇数与字符预算。仅使用 golden 的判定 MUST 只用于离线诊断，不得用于基线验收。

#### Scenario: 引用文档包含依据

- **WHEN** 回答引用了 golden 之外、但本轮真实检索到的文档，且该文档包含回答所依赖的事实
- **THEN** 判官 MUST 看到该文档，且 MUST NOT 把该事实断言判为无依据

#### Scenario: 严格口径只作诊断

- **WHEN** 以 golden-only 口径重判同一批回答
- **THEN** 报告 MUST 将该结果标为诊断，且 MUST NOT 用它决定基线或验收

#### Scenario: 错误归属仍然判负

- **WHEN** 回答把某条规则、路径或政策归属到并不包含它的文档
- **THEN** 即使扩大了来源范围，判决 MUST 仍为 `incorrect`

### Requirement: 答案判定必须重复采样并报告一致性

每次答案判定 SHALL 重复采样奇数次（默认 3 次，可配置为 1、3 或 5），并按多数聚合。结果 MUST 记录逐次判定与 `judgeAgreement`（全票一致的尝试占比）。平票或成功次数不足时 MUST 记为 `judge_error`，并单列判官分歧，不得计入回答错误。

#### Scenario: 三次一致

- **WHEN** 三次判定给出相同结论
- **THEN** 采用该结论，`judgeAgreement` 记为 1

#### Scenario: 二比一

- **WHEN** 三次判定中有两次为同一结论
- **THEN** 采用多数结论，`judgeAgreement` 记为 0.67

#### Scenario: 平票

- **WHEN** 成功判定之间无法形成多数
- **THEN** 该条记为 `judge_error`，并计入判官分歧，不计为回答错误

#### Scenario: 成功次数不足

- **WHEN** 重复判定中成功次数少于 2
- **THEN** 该条 MUST 记为 `judge_error`，并保留逐次错误类型

#### Scenario: 回滚到单次判定

- **WHEN** 重复次数配置为 1
- **THEN** 行为 MUST 等价于单次判定，`judgeAgreement` 记为 1 并标记尝试次数不足

### Requirement: 基线登记必须包含判官稳定性门槛

一次运行除满足判官错误率与版本条件外，SHALL 在 `judgeAgreement` 不低于阈值（默认 95%）时才可登记为基线。`judgeAgreement` 缺失或不达标时 MUST 拒绝登记，并给出可读原因。

#### Scenario: 一致性缺失

- **WHEN** 运行摘要中没有 `judgeAgreement`
- **THEN** 登记 MUST 被拒绝，且原因说明无法验证判官稳定性

#### Scenario: 一致性不达标

- **WHEN** `judgeAgreement` 为 90%，低于 95% 阈值
- **THEN** 登记 MUST 被拒绝，报告标注为仅诊断

#### Scenario: 一致性达标

- **WHEN** `judgeAgreement` 为 97%，其余条件也满足
- **THEN** 运行 SHALL 允许登记为新基线
