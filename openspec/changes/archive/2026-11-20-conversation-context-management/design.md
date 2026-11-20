# Design

## Context

事实：标准 Agent 取最近 20 条、闲聊取最近 10 条，按条数不按 token；没有摘要、实体状态或澄清策略。checkpoint 保存完整 messages，但发给模型的是截断后的子集。工具调用与结果成对存在，硬切可能产生孤立 ToolMessage。

## Goals / Non-Goals

**Goals:** token 预算、滚动摘要、实体/纠正状态、澄清、确认卡片保护。

**Non-Goals:** 不做旧消息向量检索；不做子 Agent 隔离；不替代长期记忆。

## Decisions

### D1. 逻辑裁剪，不删持久化历史

裁剪只影响“发给模型的消息”，checkpoint 保留完整历史。裁剪按 token 预算，保留 system、最近确认、完整 tool 对；实现可复用 LangGraph `trim_messages` 的思路。

### D2. 摘要保留结构化槽位

thread 级滚动摘要除了自然语言，还保留一个结构化头部：

```
activeEntity: 包包
corrections: [苹果手机 -> 包包]
unresolved: 用户想找包包的物流
pendingConfirm: 无
```

摘要作为独立 system 消息注入，不写进 `state.messages`。

### D3. 实体状态优先于摘要

“苹果手机 → 包包”这类纠正，靠实体状态覆盖；摘要只是辅助。向量检索旧消息不用于纠正场景，避免把旧实体捞回来。

### D4. 澄清策略

指代候选不唯一时，先问一句澄清；不静默选择。澄清问题不超过一句，给出候选。

### D5. 确认卡片保护

存在 `pendingConfirm` 或 Redis 待执行任务时，相关消息与摘要不得被裁剪；否则会出现“卡片消失但写操作仍可能执行”。

### D6. 安全回退

摘要失败/超时使用 D1 的安全截断；记录 `context.summary_failed`，不阻塞回答。

## Risks / Trade-offs

- **[摘要丢细节]** → 结构化头部优先；摘要只做辅助
- **[摘要成本]** → 只在超预算时触发，按 thread 缓存
- **[多实例并发]** → 摘要按 thread 串行，使用现有会话锁
- **[纠正被摘要覆盖]** → 实体状态独立存储，摘要生成时强制带入
- **[确认信息丢失]** → 保护规则 + 单测
