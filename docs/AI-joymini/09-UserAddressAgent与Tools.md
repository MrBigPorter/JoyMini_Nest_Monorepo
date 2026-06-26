# 09. User + Address Agent + Tools（用户信息助手）

## 🎯 本步骤目标

1. 创建 `graph/tools/user-tools.ts` — 3 个用户/地址工具的工厂函数
2. 创建 `graph/nodes/user-agent.node.ts` — 使用 `createReactAgent` 构建 User ReAct Agent
3. 掌握 `AuthService.profile()` 和 `AddressService` 的使用

完成本步骤后，`userAgent` 节点可以处理"我的个人信息"、"我的收货地址"等用户相关查询。

---

## 📖 开发背景

### 承上：上一步做了什么？

[08-CouponAgent与Tools.md](08-CouponAgent与Tools.md) 完成了：
- `graph/tools/coupon-tools.ts` — 3 个优惠券工具的工厂函数
- `graph/nodes/coupon-agent.node.ts` — Coupon ReAct Agent
- 优惠券领取的典型对话流程设计

### 启下：下一步做什么？

下一步 [10-ProductGroupAgent与Tools.md](10-ProductGroupAgent与Tools.md) 将实现：
- Product+Group Agent — 处理商品搜索、商品详情、拼团信息
- 4 个工具的工厂函数

### 架构中的位置

```
用户输入 → intentRouter (user) → userAgent (本步骤)
                                     ├── user_profile (个人信息)
                                     ├── address_list (地址列表)
                                     └── address_detail (地址详情)
                                  → answerSynthesizer
```

---

## 🔧 前提条件

- [x] 06 文档已完成（Agent 工厂函数模式）
- [x] `auth.module.ts` 需要 exports `[AuthService]`

### Service 方法速查

| Service | 方法 | 行号 | 签名 | 说明 |
|---------|------|------|------|------|
| `AuthService` | `profile` | [`auth.service.ts`](apps/api/src/client/auth/auth.service.ts):510 | `(userId)` | 用户信息：id, nickname, avatar, phone, inviteCode, vipLevel, kycStatus 等 |
| `AddressService` | `list` | [`address.service.ts`](apps/api/src/client/address/address.service.ts):177 | `(userId, dto)` | 地址列表（分页，默认排前） |
| `AddressService` | `detail` | [`address.service.ts`](apps/api/src/client/address/address.service.ts):226 | `(userId, addressId)` | 单个地址完整信息 |

---

## ⚙️ 实现步骤

### Step 1: 创建 User Tools 工厂函数

**文件**: `apps/api/src/client/ai-customer/graph/tools/user-tools.ts`

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { AuthService } from '@api/client/auth/auth.service';
import { AddressService } from '@api/client/address/address.service';

/**
 * 用户/地址工具 — 工厂函数
 *
 * 包含个人信息和地址查询两类功能。
 * AuthService 提供用户个人信息，AddressService 提供地址管理。
 *
 * @param authService - AuthService 实例
 * @param addressService - AddressService 实例
 * @returns LangChain tool 数组
 */
