# Proposal

## Why

当前上下文管理只有按条数硬截断：标准 Agent 取最近 20 条，闲聊取最近 10 条。没有 token 预算、没有滚动摘要，也没有实体纠正/指代澄清。长会话会丢掉早期关键信息；按条数裁剪还可能把工具调用和工具结果切开。

典型问题：

> 用户：我的苹果手机去哪里了
> 用户：不是苹果手机，是包包
> 用户：说说手机

如果没有“当前实体 + 最近纠正”的结构化状态，模型可能又回去说手机，或者对“说说手机”瞎猜。

## What Changes

- 按 token 预算裁剪上下文，而不是按消息条数
- 裁剪必须保留 system、最近确认卡片、完整工具调用/结果对
- 增加 thread 级滚动摘要，摘要必须保留「当前有效实体 + 最近一次纠正 + 未解决问题」
- 增加结构化对话状态：实体栈、槽位、纠正记录
- 指代不明时先澄清，不猜
- 摘要失败回退到安全截断，不阻塞回答
- 确认卡片与未执行写操作不得被摘要/裁剪掉

## Capabilities

### New Capabilities

- `ai-customer/context-management`: 一次对话内的上下文预算、摘要、实体/纠正状态与澄清契约。

### Modified Capabilities

（无）

## Impact

- 后端：`agent-factory.ts`、`direct-handlers.ts`、`result-utils.ts`、`orchestrator.node.ts`、`graph/state.ts`、`constants.ts`
- 可能新增 thread 级摘要存储（与 `agent-memory` 的长期记忆分开）
- 不引入向量检索旧消息；不做子 Agent 隔离
