# Tasks

## 1. Outbox 落库

- [ ] 1.1 新增 `ai_task_outbox` Prisma model 与迁移（`message_id` 唯一、`(status, next_attempt_at)` 索引）；验证：本地 `prisma migrate deploy` 成功
- [ ] 1.2 `ChatService.sendMessage` 在消息事务内插入 outbox；验证：事务回滚时 outbox 不残留
- [ ] 1.3 `EventsGateway.handleSendMessage` 在消息事务内插入 outbox；验证：Socket 路径同样可恢复
- [ ] 1.4 限流前置：只有允许触发 AI 时才写 outbox；验证：限流命中不产生待投递行

## 2. Relay

- [ ] 2.1 新增 relay cron，原子领取 `PENDING` 行并调用 `AiQueueService.enqueue`；验证：模拟进程崩溃后重启能补投
- [ ] 2.2 成功后置 `SENT`，失败退避并累计 attempts，超限置 `FAILED`；验证：连续失败进入 FAILED
- [ ] 2.3 多实例并发领取不重复投递；验证：两个 relay 实例并发测试只有一次入队

## 3. 重试语义与死信

- [ ] 3.1 listener 区分可重试/永久降级；锁超时不再返回成功；验证：单测覆盖三类错误
- [ ] 3.2 调整 `attempts`/backoff，与锁 TTL 对齐；验证：重试不再在锁未释放时立即撞锁
- [ ] 3.3 把 `ai-processing` 加入队列监控，提供 failed 列表；验证：管理端可查询失败任务
- [ ] 3.4 死信按 `messageId` 重放，使用 `Job.retry()`；验证：重放后 job 重新执行，已成功任务被拒绝
- [ ] 3.5 failed 保留窗口与清理策略；验证：超过窗口的任务被清理且审计保留

## 4. 验证

- [ ] 4.1 单测：事务登记、relay 幂等、错误分类、死信重放；验证：全绿
- [ ] 4.2 全量测试与 `tsc --noEmit`；验证：全绿
- [ ] 4.3 故障演练：消息提交后杀进程、重启恢复；验证：用户最终收到且只收到一条 AI 回复
