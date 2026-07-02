# 38. Agent 潜在风险分析与最佳实践

## 目录

1. [背景](#1-背景)
2. [UserId 传递问题深度分析](#2-userid-传递问题深度分析)
3. [已修复问题清单](#3-已修复问题清单)
4. [潜在风险全景图](#4-潜在风险全景图)
5. [风险详情与建议](#5-风险详情与建议)
6. [Agent Prompt 最佳实践](#6-agent-prompt-最佳实践)
7. [架构防御总览](#7-架构防御总览)

---

## 1. 背景

在 2026-06-30 的 debugging 会话中，暴露了 AI 客服 Agent 系统的多个潜在风险：

- `couponAgent` 始终 `totalToolCalls: 0`，LLM 编造优惠券数据
- 修复 coupon 工具注册后，`totalToolCalls` 仍为 0
- 所有 Agent 都在问用户要 `userId`，而不是使用已有的值
- Agent 进入 reroute 死循环（walletAgent → couponAgent → walletAgent → couponAgent）

这些问题的根因各不相同，但最终表现相似：**LLM 不调用工具，用自身知识回答**。本文档系统性分析所有已知风险。

---

## 2. UserId 传递问题深度分析

### 2.1 问题现象

所有 Agent（wallet、coupon、order）在收到用户消息后，不调用工具，而是回复：

> "I need your userId to proceed. Could you please provide me with your userId?"

### 2.2 原始代码中的传递方式

```typescript
// wallet-agent.node.ts
const { messages, userId, debug } = state;
// ...
content: `...Example:
User: "What's my balance?"
→ You call getWalletBalance(userId="${userId}")  // userId 只在这里出现
...`
```

### 2.3 根因

`userId` 只出现在 **Example（示例）** 部分的 template literal `${userId}` 中。LLM 视角：

1. **示例 = 假设场景**：LLM 认为示例是教学用的假设场景，不是真实值
2. **隐式传递**：userId 没有作为"当前上下文"显式告知 LLM
3. **LLM 的谨慎性**：当 LLM 不确定参数值时，倾向于问用户而不是猜测

### 2.4 修复方案

在 system prompt 顶部增加显式的 `## Current User` 节：

```typescript
## Current User
The current user's ID is: "cmqv1khbn0001po8m1mwqrg8w".
Use this ID when calling any tool that requires the userId parameter.
Do NOT ask the user for their userId — you already have it.
```

### 2.5 类似风险

同样的模式可能出现在其他隐式传递的参数上：

| 参数 | 位置 | 风险 |
|------|------|------|
| `userId` | 所有 Agent prompt 的 Example | ✅ 已修复 |
| `locale` | 未在 Agent 中使用（仅用于 intent router） | 如果未来加入，需显式声明 |
| `sessionId` | 未传入 Agent prompt | 如果 Agent 需要，需显式声明 |

---

## 3. 已修复问题清单

### P0-01: coupon 工具未注册

| 项目 | 内容 |
|------|------|
| **文件** | [`coupon.module.ts`](../../apps/api/src/client/coupon/coupon.module.ts) |
| **根因** | 缺少 `OnApplicationBootstrap` + `registerMany(createCouponTools(...))` |
| **影响** | `getToolsByTag('coupon')` 返回空数组 → `llm.bindTools([])` → LLM 无工具可调用 |
| **修复** | 添加了与 [`order.module.ts`](../../apps/api/src/client/orders/order.module.ts) 相同的生命周期钩子 |
| **防御** | Layer 1: [`ToolRegistryService.validateRegistration()`](../../apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts:29) |

### P0-02: 示例教 LLM 编造数据

| 项目 | 内容 |
|------|------|
| **文件** | [`coupon-agent.node.ts`](../../apps/api/src/client/ai-customer/graph/nodes/coupon-agent.node.ts) |
| **根因** | Example 中硬编码了真实优惠券名称（"New User Special — $10 off $50"） |
| **影响** | LLM 从训练数据中记住了这些名称，直接输出而不是调用工具 |
| **修复** | 改为 `[name from tool result]` 占位符格式 |

### P0-03: userId 隐式传递

| 项目 | 内容 |
|------|------|
| **文件** | wallet/coupon/order Agent node 的 system prompt |
| **根因** | userId 只出现在 Example 的 template literal 中 |
| **影响** | LLM 认为 userId 是示例占位符，问用户要 |
| **修复** | 增加显式 `## Current User` 声明节 |

### P0-04: Layer 1 启动验证

| 项目 | 内容 |
|------|------|
| **文件** | [`tool-registry.service.ts`](../../apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts:29), [`ai-customer.module.ts`](../../apps/api/src/client/ai-customer/ai-customer.module.ts:48) |
| **功能** | 启动时验证所有期望的 agent tag 是否都有对应工具注册 |
| **设计** | `AiCustomerModule.onApplicationBootstrap()` 在所有 domain module 注册完毕后执行校验 |

### P0-05: Supervisor 多 Agent 上下文污染

| 项目 | 内容 |
|------|------|
| **文件** | [`filter-messages.ts`](../../apps/api/src/client/ai-customer/graph/utils/filter-messages.ts), 3 Agent node 的 filter 逻辑 |
| **根因** | Supervisor 模式下，Agent A 的 AI 纯文本输出残留在 `state.messages` 中，Agent B 读取时被污染上下文 |
| **影响** | Agent B 的 context window 包含 Agent A 的输出 → 浪费 token + 可能混淆 LLM |
| **修复** | 创建 `filterAgentMessages()` 共享函数：普通模式过滤 tool/tool_calls，Supervisor 模式额外过滤其他 Agent 的 AI 纯文本 |
| **防御** | `isSupervised` 门控 — 单 Agent 请求零影响；共享函数单一维护点 |

### P0-06: 复合意图合并越权声明泄漏 🔥

| 项目 | 内容 |
|------|------|
| **文件** | [`wallet-agent.node.ts`](../../apps/api/src/client/ai-customer/graph/nodes/wallet-agent.node.ts), [`coupon-agent.node.ts`](../../apps/api/src/client/ai-customer/graph/nodes/coupon-agent.node.ts), [`order-agent.node.ts`](../../apps/api/src/client/ai-customer/graph/nodes/order-agent.node.ts), [`answer-synthesizer.node.ts`](../../apps/api/src/client/ai-customer/graph/nodes/answer-synthesizer.node.ts), [`filter-messages.ts`](../../apps/api/src/client/ai-customer/graph/utils/filter-messages.ts) |
| **根因** | 三层失效叠加：(1) Agent prompt 中的"politely guide back"让 LLM 主动声明越权 (2) `filter-messages` 的 supervised 话题无差别保留给所有 Agent (3) `answerSynthesizer` 原样拼接所有输出不做过滤 |
| **影响** | 复合查询（如"查看优惠券+取款记录"）最终回复中包含"outside my scope"类 disclaimer 文本 |
| **修复** | (1) 三 Agent 增加 CRITICAL Scope Restriction 章节，移除"politely guide" (2) `filter-messages` 按 `pendingTasks` 过滤 supervised 话题 (3) `answerSynthesizer` 增加 prompt 指令 + 代码级 `cleanResult()` 函数 |
| **防御** | 三层防御：(1) Agent prompt 铁律 (2) 消息话题精准过滤 (3) 合并层内容清洗 |
| **文档** | [`41-复合意图合并越权声明修复总结.md`](41-复合意图合并越权声明修复总结.md) |

---

## 4. 潜在风险全景图

### P0（阻塞级 — 必须立即修复）

| ID | 风险 | 文件 | 影响 |
|----|------|------|------|
| R01 | Agent 运行时工具数组为空静默失败 | 所有 agent node | LLM 无工具可调用，编造数据 |
| R02 | testChat debug 只显示最后一步 | [`ai-customer.service.ts:107`](../../apps/api/src/client/ai-customer/ai-customer.service.ts:107) | 多 Agent 流中漏掉前面 Agent 的 toolCalls |
| R03 | Agent 循环无出口导致 reroute 死循环 | [`customer.graph.ts`](../../apps/api/src/client/ai-customer/graph/customer.graph.ts) | supervisorRound 耗尽但无实质输出 |

### P1（严重级 — 应尽快修复）

| ID | 风险 | 文件 | 影响 |
|----|------|------|------|
| R04 | 消息过滤导致上下文丢失 | 所有 agent node | 多轮对话中 Agent 看不到之前的 tool_calls |
| R05 | userId 为空字符串时无验证 | 所有 agent node | prompt 显示 `userId=""` 仍会运行 |
| R06 | Tool 名称冲突静默忽略 | [`tool-registry.service.ts:52`](../../apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts:52) | 同名工具第二个被丢弃，无警告 |

### P2（一般级 — 可后续优化）

| ID | 风险 | 文件 | 影响 |
|----|------|------|------|
| R07 | Provider config 缓存过期 | [`ai.service.ts`](../../apps/api/src/common/ai/ai.service.ts) | LLM 配置变更后需重启 |
| R08 | MAX_ITERATIONS 无指标告警 | 所有 agent node | 循环上限到达无报警 |
| R09 | 并发 userId 潜在的竞态 | 理论上 LangGraph 隔离 | 确认安全但需保留风险意识 |
| R10 | 缺少 Agent 运行时 Metric | 无 | 无法监控 tool call 成功率 |
| R11 | 新 Agent 难以上线（注册有遗漏风险） | 新 `.module.ts` | 需要开发者记得加 OnApplicationBootstrap |

---

## 5. 风险详情与建议

### R01: Agent 运行时工具数组为空静默失败 ⚠️ P0

**位置**：所有 agent node，例如 [`wallet-agent.node.ts:46`](../../apps/api/src/client/ai-customer/graph/nodes/wallet-agent.node.ts:46)

```typescript
const tools = registry.getToolsByTag('wallet');
const llmWithTools = createLLM(llmConfig, { temperature: 0 }).bindTools(tools);
// 如果 tools 为空数组，bindTools([]) 静默成功
```

**建议**：在 `bindTools` 前检查工具数组是否为空，提前 fail-fast：

```typescript
const tools = registry.getToolsByTag('wallet');
if (tools.length === 0) {
  logger.error(`[wallet-agent] No tools registered for tag "wallet"!`);
  return {
    taskResults: { walletAgent: 'System error: wallet tools not available. Please contact support.' },
    messages: state.messages,
    agentSteps: [{ node: 'walletAgent', totalToolCalls: 0, iterations: 0, lastToolCall: null, totalMessages: 0 }],
  };
}
```

**优先级**：高 — 这是 Layer 2 运行时守卫的核心逻辑。

---

### R02: testChat debug 只显示最后一步 ⚠️ P0

**位置**：[`ai-customer.service.ts:107`](../../apps/api/src/client/ai-customer/ai-customer.service.ts:107)

```typescript
const agentDebug = result.agentSteps?.slice(-1)[0];
return {
  debug: {
    toolCalls: agentDebug?.totalToolCalls ?? 0,  // 只显示最后一步
    lastToolCall: agentDebug?.lastToolCall ?? null,
    totalMessages: agentDebug?.totalMessages ?? 0,
  },
};
```

**影响**：在 supervisor 多 Agent 流中，前面的 Agent 的 toolCalls 被忽略。用户看到 `toolCalls: 0` 但实际上是显示最后一步的。

**建议**：改为汇总所有 agentStep：

```typescript
const totalToolCalls = (result.agentSteps ?? []).reduce(
  (sum, step) => sum + (step.totalToolCalls ?? 0), 0
);
const allAgents = (result.agentSteps ?? []).map(s => ({
  node: s.node,
  toolCalls: s.totalToolCalls,
})).filter(s => s.node !== undefined);
```

---

### R03: Agent 循环无出口导致 reroute 死循环 ⚠️ P0

**位置**：[`customer.graph.ts:56`](../../apps/api/src/client/ai-customer/graph/customer.graph.ts:56)

当 walletAgent 和 couponAgent 都不调用工具（无实质输出）时：

```
Round 1: supervisor → walletAgent (0 tool calls) → supervisorRouter
Round 2: supervisor → couponAgent (0 tool calls) → supervisorRouter
Round 3: supervisor → walletAgent (0 tool calls) → supervisorRouter
Round 4: supervisor → couponAgent (0 tool calls) → supervisorRouter
Round 5: supervisor → answerSynthesizer (maxRounds reached)
```

**建议**：在 supervisorRouter 中检测 Agent 输出是否有效：

```typescript
const supervisorRouter = (state: typeof AgentState.State): string => {
  // 如果上一轮 Agent 返回了有效结果（有 tool call），继续
  // 如果上一轮 Agent 没调用工具且没解决，直接回 answerSynthesizer
  const lastStep = state.agentSteps?.slice(-1)[0];
  if (lastStep && lastStep.totalToolCalls === 0 && lastStep.iterations === 0) {
    return 'answerSynthesizer'; // Agent 无法处理，结束
  }
  // ... 原有逻辑
};
```

---

### R04: 消息过滤导致上下文丢失 ⚠️ P1

**位置**：所有 agent node，例如 [`wallet-agent.node.ts:147`](../../apps/api/src/client/ai-customer/graph/nodes/wallet-agent.node.ts:147)

```typescript
.filter((msg: any) => {
  const type = msg._getType?.() ?? '';
  if (type === 'tool') return false;
  if (type === 'ai' && msg.tool_calls?.length) return false;
  return true;
})
```

**意图**：防止 Agent 看到其他 Agent 的工具调用。

**影响**：
- 在多轮对话中，用户第二次说"帮我查余额"
- Agent 看不到之前自己调用 `getWalletBalance` 的记录
- LLM 可能重复调用相同工具

**建议**：只过滤其他 Agent 的 tool messages，保留当前 Agent 的：

```typescript
// 更精确的过滤
const currentAgentTag = 'wallet';
.filter((msg: any) => {
  const type = msg._getType?.() ?? '';
  // 保留当前 Agent 的 tool messages
  if (type === 'tool' && msg.additional_kwargs?.agent === currentAgentTag) return true;
  // 过滤其他 Agent 的 tool messages
  if (type === 'tool') return false;
  if (type === 'ai' && msg.tool_calls?.length && msg.additional_kwargs?.agent !== currentAgentTag) return false;
  return true;
})
```

**但注意**：需要先给 ToolMessage 打上 agent 标签（当前没有这个机制）。

---

### R05: userId 为空字符串时无验证 ⚠️ P1

**位置**：所有 agent node

```typescript
const userId = state.userId;
// userId 可能是 ''（空字符串）
content: `## Current User
The current user's ID is: "${userId}".` // 显示 userId=""
```

**建议**：在 agent 开头验证 userId 非空：

```typescript
const userId = state.userId;
if (!userId) {
  logger.error(`[wallet-agent] userId is empty!`);
  return {
    taskResults: { walletAgent: 'Session error: user information not available.' },
    messages: state.messages,
    agentSteps: [{ node: 'walletAgent', totalToolCalls: 0, iterations: 0, lastToolCall: null, totalMessages: 0 }],
  };
}
```

---

### R06: Tool 名称冲突静默忽略 ⚠️ P1

**位置**：[`tool-registry.service.ts:52`](../../apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts:52)

```typescript
registerMany(tools: TaggedTool[]): void {
  const existingNames = new Set(this.allTaggedTools.map((t) => t.tool.name));
  const newTools = tools.filter((t) => !existingNames.has(t.tool.name));
  this.allTaggedTools.push(...newTools); // 静默丢弃同名工具
}
```

**建议**：冲突时输出警告日志：

```typescript
registerMany(tools: TaggedTool[]): void {
  const existingNames = new Set(this.allTaggedTools.map((t) => t.tool.name));
  const conflicts = tools.filter((t) => existingNames.has(t.tool.name));
  for (const c of conflicts) {
    console.warn(`[ToolRegistry] Tool "${c.tool.name}" already registered, skipping`);
  }
  const newTools = tools.filter((t) => !existingNames.has(t.tool.name));
  this.allTaggedTools.push(...newTools);
}
```

---

### R07-R11: 后续优化项

| ID | 优化项 | 优先级 | 描述 |
|----|--------|--------|------|
| R07 | Provider config 变更通知 | P2 | AiService 缓存 provider config，可以用 EventEmitter 通知更新 |
| R08 | MAX_ITERATIONS 告警 | P2 | 当 agent 达到迭代上限时，发送报警到日志监控系统 |
| R09 | 并发隔离验证 | P2 | LangGraph 的 state 是隔离的，但可以加集成测试确认 |
| R10 | Agent Metric 收集 | P2 | 记录每次 agent 运行的 tool call 次数、耗时、成功率 |
| R11 | ESLint 注册检查 | P3 | 检测 `.module.ts` 是否实现了 `OnApplicationBootstrap` + 调用了 `registerMany` |
| R12 🔥 | **Agent prompt 中的 "politely guide" 反模式** | **P0** | **复合意图场景必现 Bug** — Agent 做了分内工作还主动声明"不归我管"，`answerSynthesizer` 拼接后泄漏到最终回复。修复：替换为 `CRITICAL: Scope Restriction`，见 [`41-复合意图合并越权声明修复总结.md`](41-复合意图合并越权声明修复总结.md) |

---

## 6. Agent Prompt 最佳实践

### 6.1 模板变量传递规则

```typescript
// ❌ 错误：只在 Example 中隐式传递
content: `...
Example: call getBalance(userId="${userId}")`

// ✅ 正确：显式声明 + Example 复用
content: `...
## Current User
The current user's ID is: "${userId}".

## Example
→ call getBalance(userId="${userId}")`
```

### 6.2 Prompt 结构标准模板

```
## Role
[你是谁，平台是什么，用什么语言回复]

## Current Context
[当前用户的上下文参数：userId, locale 等]

## Your Workflow
[Step 1..N 的操作流程]

## Available Tools
[工具列表及用途说明]

## Domain Rules
[领域特定的业务规则]

## Hard Rules
[铁律：必须调用工具、不得编造数据等]

## Example
[示例：使用当前上下文变量，展示流程]

## Display Format
[输出格式要求]
```

### 6.3 铁律写法

```typescript
## Hard Rules (Violation = mistake)

- **You MUST call at least one tool** to answer questions. NEVER make up data.
- Never use your own knowledge to fabricate data. All data must come from tool calls.
- Always pass the ${paramName} parameter when calling tools.
- If a tool returns an error, tell the user the real error. Don't hide it.
```

### 6.4 Example 不要用具体数值

```typescript
// ❌ 错误：LLM 可能记住这些值
"New User Special — $10 off $50"

// ✅ 正确：用占位符
"[name from tool result] — [discount from tool result]"
```

### 6.5 Scope Restriction 写法（Supervisor 模式必须）

所有 Agent 的 `## Hard Rules` 顶部必须包含 CRITICAL Scope Restriction 章节：

```typescript
## Hard Rules (Violation = mistake)

### CRITICAL: Scope Restriction
- You ONLY handle [domain] topics: [specific list].
- If the user's message mentions topics outside your scope ([other domains]),
  ABSOLUTELY do NOT mention them. Do NOT say "this is outside my scope" or
  "I cannot help with that" or "please contact another team".
  Other specialized assistants will handle those parts.
- Only respond to the [domain]-related part of the user's question.
  Ignore all non-[domain] content completely.
```

**反模式**（已从所有 Agent 中移除）：

```typescript
// ❌ 禁止 — 复合意图场景必现 Bug
"- If the question is not about [domain], politely guide the user back."
```

---

## 7. 架构防御总览

```
┌──────────────────────────────────────────────────────────────────────────┐
│                   5-Layer Defense System                                   │
├─────────────┬────────────────────────────┬────────────┬──────────────────┤
│ Layer       │ 机制                       │ 状态       │ 文档             │
├─────────────┼────────────────────────────┼────────────┼──────────────────┤
│ Layer 1     │ 启动时验证注册             │ ✅ 已实现  │ tool-registry    │
│ Layer 2     │ Agent 运行时检查           │ ❌ 未实现  │ R01              │
│ Layer 3     │ 集成测试                   │ ❌ 未实现  │ R01              │
│ Layer 4     │ ESLint 规则                │ ❌ 未实现  │ R11              │
│ Layer 5 🔥  │ 复合意图三层防御           │ ✅ 已实现  │ §41, 本文 P0-06 │
│             │ ├─ Agent Scope Restriction │            │                  │
│             │ ├─ Message Topic 精准过滤   │            │                  │
│             │ └─ 合并层内容清洗           │            │                  │
└─────────────┴────────────────────────────┴────────────┴──────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   Prompt 防御                                    │
├───────────────────────────┬──────────────────┬──────────────────┤
│ 规则                      │ 状态             │ 文档             │
├───────────────────────────┼──────────────────┼──────────────────┤
│ 显式声明上下文参数         │ ✅ 已修复         │ 本文 §2.4       │
│ Example 用占位符           │ ✅ 已修复         │ 本文 §6.4       │
│ 铁律：必须调用工具         │ ✅ 已有           │ 本文 §6.3       │
│ Step-by-step Workflow     │ ✅ 已有           │ 本文 §6.2       │
│ Scope Restriction 🔥      │ ✅ 已修复         │ 本文 §6.5, §41  │
│ 禁止 "politely guide" 🔥  │ ✅ 已修复         │ 本文 §6.5, §41  │
└───────────────────────────┴──────────────────┴──────────────────┘
```

---

## 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-06-30 | v1.0 | 初始版本：总结 userId 问题、已修复问题、潜在风险全景图、最佳实践 |
| 2026-07-02 | v1.1 | 新增 P0-06 复合意图合并越权声明泄漏、R12 polite guide 反模式风险、§6.5 Scope Restriction 写法、Layer 5 三层防御架构 |
