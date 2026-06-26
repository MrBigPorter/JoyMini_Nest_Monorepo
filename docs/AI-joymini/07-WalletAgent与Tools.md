# 07. Wallet Agent + Tools（钱包助手）

## 🎯 本步骤目标

1. 创建 `graph/tools/wallet-tools.ts` — 4 个钱包工具的工厂函数（含 KYC 状态检查）
2. 创建 `graph/nodes/wallet-agent.node.ts` — 使用 `createReactAgent` 构建 Wallet ReAct Agent
3. 掌握 `ClientWalletService` 和 `WalletService` 的区别与协作
4. 理解 KYC 实名认证与钱包提现的关系

完成本步骤后，`walletAgent` 节点可以处理"查余额"、"看交易记录"、"提现"等钱包相关查询，
并在提现前自动检查用户是否已完成 KYC 实名认证。

---

## 📖 开发背景

### 承上：上一步做了什么？

[06-OrderAgent与Tools.md](06-OrderAgent与Tools.md) 完成了：
- `graph/tools/order-tools.ts` — 3 个订单工具的工厂函数
- `graph/nodes/order-agent.node.ts` — Order ReAct Agent
- **Tool 工厂函数模式** 的设计与实现
- `createReactAgent` 的使用方法

### 启下：下一步做什么？

下一步 [08-CouponAgent与Tools.md](08-CouponAgent与Tools.md) 将实现：
- Coupon Agent — 处理优惠券查询、领取
- Coupon Tools — 3 个工具的工厂函数

### 架构中的位置

```
用户输入 → intentRouter (wallet) → walletAgent (本步骤)
                                      ├── wallet_balance (查询余额)
                                      ├── wallet_transactions (交易记录)
                                      ├── wallet_apply_withdraw (申请提现)
                                      └── kyc_status (KYC 状态检查 - 提现前使用)
                                   → answerSynthesizer
```

---

## 🔧 前提条件

- [x] 06 文档已完成（Order Agent、Tool 工厂函数模式）
- [x] `wallet.module.ts` 已正确 exports（`exports: [WalletService, ClientWalletService]`）
- [x] `kyc.module.ts` 已修复 exports（`exports: [KycService]`）
- [x] 了解两个钱包服务的区别

### 钱包服务的双 Service 架构

JoyMini 的钱包功能分在两个 Service 中：

| Service | 文件 | 行号 | 方法 | 职责 |
|---------|------|------|------|------|
| `WalletService` | [`wallet.service.ts`](apps/api/src/client/wallet/wallet.service.ts) | 75 | `balance(userId)` | 查询余额（含 realBalance, coinBalance, frozenBalance） |
| `WalletService` | [`wallet.service.ts`](apps/api/src/client/wallet/wallet.service.ts) | 93 | `applyWithdraw(userId, dto)` | 申请提现（**写操作**） |
| `ClientWalletService` | [`client-wallet.service.ts`](apps/api/src/client/wallet/client-wallet.service.ts) | ~580 | `getRechargeHistory(userId, dto)` | 充值/交易记录分页查询 |

**为什么要分开？** `WalletService` 处理核心账户操作（余额、冻结），`ClientWalletService` 处理客户端展示相关的查询（充值记录、交易历史）。

### KYC 与钱包的关系

用户提现必须**先完成 KYC 实名认证**（kycStatus = 4）。因此 Wallet Agent 需要能查询 KYC 状态，
在用户申请提现前先检查是否已实名。检查逻辑：
- 如果 `kycStatus !== 4` → 告知用户"请先在 App 内完成实名认证后再提现"
- 如果 `kycStatus === 4` → 继续提现流程

---

## ⚙️ 实现步骤

### Step 1: 创建 Wallet Tools 工厂函数

**文件**: `apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts`

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { WalletService } from '@api/client/wallet/wallet.service';
import { ClientWalletService } from '@api/client/wallet/client-wallet.service';
import { KycService } from '@api/client/kyc/kyc.service';

