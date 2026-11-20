# Proposal

## Why

当前只有 checkpointer（thread 级）与 `ChatMessage`；换 thread 即失忆，`ChatMessage` 也从未回放给 LangGraph。`saveContext` 代码已不存在，只剩旧文档残留。用户偏好、已确认事实、未解决事项无法跨会话复用。

## What Changes

- 新增按 `userId` 的长期记忆：偏好、稳定事实、会话摘要
- 只存蒸馏结论，不存原文、手机号、证件号、地址、订单号
- 记忆有 TTL、置信度、来源、版本；支持用户删除
- 在 graph/orchestrator 入口统一读取，覆盖标准 Agent、闲聊、RAG、合成器四条路径
- 作为独立 system 消息注入，不写入 `state.messages`
- 写入异步、失败不阻断回复；注销/清历史覆盖记忆表

## Capabilities

### New Capabilities

- `ai-customer/agent-memory`: 跨会话用户记忆的存储、读取、注入、过期与删除契约。

### Modified Capabilities

（无）

## Impact

- 数据库：新增 `ai_user_memory` / `ai_memory_summary`（名称待定）与迁移、TTL 清理任务
- 后端：`customer.graph.ts`、`orchestrator.node.ts`、`direct-handlers.ts`、`ai-memory.service.ts`、`auth.service.ts` 的注销/清历史
- 不改变 checkpointer 作为短期执行状态的职责
- Flutter 不在本次范围（记忆对用户不可见，除非后续加管理入口）
