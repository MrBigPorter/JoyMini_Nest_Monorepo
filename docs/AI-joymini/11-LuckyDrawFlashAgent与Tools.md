# 11. LuckyDraw + Flash Agent + Tools（抽奖与闪购助手）

## 🎯 本步骤目标

1. 创建 `graph/tools/lucky-tools.ts` — 5 个抽奖/闪购工具的工厂函数
2. 创建 `graph/nodes/lucky-agent.node.ts` — 使用 `createReactAgent` 构建 Lucky ReAct Agent
3. 掌握 `LuckyDrawService` 和 `ClientFlashSaleService` 的协作

完成本步骤后，`luckyAgent` 节点可以处理"我的抽奖券"、"中奖记录"、"我要抽奖"、"闪购活动"等查询。

---

## 📖 开发背景

### 承上：上一步做了什么？

[10-ProductGroupAgent与Tools.md](10-ProductGroupAgent与Tools.md) 完成了：
- `graph/tools/product-tools.ts` — 4 个商品/拼团工具的工厂函数
- `graph/nodes/product-agent.node.ts` — Product ReAct Agent
- 商品浏览不需要 userId、GroupService 位于 common 模块

### 启下：下一步做什么？

Phase 2（6 个 ReAct Agent）全部完成！接下来进入 **Phase 3：知识库**：

| # | 文档 | 内容 |
|---|------|------|
| 12 | [政策知识文档 + RAG Stub](12-政策知识文档与RAGStub.md) | 8 个政策文档 + 基础 RAG 节点 |
| 13 | [Prisma Knowledge 模型 + pgvector](13-PrismaKnowledge模型与pgvector.md) | 向量存储 + 嵌入 |

### 架构中的位置

```
用户输入 → intentRouter (lucky-draw) → luckyAgent (本步骤)
                                         ├── lucky_tickets (抽奖券列表)
                                         ├── lucky_results (中奖记录)
                                         ├── lucky_draw (执行抽奖 - 写操作)
                                         ├── flash_sessions (闪购场次)
                                         └── flash_products (闪购商品)
                                      → answerSynthesizer
```

---

## 🔧 前提条件

- [x] 10 文档已完成（Product Agent、4 工具工厂函数）
- [x] `LuckyDrawService` 正确 exports
- [x] `ClientFlashSaleService` 正确 exports

### Service 方法速查

| Service | 方法 | 行号 | 参数 | 读写 | 说明 |
|---------|------|------|------|------|------|
| `LuckyDrawService` | `listTickets` | [`lucky-draw.service.ts`](apps/api/src/common/lucky-draw/lucky-draw.service.ts):108 | `(userId, opts)` | 读 | 抽奖券列表，支持 unusedOnly 筛选项 |
| `LuckyDrawService` | `listResults` | [`lucky-draw.service.ts`](apps/api/src/common/lucky-draw/lucky-draw.service.ts):167 | `(userId, opts)` | 读 | 中奖历史记录 |
| `LuckyDrawService` | `draw` | [`lucky-draw.service.ts`](apps/api/src/common/lucky-draw/lucky-draw.service.ts):204 | `(userId, ticketId)` | **写** | 执行抽奖，Prisma 事务原子扣减库存 |
| `ClientFlashSaleService` | `getActiveSessions` | [`flash-sale.service.ts`](apps/api/src/client/flash-sale/flash-sale.service.ts):38 | 无 | 读 | 当前进行中的闪购场次 |
| `ClientFlashSaleService` | `getSessionProducts` | [`flash-sale.service.ts`](apps/api/src/client/flash-sale/flash-sale.service.ts):61 | `(sessionId)` | 读 | 闪购场次商品列表 |

---

## ⚙️ 实现步骤

### Step 1: 创建 Lucky Tools 工厂函数

**文件**: `apps/api/src/client/ai-customer/graph/tools/lucky-tools.ts`

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { LuckyDrawService } from '@api/common/lucky-draw/lucky-draw.service';
import { ClientFlashSaleService } from '@api/client/flash-sale/flash-sale.service';

/**
 * 抽奖/闪购工具 — 工厂函数
 *
 * 包含抽奖券查询、中奖记录、执行抽奖和闪购信息查询。
 * LuckyDrawService 处理抽奖逻辑，ClientFlashSaleService 处理闪购。
 *
 * @param luckyDrawService - LuckyDrawService 实例
 * @param flashSaleService - ClientFlashSaleService 实例
 * @returns LangChain tool 数组
 */
