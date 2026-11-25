# ai-quality/loop-contract Specification

## Purpose

为 AI 质量闭环定义跨管理端与客服端的唯一行为契约：每个产出有消费方、每个指标有族与版本、每个状态可推进、每个对外数字可溯源。

## Requirements

### Requirement: 链路十步必须各有唯一产出与消费方

链路的每个实体、字段与枚举值 SHALL 在契约注册表中登记所属步骤、产出方与消费方；消费方为空时 SHALL 标为 `pendingConsumer` 并写明计划。MUST NOT 存在只写不读或只展示不产生的字段与枚举值。

#### Scenario: 新增字段未登记

- **WHEN** 代码新增 summary 字段或枚举值
- **THEN** 契约校验 MUST 失败，并指出未登记的字段

#### Scenario: 字段有产出无消费

- **WHEN** 某字段被写入但没有任何读取方
- **THEN** 该字段 MUST 登记为 `pendingConsumer` 并写明计划，或从产出中移除

### Requirement: 指标必须登记族、分母与版本

每个对外数字 SHALL 在指标字典登记族、分子、分母、排除项、版本、消费者与展示位置。MUST NOT 让同名指标在不同族下含义不同而无族标识，MUST NOT 让两族共用同一版本号。

#### Scenario: 展示任务成功率

- **WHEN** 页面展示 `passRate`
- **THEN** 该数字 MUST 可追溯到族 `verdict3-1` 与所属 run

#### Scenario: 两族同名 key

- **WHEN** 同一 key 同时用于内部与外部指标
- **THEN** 返回结果 MUST 带 `metricFamily` 标识，缺失视为违约

### Requirement: 术语必须唯一

一个概念 SHALL 只有一个名字与一个义项：「基线」只指按数据集登记的 EXTERNAL 基线 run，对比用 run 称「对比运行」；「待处理」只指 `PENDING`；「当前版本」只指 `activeVersion`。MUST NOT 同一页面用同一词指两个集合。

#### Scenario: 基线被用于对比运行

- **WHEN** 页面把任意对比 run 称作「基线」
- **THEN** 该表述 MUST 被判定为违约并改用「对比运行」

#### Scenario: 当前版本歧义

- **WHEN** 页面把最新写入的 documentVersion 称作「当前版本」
- **THEN** 该表述 MUST 被判定为违约并改用「最新写入版本」

### Requirement: 权威层级必须成文并被遵守

质量结论 SHALL 以 judge verdict 为准；人工标注只用于校准一致率；failureKind 只用于分诊路由；知识解析分只描述解析质量。MUST NOT 让人工标注、`AiScore` 或 failureKind 进入任何通过率或准确率的分母与分子。

#### Scenario: 计算通过率

- **WHEN** 系统计算任一质量指标
- **THEN** 人工标注、分诊评分与 failureKind MUST NOT 参与分子或分母

#### Scenario: 依赖不可用

- **WHEN** 判官或检索依赖不可用
- **THEN** 该失败 MUST 可见并单独分账，MUST NOT 静默折算为业务失败

### Requirement: 对外数字必须可溯源

任一展示的分数 SHALL 能链到 run id、指标族与版本、judgeSpecVersion、datasetSnapshot 与 scope。MUST NOT 展示没有 run 出处的百分比，MUST NOT 在缺版本时把两次运行并排比较。

#### Scenario: 缺判官版本

- **WHEN** 待比较的运行缺少 `judgeSpecVersion`
- **THEN** 比较入口 MUST 禁用并说明缺失字段

#### Scenario: 页面展示百分比

- **WHEN** 页面渲染任一百分比
- **THEN** 用户 MUST 能定位到对应 run 与指标版本

### Requirement: 状态机不得有死状态

每个状态 SHALL 有产出条件与至少一条转移；`FIXED_PENDING_VERIFY` SHALL 由下一轮运行结果自动推进为 `CLOSED` 或打回。MUST NOT 存在只能人工点击推进或永不产出的状态值。

#### Scenario: 待验用例自动推进

- **WHEN** 一轮运行完成且待验用例判定通过
- **THEN** 该用例 MUST 自动推进，MUST NOT 依赖人工点击

#### Scenario: 状态无转移路径

- **WHEN** 契约登记的状态没有任何转移条件
- **THEN** 契约校验 MUST 失败

### Requirement: 一致性门禁必须可执行

契约 SHALL 以注册表加自动化测试落地：summary key、枚举值与指标族必须已登记；每条 Requirement SHALL 标注实现位置与验证用例；`docs/coding-standards.md` SHALL 含对应审阅项。MUST NOT 依赖人工通读，MUST NOT 让未映射的 Requirement 通过验收。

#### Scenario: 枚举值未登记

- **WHEN** 代码引入未登记到注册表的枚举值
- **THEN** 门禁测试 MUST 失败

#### Scenario: Requirement 无实现映射

- **WHEN** 某条 Requirement 在 spec 中缺少实现位置或验证用例
- **THEN** 该条 MUST 视为未交付
