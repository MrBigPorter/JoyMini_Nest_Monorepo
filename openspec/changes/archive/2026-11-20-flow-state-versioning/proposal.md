# Proposal

## Why

当前 `flowState` 从未写入 checkpoint，`updateFlowData/updateFlowStatus` 只回显、不写 state，`flowDataAccumulator` 从未传入，`flowContext` 被强制关闭。所谓“状态机”实际是声明了但没接通的死代码；在这个基础上做版本/回滚没有意义。

## What Changes

- **阶段 A**：把 `flowState` 真正写入 LangGraph checkpoint，打通工具 → agent-runner → orchestrator
- **阶段 B**：引入不可变的流程定义版本、会话级绑定、安全切换与回滚审计
- 新会话绑定最新版本；旧会话保持原版本
- 只在安全点切换（无 `pendingConfirm`、无进行中流、未转人工）
- 回滚分「定义回滚」与「状态回滚」，后者需要显式确认且不撤销业务副作用

## Capabilities

### New Capabilities

- `ai-customer/flow-state-versioning`: 流程状态的可持久化、可版本化、可绑定与可回滚契约。

### Modified Capabilities

（无）

## Impact

- 后端：`graph/state.ts`、`flow-tools.ts`、`agent-runner.ts`、`agent-factory.ts`、`orchestrator.node.ts`
- 数据库：新增流程定义版本表、会话绑定表、审计表；可能涉及 checkpoint 回滚工具
- 不改变现有确认卡片的业务动作映射；不撤销已完成的写操作