export function createLuckyTools(
  luckyDrawService: LuckyDrawService,
  flashSaleService: ClientFlashSaleService,
) {
  /**
   * Tool 1: 查询抽奖券列表
   *
   * 返回当前用户的抽奖券列表，可选筛选项：只显示未使用的。
   */
  const ticketsTool = tool(
    async ({ userId, page, pageSize, unusedOnly }) => {
      try {
        const result = await luckyDrawService.listTickets(userId, {
          page,
          pageSize,
          unusedOnly,
        });
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询抽奖券失败：${error.message}`;
      }
    },
    {
      name: 'lucky_tickets',
      description:
        '查询当前登录用户的抽奖券列表，支持分页和筛选未使用的券。' +
        'userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        page: z.number().optional().default(1).describe('页码'),
        pageSize: z.number().optional().default(10).describe('每页数量'),
        unusedOnly: z
          .boolean()
          .optional()
          .default(false)
          .describe('是否只显示未使用的抽奖券'),
      }),
    },
  );

  /**
   * Tool 2: 查询中奖记录
   *
   * 返回当前用户的中奖历史记录。
   */
  const resultsTool = tool(
    async ({ userId, page, pageSize }) => {
      try {
        const result = await luckyDrawService.listResults(userId, {
          page,
          pageSize,
        });
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询中奖记录失败：${error.message}`;
      }
    },
    {
      name: 'lucky_results',
      description:
        '查询当前登录用户的中奖历史记录。返回中奖时间、奖品信息等。' +
        'userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        page: z.number().optional().default(1).describe('页码'),
        pageSize: z.number().optional().default(10).describe('每页数量'),
      }),
    },
  );

  /**
   * Tool 3: 执行抽奖
   *
   * 【写操作】使用指定的抽奖券进行抽奖。
   * 内部使用 Prisma 事务确保原子性。
   * 需要用户确认后才能执行。
   */
  const drawTool = tool(
    async ({ userId, ticketId }) => {
      try {
        const result = await luckyDrawService.draw(userId, ticketId);
        return JSON.stringify(result);
      } catch (error: any) {
        return `抽奖失败：${error.message}`;
      }
    },
    {
      name: 'lucky_draw',
      description:
        '【写操作-需确认】使用指定的抽奖券进行一次抽奖。抽奖过程是原子操作（使用Prisma事务保证）。' +
        '重要：执行前必须先和用户确认使用的抽奖券，并告知抽奖可能的结果！' +
        'userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        ticketId: z.string().describe('抽奖券ID（用户从抽奖券列表中选择）'),
      }),
    },
  );

  /**
   * Tool 4: 查询闪购场次
   *
   * 返回当前进行中的闪购活动场次列表。
   * 公开信息，不需要用户登录。
   */
  const flashSessionsTool = tool(
    async () => {
      try {
        const result = await flashSaleService.getActiveSessions();
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询闪购场次失败：${error.message}`;
      }
    },
    {
      name: 'flash_sessions',
      description:
        '查询当前进行中的闪购活动场次列表。返回场次名称、开始/结束时间等信息。公开信息，不需要登录。',
      schema: z.object({}),
    },
  );

  /**
   * Tool 5: 查询闪购商品
   *
   * 根据闪购场次ID查询该场次的商品列表及闪购价格。
   */
  const flashProductsTool = tool(
    async ({ sessionId }) => {
      try {
        const result = await flashSaleService.getSessionProducts(sessionId);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询闪购商品失败：${error.message}`;
      }
    },
    {
      name: 'flash_products',
      description:
        '根据闪购场次ID查询该场次的闪购商品列表，包含商品名称、闪购价格、剩余库存等。用户需要提供闪购场次ID。',
      schema: z.object({
        sessionId: z.string().describe('闪购场次ID'),
      }),
    },
  );

  return [ticketsTool, resultsTool, drawTool, flashSessionsTool, flashProductsTool];
}
```

### Step 2: 创建 Lucky Agent 节点

**文件**: `apps/api/src/client/ai-customer/graph/nodes/lucky-agent.node.ts`

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOllama } from '@langchain/ollama';
import { LuckyDrawService } from '@api/common/lucky-draw/lucky-draw.service';
import { ClientFlashSaleService } from '@api/client/flash-sale/flash-sale.service';
import { createLuckyTools } from '../tools/lucky-tools';
import { AgentStateType } from '../state';

/**
 * 构建 Lucky Draw + Flash Sale ReAct Agent
 *
 * 处理抽奖券查询、中奖记录、执行抽奖和闪购信息查询。
 * 这是工具最多的 Agent（5 个工具），覆盖抽奖和闪购两个业务域。
 */
function buildLuckyAgent(
  luckyDrawService: LuckyDrawService,
  flashSaleService: ClientFlashSaleService,
) {
  return createReactAgent({
    llm: new ChatOllama({
      model: 'qwen3.5:0.8b',
      temperature: 0.1,
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    }),
    tools: createLuckyTools(luckyDrawService, flashSaleService),
    recursionLimit: 10,
  });
}

/**
 * Lucky Agent Node 工厂函数
 */
export function createLuckyAgentNode(
  luckyDrawService: LuckyDrawService,
  flashSaleService: ClientFlashSaleService,
) {
  const agent = buildLuckyAgent(luckyDrawService, flashSaleService);

  return async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    const lastMessage = state.messages[state.messages.length - 1];

    try {
      const result = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: `[当前用户ID: ${state.userId}]\n${lastMessage.content}`,
          },
        ],
      });

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
        agentOutput: `抽奖查询出错：${error.message}`,
      };
    }
  };
}
```

