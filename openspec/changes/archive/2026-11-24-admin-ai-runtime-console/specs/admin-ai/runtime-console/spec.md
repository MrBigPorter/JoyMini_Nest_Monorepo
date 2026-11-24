# Spec Delta

## Purpose

规定 admin 端 AI 运行时队列、死信与 Outbox 的可视化与操作契约。目标是让运营在不登录服务器的情况下发现并处理 AI 投递故障。

## ADDED Requirements

### Requirement: 队列状态必须可视化

系统 SHALL 在 admin 展示所有 AI 相关队列的 waiting/active/failed/delayed/paused 状态；`rag-embedding` MUST 纳入监控范围。

#### Scenario: 查看队列

- **WHEN** 运营打开 `/ai-ops/runtime`
- **THEN** 页面展示队列列表与各状态数量

### Requirement: 死信必须可查询与重放

系统 SHALL 展示 AI 队列 failed 任务并允许单条重放；已有 AI 回复的任务 MUST 被拒绝重放。

#### Scenario: 重放死信

- **WHEN** 运营对一个 failed job 点击 Replay
- **THEN** 后端调用 `Job.retry()`，页面刷新后状态更新

### Requirement: Outbox 必须可查询与重放

系统 SHALL 展示 `ai_task_outbox` 的状态、尝试次数、最后错误与下次投递时间；FAILED 行 MUST 可重放。

#### Scenario: Outbox 失败

- **WHEN** 消息已落库但入队失败
- **THEN** 页面能看到 FAILED 行，并可重放

### Requirement: 写操作必须二次确认

系统 SHALL 对 pause/resume/clean/replay 要求二次确认；VIEWER MUST NOT 执行写操作。

#### Scenario: 暂停队列

- **WHEN** ADMIN 点击 Pause
- **THEN** 页面要求确认，确认后队列暂停

### Requirement: 空态与错误必须可理解

系统 SHALL 在无队列/无死信/无 Outbox 时显示空态，在接口失败时显示错误与重试入口。

#### Scenario: 没有死信

- **WHEN** failed 列表为空
- **THEN** 页面显示“没有死信”，而不是空白
