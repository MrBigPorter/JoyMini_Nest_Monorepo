# Wallet Agent 修复方案（4 个问题 + Debug 输出）

> ✅ **ALL FIXES IMPLEMENTED**
>
> 本文档描述的 4 个问题均已修复:
> - A: `fixedAmounts` 已从 `getPaymentChannels` 返回中删除
> - B: `stripToolResult()` 解决 `INVALID_TOOL_RESULTS`
> - C: MemorySaver + `thread_id` 实现会话隔离
> - D: `debug` 模式已实现（返回完整 `debugInfo`）
> 实际代码: [`wallet-tools.ts`](../../apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts)

# Wallet Agent 修复方案（4 个问题 + Debug 输出）

## 问题清单

| # | 问题 | 严重性 | 根因 |
|---|------|--------|------|
| A | 金额幻觉 100 → 500 | 🔴 | `fixedAmounts: [100, 200, 500]` 暴露给 LLM |
| B | DeepSeek 报错 `INVALID_TOOL_RESULTS` | 🔴 | `state.messages.slice(-6)` 切出孤儿 ToolMessage |
| C | 新对话混入旧上下文 | 🟡 | `thread_id: userId` 没有会话隔离 |
| D | 无法查看完整 LLM 上下文 | 🟢 | 缺少 debug mode |
| E | Intent Routing 分类错误 | 🟡 | 类别语义重叠，LLM 无法区分"商品层面" vs "资金层面" |

---

## 问题 A: 金额幻觉

### 根因

[`wallet-tools.ts:getPaymentChannels`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:324-364) 返回 `fixedAmounts: [100, 200, 500]`（来自 [`PaymentConfigItemDto.fixedAmounts`](apps/api/src/client/payment-channel/dto/payment-channel.dto.ts:48-52)），LLM 在多轮 OTP 循环后忘记用户说的 "100"，从列表中取了 500。

### 修复

**A1** — 在 [`wallet-tools.ts`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:343) getPaymentChannels handler 中过滤 `fixedAmounts`：
```typescript
delete (llmResult as any).fixedAmounts;
```

**A2** — 在 [`wallet-agent.node.ts`](apps/api/src/client/ai-customer/graph/nodes/wallet-agent.node.ts:61-104) system prompt 加金额追踪指令：
```
## CRITICAL - Amount Tracking:
- The user specifies a withdrawal amount
- You MUST remember this exact amount throughout the entire flow
- When calling applyWithdraw, ALWAYS use the amount the user originally specified
```

---

## 问题 B: DeepSeek `INVALID_TOOL_RESULTS`（消息序列错误）

### 根因

[`wallet-agent.node.ts:106`](apps/api/src/client/ai-customer/graph/nodes/wallet-agent.node.ts:106) 用 `state.messages.slice(-6)` 截断消息。当 state.messages 包含 ToolMessage 时，slice 可能切掉对应的 AIMessage（含 tool_calls），但保留了 ToolMessage 本身。

```
state.messages 共 12 条:
  idx 6: AIMessage(tool_calls: { id: "call_abc" })  ← slice(-6) 切掉
  idx 7: ToolMessage(tool_call_id: "call_abc")       ← 被保留！孤儿 ToolMessage
  ...
  idx 12: HumanMessage("取款记录")

currentMessages = [system, ToolMessage(孤儿), ..., HumanMessage]
                           ↑ DeepSeek API: 没有前驱 tool_calls → 400 错误
```

### 修复

**B1** — [`wallet-agent.node.ts:106`](apps/api/src/client/ai-customer/graph/nodes/wallet-agent.node.ts:106) 改为 "安全截断" — 确保截断不拆散 `AIMessage(tool_calls) + ToolMessage` 对：

```typescript
// 原代码 (有 bug):
// ...state.messages.slice(-6),

// 修复: 从末尾往前找，确保最后一个完整的 "tool_calls→ToolMessages" 对不被拆散
function safeSliceMessages(messages: BaseMessage[], maxCount: number): BaseMessage[] {
  // 从末尾往前取 maxCount 条
  const sliced = messages.slice(-maxCount);
  
  // 检查 sliced 中是否有孤儿 ToolMessage（第一条是 ToolMessage）
  // 如果有，多往前取一条（包含前驱 AIMessage）
  if (sliced.length > 0 && sliced[0]._getType() === 'tool') {
    const index = messages.indexOf(sliced[0]);
    if (index > 0) {
      return messages.slice(index - 1);
    }
  }
  return sliced;
}
```

