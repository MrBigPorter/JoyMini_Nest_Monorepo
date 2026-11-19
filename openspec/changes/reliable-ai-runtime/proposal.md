# Proposal

## Why

AI 处理链路目前建立在三个不成立的假设上：进程不会重启、只有一个实例、消息不会丢。

`MemorySaver` 把会话状态存在进程内存里，重启即失；事件总线是进程内的，AI 请求一旦随进程崩溃就静默消失；Socket 房间没有跨实例广播能力；用户断连后模型继续跑完、继续计费；没有任何 token 预算。这些问题单机演示时看不出来，一旦部署两个副本就全部暴露。

## What Changes

- **状态持久化**：会话状态改存数据库（沿用现有 `Conversation.threadId` 作为图线程键），进程内存降级为可选实现。
- **任务可靠投递**：AI 处理走 BullMQ，以 `messageId` 为幂等键，重复投递丢弃第二次；失败可重试，超限进死信。
- **跨实例投递**：接入 Socket.IO Redis adapter。
- **断连取消**：连接关闭时沿调用链传递取消信号，中止模型调用。
- **资源预算**：按用户日累计与单会话两级计量 token，超限降级而非失败。
- **指标化**：在既有结构化日志之外，补齐可聚合指标（独立解决率、P95 首响、单会话 token、转人工原因分布）。

## Capabilities

### New Capabilities

- `ai-customer/agent-runtime`: AI 处理后端的运行时保证——状态可重建、任务至少投递一次且幂等、跨实例可送达、断连可中止、资源有预算、行为可度量。

### Modified Capabilities

（无。）

## Impact

**代码**

- `graph/customer.graph.ts`、`graph/state.ts` — checkpointer 替换
- `client/ai-customer/ai-message.listener.ts`、`ai-customer.service.ts` — 走队列与取消
- `common/events/events.gateway.ts`、`main.ts` — Redis adapter
- `common/chat/events/chat.events.ts` — 事件补 `messageId`
- `client/ai-customer/sse-rate-limiter.service.ts` — 两级预算
- 新增指标聚合模块

**数据库**

- checkpoint 表（走 Prisma 迁移，不用运行时建表）
- 队列相关表由 BullMQ 管理

**测试**

- 重启恢复用例、重复投递用例、跨实例投递用例、断连中止用例、预算降级用例

**不涉及**：意图与工具内容、前端、部署拓扑（除 adapter 外）。