/**
 * 钱包工具 — 工厂函数
 *
 * 接收 WalletService 和 ClientWalletService 两个实例，
 * 因为钱包功能分布在两个 Service 中。同时接收 KycService
 * 用于在提现前检查 KYC 实名认证状态。
 *
 * @param walletService - WalletService 实例（余额、提现）
 * @param clientWalletService - ClientWalletService 实例（交易记录）
 * @param kycService - KycService 实例（KYC 状态检查）
 * @returns LangChain tool 数组
 */
export function createWalletTools(
  walletService: WalletService,
  clientWalletService: ClientWalletService,
  kycService: KycService,
) {
  /**
   * Tool 1: 查询钱包余额
   *
   * 返回用户的实时余额信息，包括：
   * - realBalance: 真实货币余额（美元）
   * - coinBalance: 平台币余额
   * - frozenBalance: 冻结金额
   */
  const balanceTool = tool(
    async ({ userId }) => {
      try {
        const result = await walletService.balance(userId);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询余额失败：${error.message}`;
      }
    },
    {
      name: 'wallet_balance',
      description:
        '查询当前登录用户的钱包余额信息。返回真实货币余额、平台币余额和冻结金额。' +
        '注意：只能查询当前登录用户的余额，userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
      }),
    },
  );

  /**
   * Tool 2: 查询交易/充值记录
   *
   * 返回用户的充值、消费等交易历史记录，支持分页查询。
   */
  const transactionsTool = tool(
    async ({ userId, page, pageSize }) => {
      try {
        const result = await clientWalletService.getRechargeHistory(userId, {
          page,
          pageSize,
        });
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询交易记录失败：${error.message}`;
      }
    },
    {
      name: 'wallet_transactions',
      description:
        '查询当前登录用户的交易记录或充值记录。支持分页查询，按时间倒序排列。' +
        '注意：只能查询当前登录用户的记录，userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        page: z.number().optional().default(1).describe('页码，从1开始'),
        pageSize: z.number().optional().default(10).describe('每页数量'),
      }),
    },
  );

  /**
   * Tool 3: 申请提现
   *
   * 【写操作】提交提现申请。用户需要提供提现金额。
   * 需要对用户进行二次确认提示。
   */
  const applyWithdrawTool = tool(
    async ({ userId, amount }) => {
      try {
        const result = await walletService.applyWithdraw(userId, { amount } as any);
        return JSON.stringify(result);
      } catch (error: any) {
        return `提现申请失败：${error.message}`;
      }
    },
    {
      name: 'wallet_apply_withdraw',
      description:
        '【写操作-需确认】为当前登录用户申请提现。需要用户确认提现金额。' +
        '重要：执行此操作前必须先和用户确认提现金额！' +
        'userId 由系统自动传入，不需要用户提供。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
        amount: z.number().positive().describe('提现金额（正数）'),
      }),
    },
  );

  /**
   * Tool 4: 查询 KYC 实名认证状态
   *
   * 提现操作需要用户先完成实名认证。此工具用于检查当前用户的 KYC 状态。
   * KYC 状态码: 0=未开始 1=审核中 2=已驳回 3=需补充 4=已通过
   */
  const kycStatusTool = tool(
    async ({ userId }) => {
      try {
        const result = await kycService.getMyKyc(userId);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询 KYC 状态失败：${error.message}`;
      }
    },
    {
      name: 'kyc_status',
      description:
        '查询当前登录用户的实名认证KYC状态。提现前应检查此状态，' +
        '如果用户未完成实名认证KYC status != 4，应告知用户先完成实名认证再提现。' +
        'userId 由系统自动传入。',
      schema: z.object({
        userId: z.string().describe('用户ID（由系统自动传入）'),
      }),
    },
  );

  return [balanceTool, transactionsTool, applyWithdrawTool, kycStatusTool];
}
```

### Step 2: 创建 Wallet Agent 节点

**文件**: `apps/api/src/client/ai-customer/graph/nodes/wallet-agent.node.ts`

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOllama } from '@langchain/ollama';
import { WalletService } from '@api/client/wallet/wallet.service';
import { ClientWalletService } from '@api/client/wallet/client-wallet.service';
import { KycService } from '@api/client/kyc/kyc.service';
import { createWalletTools } from '../tools/wallet-tools';
import { AgentStateType } from '../state';

/**
 * 构建 Wallet ReAct Agent
 *
 * 处理钱包余额查询、交易记录查询和提现申请。
 * 提现前会自动检查 KYC 实名认证状态。
 */
function buildWalletAgent(
  walletService: WalletService,
  clientWalletService: ClientWalletService,
  kycService: KycService,
) {
  return createReactAgent({
    llm: new ChatOllama({
      model: 'qwen3.5:0.8b',
      temperature: 0,
    }),
    tools: createWalletTools(walletService, clientWalletService, kycService),
    messageModifier:
      '你是 JoyMini 的钱包助手。你的职责是帮助用户处理钱包相关事务。\n\n' +
      '你可以：\n' +
      '1. 查询用户钱包余额（wallet_balance）\n' +
      '2. 查询交易记录（wallet_transactions）\n' +
      '3. 申请提现（wallet_apply_withdraw）— 需先确认金额\n' +
      '4. 检查 KYC 实名认证状态（kyc_status）— 提现前建议先检查\n\n' +
      '注意：\n' +
      '- 提现需要用户先完成 KYC 实名认证（kycStatus = 4 表示已通过）\n' +
      '- 如果用户未完成实名认证，请告知用户先去 App 内实名认证\n' +
      '- 提现操作需要二次确认：先展示金额，让用户确认后再执行',
  });

  return async (state: AgentStateType) => {
    const result = await agentApp.invoke({ messages: state.messages });
    return { messages: result.messages };
  };
}

/**
 * Wallet Agent 节点工厂函数
 *
 * 在 AiCustomerService 中调用，传入 WalletService、ClientWalletService 和 KycService 实例。
 *
 * @example
 * const walletAgentNode = createWalletAgentNode(walletService, clientWalletService, kycService);
 */
export function createWalletAgentNode(
  walletService: WalletService,
  clientWalletService: ClientWalletService,
  kycService: KycService,
) {
  const agentApp = buildWalletAgent(walletService, clientWalletService, kycService);
  return async (state: AgentStateType) => {
    const result = await agentApp.invoke({ messages: state.messages });
    return { messages: result.messages };
  };
}
```

---

## ✅ 验证

### 编译检查

```bash
yarn workspace @lucky/api build
```

### 手动验证步骤

1. **查询余额**
   - 输入："我的钱包余额是多少？"
   - 预期：Intent Router 路由到 `walletAgent`，调用 `wallet_balance`，返回余额信息

2. **查询交易记录**
   - 输入："最近一笔充值记录"
   - 预期：路由到 `walletAgent`，调用 `wallet_transactions`，返回充值记录

3. **提现（未实名）**
   - 输入："我要提现 50 美元"
   - 预期：LLM 先调用 `kyc_status` 检查 KYC → 发现未认证 → 提示"请先完成实名认证"
   - 不会调用 `wallet_apply_withdraw`

4. **提现（已实名）**
   - 输入："我要提现 50 美元"
   - 预期：LLM 先调用 `kyc_status` → KYC 已通过 → 继续调用 `wallet_apply_withdraw` → 返回结果

---

## 📝 技术要点

1. **KYC 交叉工具**：Wallet Agent 拥有 `kyc_status` 工具，但 KYC 相关问题（如"我的 KYC 状态"）由独立的 `kycAgent` 处理。Wallet Agent 只在提现流程中检查 KYC
2. **`applyWithdraw` 写操作保护**：LLM 必须先调用 `kyc_status` 确认实名状态，再通知用户确认金额，最后才执行提现
3. **Tool 工厂函数模式**：与 Order Agent 一致，每个 Service 实例在 `AiCustomerService` 中注入后传入工厂函数

---

## 🔜 下一步预告

在 [08-CouponAgent与Tools.md](08-CouponAgent与Tools.md) 中，我们将：
- 创建 Coupon Tools（3 个工具）
- 创建 Coupon Agent
- 使用 `ClientCouponService` 实现优惠券查询和领取
