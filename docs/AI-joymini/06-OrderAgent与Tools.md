# 06. Order Agent + Tools（订单助手）

## 🎯 本步骤目标

1. 创建 `graph/tools/order-tools.ts` — 3 个订单工具的工厂函数
2. 创建 `graph/nodes/order-agent.node.ts` — 使用 `createReactAgent` 构建 Order ReAct Agent
3. 理解 Tool 工厂函数模式 — 解决 LangChain `tool()` 与 NestJS DI 的兼容问题

完成本步骤后，`orderAgent` 节点可以处理"查订单"、"看物流"、"申请退款"等订单相关查询。

---

## 📖 开发背景

### 承上：上一步做了什么？

[05-AnswerSynthesizer与Graph组装.md](05-AnswerSynthesizer与Graph组装.md) 完成了：
- `answer-synthesizer.node.ts` — 回答合成节点
- `general-chat.node.ts` — 通用对话节点
- `customer.graph.ts` — 完整 StateGraph 组装（含所有节点占位）
- `ai-customer.service.ts` — 注入所有 Service，初始化 Graph

### 启下：下一步做什么？

下一步 [07-WalletAgent与Tools.md](07-WalletAgent与Tools.md) 将实现：
- Wallet Agent — 处理余额查询、交易记录、提现
- Wallet Tools — 3 个工具的工厂函数

### 架构中的位置

```
用户输入 → intentRouter (order) → orderAgent (本步骤)
                                     ├── listOrders (查询订单列表)
                                     ├── getOrderDetail (查询订单详情)
                                     └── applyRefund (申请退款)
                                  → answerSynthesizer
```

---

## 🔧 前提条件

- [x] 05 文档已完成（Graph 组装、Service 注入）
- [x] `order.module.ts` 已修复 exports（`exports: [OrderService]`）
- [x] 了解 OrderService 的三个方法签名（见 spec-coding-analysis.md 1.1 节）

### OrderService 方法速查

| 方法 | 文件 | 行号 | 签名 | 说明 |
|------|------|------|------|------|
| `listOrders` | [`order.service.ts`](apps/api/src/client/orders/order.service.ts) | 532 | `(userId, q: ListOrdersDto)` | 分页订单列表，支持 status 过滤 |
| `getOrderDetail` | [`order.service.ts`](apps/api/src/client/orders/order.service.ts) | 609 | `(userId, orderId)` | 订单详情 + 交易记录 |
| `applyRefund` | [`order.service.ts`](apps/api/src/client/orders/order.service.ts) | 484 | `(userId, dto: RefundApplyDto)` | **写操作** — 申请退款 |

---

## ⚙️ 实现步骤

### Step 1: 创建 Order Tools 工厂函数

**文件**: `apps/api/src/client/ai-customer/graph/tools/order-tools.ts`

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { OrderService } from '@api/client/orders/order.service';

/**
 * 订单工具 — 工厂函数
 *
 * 关键设计：LangChain 的 `tool()` 接受纯函数回调，
 * 但 NestJS Service 通过 DI 在构造函数中注入。
 * 解决方案：工厂函数接收 Service 实例，返回 tool 数组。
 *
 * @param orderService - 从 NestJS DI 注入的 OrderService 实例
 * @returns LangChain tool 数组
 */
