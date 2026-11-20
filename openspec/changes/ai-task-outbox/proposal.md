# Proposal

## Why

AI 任务已经走 BullMQ，但「消息落库」与「入队」是两个独立操作：DB 提交后、`queue.add` 前进程崩溃，消息永远不会有 AI 回复。死信侧也只有指标，没有重放入口；listener 还会吞掉异常，导致重试和死信长期为空。

## What Changes

- 在消息写入的同一数据库事务内登记 `ai_task_outbox`（`message_id` 唯一）
- 独立 relay cron 领取 `PENDING` 行，调用现有 `AiQueueService.enqueue`
- 死信可查询、可按 `messageId` 重放；重放必须用 `Job.retry()`，不能用 `queue.add()`
- 修正重试语义：可重试错误抛给 BullMQ，永久降级才吞
- 把 `ai-processing` 纳入队列监控，提供 failed 列表与清理策略

## Capabilities

### New Capabilities

- `ai-customer/task-delivery`: AI 任务的持久投递契约——事务性登记、至少一次 relay、幂等消费、死信可见与重放。

### Modified Capabilities

（无）

## Impact

- 数据库：新增 `ai_task_outbox` 表与迁移
- 后端：`chat.service.ts`、`events.gateway.ts`、`ai-message.listener.ts`、`ai-queue.module.ts`、`queue-monitor.service.ts`
- 不替换现有 BullMQ/幂等键；不覆盖 SSE 直连路径
