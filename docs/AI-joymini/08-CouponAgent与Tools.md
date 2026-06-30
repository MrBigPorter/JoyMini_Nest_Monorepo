# 08. Coupon Agent + Tools（优惠券助手）

> **⚠️ PENDING — couponAgent 尚未实现**
>
> 本文档描述的 `coupon-tools.ts` 和 `coupon-agent.node.ts` 已在计划中但尚未创建：
> - `coupon-tools.ts` — 未创建
> - `coupon-agent.node.ts` — 未创建
> - customer.graph.ts 中 coupon 路由 → 当前 fallback 到 generalChat
>
> 方案 B 决策后，couponAgent 创建是待办事项之一。
> 详见 [`33-工作流型智能体16挑战对标.md`](33-工作流型智能体16挑战对标.md)

## 🎯 本步骤目标

1. 创建 `graph/tools/coupon-tools.ts` — 3 个优惠券工具的工厂函数
2. 创建 `graph/nodes/coupon-agent.node.ts` — 使用 `createReactAgent` 构建 Coupon ReAct Agent
3. 掌握 `ClientCouponService` 的三个方法及 `claimCoupon` 的事务处理

完成本步骤后，`couponAgent` 节点可以处理"我的优惠券"、"有哪些券可以领"、"领取优惠券"等优惠券相关查询。

---

## 📖 开发背景

### 承上：上一步做了什么？

[07-WalletAgent与Tools.md](07-WalletAgent与Tools.md) 完成了：
- `graph/tools/wallet-tools.ts` — 3 个钱包工具的工厂函数
- `graph/nodes/wallet-agent.node.ts` — Wallet ReAct Agent
- 双 Service 注入模式（`WalletService` + `ClientWalletService`）
- 写操作安全确认设计

### 启下：下一步做什么？

下一步 [09-UserAddressAgent与Tools.md](09-UserAddressAgent与Tools.md) 将实现：
- User+Address Agent — 处理个人信息、地址查询
- User+Address Tools — 3 个工具的工厂函数

### 架构中的位置

```
用户输入 → intentRouter (coupon) → couponAgent (本步骤)
                                     ├── coupon_my_list (我的优惠券)
                                     ├── coupon_claimable (可领优惠券)
                                     └── coupon_claim (领取优惠券)
                                  → answerSynthesizer
```

---

## 🔧 前提条件

- [x] 06 文档已完成（Agent 工厂函数模式）
- [x] `coupon.module.ts` 已修复 exports（`exports: [ClientCouponService]`）

### ClientCouponService 方法速查

| 方法 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `getMyCoupons` | [`coupon.service.ts`](apps/api/src/client/coupon/coupon.service.ts):13 | `(userId, dto: QueryMyCouponsDto)` | 用户已领取的优惠券列表，自动清理过期券 |
| `claimCoupon` | [`coupon.service.ts`](apps/api/src/client/coupon/coupon.service.ts):71 | `(userId, dto)` | **写操作** — 领取优惠券（含 Prisma 事务） |
| `getClaimableCoupons` | [`coupon.service.ts`](apps/api/src/client/coupon/coupon.service.ts):173 | `(userId)` | 可领取的优惠券模板列表（排除已领过的） |

---

## ⚙️ 实现步骤

### Step 1: 创建 Coupon Tools 工厂函数

**文件**: `apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts`

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ClientCouponService } from '@api/client/coupon/coupon.service';

/**
 * 优惠券工具 — 工厂函数
 *
 * @param couponService - NestJS 注入的 ClientCouponService 实例
 * @returns LangChain tool 数组
 */
