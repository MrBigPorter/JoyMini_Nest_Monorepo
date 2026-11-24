# Spec Delta

## ADDED Requirements

### Requirement: 无依据作答率必须单独报告

系统 SHALL 在每次回复质量评测中按依据分型（`kb` / `tool` / `none` / `fallback`）分别统计条数，并把 `none` 组作为「无依据作答率」单独报告。`none` 组 MUST NOT 进入准确率分母，MUST NOT 与兜底话术合并计算。

#### Scenario: 报告分型分布

- **WHEN** 一次评测完成
- **THEN** 报告给出四类依据的条数，并单列无依据作答率（无依据条数 / 真实回答条数）

#### Scenario: 无依据不并入准确率

- **WHEN** 某条回答既没有知识库 sources 也没有工具结果
- **THEN** 该条计入无依据作答率，不计入「与期望答案一致」的分母

#### Scenario: 兜底话术不算回答

- **WHEN** 回复命中固定兜底话术
- **THEN** 该条记为 `fallback`，既不计入真实回答率，也不计入无依据作答率

### Requirement: 依据分型的判定必须来自运行时记录

系统 SHALL 用运行时产生的依据记录（知识库 sources 数量、工具执行记录）判定分型，MUST NOT 由评测脚本根据回答文本猜测。

#### Scenario: 只有工具结果

- **WHEN** 运行时记录显示本轮执行了工具但没有知识库 sources
- **THEN** 评测把该条记为 `tool`，不判为无依据

#### Scenario: 记录缺失

- **WHEN** 某条回复在运行时记录中找不到依据信息
- **THEN** 评测把该条标记为分型未知并单列，不猜测归类