### Step 3: 所有 6 个 Agent 的工具总结

| # | Agent | 工具数 | 工具列表 | 写操作 | Service |
|---|-------|--------|---------|--------|---------|
| 06 | Order | 3 | `order_list`, `order_detail`, `order_apply_refund` | ✅ refund | `OrderService` |
| 07 | Wallet | 3 | `wallet_balance`, `wallet_transactions`, `wallet_apply_withdraw` | ✅ withdraw | `WalletService` + `ClientWalletService` |
| 08 | Coupon | 3 | `coupon_my_list`, `coupon_claimable`, `coupon_claim` | ✅ claim | `ClientCouponService` |
| 09 | User | 3 | `user_profile`, `address_list`, `address_detail` | ❌ 纯读 | `AuthService` + `AddressService` |
| 10 | Product | 4 | `treasure_list`, `treasure_detail`, `group_list`, `group_detail` | ❌ 纯读 | `TreasureService` + `GroupService` |
| 11 | Lucky | 5 | `lucky_tickets`, `lucky_results`, `lucky_draw`, `flash_sessions`, `flash_products` | ✅ draw | `LuckyDrawService` + `ClientFlashSaleService` |

**总计**：21 个工具（6 个 Agent），覆盖 9 个 Service 的所有 21 个方法。

### Step 4: 抽奖执行的典型对话

```
用户: "我有多少抽奖券？"
Agent: 调用 lucky_tickets → 返回列表
Agent: "亲，您有 3 张抽奖券，其中 2 张未使用。"

用户: "我要抽奖！"
Agent: "您有 2 张未使用的抽奖券，使用哪一张呢？"
用户: "用第一张，券 ID 是 tkt-001"
Agent: "确认使用抽奖券 tkt-001 进行抽奖吗？"
用户: "确认"
Agent: 调用 lucky_draw({ ticketId: "tkt-001" }) → 原子执行
Agent: "🎉 恭喜您！抽中了【蓝牙耳机 X1 Pro】！奖品将在 3 个工作日内发放～"
```

---

## ✅ 验证

```bash
# 编译检查
yarn workspace @lucky/api build
```

---

## 📝 技术要点

### 闪购的时间敏感性

闪购信息是**时间敏感**的：
- `getActiveSessions()` 只返回**当前进行中**的场次
- 每次用户询问时都需要重新查询（不要缓存）
- Agent description 中应提示 LLM 这是实时数据

### LuckyDrawService.draw() 的事务处理

`draw()` 方法内部使用 `prisma.$transaction`：

```typescript
// lucky-draw.service.ts:204
async draw(userId: string, ticketId: string): Promise<DrawResult> {
  return this.prisma.$transaction(async (tx) => {
    // 1. 锁定抽奖券记录（行级锁）
    // 2. 检查券是否未使用
    // 3. 标记券为已使用
    // 4. 随机抽取奖品
    // 5. 扣减库存
    // 6. 创建中奖记录
    // 7. 发放奖品（优惠券等）
  });
}
```

Agent 调用 `draw()` 时不需要关心事务细节，一次调用即可完成完整的抽奖流程。

### 为什么闪购没有购买 tool？

当前只提供闪购信息的查询（场次列表 + 商品列表），**不包括**闪购下单功能。原因是：
1. 闪购下单涉及复杂的库存锁定和超时处理
2. 闪购的下单流程和普通购物车流程不同
3. 这是 Phase 5 可以扩展的功能

### 闪购工具不需要 userId

`flash_sessions` 和 `flash_products` 是公开信息，不需要用户认证。但 `lucky_tickets`、`lucky_results`、`lucky_draw` 需要 `userId`。

---

## 🔜 下一步预告

Phase 2（6 个 ReAct Agent）全部完成！接下来进入 **Phase 3：知识库**。

在 [12-政策知识文档与RAGStub.md](12-政策知识文档与RAGStub.md) 中，我们将：
- 创建 8 个政策知识文档（退款政策、发货政策、优惠券规则等）
- 完善 `graph/nodes/rag.node.ts` — 实现基础的政策文档加载和查询
- 为 Phase 3 的完整 pgvector 向量搜索做准备
