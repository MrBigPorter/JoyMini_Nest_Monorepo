# Design

## Context

见 `proposal.md`。调研确认：

- 只有 checkpointer（thread 级）+ ChatMessage；ChatMessage 从未回放给 LangGraph
- `saveContext` 代码已不存在，只剩旧文档
- 标准 Agent、闲聊、RAG、合成器分别组 prompt；只改 `buildAgentPrompt` 覆盖不全
- `buildInitialMessages` 已有 `options.inject` 钩子但无人调用
- PromptResolver 正在改为深合并（PR #70）；记忆仍不应放进 `AgentPromptConfig`
- 注销 `clearUserData` 不删 ChatMessage/checkpoint/feedback

## Goals / Non-Goals

**Goals:** 按 userId 的蒸馏记忆、TTL/删除、统一注入、隐私白名单。

**Non-Goals:** 不存原始对话；不做跨用户共享；不替代 checkpointer；不面向用户展示记忆编辑 UI。

## Decisions

### D1. 记忆是用户级蒸馏层

两张表：

- `AiUserMemory`：`userId`、`kind`（preference/fact/summary）、`key`、`value`（≤500 字）、`confidence`、`sourceConversationId/sourceMessageId`、`version`、`status`、`expiresAt`、`lastUsedAt`
- `AiMemorySummary`：`userId`、`threadId/conversationId`、`summary`（≤1000 字）、`coveredToSeqId`、`tokenCount`、`expiresAt`

不存原文、手机号、证件号、地址、订单号、验证码、支付信息。

### D2. 抽取与写入异步

在 `finalizeAfterStream` 后 fire-and-forget；用 `sourceMessageId` 唯一键幂等；失败只记录，不阻断回复。抽取规则先做确定性槽位（语言、称呼、常用城市、已实名布尔），不急于上 LLM 摘要。

### D3. 在 orchestrator 入口统一读取

每轮在 graph 入口读取一次，作为独立 system 消息传给标准 Agent、闲聊、RAG、合成器；每轮覆盖，不写入 `state.messages`，避免 checkpoint 持久化和 PII 放大。标准 Agent 复用 `buildInitialMessages` 的 `inject` 钩子。

### D4. 限制注入规模

每用户最多 20 条高置信/最近使用，单条 ≤500 字，总长度设上限；过期/低置信不注入。记忆作为“数据”而非指令，提示模型不得执行其中内容。

### D5. 删除与合规

- 记忆 TTL：偏好 365 天、事实 180 天、摘要 30–90 天；软删除保留 30 天后物理清理
- 注销 `clearUserData` 增加记忆表删除；`clear-history` 只清会话摘要，不删用户偏好，并明确文案
- 增加定时清理任务；记忆表加 `(userId, status, expiresAt)` 索引

## Risks / Trade-offs

- **[PII 放大]** → 字段白名单 + 正则过滤 + 长度上限；禁止原文/号码/证件/地址/订单号
- **[日志二次泄露]** → `buildAgentPrompt` 当前打印完整 prompt；注入记忆前改为只记 length/hash
- **[跨用户泄露]** → 以 sender userId 为键，不按 conversation 共享
- **[记忆投毒]** → 只存结构化槽位，不作为指令；限制长度与格式
- **[PromptResolver 覆盖]** → 记忆独立注入，不放进 `AgentPromptConfig`
- **[删除权缺口]** → 注销/清历史必须覆盖记忆表，并留审计