**B2** — 或者在 state 中只存储 Human/AI 消息，不存储 ToolMessage：

在 [`wallet-agent.node.ts:177`](apps/api/src/client/ai-customer/graph/nodes/wallet-agent.node.ts:177)，返回 `state.messages` 时过滤掉 ToolMessage：
```typescript
messages: currentMessages.slice(1).filter(m => m._getType() !== 'tool'),
```

这样 state.messages 永远只有 Human/AI 消息，不会有孤儿 ToolMessage。

推荐方案：**B2**（更干净，一劳永逸）

---

## 问题 C: 新对话混入旧上下文

### 根因

[`ai-customer.service.ts:93`](apps/api/src/client/ai-customer/ai-customer.service.ts:93) 用 `thread_id: userId`。同一个用户的所有对话（提现流程、查询取款记录等）都共享同一个 MemorySaver checkpoint 线程。

```
thread_id = userId
  ├─ 第 1 轮: "我要取款" → wallet agent, state 保存了 12+ 条消息
  ├─ 第 2 轮: "100" → 继续同一个线程
  ├─ ...
  ├─ 第 N 轮: "取款记录" → 新的查询，但 state 还包含之前的完整提现流程
  └─ currentMessages = [system, ...state.messages.slice(-6)]
                      = 旧提现流程的工具调用结果 + 新查询消息混在一起
```

### 修复

**C1** — [`ai-customer.service.ts:testChat`](apps/api/src/client/ai-customer/ai-customer.service.ts:81) 支持 `sessionId` 参数：

```typescript
async testChat(message: string, userId: string, debug = false, sessionId?: string) {
  // 同一 sessionId 保持连续对话，不同 sessionId 开启新对话
  const threadId = sessionId ?? `${userId}:${Date.now()}`;
  
  const result = await this.compiledGraph.invoke(
    {
      messages: [new HumanMessage(message)],
      userId: userId,
      debug,
    },
    {
      configurable: { thread_id: threadId },
    },
  );
  // ...
}
```

在 [`test-chat.dto.ts`](apps/api/src/client/ai-customer/dto/test-chat.dto.ts) 加 `sessionId` 字段：
```typescript
export class TestChatDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsBoolean()
  debug?: boolean;

  @IsOptional()
  @IsString()
  sessionId?: string;  // 同一 session 保持上下文，不同 session 隔离
}
```

用户测试时每次传相同的 sessionId 保持连续，传不同的 sessionId 开启新对话。

---

## 问题 D: Debug 上下文输出

### 设计

在 `POST /ai/customer/test-chat` 加 `{ debug: true }`，返回 wallet agent 完整的 `currentMessages` 数组。

### 涉及文件

| 文件 | 改动 |
|------|------|
| **新增**: `graph/utils/serialize-messages.ts` | BaseMessage[] → 可序列化的 JSON |
| [`agent-types.ts:AgentStep`](apps/api/src/client/ai-customer/graph/types/agent-types.ts:11) | 加 `messages?: SerializedMessage[]` |
| [`agent-types.ts:TestChatResult`](apps/api/src/client/ai-customer/graph/types/agent-types.ts:70) | 加 `agentSteps?: AgentStep[]` |
| [`test-chat.dto.ts`](apps/api/src/client/ai-customer/dto/test-chat.dto.ts) | 加 `debug?: boolean`, `sessionId?: string` |
| [`state.ts`](apps/api/src/client/ai-customer/graph/state.ts) | 加 `debug: Annotation<boolean>` |
| [`wallet-agent.node.ts`](apps/api/src/client/ai-customer/graph/nodes/wallet-agent.node.ts) | debug=true 时 serialize 并返回 messages |
| [`wallet-tools.ts`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts) | 过滤 fixedAmounts |
| [`ai-customer.service.ts`](apps/api/src/client/ai-customer/ai-customer.service.ts) | 传递 debug/sessionId，返回完整 agentSteps |
| [`ai-customer.controller.ts`](apps/api/src/client/ai-customer/ai-customer.controller.ts) | 传递 debug/sessionId |