export function createOrderTools(orderService: OrderService) {
  /**
   * Tool 1: 查询订单列表
   *
   * 根据可选的 status 和分页参数查询用户订单列表。
   * status: paid（已付款）/ unpaid（未付款）/ refunded（已退款）
   */
  const orderListTool = tool(
    async ({ userId, status, page, pageSize }) => {
      try {
        const result = await orderService.listOrders(userId, {
          status,
          page,
          pageSize,
        } as any);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询订单列表失败：${error.message}`;
      }
    },
    {
      name: 'order_list',
      description:
        '查询当前登录用户的订单列表。支持按状态筛选（paid/unpaid/refunded），支持分页。' +
        '注意：只能查询当前登录用户的订单，userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        status: z
          .enum(['paid', 'unpaid', 'refunded'])
          .optional()
          .describe('订单状态筛选：paid=已付款, unpaid=未付款, refunded=已退款'),
        page: z.number().optional().default(1).describe('页码，从1开始'),
        pageSize: z.number().optional().default(10).describe('每页数量'),
      }),
    },
  );

  /**
   * Tool 2: 查询订单详情
   *
   * 根据订单ID查询完整订单信息，包含商品快照和物流信息。
   */
  const orderDetailTool = tool(
    async ({ userId, orderId }) => {
      try {
        const result = await orderService.getOrderDetail(userId, orderId);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询订单详情失败：${error.message}`;
      }
    },
    {
      name: 'order_detail',
      description:
        '根据订单ID查询订单的详细信息，包括商品列表、金额、物流状态等。' +
        '注意：只能查询当前登录用户的订单，userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        orderId: z.string().describe('订单ID'),
      }),
    },
  );

  /**
   * Tool 3: 申请退款
   *
   * 【写操作】提交退款申请。根据订单ID和退款原因，对指定商品发起退款。
   * 需要对用户进行二次确认提示。
   */
  const applyRefundTool = tool(
    async ({ userId, orderId, reason, items }) => {
      try {
        const result = await orderService.applyRefund(userId, {
          orderId,
          reason,
          items,
        } as any);
        return JSON.stringify(result);
      } catch (error: any) {
        return `退款申请失败：${error.message}`;
      }
    },
    {
      name: 'order_apply_refund',
      description:
        '【写操作-需确认】为当前登录用户的订单申请退款。需要用户提供订单ID、退款原因和退款商品列表。' +
        '重要：执行此操作前必须先和用户确认退款原因和商品信息！' +
        'userId 由系统自动传入，不需要用户提供。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        orderId: z.string().describe('需要退款的订单ID'),
        reason: z.string().describe('退款原因说明'),
        items: z
          .array(
            z.object({
              orderItemId: z.string().describe('订单商品项ID'),
              quantity: z.number().describe('退款数量'),
            }),
          )
          .describe('退款商品列表'),
      }),
    },
  );

  return [orderListTool, orderDetailTool, applyRefundTool];
}
```

### Step 2: 创建 Order Agent 节点

**文件**: `apps/api/src/client/ai-customer/graph/nodes/order-agent.node.ts`

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOllama } from '@langchain/ollama';
import { OrderService } from '@api/client/orders/order.service';
import { createOrderTools } from '../tools/order-tools';
import { AgentStateType } from '../state';

/**
 * 构建 Order ReAct Agent
 *
 * 使用 LangGraph 的预置 createReactAgent，结合 Ollama 和订单工具。
 * createReactAgent 自动处理 ReAct 循环（LLM 推理 → 工具调用 → 结果注入 → 继续推理）。
 *
 * @param orderService - NestJS 注入的 OrderService 实例
 * @returns Compiled React Agent
 */
function buildOrderAgent(orderService: OrderService) {
  return createReactAgent({
    llm: new ChatOllama({
      model: 'qwen3.5:0.8b',
      temperature: 0.1,
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    }),
    tools: createOrderTools(orderService),
    // 限制 ReAct 循环最大步数，防止无限循环
    recursionLimit: 10,
  });
}

/**
 * Order Agent Node
 *
 * 接收意图路由传来的订单类问题，使用 ReAct Agent 调用订单工具，
 * 最终将结果写入 agentOutput 供 answerSynthesizer 使用。
 *
 * 注意：本文件导出 node 函数，但 Agent 实例需要按需创建（因为需要 Service 实例）。
 * 实际使用时，orderService 通过闭包传入。
 */
export function createOrderAgentNode(orderService: OrderService) {
  const agent = buildOrderAgent(orderService);

  return async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    const lastMessage = state.messages[state.messages.length - 1];

    try {
      // 将 userId 注入到消息中，供工具函数使用
      const result = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: `[当前用户ID: ${state.userId}]\n${lastMessage.content}`,
          },
        ],
      });

      // 提取最后一条消息作为 agent 的输出
      const lastResultMessage = result.messages[result.messages.length - 1];
      const output =
        typeof lastResultMessage?.content === 'string'
          ? lastResultMessage.content
          : JSON.stringify(lastResultMessage?.content ?? '');

      return {
        agentOutput: output,
        messages: result.messages,
      };
    } catch (error: any) {
      return {
        agentOutput: `订单查询出错：${error.message}`,
      };
    }
  };
}
```

### Step 3: 理解 Tool 工厂函数模式

这是本项目最关键的设计模式之一。以下是其工作原理：

```
NestJS DI Container
    │
    ├── OrderService (由 NestJS 创建和管理)
    │
    └── AiCustomerService (通过构造函数注入 OrderService)
            │
            └── initGraph() 时调用 buildCustomerGraph()
                    │
                    └── createOrderAgentNode(orderService)
                            │
                            └── buildOrderAgent(orderService)
                                    │
                                    └── createOrderTools(orderService)
                                            │
                                            ├── tool(fn, { schema, name, description })
                                            ├── tool(fn, { schema, name, description })
                                            └── tool(fn, { schema, name, description })
```

**为什么需要工厂函数？**

| 问题 | 说明 |
|------|------|
| LangChain `tool()` 需要纯函数 | `tool(callback, config)` — callback 是独立函数，不能访问 `this` |
| NestJS Service 是实例方法 | `orderService.listOrders()` 需要 `this.prisma`，不能作为独立函数使用 |
| 解决方案 | 工厂函数在创建时接收 Service 实例，通过闭包让 tool callback 访问实例方法 |

