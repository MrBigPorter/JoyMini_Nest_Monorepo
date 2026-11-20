# Spec Delta

## Purpose

规定 AI 任务从业务消息提交到队列消费的持久投递契约：事务性登记、至少一次 relay、幂等消费、死信可见与重放。

## ADDED Requirements

### Requirement: 任务登记必须与消息落库同事务

系统 SHALL 在创建 AI 相关消息的同一数据库事务内登记待投递任务；事务提交后即使进程崩溃，任务 MUST 仍可被后续 relay 发现。

#### Scenario: 提交后崩溃

- **WHEN** 消息事务提交后、入队前进程崩溃
- **THEN** relay 仍能发现该任务并完成入队

### Requirement: Relay 至少投递一次且幂等

系统 SHALL 由独立 relay 领取待投递任务并写入队列；同一 `messageId` MUST 最多产生一个有效任务，重复 relay MUST 被幂等吸收。

#### Scenario: 多实例 relay

- **WHEN** 两个实例同时扫描到同一条待投递任务
- **THEN** 只有一个实例完成入队，另一个不产生重复任务

### Requirement: 死信必须可查询与重放

系统 SHALL 保留失败任务并提供按 `messageId` 查询与重放入口；重放 MUST 使用队列的单条重试能力，不得用同一 jobId 重新入队。

#### Scenario: 单条重放

- **WHEN** 运维选择一条失败任务重放
- **THEN** 该任务重新进入等待队列，且不因已存在的 jobId 被静默丢弃

#### Scenario: 已成功任务

- **WHEN** 某任务已有成功回复
- **THEN** 重放入口拒绝或只做补投递，不重复执行图与工具

### Requirement: 可重试错误必须向上抛出

系统 SHALL 区分可重试错误与永久降级错误；可重试错误 MUST 抛给队列以触发重试，永久降级 MUST 记录并结束，不得让任务被静默记为成功。

#### Scenario: 锁超时

- **WHEN** 同会话锁在等待上限内仍不可获取
- **THEN** 任务进入可重试/死信路径，而不是直接返回成功

### Requirement: 死信必须有保留与清理策略

系统 SHALL 为失败任务定义保留窗口与清理规则，避免 Redis 无界增长；清理不得早于可重放窗口。

#### Scenario: 超过保留期

- **WHEN** 失败任务超过保留窗口
- **THEN** 系统按策略清理，并保留必要的审计字段
