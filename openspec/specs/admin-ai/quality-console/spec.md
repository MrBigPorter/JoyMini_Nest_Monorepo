# admin-ai/quality-console Specification

## Purpose

规定管理端 AI 质量台如何如实呈现状态、按角色承载四类决策，并保证质检主流程的每个操作都有可预期的结果与可追溯的证据。

## Requirements

### Requirement: 管理端页面必须如实呈现失败、禁用与未知

页面 SHALL 区分「加载中」「已禁用（无权限或开关关闭）」「请求失败」「无数据」四种状态；空值与未知 SHALL 显示为「未知」或「未检查」。外部运行的覆盖率与跨运行抖动 SHALL 按服务端口径呈现，不得另算；历史运行缺少这些字段时 MUST 显示「未记录」，MUST NOT 显示 0 或「暂无」。MUST NOT 把 403 吞成成功或 `undefined`，MUST NOT 用 0 或「暂无」代替未知，MUST NOT 把前端推断当作后端事实。

#### Scenario: 无权限访问

- **WHEN** 当前角色无权访问某写操作或评测开关关闭
- **THEN** 页面 MUST 显示禁用态与原因，MUST NOT 渲染写入口或成功提示

#### Scenario: 指标未知

- **WHEN** 后端未返回某指标或请求失败
- **THEN** 页面 MUST 显示「未知」或「未检查」，MUST NOT 显示 0

#### Scenario: 前端推断

- **WHEN** 页面根据现有字段推断出某结论
- **THEN** 该结论 MUST 标注「推断」，MUST NOT 与后端事实同等呈现

#### Scenario: 历史运行缺少覆盖率

- **WHEN** 某次运行未记录覆盖率或判定翻转率
- **THEN** 页面 MUST 显示「未记录」，MUST NOT 显示 0、MUST NOT 用其他字段推算

#### Scenario: 两次运行不可比

- **WHEN** 差异接口返回不可比原因
- **THEN** 页面 MUST 展示原因，MUST NOT 渲染差异数字

### Requirement: 角色视图必须与决策对应

同一页面 SHALL 按角色提供默认视图：运营默认队列，质量负责人默认运行、基线与证据，研发默认链路与检索调试，管理者默认趋势与成本；切换视图 MUST NOT 改变数据口径。MUST NOT 用单一默认视图承载四类决策，MUST NOT 在缺证据字段时展示百分比。

#### Scenario: 运营进入页面

- **WHEN** 运营角色打开质量台
- **THEN** 默认落在分诊队列，可直接认领与提交

#### Scenario: 质量负责人进入页面

- **WHEN** 质量负责人打开质量台
- **THEN** 默认落在运行、基线与发布证据，缺证据时列出缺项

#### Scenario: 切换视图

- **WHEN** 同一用户切换视图
- **THEN** 同一运行的数字 MUST 保持一致，不得因视图不同而重算

### Requirement: 质检卡片必须可跳过且归因不得被默认值覆盖

跳过操作 SHALL 只移动当前游标，不提交、不回队首；归因初值 SHALL 取该条自身归因或当前筛选条件，切换条目 MUST 重置。MUST NOT 跳回第 1 条，MUST NOT 用固定默认值覆盖已有归因。

#### Scenario: 跳过第一条

- **WHEN** 运营在第一条点击跳过
- **THEN** 游标 MUST 后移到下一条，MUST NOT 停留在第一条

#### Scenario: 按归因筛选后进入

- **WHEN** 运营按某归因筛选后打开质检
- **THEN** 归因初值 MUST 为该筛选值或该条已有归因，MUST NOT 为固定的 `UNKNOWN`

#### Scenario: 切换条目

- **WHEN** 运营从一条切到另一条
- **THEN** 归因选择 MUST 重置为新条目的值

### Requirement: 分诊提交必须防重复且备注可选

同一条记录的提交 SHALL 在请求中禁用重复触发；备注 SHALL 可选且内联输入；认领与处理完成 MUST 在列表与卡片上分开呈现。MUST NOT 使用阻塞式弹窗收集备注，MUST NOT 在取消备注时仍提交，MUST NOT 让已认领记录显示为未处理。

#### Scenario: 双击提交

- **WHEN** 运营双击提交或连按 Enter
- **THEN** 同一条记录 MUST 只发出一次请求

#### Scenario: 取消备注

- **WHEN** 运营打开备注后取消
- **THEN** 系统 MUST NOT 提交该条分诊

#### Scenario: 已认领记录

- **WHEN** 一条记录已被认领但未处理完成
- **THEN** 列表 MUST 显示「已认领」，MUST NOT 显示「待处理」且未区分

### Requirement: 质检证据必须可追溯

质检卡片 SHALL 展示关联链路的失败步骤、错误摘要与建议归因；匹配 MUST 优先按消息标识精确匹配，回退到会话最新时 MUST 标「近似」；链路已清理时 MUST 标「证据已过期」。MUST NOT 在无链路时伪造归因，MUST NOT 展示与当前记录不对应的链路。

#### Scenario: 精确匹配

- **WHEN** 反馈可定位到具体消息的链路
- **THEN** 卡片 MUST 展示该链路中失败步骤的错误摘要

#### Scenario: 仅会话级匹配

- **WHEN** 只能回退到会话最新链路
- **THEN** 证据 MUST 标注「近似」

#### Scenario: 链路已清理

- **WHEN** 关联链路已超过保留期被清理
- **THEN** 卡片 MUST 标注「证据已过期」，MUST NOT 展示其他链路顶替

### Requirement: 分页必须在总量缩水后回退

列表 SHALL 在总数缩水导致当前页越界时自动回退到最后一页并重新取数。MUST NOT 停在空页，MUST NOT 把空页判定为「暂无数据」。

#### Scenario: 处理完当前页最后一条

- **WHEN** 当前页最后一条被处理导致总数缩水
- **THEN** 列表 MUST 自动回退并展示上一页数据

#### Scenario: 总数归零

- **WHEN** 筛选结果确实为零
- **THEN** 列表 MUST 显示真正的空状态，不得与越界空页混淆
