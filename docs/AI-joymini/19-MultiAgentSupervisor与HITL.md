# 19. Multi-Agent Supervisor + Human-in-the-Loop

> ⛔ **DEPRECATED — Supervisor LLM 方案已废弃**
>
> 由于 Bug 5（Supervisor LLM 幻觉），Supervisor 方案被废弃。
> 当前架构为 **orchestrator 流水线**：多标签意图分类 → 依赖排序 → 顺序执行 Agent。
> 写操作安全通过**两阶段确认**（预览→确认→执行）实现，而非 `interrupt()`。
> 详见 [`24-Supervisor架构完整总结`](24-Supervisor架构完整总结.md)
>
> 本文档编写于 Supervisor Pattern 的早期设计阶段，部分内容与实际代码实现不一致：
> - `withStructuredOutput` 方案 → 实际使用 `StringOutputParser` + JSON 手动解析
> - `agent-executor.node.ts` 独立执行器 → 实际使用 `supervisorRouter` 指针式逐个派发
> - `interrupt()` HITL 方案 → 实际尚未实现 HITL
> - Supervisor 从 START 无条件进入 → 实际先走 intentGateway → intentRouter → routerByIntent 分流
>
> 实际实现详情见 [`24-Supervisor架构完整总结`](24-Supervisor架构完整总结.md)
>
> **2026-06-30 更新 — 方案 B 决策：** 由于 Bug 5（Supervisor LLM 幻觉），决定采用**单轮单 Agent（方案 B）**替代 Supervisor LLM 分解。
> Supervisor Node 将去掉 LLM 分解代码，降级为纯 round 计数器。
> 详见 [`33-工作流型智能体16挑战对标.md`](33-工作流型智能体16挑战对标.md) 和 [`24-Supervisor架构完整总结.md`](24-Supervisor架构完整总结.md#七方案-b-变更计划)

## 🎯 本步骤目标

实现两种高级 Agent 模式：
1. **Supervisor Agent 模式** — 一个主 Agent（Supervisor）调度多个子 Agent，实现更智能的任务分配
2. **Human-in-the-Loop（HITL）** — 写操作（退款、提现、领取优惠券）需要用户确认后才能执行

这是整个 AI 客服系统的**进阶能力**部分，也是面试中展示架构深度的关键内容。

---

## 📖 背景说明

### 承上

在 [**18-PostgreSQLCheckpointer**](18-PostgreSQLCheckpointer.md) 中，我们实现了：
- `PostgresSaver` 跨会话对话记忆
- `thread_id` 多会话隔离
- 自动恢复上次对话状态

目前我们的架构是 **单意图路由 → 单 Agent** 的简单模式，一个用户消息只能触发一个 Agent。

### 这一步要解决的问题

1. **复杂查询拆分** — 用户问"帮我查一下最近的订单，然后看看有没有优惠券可以用"需要同时调用 OrderAgent 和 CouponAgent
2. **写操作安全** — 退款、提现等操作如果直接执行，用户可能误操作
3. **状态确认** — 执行关键操作前，需要让用户确认参数正确

### 设计决策

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| Supervisor 模式 | 串行 / 并行 / 分层 | **分层 Supervisor** | Supervisor 分析意图 → 分发子 Agent → 汇总结果 |
| HITL 实现 | `interrupt()` / 外部确认 | **LangGraph `interrupt()`** | LangGraph 原生支持，暂停图执行，等待用户输入 |
| 子 Agent 通信 | 共享 State / 独立 State | **共享 State** | 子 Agent 的结果写入同一 State，Supervisor 汇总 |
| 确认方式 | 按钮 / 文字输入 | **文字确认** | 简单直接，用户输入"确认"或"取消" |

---

## ⚙️ 前置条件

### 环境要求

- `@langchain/langgraph` v0.2.10+（需要 `interrupt()` 支持）
- `@langchain/core` v0.3+（需要 `Command` 类）
- PostgreSQL Checkpointer 已集成（文档 18）— `interrupt()` 依赖 Checkpointer

### 文件/配置准备

- [`customer.graph.ts`](05-AnswerSynthesizer与Graph组装.md) — 当前 Graph 定义
- [`ai-customer.service.ts`](05-AnswerSynthesizer与Graph组装.md) — 当前 Service
- 所有 6 个 Agent Node 已实现（文档 06-11）

### 知识准备

- LangGraph `interrupt()` API — 暂停图执行，等待外部输入
- LangGraph `Command` 类 — 用于向暂停的图发送恢复指令
- Multi-Agent Supervisor 模式 — Agent Orchestration 架构

---

## 📝 实现步骤

### Step 1: 实现 Supervisor Agent Node

Supervisor 是一个**特殊的 Agent**，它不直接执行工具，而是分析用户输入，决定调用哪个子 Agent（或串联多个）。

**文件**：`apps/api/src/client/ai-customer/graph/nodes/supervisor.node.ts`

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatOllama } from '@langchain/ollama';
import { z } from 'zod';