```typescript
// ❌ 错误做法：tool 内无法访问 orderService
const badTool = tool(
  async (args) => orderService.listOrders(args.userId, args), // orderService is undefined!
  { name: 'bad', schema: ... }
);

// ✅ 正确做法：工厂函数通过闭包传递 service 实例
function createOrderTools(orderService: OrderService) {
  const goodTool = tool(
    async (args) => orderService.listOrders(args.userId, args),
    { name: 'good', schema: ... }
  );
  return [goodTool];
}
```

### Step 4: 更新 customer.graph.ts — 使用工厂函数创建 Agent Node

**文件**: `apps/api/src/client/ai-customer/graph/customer.graph.ts`

```diff
- import { orderAgentNode } from './nodes/order-agent.node';
+ import { createOrderAgentNode } from './nodes/order-agent.node';

- export function buildCustomerGraph() {
+ export function buildCustomerGraph(deps: {
+   orderService: OrderService;
+   walletService: WalletService;
+   // ... 其他 service
+ }) {
+   const orderAgentNode = createOrderAgentNode(deps.orderService);
+   
    const workflow = new StateGraph(AgentState)
      .addNode('intentRouter', intentRouterNode)
      .addNode('orderAgent', orderAgentNode)
      // ...
```

**注意**：完整的 `customer.graph.ts` 改造将在所有 Agent 文档完成后统一更新。目前可以先保持占位节点，等文档 06-11 全部完成后，在文档 14（SSE API）时统一做最终调整。

---

## ✅ 验证

```bash
# 编译检查
yarn workspace @lucky/api build

# 手动测试订单工具函数
node -e "
const { tool } = require('@langchain/core/tools');
const { z } = require('zod');

// 模拟订单服务
const mockOrderService = {
  listOrders: async (userId, dto) => ({ list: [{ id: '1', status: 'paid' }], total: 1 }),
  getOrderDetail: async (userId, orderId) => ({ id: orderId, status: 'paid', amount: 99.99 }),
  applyRefund: async (userId, dto) => ({ success: true, refundId: 'ref-001' }),
};

// 测试工具函数
const testTool = tool(
  async ({ userId }) => {
    const result = await mockOrderService.listOrders(userId, { page: 1, pageSize: 10 });
    return JSON.stringify(result);
  },
  { name: 'test', schema: z.object({ userId: z.string() }) }
);

testTool.invoke({ userId: 'test123' }).then(console.log);
"
```

---

## 📝 技术要点

### createReactAgent vs 手动 StateGraph

`createReactAgent` 是 LangGraph v0.2+ 提供的预置 ReAct Agent 构造器。它内部实现了标准的 ReAct 循环：
1. LLM 推理 → 决定是否调用工具
2. 如果要调用工具 → 进入 ToolNode → 执行工具 → 结果返回 LLM
3. LLM 继续推理 → 直到不再需要调用工具

这与手动构建 StateGraph 的区别：

| 方式 | 优点 | 缺点 |
|------|------|------|
| `createReactAgent` | 开箱即用，代码简洁 | 定制化有限 |
| 手动 StateGraph | 完全控制节点逻辑 | 需要更多样板代码 |

本项目使用 `createReactAgent` 作为 Phase 1-2 的快速实现，Phase 5（文档 19）可以考虑手动构建 Supervisor 模式。

### tool() 的 name 命名规范

工具名称使用 `snake_case`，格式为 `{domain}_{action}`：

| 工具名 | 对应方法 | 说明 |
|--------|---------|------|
| `order_list` | `listOrders` | 查询订单列表 |
| `order_detail` | `getOrderDetail` | 查询订单详情 |
| `order_apply_refund` | `applyRefund` | 申请退款 |

### 写操作的安全处理

`applyRefund` 是**写操作**，在 tool description 中明确标注：
```
'【写操作-需确认】执行此操作前必须先和用户确认退款原因和商品信息！'
```

这样 LLM 在调用前会先向用户确认，而不是直接执行。后续 Phase 5 的 HITL（Human-in-the-Loop）将提供更完善的安全机制（文档 19）。

### userId 注入方式

`userId` 通过 `state.userId` 传递，并在 invoke 时注入到消息中：
```
`[当前用户ID: ${state.userId}]\n${lastMessage.content}`
```

这是因为工具的 `userId` 参数标记为"由系统自动传入"，LLM 不会要求用户提供，但工具执行时需要这个值。

---

## 🔜 下一步预告

在 [07-WalletAgent与Tools.md](07-WalletAgent与Tools.md) 中，我们将实现第二个 ReAct Agent：
- **Wallet Agent** — 处理余额查询、交易记录、提现
- **3 个 Wallet Tools**：`wallet_balance`、`wallet_transactions`、`wallet_apply_withdraw`
- **写操作安全确认**：`applyWithdraw` 的二次确认模式
