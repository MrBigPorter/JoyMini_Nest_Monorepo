# admin-ai/quality-loop Specification

## Purpose

规定 admin 端反馈分诊、评测集批量跑分与 Prompt 真测试的契约，让线上质量信号能回流为可重复评测。

## Requirements

### Requirement: 反馈必须可分诊

系统 SHALL 为反馈提供 PENDING/REVIEWED/IGNORED 状态，并记录 reviewedBy/reviewedAt；分诊更新 SHALL 在同一事务内完成状态派生、状态写入与评分写入，并以版本或旧值条件检测并发冲突；认领 SHALL 记录 claimedBy/claimedAt，并与处理完成分开呈现。MUST NOT 写出互相矛盾的状态与处置组合，MUST NOT 静默覆盖负责人，MUST NOT 吞掉评分写入失败。

#### Scenario: 标记已处理

- **WHEN** 管理员点击 Reviewed
- **THEN** 记录状态与操作者，列表可筛选

#### Scenario: 并发分诊同一反馈

- **WHEN** 两个管理员同时提交对同一反馈的分诊
- **THEN** 一个成功，另一个 MUST 收到 409 并提示重读，MUST NOT 写出矛盾组合

#### Scenario: 认领但不处理

- **WHEN** 管理员认领一条反馈但未提交分诊
- **THEN** 记录认领者与时间，处理状态 MUST 保持 PENDING，MUST NOT 写入 reviewedBy

#### Scenario: 仅修改备注

- **WHEN** 管理员只修改备注而未改变判定
- **THEN** reviewedBy/reviewedAt MUST NOT 被刷新

### Requirement: 评测集必须可批量运行

系统 SHALL 支持创建评测集、批量导入用例、启动运行并查询结果；运行 MUST 异步执行，不阻塞请求。

#### Scenario: 启动评测

- **WHEN** 管理员点击启动
- **THEN** 返回 RUNNING run，UI 轮询结果

### Requirement: Prompt 测试必须真实调用模型

系统 SHALL 使用 active version 的 prompt 调用 LLM，并落 actualOutput/latencyMs。

#### Scenario: 测试 Prompt

- **WHEN** 管理员提交测试问题
- **THEN** 返回模型输出与耗时

### Requirement: 评测失败必须可见

系统 SHALL 在 run 失败时标记 FAILED 并保存错误摘要。

#### Scenario: judge 不可用

- **WHEN** judge 调用失败
- **THEN** run.status=FAILED，summary.error 可见

### Requirement: 评测用例输入必须限长且查重

评测用例的题干、答案、标签与判分条件 SHALL 有长度上限（题干 2000 字符、答案 8000 字符、标签 20 个且每个 32 字符、必含关键词 20 个且每个 500 字符、判分条件序列化后 8KB），批量导入 MUST 按端点分档（用例 100 条以内，运行与外部结果 500 条以内），规范化后的题干 MUST 在同一数据集内查重。MUST NOT 无上限落库，MUST NOT 只对单个 DTO 设限。

#### Scenario: 超长用例

- **WHEN** 导入的题干超过上限
- **THEN** 请求 MUST 返回参数错误并指明字段，MUST NOT 截断后落库

#### Scenario: 重复题干

- **WHEN** 同一数据集内导入规范化后相同的题干
- **THEN** 系统 MUST 拒绝或标记跳过，并在结果中说明

### Requirement: 判分条件必须唯一且编辑无损

判分条件 SHALL 以 `expect` 为唯一权威字段；页面展示与编辑 MUST 以 `expect` 为准，编辑 MUST 保留 `confirmAction`、`forbidExecution`、`intent` 等非文本条件；`expected` 仅作只读兼容保留。MUST NOT 展示 `expected` 而判分读取 `expect`，MUST NOT 让一次编辑把判分条件重写为只剩关键词。

#### Scenario: 编辑期望答案

- **WHEN** 管理员编辑某用例的期望
- **THEN** 判分条件中的动作与意图字段 MUST 保留，判分读取结果与编辑内容一致

#### Scenario: 兼容字段

- **WHEN** 用例存在历史 `expected` 字段
- **THEN** 页面只读展示该字段，MUST NOT 用它替代判分

### Requirement: 评测与回归读取必须分页且有上限

运行结果与数据集用例的读取 SHALL 保留原数组字段作为当前页，并新增总数字段与页码/页大小参数（默认 50，上限 200）；运行中的结果 MUST 按创建时间倒序，使最新结果出现在第一页。MUST NOT 改变既有数组形状导致调用方破坏，MUST NOT 静默截断。

#### Scenario: 大运行读取

- **WHEN** 一次运行有 2000 条结果
- **THEN** 默认响应返回 50 条与总数 2000，页大小超过 200 MUST 返回参数错误

#### Scenario: 运行中的最新结果

- **WHEN** 运行进行中且结果持续写入
- **THEN** 第一页 MUST 包含最新结果

### Requirement: 反馈列表查询次数必须与页大小无关

反馈列表的数据库查询次数 SHALL 固定，不随页大小增长；系统 MUST 为消息上下文查询补充会话与时间的组合索引。MUST NOT 对每行执行独立查询，MUST NOT 拉取整段会话后在内存分组。