export function createCouponTools(couponService: ClientCouponService) {
  /**
   * Tool 1: 查询我的优惠券
   *
   * 返回当前用户已领取的优惠券列表，自动清理过期券。
   */
  const myCouponsTool = tool(
    async ({ userId, status, page, pageSize }) => {
      try {
        const result = await couponService.getMyCoupons(userId, {
          status,
          page,
          pageSize,
        } as any);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询优惠券失败：${error.message}`;
      }
    },
    {
      name: 'coupon_my_list',
      description:
        '查询当前登录用户已领取的优惠券列表。支持按使用状态和分页筛选。' +
        '系统会自动清理已过期的优惠券。' +
        'userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        status: z
          .enum(['unused', 'used', 'expired'])
          .optional()
          .describe('优惠券使用状态筛选'),
        page: z.number().optional().default(1).describe('页码'),
        pageSize: z.number().optional().default(10).describe('每页数量'),
      }),
    },
  );

  /**
   * Tool 2: 查询可领取的优惠券
   *
   * 返回当前用户可以领取的优惠券模板列表，
   * 排除已经领取过的优惠券类型。
   */
  const claimableCouponsTool = tool(
    async ({ userId }) => {
      try {
        const result = await couponService.getClaimableCoupons(userId);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询可领优惠券失败：${error.message}`;
      }
    },
    {
      name: 'coupon_claimable',
      description:
        '查询当前登录用户可以领取的优惠券列表。返回还未领取过的优惠券模板，包含优惠券面额、使用条件等信息。' +
        'userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
      }),
    },
  );

  /**
   * Tool 3: 领取优惠券
   *
   * 【写操作】根据优惠券模板ID领取一张优惠券。
   * 使用 Prisma 事务确保原子性。
   */
  const claimCouponTool = tool(
    async ({ userId, couponTemplateId }) => {
      try {
        const result = await couponService.claimCoupon(userId, {
          couponTemplateId,
        } as any);
        return JSON.stringify(result);
      } catch (error: any) {
        return `领取优惠券失败：${error.message}`;
      }
    },
    {
      name: 'coupon_claim',
      description:
        '【写操作-需确认】为当前登录用户领取一张优惠券。需要用户提供优惠券模板ID。' +
        '重要：执行前先向用户展示可领取的优惠券列表让用户选择，执行前和用户确认！' +
        'userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        couponTemplateId: z.string().describe('优惠券模板ID（从可领列表中选择）'),
      }),
    },
  );

  return [myCouponsTool, claimableCouponsTool, claimCouponTool];
}
```

### Step 2: 创建 Coupon Agent 节点

**文件**: `apps/api/src/client/ai-customer/graph/nodes/coupon-agent.node.ts`

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOllama } from '@langchain/ollama';
import { ClientCouponService } from '@api/client/coupon/coupon.service';
import { createCouponTools } from '../tools/coupon-tools';
import { AgentStateType } from '../state';

/**
 * 构建 Coupon ReAct Agent
 *
 * 处理优惠券查询、可领取列表查询和领取操作。
 */
function buildCouponAgent(couponService: ClientCouponService) {
  return createReactAgent({
    llm: new ChatOllama({
      model: 'qwen3.5:0.8b',
      temperature: 0.1,
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    }),
    tools: createCouponTools(couponService),
    recursionLimit: 10,
  });
}

/**
 * Coupon Agent Node 工厂函数
 */
export function createCouponAgentNode(couponService: ClientCouponService) {
  const agent = buildCouponAgent(couponService);

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
        agentOutput: `优惠券查询出错：${error.message}`,
      };
    }
  };
}
```

### Step 3: 优惠券查询的典型对话流程

```
用户: "我有哪些优惠券？"
Agent: 调用 coupon_my_list → 返回列表
Agent: "亲，您目前有以下优惠券：
       1. 满100减20券（未使用，有效期至2025-12-31）
       2. 全场9折券（已使用）"

用户: "有什么券可以领吗？"
Agent: 调用 coupon_claimable → 返回列表
Agent: "亲，您现在可以领取以下优惠券：
       1. 新人满50减10券
       2. 满200减50券（限时）
       请问您想领取哪一张？"

用户: "领第一张"
Agent: "好的，为您领取新人满50减10券，确认吗？"
用户: "确认"
Agent: 调用 coupon_claim → 执行领取
Agent: "领取成功！已为您添加新人满50减10券，有效期30天～"
```

---

## ✅ 验证

```bash
# 编译检查
yarn workspace @lucky/api build
```

---

## 📝 技术要点

### ClientCouponService 的事务处理

`claimCoupon` 内部使用 Prisma 事务：

```typescript
// coupon.service.ts:76
async claimCoupon(userId: string, dto: { couponTemplateId: string }) {
  return this.prisma.$transaction(async (tx) => {
    // 1. 检查模板是否存在且可领取
    // 2. 检查用户是否已领取过
    // 3. 创建用户-优惠券关联记录
    // 4. 更新模板已领数量
  });
}
```

Agent 调用时无需关心事务细节，一次 `invoke` 即可完成所有操作。

### 优惠券工具的推荐流程

| 步骤 | Agent 动作 | 用户动作 |
|------|-----------|---------|
| 1 | 询问用户想做什么 | "我想领优惠券" |
| 2 | 调用 `coupon_claimable` 获取可领列表 | - |
| 3 | 展示列表给用户选择 | "领第一张" |
| 4 | 和用户确认 | "确认" |
| 5 | 调用 `coupon_claim` | - |
| 6 | 显示领取结果 | "谢谢" |

---

## 🔜 下一步预告

在 [09-UserAddressAgent与Tools.md](09-UserAddressAgent与Tools.md) 中，我们将实现第四个 ReAct Agent：
- **User+Address Agent** — 处理个人信息查询、地址列表、地址详情
- **3 个 User Tools**：`user_profile`、`address_list`、`address_detail`
- **AuthService 的 profile() 方法使用**