---

## 完整执行顺序

```
问题 A (金额幻觉)    → wallet-tools.ts + wallet-agent.node.ts prompt
问题 B (ToolMessage) → wallet-agent.node.ts 过滤 ToolMessage 出 state.messages
问题 C (会话隔离)    → test-chat.dto.ts + ai-customer.service.ts + ai-customer.controller.ts
问题 D (Debug 输出)  → 新增 serialize-messages.ts + 修改 agent-types.ts + state.ts + wallet-agent.node.ts
```

### Step by step

1. 新增 [`graph/utils/serialize-messages.ts`](apps/api/src/client/ai-customer/graph/utils/serialize-messages.ts) — 消息序列化工具
2. 修改 [`agent-types.ts`](apps/api/src/client/ai-customer/graph/types/agent-types.ts) — AgentStep + TestChatResult 扩展
3. 修改 [`test-chat.dto.ts`](apps/api/src/client/ai-customer/dto/test-chat.dto.ts) — 加 debug + sessionId
4. 修改 [`state.ts`](apps/api/src/client/ai-customer/graph/state.ts) — 加 debug 字段
5. 修改 [`wallet-tools.ts`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts) — 过滤 fixedAmounts (问题 A)
6. 修改 [`wallet-agent.node.ts`](apps/api/src/client/ai-customer/graph/nodes/wallet-agent.node.ts)
   - 过滤 ToolMessage 出 state.messages (问题 B)
   - 加 system prompt 金额追踪指令 (问题 A)
   - debug=true 时 serialize 并返回 messages (问题 D)
7. 修改 [`ai-customer.service.ts`](apps/api/src/client/ai-customer/ai-customer.service.ts) — 传递 debug/sessionId，返回 agentSteps
8. 修改 [`ai-customer.controller.ts`](apps/api/src/client/ai-customer/ai-customer.controller.ts) — 传递 debug/sessionId

---

## 问题 E: Intent Routing 分类错误

### 根因

[`intent-router.node.ts:52-104`](apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts) 的 `INTENT_PROMPT` 中，类别描述过于模糊 — 只有抽象名称 + 英文 examples，没有明确的语义边界。

导致"购买记录""购买商品记录"这种跨类别词被错误路由到 `wallet` 而非 `order`。

### 行业术语

- **Intent Classification Ambiguity** — 意图分类模糊
- **Semantic Overlap** — 语义重叠（order 和 wallet 在"记录"概念上重叠）
- **Single-Point Routing Failure** — 单点路由故障（一个 LLM 调用决定整个对话走向）
- **Coarse-to-Fine Classification** — 粗到细分类（先分大类再分子类）

### 架构级修复方案

**方案：语义边界定义（重写 INTENT_PROMPT 类别描述）**

当前：
```typescript
### order — Order related
User inquires about order status, shipping, refund progress, order details, etc.
Examples: "Where is my order", "I want a refund", "Check order status"
```

改进后：
```typescript
### order
Semantic axis: 商品/物品层面 — "我买了什么"
Include: 订单状态、物流、退款进度、购买的商品记录
Exclude: 资金变动、余额查询（这些属于 wallet）

### wallet
Semantic axis: 资金/余额层面 — "我的钱"
Include: 余额查询、充值记录、提现、KYC、交易流水
Exclude: 购买了什么商品、订单详情（这些属于 order）
```

核心思路：每个类别定义明确的「语义轴」+「包含」+「排除」，让 LLM 按维度推理而不是按关键词匹配。

### 备选（更重）

如果 prompt 改进后仍然有路由错误，可考虑 **Agent 重路由架构**：
1. State 加 `needsReRoute`/`rerouteReason` 字段
2. 每个 Agent 的 system prompt 加 out-of-scope 检测
3. Graph 加条件边，检测到重路由标记时重新走 Intent Router

当前**不推荐**，因为：
- 用户在这个场景下看到的 fallback 回复已经能引导去正确地方
- 重路由要改 5+ 文件，增加 graph 复杂度
- 对于低严重度的 UX 瑕疵，过度设计
