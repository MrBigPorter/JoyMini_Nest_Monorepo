# Design

## Context

- 状态：`customer.graph.ts` 用 `MemorySaver`；数据库里已有 `Conversation.threadId`（随机 UUID），同时被用作图线程键与 Redis 热缓存键。
- 投递：`ai-message.listener.ts` 监听事件后直接跑图，异常只落日志。
- 广播：无 Socket.IO adapter，`EventEmitter2` 也是进程内。
- 取消：`res.on('close')` 只释放限流。
- 预算：`llm.usage` 事件已有 token，无上限。
- 指标：只有日志，无聚合。

## Goals / Non-Goals

**Goals:** 状态可重建、任务幂等、跨实例可达、断连可止、预算可控、指标可算。

**Non-Goals:** 不做全站 outbox；不改意图与工具；不做部署拓扑改造（仅加 adapter）；不做跨区域容灾。

## Decisions

### D1. Checkpointer 沿用 `Conversation.threadId`，表走 Prisma 迁移

改键会导致历史会话状态断裂；运行时 `setup()` 建表则要求线上账号有 DDL 权限。因此：`thread_id = Conversation.threadId`，checkpoint 表由迁移创建。

### D2. 队列幂等键取 `messageId`

消息 ID 天然唯一，且发送方在落库时已保证。事件 payload 需补 `messageId`（现状只有 `conversationId/content/userId`）。重复投递语义：**丢弃第二次**，不返回第一次结果（避免用户多等）。

Redis 键 `ai:msg:done:<messageId>` 写在回复落库之后，存在一个毫秒级窗口：回复已写库、done 未写时进程崩溃，重放会再写一条回复。因此再加一层数据库兜底：`ChatMessage.triggerMessageId` 唯一索引，回复与触发消息一对一；重放插入撞 `P2002` 时静默吸收（只记 warn，不重复广播）。序号自增与消息写入放在同一事务，冲突时不会留下 seqId 空洞。

另：崩溃会让会话级 Redis 锁 `ai:conv:<id>` 留到 TTL 到期。`LOCK_MAX_WAIT_MS` 必须大于 `LOCK_TTL_MS`，否则重启后的恢复消费会在锁过期前放弃，任务被记为成功但用户收不到回复。

### D3. 取消信号用 `AbortSignal` 沿调用链传递

`controller(close) → service → orchestrator → agent-runner → LLM`。漏传一层等于没做，因此每层都要显式接收并向下传，任何新增中间层必须补参数。

### D4. 预算两级计数，Redis 存储

`cost:u:{userId}:{yyyymmdd}` 与 `cost:c:{conversationId}`。用户日累计防滥用，会话累计防单轮跑飞；两者都超时以会话级降级优先。

### D5. 指标先从结构化记录聚合，不引入独立指标系统

现有 `emitStage` 已覆盖关键节点，先用离线聚合脚本产出指标，验证口径正确后再考虑 Prometheus。避免先上系统后改口径。

离线报告固定四项，口径如下（时间窗默认最近 7 天）：

| 指标 | 分子 | 分母 | 数据源 |
|---|---|---|---|
| 独立解决率 | 窗口内未转人工（`transferredAt IS NULL`）且至少有一条 AI 回复的会话数 | 有 AI 参与的会话数 | `conversations` + `chat_messages` |
| 首响 P95 | `percentile_cont(0.95)` of `firstResponseAt - transferredAt` | 仅统计两者均非空的会话 | `conversations` |
| 单会话消耗 | 会话累计 token | 会话数 | **当前不可得**：`ai_usage_daily` 只按用户+日聚合，没有 conversation 维度 |
| 转人工原因分布 | 按 `transferReason` 分组的会话数 | 转人工会话总数 | `conversations` |

**不可得规则**：缺数据源的指标必须输出 `"不可得"` 并注明原因，不得用用户日用量平均等近似值冒充。等 token 账本增加 conversation 维度后再补第三项。

### D6. Redis adapter 复用现有连接配置

`main.ts` 换 `RedisIoAdapter`，不新增运维对象。

## Risks / Trade-offs

- **[取消信号穿透失败]** → 先单 Agent 场景验证，再全链路；用日志确认停止。
- **[checkpoint 序列化失败]** → 先用两条真实会话在本地验证。
- **[队列重试导致重复回复]** → 幂等键 + 唯一约束双保险。
- **[指标口径反复]** → 先出离线报告确认口径，再谈接入。

## Migration Plan

1. checkpointer（行为不变，可开关）
2. 队列 + 幂等（行为变更，灰度开关）
3. Redis adapter（低风险）
4. 取消（行为变更）
5. 预算（默认阈值宽松，观察后再收紧）
6. 指标聚合脚本

回滚：每步独立开关；checkpoint 表可保留不删。

## Open Questions

- 预算阈值初始值定多少？—— 先用观察数据定一个宽松值，不影响结构设计。