export function createUserTools(
  authService: AuthService,
  addressService: AddressService,
) {
  /**
   * Tool 1: 查询个人信息
   *
   * 返回当前登录用户的个人信息：
   * - 昵称、头像、手机号
   * - 邀请码、VIP 等级
   * - KYC 认证状态、自排除到期时间
   */
  const profileTool = tool(
    async ({ userId }) => {
      try {
        const result = await authService.profile(userId);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询个人信息失败：${error.message}`;
      }
    },
    {
      name: 'user_profile',
      description:
        '查询当前登录用户的个人信息，包括昵称、头像、手机号、VIP等级、KYC认证状态等。' +
        '注意：只能查询当前登录用户的信息，userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
      }),
    },
  );

  /**
   * Tool 2: 查询地址列表
   *
   * 返回当前用户的收货地址列表，支持分页。
   */
  const addressListTool = tool(
    async ({ userId, page, pageSize }) => {
      try {
        const result = await addressService.list(userId, {
          page,
          pageSize,
        } as any);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询地址列表失败：${error.message}`;
      }
    },
    {
      name: 'address_list',
      description:
        '查询当前登录用户的收货地址列表。支持分页查询。' +
        'userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        page: z.number().optional().default(1).describe('页码'),
        pageSize: z.number().optional().default(10).describe('每页数量'),
      }),
    },
  );

  /**
   * Tool 3: 查询地址详情
   *
   * 根据地址ID查询单个收货地址的完整信息。
   */
  const addressDetailTool = tool(
    async ({ userId, addressId }) => {
      try {
        const result = await addressService.detail(userId, addressId);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询地址详情失败：${error.message}`;
      }
    },
    {
      name: 'address_detail',
      description:
        '根据地址ID查询单个收货地址的详细信息，包括收货人、电话、详细地址等。' +
        '注意：只能查询当前登录用户的地址，userId 由系统自动传入。' +
        '调用此工具前，用户需要提供地址ID。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        addressId: z.string().describe('地址ID'),
      }),
    },
  );

  return [profileTool, addressListTool, addressDetailTool];
}
```

### Step 2: 创建 User Agent 节点

**文件**: `apps/api/src/client/ai-customer/graph/nodes/user-agent.node.ts`

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOllama } from '@langchain/ollama';
import { AuthService } from '@api/client/auth/auth.service';
import { AddressService } from '@api/client/address/address.service';
import { createUserTools } from '../tools/user-tools';
import { AgentStateType } from '../state';

/**
 * 构建 User ReAct Agent
 *
 * 处理个人信息查询、地址列表和地址详情查询。
 */
function buildUserAgent(
  authService: AuthService,
  addressService: AddressService,
) {
  return createReactAgent({
    llm: new ChatOllama({
      model: 'qwen3.5:0.8b',
      temperature: 0.1,
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    }),
    tools: createUserTools(authService, addressService),
    recursionLimit: 10,
  });
}

/**
 * User Agent Node 工厂函数
 */
export function createUserAgentNode(
  authService: AuthService,
  addressService: AddressService,
) {
  const agent = buildUserAgent(authService, addressService);

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
        agentOutput: `用户信息查询出错：${error.message}`,
      };
    }
  };
}
```

### Step 3: 修复 AuthModule exports

确保 `auth.module.ts` 导出了 `AuthService`，否则 AiCustomerModule 无法注入：

```diff
// apps/api/src/client/auth/auth.module.ts
@Module({
+ exports: [AuthService],
})
export class AuthModule {}
```

### Step 4: 地址工具的用户体验设计

地址查询的典型流程：

```
用户: "我的收货地址有哪些？"
Agent: 调用 address_list → 返回列表
Agent: "亲，您有以下收货地址：
       1. 张三，138****1234，北京市朝阳区xxx（默认地址）
       2. 张三，138****5678，上海市浦东新区xxx"

用户: "看看第一个地址的详情"
Agent: "请提供地址ID以便查询详细地址"
用户: "地址ID是 addr-001"
Agent: 调用 address_detail → 返回详情
Agent: "收货人：张三
       联系电话：138****1234
       详细地址：北京市朝阳区xxx小区x栋x单元xxx
       邮编：100000
       是否默认：是"
```

注意：`address_detail` 需要用户提供 `addressId`，Agent 应先从列表结果中获取 ID。

---

## ✅ 验证

```bash
# 编译检查
yarn workspace @lucky/api build
```

---

## 📝 技术要点

### AuthService 的 profile() 方法

`profile()` 返回的数据结构包含敏感信息（如手机号 `phone`）和业务信息（如 `vipLevel`、`kycStatus`）：

```typescript
// 返回值示例（部分字段）
{
  id: 'user-xxx',
  nickname: '张三',
  avatar: 'https://...',
  phone: '+86138****1234',       // 已脱敏
  inviteCode: 'ABC123',
  vipLevel: 2,                    // VIP 等级
  kycStatus: 'verified',          // KYC 认证状态
  selfExclusionExpireAt: null,    // 自排除到期时间
}
```

### 只读操作 vs 写操作

本步骤的 3 个工具全是只读操作（读个人信息、读地址列表、读地址详情），因此不需要写操作的安全确认提示。

### AddressModule 的 exports 要求

```typescript
// apps/api/src/client/address/address.module.ts
@Module({
  providers: [AddressService],
  controllers: [AddressController],
  exports: [AddressService],  // 需要添加此行
})
export class AddressModule {}
```

---

## 🔜 下一步预告

在 [10-ProductGroupAgent与Tools.md](10-ProductGroupAgent与Tools.md) 中，我们将实现第五个 ReAct Agent：
- **Product+Group Agent** — 处理商品搜索、商品详情、拼团列表、拼团详情
- **4 个 Product Tools**：`treasure_list`、`treasure_detail`、`group_list`、`group_detail`
- **TreasureService + GroupService 的协作**