// Supervisor 的输出格式
const supervisorOutputSchema = z.object({
  tasks: z.array(
    z.object({
      agent: z.enum([
        'order', 'wallet', 'coupon', 'user', 'product', 'lucky', 'rag', 'general',
      ]),
      description: z.string(),
    }),
  ).min(1).max(3),
});

// Supervisor Prompt
const SUPERVISOR_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个 AI 客服的 Supervisor。分析用户的最新消息，决定需要调用哪些子 Agent 来回答。

每个子 Agent 的职责：
- order: 订单查询、退款申请
- wallet: 钱包余额、交易记录、提现
- coupon: 我的优惠券、可领优惠券、领取优惠券
- user: 用户信息、收货地址
- product: 商品列表、商品详情、拼团信息
- lucky: 抽奖记录、闪购活动
- rag: 政策知识（退款政策、发货规则等）
- general: 日常对话（问候、闲聊）

规则：
1. 如果用户的问题涉及多个领域，列出所有需要的 Agent（最多 3 个）
2. 每个任务都要提供明确的描述
3. 如果用户只是想闲聊，只返回 general

输出格式必须是 JSON 数组。`,
  ],
  ['human', '{input}'],
]);

export async function supervisorNode(state: typeof AgentState.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  const input = typeof lastMessage.content === 'string' ? lastMessage.content : '';

  // 调用 LLM 分析意图
  const chain = SUPERVISOR_PROMPT
    .pipe(new ChatOllama({ model: 'qwen3.5:0.8b', temperature: 0 }))
    .pipe(new StructuredOutputParser(supervisorOutputSchema));

  const result = await chain.invoke({ input });

  return {
    tasks: result.tasks,  // 存储到 State
  };
}
```

### Step 2: 更新 State 定义，添加 tasks 字段

**文件**：`apps/api/src/client/ai-customer/graph/state.ts`

```typescript
export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,

  intent: Annotation<string | null>({
    reducer: (a, b) => b ?? a,   // 只更新一次
  }),

  agentOutput: Annotation<string | null>({
    reducer: (a, b) => b ?? a,
  }),

  userId: Annotation<string>({
    reducer: (a, b) => b,
  }),

  // 新增：Supervisor 分配的 Task 列表
  tasks: Annotation<Array<{ agent: string; description: string }>>({
    reducer: (a, b) => b,
  }),

  // 新增：子 Agent 执行结果汇总
  taskResults: Annotation<Record<string, any>>({
    reducer: (a, b) => ({ ...a, ...b }),
  }),
});
```

### Step 3: 实现并行 Agent 执行节点

**文件**：`apps/api/src/client/ai-customer/graph/nodes/agent-executor.node.ts`

```typescript
/**
 * Agent 执行器节点
 * 根据 Supervisor 分配的 tasks，按顺序执行对应的子 Agent
 */
export async function agentExecutorNode(state: typeof AgentState.State) {
  const tasks = state.tasks || [];
  const results: Record<string, any> = {};

  for (const task of tasks) {
    // 根据 task.agent 调用对应的子 Agent
    switch (task.agent) {
      case 'order':
        results.order = await orderAgentNode(state);
        break;
      case 'wallet':
        results.wallet = await walletAgentNode(state);
        break;
      case 'coupon':
        results.coupon = await couponAgentNode(state);
        break;
      // ... 其他 Agent
    }
  }

  return { taskResults: results };
}
```

> **注意**：实际实现中，子 Agent 的执行可能更为复杂。上述是简化示例。详细模式见 `spec-coding-analysis.md` 的 Section 7.2。

