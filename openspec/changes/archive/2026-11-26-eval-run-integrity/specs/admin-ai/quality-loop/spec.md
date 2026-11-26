# Spec Delta — admin-ai/quality-loop

## MODIFIED Requirements

### Requirement: 评测失败必须可见

系统 SHALL 在 run 级失败（入队失败、预算耗尽、未捕获异常、心跳超时、判官整体不可用或连续失败达阈值）时标记 FAILED，并保存失败类别与已处理/总数。单条判官或执行失败 MUST NOT 使整单 FAILED，MUST 逐条留痕后继续；运行完成时 summary MUST 保留已判分计数，使未判分条目可解释。

#### Scenario: judge 不可用

- **WHEN** judge 整体不可用或连续失败达到阈值
- **THEN** run.status=FAILED，summary 中失败类别与已处理/总数可见

#### Scenario: 单条判官失败

- **WHEN** 单条判官调用失败但后续调用成功
- **THEN** run 继续执行并最终 COMPLETED，该条记为 `judge_error`

#### Scenario: 已完成仍有未判分条目

- **WHEN** run 状态为 COMPLETED 但存在未判分条目
- **THEN** summary MUST 通过有效判定数与判官失败率解释差额，MUST NOT 只给出一个总数

## ADDED Requirements

### Requirement: 评测启动必须互斥且幂等

同一数据集 SHALL 至多存在一条非 EXTERNAL 的 RUNNING 运行，该约束 MUST 由数据库唯一约束保证；启动冲突时 MUST 返回 409 并说明已有运行。MUST NOT 仅依赖应用层先查后写，MUST NOT 因并发请求创建第二条运行或投递第二个任务。

#### Scenario: 并发启动

- **WHEN** 两个请求同时启动同一数据集
- **THEN** 一个成功、一个返回 409，且只投递一个执行任务

#### Scenario: EXTERNAL 运行

- **WHEN** 启动 EXTERNAL 全量运行
- **THEN** 该运行 MUST NOT 占用内部运行的单实例约束

### Requirement: 运行存活必须由心跳判定

运行执行期间 SHALL 至少每条用例开始时更新心跳（可节流）；清扫 SHALL 按「最近心跳（缺失时回退开始时间）超过阈值」判定，并在后台定时任务中执行。MUST NOT 按开始时间绝对时长判死，MUST NOT 让读接口触发清扫。

#### Scenario: 长任务持续运行

- **WHEN** 一次运行超过 30 分钟但心跳持续更新
- **THEN** 运行 MUST 保持 RUNNING，MUST NOT 被轮询置为 FAILED

#### Scenario: worker 已死

- **WHEN** 心跳超过阈值未更新
- **THEN** 后台清扫 MUST 将其标为 FAILED 并记录失败类别

#### Scenario: 读接口被调用

- **WHEN** 管理员打开页面轮询运行状态
- **THEN** 读接口 MUST NOT 改变任何运行状态

### Requirement: 评测标准必须版本化且随运行留存

判官标准 SHALL 为带版本号的工件；每次运行 MUST 记录判官标准版本、prompt 哈希、判官模型与供应商、采样次数、指标族与指标版本。MUST NOT 用未版本化标准产出可比较分数，MUST NOT 让缺版本的运行登记基线。

#### Scenario: 运行完成

- **WHEN** 一次运行结束
- **THEN** 上述六个字段 MUST 齐全，且 prompt 哈希可由标准文本复算

#### Scenario: 版本缺失

- **WHEN** 运行记录缺少判官标准版本
- **THEN** 该运行 MUST 被拒绝登记为基线并给出可读原因

### Requirement: 基线必须按数据集界定且仅 EXTERNAL 可登记

基线 SHALL 按数据集界定，同一数据集至多一条基线；登记 SHALL 校验运行模式为 EXTERNAL、范围为全量、数据集快照与对比基线同源、知识快照稳定、版本字段齐全且样本量达标。MUST NOT 在登记时清空其他数据集的基线，MUST NOT 让内部运行混入。

#### Scenario: 内部运行登记基线

- **WHEN** 对内部诊断运行发起基线登记
- **THEN** 系统 MUST 拒绝并说明仅 EXTERNAL 全量运行可登记

#### Scenario: 跨数据集互不影响

- **WHEN** 数据集 A 登记新基线
- **THEN** 数据集 B 的既有基线 MUST 保持不变

#### Scenario: 范围缺失

- **WHEN** 运行记录的 scope 为空或非全量
- **THEN** 登记 MUST 被拒绝

### Requirement: 写操作样本不得真实执行

涉及写操作的评测样本 SHALL 以「确认卡片是否正确生成」为通过判据，执行标志 MUST 为禁止执行。MUST NOT 在生产库对写操作样本真实下单核验；需要真实执行验收时 MUST 另立隔离环境的评测。

#### Scenario: 动作样本运行

- **WHEN** 评测样本涉及下单等写操作
- **THEN** 运行结束后 MUST NOT 存在对应的业务写操作记录

#### Scenario: 执行标志为允许

- **WHEN** 动作样本的执行标志为允许真实执行
- **THEN** 契约校验 MUST 失败并阻止该样本进入运行

### Requirement: 指标必须声明族且消费方按族分流

每次运行的 summary SHALL 声明指标族与其版本；同名 key SHALL 按族解释，消费者 MUST 按族读取。既有任务成功率语义 MUST 保持不变，并并列提供有效通过率（分子 `solved`、分母为排除判官与执行失败后的有效判定数）。MUST NOT 让界面用一族的 key 读取另一族的数字。

#### Scenario: 内部运行 summary

- **WHEN** 内部评测运行完成
- **THEN** summary MUST 带 `metricFamily=verdict3` 与 `verdict3-1`，并同时给出任务成功率与有效通过率

#### Scenario: 外部运行展示

- **WHEN** 页面展示 EXTERNAL 运行
- **THEN** 指标 MUST 以 `answer_accuracy-v3` 解释，基线下拉 MUST 显示准确率而非空值

#### Scenario: 跨族同名 key

- **WHEN** 同一 key 名在两族中含义不同
- **THEN** 返回结果 MUST 带族标识，缺标识时消费方 MUST 拒绝展示