#### Scenario: 大页列表

- **WHEN** 以 100 条页大小请求反馈列表
- **THEN** 查询次数 MUST 与 10 条页大小相同

### Requirement: 日期筛选必须使用显式时区

日期筛选 SHALL 以本地日界转换为查询区间；筛选状态 MUST 在 URL 中保持日期格式。MUST NOT 把带时区的时间戳写入 URL，MUST NOT 让展示日期与查询区间相差一个时区。

#### Scenario: 本地日期筛选

- **WHEN** 中国区运营选择某一天
- **THEN** 查询区间 MUST 覆盖该本地日 00:00 到次日 00:00，刷新后筛选保持

### Requirement: 运行终态必须刷新且状态必须可解释

运行从 RUNNING 进入终态（含取消）后 SHALL 刷新数据集与基线下拉；运行卡 SHALL 展示运行标识、范围、指标族、已处理/总数与失败类别。MUST NOT 在每个渲染周期重复触发刷新，MUST NOT 只翻译状态词而不解释原因。

#### Scenario: 运行完成

- **WHEN** 轮询发现运行进入终态
- **THEN** 数据集卡片与基线下拉 MUST 各刷新一次

#### Scenario: 打开历史终态运行

- **WHEN** 管理员打开早已结束的运行
- **THEN** 系统 MUST NOT 触发刷新

### Requirement: 回归用例必须可解释

回归用例 SHALL 提供运行时间线与两次运行的差异（新增失败、修复、回退、仍失败四类）；`FIXED_PENDING_VERIFY` SHALL 由下一轮运行自动推进为关闭或打回。差异 MUST 为描述性结论，统计显著性 MUST 由配对检验负责。MUST NOT 只提供新建规则与运行列表，MUST NOT 让人工口头确认修复，MUST NOT 在控制台声称显著改善。

#### Scenario: 查看用例历史

- **WHEN** 管理员打开某回归用例
- **THEN** 页面 MUST 展示每次运行的判定与两次运行的差异分类

#### Scenario: 待验用例

- **WHEN** 一轮运行完成且待验用例判定通过
- **THEN** 系统 MUST 自动关闭；判定失败 MUST 打回并记录回退时间

### Requirement: 标注必须可归属且不污染指标

人工标注 SHALL 落库并记录标注者、指南版本、来源（人工或预标注）与置信度，同一运行、用例与标注者 MUST 唯一；标注 MUST 只用于校准判官。MUST NOT 仅以本地文件存储，MUST NOT 让预标注与人工标注无法区分，MUST NOT 让标注进入任何质量指标。

#### Scenario: 两人标注同一用例

- **WHEN** 两名管理员标注同一运行的同一用例
- **THEN** 两条标注 MUST 并存且各自可归属

#### Scenario: 预标注

- **WHEN** 系统生成预标注
- **THEN** 其来源与置信度 MUST 被记录，人工修改后 MUST 可追溯

### Requirement: 知识质量分必须区分解析质量与有效性

知识侧 SHALL 分别呈现解析质量（结构检查通过情况）与有效性（检索命中与引用正确）；解析质量 MUST 展示通过与否及各项检查明细，分档 MUST 与通过判据同源；版本 MUST 区分生效版本与最新写入版本。MUST NOT 把解析分称作检索质量，MUST NOT 用分档阈值替代通过判据，MUST NOT 让「当前版本」有两种含义。

#### Scenario: 文档解析检查

- **WHEN** 查看某知识文档
- **THEN** 页面 MUST 展示解析通过情况与四项检查明细，MUST NOT 只给一个百分制总分

#### Scenario: 版本语义

- **WHEN** 页面展示版本
- **THEN** 生效版本与最新写入版本 MUST 分别标注

### Requirement: 枚举与摘要字段不得有幽灵值

每个枚举值 SHALL 有产出路径与消费方；无消费方的字段 MUST 在契约注册表登记为待接入或移除；同一评分字段的不同量纲 MUST 显式标记。MUST NOT 展示永不产生的枚举值，MUST NOT 写入没有产出路径的失败类别，MUST NOT 保留只写不读的字段。

#### Scenario: 展示运行状态

- **WHEN** 页面渲染运行状态
- **THEN** 只允许出现有产出路径的状态值

#### Scenario: 评分量纲

- **WHEN** 同一评分表存在不同量纲
- **THEN** 每条记录 MUST 带量纲标识，消费方 MUST 按量纲解释

### Requirement: 判官校准必须可计算且可见

系统 SHALL 能按运行或数据集计算判官结论与人工标注的一致率、样本量与分歧用例明细（含判官理由与人工备注）；样本量低于 20 时 MUST 返回「样本不足」且不下结论。校准结果 MUST 只用于评估判官。MUST NOT 在样本不足时给出百分比结论，MUST NOT 让校准结果进入任何指标或发布证据，MUST NOT 只存标注而不提供计算。

#### Scenario: 样本充足

- **WHEN** 某运行有至少 20 条人工标注
- **THEN** 系统 MUST 返回一致率、样本量与逐条分歧明细

#### Scenario: 样本不足

- **WHEN** 人工标注少于 20 条
- **THEN** 系统 MUST 返回「样本不足」，页面 MUST NOT 显示一致率百分比