### Step 4: 实现 Human-in-the-Loop（HITL）

HITL 的核心是 LangGraph 的 `interrupt()` 函数，它可以在图执行到某个节点时暂停，等待外部输入。

**文件**：`apps/api/src/client/ai-customer/graph/nodes/hitl.node.ts`

```typescript
import { interrupt, Command } from '@langchain/langgraph';
import { ChatPromptTemplate } from '@langchain/core/prompts';

const HITL_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `判断用户消息是否包含以下写操作（需要用户确认）：
1. 退款申请（applyRefund）
2. 提现申请（applyWithdraw）
3. 领取优惠券（claimCoupon）
4. 抽奖（draw）
5. 发红包（sendRedPacket）

如果包含以上操作，返回 NEED_CONFIRMATION，否则返回 NO_CONFIRMATION_NEEDED。

输出格式：{"action": "NEED_CONFIRMATION" | "NO_CONFIRMATION_NEEDED", "summary": "操作内容摘要"}`,
  ],
  ['human', '{input}'],
]);

/**
 * HITL 节点：在执行写操作前暂停，等待用户确认
 */
export async function hitlNode(state: typeof AgentState.State) {
  // 1. 判断是否需要确认
  const lastMessage = state.messages[state.messages.length - 1];
  const input = typeof lastMessage.content === 'string' ? lastMessage.content : '';

  const result = await HITL_PROMPT
    .pipe(new ChatOllama({ model: 'qwen3.5:0.8b', temperature: 0 }))
    .pipe(new JsonOutputParser())
    .invoke({ input });

  if (result.action === 'NEED_CONFIRMATION') {
    // 2. 暂停执行，等待用户确认
    const userResponse = await interrupt({
      type: 'confirmation_required',
      summary: result.summary,
      prompt: `请确认是否要执行以下操作：${result.summary}\n回复"确认"继续，回复"取消"终止。`,
    });

    // 3. 用户响应处理
    if (userResponse === 'confirm' || userResponse === '确认') {
      return { hitlStatus: 'confirmed' };
    } else {
      return { hitlStatus: 'cancelled', agentOutput: '已取消操作。' };
    }
  }

  return { hitlStatus: 'not_needed' };
}
```

### Step 5: 更新 Graph 定义（Supervisor + HITL）

**文件**：`apps/api/src/client/ai-customer/graph/customer.graph.ts`

```typescript
import { supervisorNode } from './nodes/supervisor.node';
import { agentExecutorNode } from './nodes/agent-executor.node';
import { hitlNode } from './nodes/hitl.node';

export function buildCustomerGraph() {
  const graph = new StateGraph(AgentState)
    // ── 新增：Supervisor ──
    .addNode('supervisor', supervisorNode)
    .addNode('agentExecutor', agentExecutorNode)

    // ── 原有节点 ──
    .addNode('intentRouter', intentRouterNode)
    .addNode('orderAgent', orderAgentNode)
    .addNode('walletAgent', walletAgentNode)
    .addNode('couponAgent', couponAgentNode)
    .addNode('userAgent', userAgentNode)
    .addNode('productAgent', productAgentNode)
    .addNode('luckyAgent', luckyAgentNode)
    .addNode('ragNode', ragNode)
    .addNode('generalChat', generalChatNode)

    // ── 新增：HITL ──
    .addNode('hitl', hitlNode)

    .addNode('answerSynthesizer', answerSynthesizerNode)

    // ── 边定义 ──
    .addEdge(START, 'supervisor')

    // Supervisor → 意图路由（或直接到子 Agent）
    .addConditionalEdges('supervisor', routeByTasks, {
      multi: 'agentExecutor',    // 需要多个 Agent
      single: 'intentRouter',    // 只需要一个 Agent → 走原路由
      general: 'generalChat',    // 闲聊
      rag: 'ragNode',
    })

    // Agent 执行器 → HITL（写操作检查）
    .addEdge('agentExecutor', 'hitl')
    .addConditionalEdges('hitl', routeByHitlStatus, {
      confirmed: 'answerSynthesizer',  // 确认后继续
      cancelled: 'answerSynthesizer',  // 取消后告知用户
      not_needed: 'answerSynthesizer', // 无需确认
    })

    // 原有路由保持不变
    .addConditionalEdges('intentRouter', routeByIntent, {
      orderAgent: 'orderAgent',
      walletAgent: 'walletAgent',
      couponAgent: 'couponAgent',
      userAgent: 'userAgent',
      productAgent: 'productAgent',
      luckyAgent: 'luckyAgent',
      ragNode: 'ragNode',
      generalChat: 'generalChat',
    })

    // 所有 Agent → HITL（检查写操作）
    .addEdge('orderAgent', 'hitl')
    .addEdge('walletAgent', 'hitl')
    .addEdge('couponAgent', 'hitl')
    .addEdge('userAgent', 'hitl')
    .addEdge('productAgent', 'hitl')
    .addEdge('luckyAgent', 'hitl')
    .addEdge('ragNode', 'answerSynthesizer')    // RAG 不需要 HITL
    .addEdge('generalChat', 'answerSynthesizer') // 闲聊不需要 HITL

    .addEdge('answerSynthesizer', END);

  return graph.compile();
}

// 条件边：根据 task 数量路由
function routeByTasks(state: typeof AgentState.State) {
  const tasks = state.tasks || [];
  if (tasks.length > 1) return 'multi';
  if (tasks.length === 1) {
    const agent = tasks[0].agent;
    if (agent === 'general') return 'general';
    if (agent === 'rag') return 'rag';
    return 'single';
  }
  return 'single';
}

// 条件边：根据 HITL 状态路由
function routeByHitlStatus(state: typeof AgentState.State) {
  return state.hitlStatus || 'not_needed';
}
```

