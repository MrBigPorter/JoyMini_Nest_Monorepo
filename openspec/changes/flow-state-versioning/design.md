# Design

## Context

见 `proposal.md`。调研确认：

- `flowState` 从未被写入；`updateFlowData/updateFlowStatus` 只回显
- `flowDataAccumulator` 从未传入 `runAgentLoop`，`flowContext` 被强制关闭
- `pendingConfirm` 在 checkpoint，确认 token/OTP 在 Redis，两者没有互相引用
- checkpoint 四张表不在 Prisma schema 内，回滚需 SQL/saver API
- 没有任何 FlowDefinition/FlowBinding 表

## Goals / Non-Goals

**Goals:** 阶段 A 接通 flowState；阶段 B 定义版本、绑定、安全切换、回滚审计。

**Non-Goals:** 不撤销已完成的业务写操作；不做跨会话流程迁移；不在本次实现多实例流程编排。

## Decisions

### 阶段 A：先接通状态机

1. `agent-runner` 接收并传递 `flowDataAccumulator`；`agent-factory` 不再强制 `flowContext:false`
2. `updateFlowData/updateFlowStatus` 的调用参数进入 accumulator；orchestrator 每个返回路径都写完整 `flowState`（reducer 是整体替换）
3. 先补单测证明「第二轮能读到第一轮 flowType/step/data」
4. 未完成 A 之前，不得宣称版本化状态机

### 阶段 B：版本与绑定

#### D1. 不可变定义版本

`FlowDefinitionVersion`：`flowType`、`version`、`definitionHash`（规范化 JSON 的 SHA-256）、`payload`、`status`。哈希必须包含 allowedStatuses、step 图、确认动作映射、prompt 版本引用、写工具 capability；否则版本是装饰。

#### D2. 会话绑定

`ConversationFlowBinding`：`conversationId`、`flowType`、`definitionVersionId`、`definitionHash`、`status`、`threadId`、`checkpointId`。每个会话每个 flowType 只有一条 ACTIVE；新会话绑最新，旧会话保持。

#### D3. 安全切换

只允许：`pendingConfirm == null`、Redis 无 `ai:confirm:pending:*`、无进行中流、`handlerId == null`、目标版本 active 且 flowType 匹配、threadId 未漂移。不满足返回明确原因。

#### D4. 回滚边界

- 定义回滚：只切绑定指针，不动 checkpoint
- 状态回滚：恢复 checkpoint 到指定 `checkpointId`，需要清理 blobs/writes、处理 threadId 与 ChatMessage 一致性
- 已完成确认、已执行写操作、已转人工 → 拒绝状态回滚
- 回滚只回状态，不退款、不撤单、不撤销业务副作用

#### D5. 审计

`FlowBindingAuditLog` 记录 bind/switch/rollback、操作者、原因、from/to version、threadId、checkpointId。

## Risks / Trade-offs

- **[状态机当前是死代码]** → 阶段 A 必须先做；否则版本/回滚无意义
- **[两套记忆源]** → checkpoint messages 与 ChatMessage 独立；状态回滚可能导致 UI 与 AI 上下文不一致，需明确只回滚哪一套
- **[确认链路跨存储]** → pendingConfirm 与 Redis token 无关联，切换/回滚前必须拒绝或作废
- **[checkpoint 无保留期]** → 回滚窗口等于永久；需定义清理策略
- **[MemorySaver 降级]** → 语义不成立，回滚 API 必须 fail-closed
