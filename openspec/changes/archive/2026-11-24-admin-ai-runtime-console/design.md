# Design

## Context

`QueueMonitorService` 已有队列统计、AI 死信查询/重放、Outbox 失败查询/重放；`QueueMonitorModule` 只注册了 blog-ai/avatar/group_settlement/embedding/ai-processing。admin-next 没有对应页面，`/monitor` 是 Grafana 外链。

## Goals / Non-Goals

**Goals:** 让运营能看队列、看死信/Outbox、执行重放；补齐 rag-embedding 监控。

**Non-Goals:** 不替换 Grafana；不做指标图表；不做模型/Provider 切换；不做 AI kill switch。

## Decisions

### D1. 页面只做“快照 + 操作”

- `/ai-ops` 汇总：AI 队列 waiting/active/failed、死信数量、Outbox FAILED、今日 token
- `/ai-ops/runtime`：队列表 + 死信表 + Outbox 表
- 数据全部来自现有 admin API；Outbox 列表补 `GET /admin/queues/ai/outbox?status=`

### D2. rag-embedding 入监控

在 `QueueMonitorService.queueNames`、构造注入、`getQueueStatsByName`、`getQueueByName`、`QueueMonitorModule.BullModule.registerQueue` 同时加入 `RAG_EMBEDDING_QUEUE`。

### D3. 写操作安全

- pause/resume/clean、replay 都二次确认
- 后端保留 RolesGuard：VIEWER 只读，ADMIN/SUPER_ADMIN 可写
- 重放沿用现有语义：AI 死信用 `Job.retry()`；Outbox 只重放 FAILED

### D4. 数据口径要标注

`/api/v1/metrics` 是单实例/需 metrics token，不在本页使用。页面只展示 admin API 返回的队列/任务数据，并标注采集时间。

## Risks / Trade-offs

- **[多实例]** 队列统计来自 Redis，天然全局；进程内指标不展示
- **[重放副作用]** 已有 AI 回复的 job 会被后端拒绝，页面展示拒绝原因
- **[队列暂停阻断回复]** 二次确认 + 操作日志；使用手册写明影响