### Step 6: 前端 HITL 交互

当后端发送 `interrupt` 事件时，前端需要暂停发送新消息，显示确认对话框：

```typescript
// SSE 事件处理（在前端 useAiChat Hook 中增加）
case 'interrupt': {
  // 显示确认对话框
  setPendingConfirmation({
    summary: data.summary,
    prompt: data.prompt,
    onConfirm: async () => {
      // 发送确认指令
      await sendResumeCommand('confirm');
    },
    onCancel: async () => {
      // 发送取消指令
      await sendResumeCommand('cancel');
    },
  });
  break;
}

// 发送恢复指令
async function sendResumeCommand(command: string) {
  await fetch(`${API_BASE}/ai-customer/chat/resume`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      threadId: `ai-customer-${userId}`,
      command,  // 'confirm' | 'cancel'
    }),
  });
}
```

### Step 7: 实现 Resume 端点（恢复中断的图执行）

**文件**：`apps/api/src/client/ai-customer/ai-customer.controller.ts`

```typescript
@Post('chat/resume')
async resumeChat(
  @CurrentUserId() userId: string,
  @Body('command') command: string,
  @Res() res: Response,
) {
  if (!this.checkpointer) {
    res.status(500).json({ error: 'Checkpointer not available' });
    return;
  }

  const threadId = `ai-customer-${userId}`;

  // 使用 Command 恢复图执行
  const result = await this.graph.invoke(
    new Command({
      resume: command === 'confirm' ? 'confirm' : 'cancel',
    }),
    {
      configurable: { thread_id: threadId },
    },
  );

  // SSE 输出最终结果
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  // ... SSE 事件推送 ...

  if (result.agentOutput) {
    res.write(`data: ${JSON.stringify({ type: 'token', content: result.agentOutput })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  res.end();
}
```

---

## ✅ 验收方式

### 手动验证

```bash
# 1. Supervisor 模式：复杂查询
curl -X POST http://localhost:3000/ai-customer/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "帮我查一下最近的订单，然后看看有没有可以领的优惠券"}'
# → Supervisor 识别需要 2 个 Agent → 分别执行 → 汇总结果

# 2. HITL：写操作确认
curl -X POST http://localhost:3000/ai-customer/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "我要申请退款"}'
# → 执行到 hitlNode → interrupt → 等待用户确认
```

### 预期结果

```bash
# Supervisor 多 Agent 场景
data: {"type":"step","type":"tool_start","tool":"order_list","input":...}
data: {"type":"step","type":"tool_end","tool":"order_list","output":"..."}
data: {"type":"step","type":"tool_start","tool":"coupon_claimable","input":...}
data: {"type":"step","type":"tool_end","tool":"coupon_claimable","output":"..."}
data: {"type":"token","content":"亲，您最近的订单是..."}
data: {"type":"token","content":"另外，您还可以领取以下优惠券..."}
data: {"type":"done",{}}

