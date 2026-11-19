# Proposal

## Why

工具的 `userId` 目前由模型填写。全仓 12 处以上写着 `userId: z.string().describe('The current user ID')`，部分文件注释标注「方案A：userId 由 LLM 通过 tool 参数自动传递」——这意味着用户只要在对话里说一句指定 ID，就可能读到别人的订单、钱包、优惠券。

同一信任边界上还有四处缺口：写操作确认名单只覆盖 5 个工具，`createAddress` / `updateAddress` 直接执行；流式转发没有白名单，内部决策结构可能出现在客户端；Socket 触发 AI 的路径没有与 HTTP 一致的限流，同一会话可并发启动多个任务；`ChatMessage` 缺 `(conversationId, seqId)` 唯一约束，并发发送可能重号。

这些不是性能问题，是**用户可以直接利用的越权路径**，必须在做其它企业级能力之前堵掉。

## What Changes

- **身份收口**：从工具 schema 中删除 `userId` 参数，改为在构造工具时由调用链闭包注入；模型无法覆盖。
- **能力标记**：工具注册时声明 `read` / `write` / `requiresOwnership`，执行前按标记校验。**不引入 RBAC**——客户端用户没有角色体系，JWT 只签 `sub`。
- 补全写操作确认名单：`createAddress`、`updateAddress` 纳入截停。
- 增加输入侧注入检测与输出侧白名单：只转发最终文本帧，内部决策结构不出网。
- Socket 触发 AI 的路径接入与 HTTP 一致的限流，同一会话同一时刻只允许一个 AI 任务。
- 消息表补 `(conversationId, seqId)` 唯一约束，冲突时重试取号。

## Capabilities

### New Capabilities

- `ai-customer/agent-trust-boundary`: AI Agent 的信任边界——谁的请求、能做什么、能看到什么。规定身份只能来自凭证，工具必须声明能力并按能力校验，有副作用的操作必须经确认，模型输出在出网前必须过滤。

### Modified Capabilities

（无。`ai-customer/intent-classification` 与 `ai-customer/intent-selection` 属另外两个变更，边界不重叠。）

## Impact

**代码**

- `apps/api/src/client/ai-customer/graph/tools/*.ts`（9 个领域文件）— 删除 `userId` 参数，工厂函数增加身份入参
- `apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts` — 能力标记
- `apps/api/src/client/ai-customer/graph/nodes/orchestrator-utils/confirm-utils.ts` — 补全名单
- `apps/api/src/client/ai-customer/graph/nodes/agent-factory.ts` — 装配时注入身份与能力
- `apps/api/src/client/ai-customer/ai-stream.handler.ts` — 输出白名单
- `apps/api/src/client/ai-customer/graph/utils/intent-classifier.ts` 或新增模块 — 输入侧检测
- `apps/api/src/common/events/events.gateway.ts` — Socket 路径限流与单飞
- `apps/api/prisma/schema.prisma` + 迁移 — 消息唯一约束

**测试**

- 工具身份用例：构造指定他人 ID 的对话，断言参数中不含身份且返回数据属于本人
- 确认名单用例：`createAddress` / `updateAddress` 被截停
- 流式白名单用例：构造含内部字段的输出，客户端收不到
- 并发用例：同一会话两个 Socket 触发，只有一个 AI 任务启动

**文档**

- `docs/current-task.md` 与 `docs/AI-joymini/87-全项目问题总清单.md` 对应条目标记

**不涉及**：意图标签体系、资金结算逻辑、前端、部署拓扑。
