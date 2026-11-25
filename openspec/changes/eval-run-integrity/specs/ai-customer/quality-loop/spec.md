# Spec Delta — ai-customer/quality-loop

## MODIFIED Requirements

### Requirement: 评测运行必须保存可复现快照

每次评测运行（含管理端内部运行）SHALL 记录数据集快照标识、代码版本、依据门禁模式（EXTERNAL）、判官输入规范版本与运行时间。内部运行 MUST 记录数据集快照（用例标识集合与哈希）与代码版本。任一标识缺失时，该运行 MUST NOT 参与跨运行比较。

#### Scenario: 完整运行

- **WHEN** 一次评测正常结束
- **THEN** 运行记录包含上述标识，且可据此复现同一批用例

#### Scenario: 标识缺失

- **WHEN** 运行记录缺少代码版本或数据集快照
- **THEN** 报告将该运行标为「仅诊断」，不出现在基线对比中

#### Scenario: 内部运行也必须可复现

- **WHEN** 管理端对内部数据集启动并完成一次运行
- **THEN** 运行记录 MUST 含用例标识集合与哈希、代码版本，MUST NOT 因「只有 harness 需要」而留空

### Requirement: 判官失败必须与回答错误分账

每条判定结果 SHALL 为 `correct`、`incorrect` 或 `judge_error` 之一。`judge_error` MUST NOT 计入准确率分母；系统 MUST 单独报告判官错误率，并按鉴权、限流、超时、输出格式、内容策略分类。内部评测与外部 harness MUST 使用同一套记法与分类，并在 summary 输出判官错误率与分类计数。逐条 `judge_error` 只影响该条；整单判官不可用或连续失败达阈值时，按 `评测失败必须可见` 处理整单失败。

#### Scenario: 判官超时

- **WHEN** 判官调用超时或超过重试次数
- **THEN** 该条记为 `judge_error`，不计为 `incorrect`

#### Scenario: 判官输出不可解析

- **WHEN** 判官返回内容不符合约定格式
- **THEN** 该条记为 `judge_error`，错误类型为输出格式，不计入准确率

#### Scenario: 内部路径判官失败

- **WHEN** 管理端内部运行中某条判官调用失败
- **THEN** 该条 MUST 记为 `judge_error` 并进入判官错误率，MUST NOT 折算为 `unsolved`

## ADDED Requirements

### Requirement: 内部评测执行失败必须单独记账

内部 LIVE 评测的执行失败 SHALL 记录执行失败类别并继续运行；系统 MUST 单独报告执行失败率。执行失败 MUST NOT 计为 `unsolved` 或 `judge_error`，MUST NOT 进入任何质量分母。

#### Scenario: 单条执行失败

- **WHEN** 内部运行中某条用例调用被测模型失败
- **THEN** 该条记为执行失败，运行继续，summary 中执行失败数与执行失败率可见

#### Scenario: 执行失败不计入任务成功率

- **WHEN** 统计任务成功率与有效通过率
- **THEN** 执行失败条目 MUST NOT 出现在 `unsolved` 中，且 MUST 从有效通过率的分母中排除