# HITL 场景
data: {"type":"interrupt","summary":"申请退款（订单 #12345）","prompt":"请确认是否退款..."}
# → 用户发送确认 → resume endpoint
data: {"type":"token","content":"已为您提交退款申请，预计 48 小时内审核。"}
data: {"type":"done",{}}
```

### 数据库验证（Interrupt 状态）

```sql
-- 查看被 interrupt 的 checkpoint
SELECT thread_id, checkpoint_id, metadata
FROM langgraph_checkpoints
WHERE metadata->>'source' = 'interrupt'
LIMIT 5;
```

---

## 🔚 总结与回顾

### 19 个文档完成后的架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    AI Customer Service                   │
├─────────────────────────────────────────────────────────┤
│  Phase 0: 基础设施                                       │
│  ├── 01. Ollama + AiService + Deploy                     │
│  └── 02. LangGraph 依赖 + Module Exports                 │
├─────────────────────────────────────────────────────────┤
│  Phase 1: 核心引擎                                        │
│  ├── 03. AiCustomerModule + State                        │
│  ├── 04. 9-Intent 路由节点                               │
│  └── 05. AnswerSynthesizer + Graph 组装                  │
├─────────────────────────────────────────────────────────┤
│  Phase 2: 6 个 ReAct Agent（21 个 Tools）                │
│  ├── 06. OrderAgent (order_list/detail/applyRefund)     │
│  ├── 07. WalletAgent (balance/transactions/withdraw)    │
│  ├── 08. CouponAgent (myList/claimable/claim)           │
│  ├── 09. UserAddressAgent (profile/addressList/detail)  │
│  ├── 10. ProductGroupAgent (treasure/group x4)          │
│  └── 11. LuckyDrawFlashAgent (lucky/flash x5)           │
├─────────────────────────────────────────────────────────┤
│  Phase 3: 知识库                                         │
│  ├── 12. 8 个政策文档 + RAG Stub                         │
│  └── 13. Prisma Knowledge 模型 + pgvector                │
├─────────────────────────────────────────────────────────┤
│  Phase 4: 前端 UI                                        │
│  ├── 14. SSE API Controller                              │
│  ├── 15. 前端 Chat 页面 (Server)                         │
│  └── 16. 前端 Chat Client + useAiChat Hook               │
├─────────────────────────────────────────────────────────┤
│  Phase 5: 进阶能力 [本期可选]                              │
│  ├── 17. 完整 RAG 节点（向量搜索）                        │
│  ├── 18. PostgreSQL Checkpointer（对话记忆）              │
│  └── 19. Multi-Agent Supervisor + HITL [MVP 后]         │
└─────────────────────────────────────────────────────────┘
```

### 关键架构模式回顾

| 模式 | 文档 | 说明 |
|---|---|---|
| Tool 工厂函数 | 06-11 | 解决 LangChain `tool()` + NestJS DI 的兼容问题 |
| 9-Intent 分类 | 04 | 覆盖所有业务领域的意图路由 |
| SSE 流式输出 | 14 | 逐 token 推送 + Agent 步骤可见 |
| 混合检索 RAG | 17 | 向量搜索 + 关键词精确匹配 |
| pgvector 768 维 | 13、17 | 与 mxbai-embed-large 对齐 |
| Tool 命名约定 | 06 | `snake_case` 格式 `{domain}_{action}` |
| 写操作安全 | 19 | HITL 确认后才能执行 |
| Checkpointer 降级 | 18 | 数据库不可用时降级为无记忆模式 |

---

## 📚 关键设计决策回顾

1. **分层 Supervisor**：Supervisor 只负责任务分配，不执行具体操作，职责清晰
2. **`interrupt()` 模式**：LangGraph 原生支持的 HITL 方案，无需额外状态管理
3. **`Command` 恢复**：通过 `Command` 类向暂停的图发送恢复指令，流程完整
4. **写操作安全**：所有写操作（退款/提现/领券/抽奖）都经过 HITL 确认
5. **Phase 5 可选**：Supervisor + HITL 是增强功能，不影响 Phase 1-4 的核心流程
