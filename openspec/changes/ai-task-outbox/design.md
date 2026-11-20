# Design

## Context

见 `proposal.md`。现有四层幂等（jobId、`ai:msg:done`、`triggerMessageId`、会话序号唯一）已覆盖重复消费，真正缺口是：

1. 消息事务提交 → `queue.add` 之间崩溃，任务永久丢失
2. listener 吞异常，BullMQ 很少重试，死信集合可能为空
3. 锁超时被当成功，用户无回复
4. 没有死信重放入口；`ai-processing` 不在队列监控里

## Goals / Non-Goals

**Goals:** 事务性登记、至少一次 relay、死信可见可重放、重试语义正确。

**Non-Goals:** 不重做队列/幂等；不覆盖 SSE 直连；不做全站 Outbox；不改 AI 回复落库。

## Decisions

### D1. Outbox 只包「消息提交 → 入队」

在 `ChatService.sendMessage` 与 `EventsGateway.handleSendMessage` 的现有事务内插入 `ai_task_outbox`，与 `ChatMessage` 同提交。relay 只调用现有 `AiQueueService.enqueue`。

### D2. 表结构最小化

`ai_task_outbox`：`id`、`message_id`（唯一）、`conversation_id`、`user_id`、`status`（PENDING/SENT/FAILED）、`attempts`、`next_attempt_at`、`last_error`、`created_at`、`sent_at`。不存 `content`，避免第二份 PII；relay 按 messageId 回查。

### D3. Relay 用 cron + 原子领取

`@nestjs/schedule` 已启用。每秒/数秒扫描 `PENDING AND next_attempt_at <= now`，用 `FOR UPDATE SKIP LOCKED` 或条件 UPDATE 抢占；成功后置 SENT，失败退避并累计 attempts。

### D4. 死信重放用 `Job.retry()`

failed job 占用 jobId，`queue.add()` 同 id 不会新增。按 messageId 找 job，调用 `job.retry('failed', { resetAttemptsMade: true })`。重放前检查 `ai:msg:done` 与 `triggerMessageId`，有成功回复则拒绝重跑图。

### D5. 修正 listener 错误分类

- 可重试：锁获取失败、DB 瞬时错误、provider 5xx/超时 → 抛出
- 永久降级：配额、转人工兜底 → 记录后结束
- 锁超时：进入可重试/死信，不再 `return` 成功
- `attempts`/backoff 与 120s 锁 TTL 对齐，避免 2s 固定退避反复撞锁

### D6. 队列监控与清理

把 `ai-processing` 加入 `QueueMonitorService`，提供 failed 列表与单条重放；failed 保留窗口与清理策略对齐，避免 Redis 无界增长。

## Risks / Trade-offs

- **[relay 延迟放大 handlerId 竞态]** → worker 执行前复查会话是否已转人工。
- **[Socket 限流发生在落库后]** → 把限流前置到事务前，只有允许触发 AI 才写 outbox。
- **[工具副作用重跑]** → 重放前检查成功回复；只补投递，不重跑图。
- **[多实例重复 relay]** → 原子领取 + jobId 双保险。
- **[消息顺序]** → 现有进程内串行仍保证同会话到达顺序；relay 不并行同一会话。
