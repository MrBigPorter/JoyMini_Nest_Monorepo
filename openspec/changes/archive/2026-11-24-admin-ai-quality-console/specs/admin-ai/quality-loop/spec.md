# Spec Delta

## Purpose

规定 admin 端反馈分诊、评测集批量跑分与 Prompt 真测试的契约，让线上质量信号能回流为可重复评测。

## ADDED Requirements

### Requirement: 反馈必须可分诊

系统 SHALL 为反馈提供 PENDING/REVIEWED/IGNORED 状态，并记录 reviewedBy/reviewedAt。

#### Scenario: 标记已处理

- **WHEN** 管理员点击 Reviewed
- **THEN** 记录状态与操作者，列表可筛选

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
