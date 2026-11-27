# Spec Delta

## ADDED Requirements

### Requirement: 收录判定必须状态穷尽

每条评测用例 SHALL 归入 `correct`、`incorrect`、`judge_error`（带失败类别）或 `not_applicable` 之一。失败类别 SHALL 只取既有失败枚举，MUST NOT 新增第六类。未调用过判官的用例 MUST NOT 记为判官失败，MUST NOT 伪造判官适用状态；判官给出结构化失败类别时 MUST 优先采用该类别，MUST NOT 从自由文本猜测。

#### Scenario: 无 golden 文档的负样本

- **WHEN** 用例没有期望命中文档，因而没有调用过 golden 判官
- **THEN** 收录结果 MUST 为 `not_applicable` 并记录原因，MUST NOT 为 `judge_error`

#### Scenario: 判官调用真实失败

- **WHEN** 判官端点返回超时、限流、鉴权或解析失败
- **THEN** 收录结果 MUST 为 `judge_error` 并带上对应失败类别

#### Scenario: 结构化失败类别优先

- **WHEN** 判官返回的结果同时带有结构化失败类别与自由文本原因
- **THEN** 系统 MUST 采用结构化失败类别，MUST NOT 依据文本重新归类

#### Scenario: 判官未给出结论

- **WHEN** 判官被调用但既未返回布尔结论，也未返回结构化失败类别
- **THEN** 收录结果 MUST 为 `not_applicable`，MUST NOT 归为 `output_format`

### Requirement: 评测覆盖率必须可见

每次运行 summary SHALL 含已判条数 `judgedCases` 与覆盖率 `coverage`。分母 MUST 为本次运行入库的用例条数；`coverage` MUST 等于 `judgedCases` 除以该条数并保留四位小数；条数为 0 时 MUST 返回 `null`，MUST NOT 返回 0。运行级数值 SHALL 由服务端单点计算，客户端副本 MUST 只用于对账。

#### Scenario: 部分用例被判

- **WHEN** 本次运行入库 225 条，其中 97 条得到布尔判定
- **THEN** summary MUST 含 `judgedCases: 97` 与 `coverage: 0.4311`

#### Scenario: 空运行

- **WHEN** 本次运行没有入库任何用例
- **THEN** `coverage` MUST 为 `null`，MUST NOT 为 0

#### Scenario: 历史运行缺少字段

- **WHEN** 读取改造前产生的运行
- **THEN** 覆盖率 MUST 呈现为「未记录」，MUST NOT 由其他字段推算

### Requirement: 判官原始输出必须可审计且受保留期约束

每次判官尝试 SHALL 记录原始输出、解析结果、失败类别与判官版本；原始输出超过上限时 MUST 截断并标记截断状态。原始输出 MUST 在落库前脱敏，MUST NOT 写入应用日志。读取 MUST 限定 ADMIN 与 SUPER_ADMIN。记录 MUST 按保留期清理；记录写入失败 MUST NOT 改变判分结果或使运行失败。

#### Scenario: 解析失败可复盘

- **WHEN** 判官输出无法解析
- **THEN** 该次尝试 MUST 可回查截断后的原始输出

#### Scenario: 超过保留期

- **WHEN** 尝试记录超过保留期
- **THEN** 系统 MUST 清理该记录，且 MUST NOT 影响运行级汇总

#### Scenario: 留痕写入失败

- **WHEN** 尝试记录写入失败
- **THEN** 判分结果与运行状态 MUST 保持不变，仅记录告警

### Requirement: 判官输出必须受结构化约束且可降级

判官调用 SHALL 优先请求结构化（JSON）输出并校验必需字段；校验失败 SHALL 回退既有文本解析，MUST NOT 直接判为失败。服务提供方不支持结构化输出时 MUST 能通过开关退回纯文本模式，MUST NOT 使整条评测链路失败。解码约束或提示词变化 MUST 上调判官版本号。

#### Scenario: 结构化输出正常

- **WHEN** 服务提供方接受结构化输出请求并返回合法 JSON
- **THEN** 系统 MUST 使用校验后的字段，MUST NOT 再次依赖文本提取

#### Scenario: 服务提供方不支持

- **WHEN** 服务提供方以 4xx 拒绝结构化输出请求
- **THEN** 系统 MUST 退回纯文本解析，本次判官调用 MUST NOT 因此失败

#### Scenario: 回退后仍无法解析

- **WHEN** 结构化校验与文本解析都未得到结论
- **THEN** 收录结果 MUST 为 `judge_error`，失败类别为输出格式

### Requirement: 评测用量必须区分真实与估算

运行用量 SHALL 标明来源 `real`、`estimated` 或 `mixed`，并按聊天与判官分账。服务提供方返回用量时 MUST 记为真实值；未返回时 MUST 标为不可得，MUST NOT 以 0 代替真实值。预算超限时，判定依据 MUST 记录在运行摘要中，使历史运行可解释。

#### Scenario: 服务提供方返回用量

- **WHEN** 模型响应包含用量信息
- **THEN** 运行摘要 MUST 以 `real` 记录并按角色分账

#### Scenario: 用量不可得

- **WHEN** 模型响应不包含用量信息
- **THEN** 对应调用 MUST 标为不可得，MUST NOT 记为 0 token

#### Scenario: 预算超限

- **WHEN** 运行因预算停止
- **THEN** 运行摘要 MUST 记录所用预算口径与阈值，使该次停止可解释

## MODIFIED Requirements

### Requirement: 回归用例必须可解释

回归用例 SHALL 提供运行时间线与两次运行的差异（新增失败、修复、回退、仍失败四类）；`FIXED_PENDING_VERIFY` SHALL 由下一轮运行自动推进为关闭或打回。差异 MUST 为描述性结论，统计显著性 MUST 由配对检验负责。两次运行的差异 SHALL 附带可比性结论与判定翻转率；不可比时 MUST 明示原因并 MUST NOT 给出差异数字。MUST NOT 只提供新建规则与运行列表，MUST NOT 让人工口头确认修复，MUST NOT 在控制台声称显著改善。

#### Scenario: 查看用例历史

- **WHEN** 管理员打开某回归用例
- **THEN** 页面 MUST 展示每次运行的判定与两次运行的差异分类

#### Scenario: 待验用例

- **WHEN** 一轮运行完成且待验用例判定通过
- **THEN** 系统 MUST 自动关闭；判定失败 MUST 打回并记录回退时间

#### Scenario: 两次运行不可比

- **WHEN** 两次运行的数据快照、评估范围、指标版本、判官版本或运行模式不一致
- **THEN** 系统 MUST 列出不可比原因，MUST NOT 展示差异数字

#### Scenario: 同输入判定翻转

- **WHEN** 两次运行的判官输入与判官版本一致，但同一用例判定由通过变为失败或反之
- **THEN** 输出 MUST 给出翻转数、翻转率与方向，并 MUST 标注该翻转可能来自判官非确定性
