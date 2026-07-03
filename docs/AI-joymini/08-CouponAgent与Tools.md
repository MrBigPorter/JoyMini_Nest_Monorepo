# 08. Coupon Agent + Tools（优惠券助手）

> **✅ DONE — couponAgent 已实现**
>
> 本文档描述的 `coupon-tools.ts` 和 `coupon-agent.node.ts` 已于 2026-06-30 **全部实现并投入使用**。
>
> 实际实现与本文档最初的方案有较大差异，经历了多次重构：
> - 原始方案：`createReactAgent` + 硬编码 `ChatOllama` + 3 个工具
> - 当前架构：`runAgentLoop` + `prompt-builder` + `ToolRegistryService` + `LlmProviderConfig` + 4 个工具
>
> 详见下方「实际实现 vs 文档方案」对比。

## 🎯 本步骤目标

1. ~~创建 `graph/tools/coupon-tools.ts` — 3 个优惠券工具的工厂函数~~ ✅ **已完成（实际 4 个工具）**
2. ~~创建 `graph/nodes/coupon-agent.node.ts` — 使用 `createReactAgent` 构建 Coupon ReAct Agent~~ ✅ **已完成（改用 `runAgentLoop` 模式）**
3. 掌握 `ClientCouponService` 的三个方法及 `claimCoupon` 的事务处理

完成本步骤后，`couponAgent` 节点可以处理"我的优惠券"、"有哪些券可以领"、"领取优惠券"、"兑换码兑换"等优惠券相关查询。

---

## 📖 开发背景

### 承上：上一步做了什么？

[07-WalletAgent与Tools.md](07-WalletAgent与Tools.md) 完成了：
- `graph/tools/wallet-tools.ts` — 5 个钱包工具的工厂函数
- `graph/nodes/wallet-agent.node.ts` — Wallet Agent（含 OTP 验证）
- `ToolRegistry` 架构 — `OnApplicationBootstrap` 编程式注册 + `@Global ToolRegistryModule`
- `TaggedTool` 标签系统

### 启下：下一步做什么？

下一步 [09-UserAddressAgent与Tools.md](09-UserAddressAgent与Tools.md) 将实现：
- User+Address Agent — 处理个人信息、地址查询
- User+Address Tools — 3 个工具的工厂函数

### 架构中的位置

```
用户输入 → intentRouter (coupon) → couponAgent (本步骤)
                                      ├── getUserCoupons (我的优惠券)
                                      ├── getClaimableCoupons (可领优惠券)
                                      ├── claimCoupon (领取优惠券)
                                      └── redeemCouponCode (兑换码兑换)
                                   → answerSynthesizer
```

---

## 🔧 前提条件

- [x] 06 文档已完成（Agent 工厂函数模式）
- [x] `coupon.module.ts` 已修复 exports（`exports: [ClientCouponService]`）
- [x] `ToolRegistryService` 已实现（`tag` 标签过滤）
- [x] `agent-runner.ts` + `prompt-builder.ts` 已就绪（Agent 运行框架）
- [x] `llm-factory.ts` 已就绪（统一 LLM 创建）

### ClientCouponService 方法速查

| 方法 | 行号 | 签名 | 说明 |
|------|------|------|------|
| `getMyCoupons` | [`coupon.service.ts`](apps/api/src/client/coupon/coupon.service.ts):13 | `(userId, dto: QueryMyCouponsDto)` | 用户已领取的优惠券列表，自动清理过期券 |
| `claimCoupon` | [`coupon.service.ts`](apps/api/src/client/coupon/coupon.service.ts):71 | `(userId, couponId, source?)` | **写操作** — 领取优惠券（含 Prisma 事务） |
| `getClaimableCoupons` | [`coupon.service.ts`](apps/api/src/client/coupon/coupon.service.ts):173 | `(userId)` | 可领取的优惠券模板列表（排除已领过的） |
| `redeemCode` | [`coupon.service.ts`](apps/api/src/client/coupon/coupon.service.ts):? | `(userId, code)` | **写操作** — 兑换码兑换优惠券 |

---

## ⚙️ 实际实现

### Step 1: 创建 Coupon Tools 工厂函数

**文件**: [`apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts`](apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts)

实际实现使用 `TaggedTool` 模式（标签 `'coupon'`），返回 4 个工具：

| Tool | 功能 | 读/写 | 说明 |
|------|------|-------|------|
| `getUserCoupons` | 查询我的优惠券 | 读 | 支持按状态筛选 + 分页 |
| `getClaimableCoupons` | 可领取的优惠券（领券中心） | 读 | 排除已领取过的模板 |
| `claimCoupon` | 领取优惠券 | **写** | 按模板 ID 领取 |
| `redeemCouponCode` | 兑换码兑换 | **写** | 不区分大小写 |

**核心模式:**
- 使用 `tool()` 函数包装（来自 `@langchain/core/tools`）
- 返回 `TaggedTool` 结构：`{ tool: DynamicStructuredTool, tags: ['coupon'] }`
- 用 `toolSuccess`/`toolFailure` 包裹返回结果
- 用 `toLLM()` + `plainToInstance` 序列化 DTO 为 LLM 友好的语义化数据

**代码片段:**

```typescript
// coupon-tools.ts — TaggedTool 工厂模式
export const createCouponTools = (
  couponService: ClientCouponService,
): TaggedTool[] => {
  return [
    {
      tool: tool(
        async ({ userId, status, page, pageSize }) => {
          try {
            const result = await couponService.getMyCoupons(userId, {
              status, page: page ?? 1, pageSize: pageSize ?? 10,
            });
            const llmList = (result.list ?? []).map((item) =>
              toLLM(plainToInstance(MyCouponResponseDto, item), MyCouponResponseDto, 'zh'),
            );
            return toolSuccess({ total: result.total, coupons: llmList, ... });
          } catch (e) {
            return toolFailure(`Failed to query coupons: ${(e as Error).message}`);
          }
        },
        {
          name: 'getUserCoupons',
          schema: z.object({ ... }),
          description: "Get the current user's coupon list...",
        },
      ),
      tags: ['coupon'],
    },
    // ... claimCoupon, redeemCouponCode, getClaimableCoupons
  ];
};
```

**与初始方案的主要差异:**
| 项目 | 初始方案 | 实际实现 |
|------|----------|----------|
| 工具数量 | 3 | 4（新增 `redeemCouponCode`） |
| 工具命名 | `coupon_my_list`, `coupon_claimable`, `coupon_claim` | `getUserCoupons`, `getClaimableCoupons`, `claimCoupon`, `redeemCouponCode` |
| 返回值格式 | `JSON.stringify` | `toolSuccess`/`toolFailure` |
| DTO 序列化 | 无 | `toLLM` + `plainToInstance` |
| 注册方式 | 直接返回数组 | `TaggedTool[]` → `ToolRegistryService.registerMany()` |

### Step 2: 创建 Coupon Agent 节点

**文件**: [`apps/api/src/client/ai-customer/graph/nodes/coupon-agent.node.ts`](apps/api/src/client/ai-customer/graph/nodes/coupon-agent.node.ts)

实际实现包含两个导出：

1. **`couponAgentNode`** — 占位节点，用于 graph 无条件注册（Phase 1 阶段透传）
2. **`createCouponAgentNode`** — 工厂函数，生产真正的 Coupon Agent

```typescript
// coupon-agent.node.ts — 占位节点（graph 注册用）
export const couponAgentNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  return state; // Phase 1 透传
};

// 工厂函数（生产用）
export const createCouponAgentNode = (
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) => {
  return async (state: typeof AgentState.State): Promise<AgentNodeOutput> => {
    const tools = registry.getToolsByTag('coupon');
    const llm = createLLM(llmConfig, { temperature: 0 });
    const llmWithTools = llm.bindTools(tools);

    const systemPrompt = buildAgentPrompt({
      role: 'You are the coupon inquiry assistant for JoyMini platform.',
      domainName: 'coupon',
      userId,
      workflow: `Step 1: Understand what the user needs
- View my coupons list → getUserCoupons
- View claimable coupons → getClaimableCoupons
- Claim a coupon → claimCoupon
- Redeem a coupon code → redeemCouponCode
...`,
      scopeRestriction: {
        domain: 'coupon',
        handles: ['coupon list', 'claimable coupons', 'claim coupon', 'redeem code'],
        outside: ['wallet', 'orders', 'products', 'lucky-draw'],
      },
      hardRules: [
        '- **If a tool call fails, DO NOT retry the same call** with the same parameters.',
        '- If the conversation history already shows a failed tool call, do NOT call the same tool again.',
      ],
    });

    const result = await runAgentLoop({
      llmWithTools, initialMessages, tools, agentName: 'couponAgent', logger,
    });

    return {
      taskResults: { couponAgent: result.content },
      messages: result.currentMessages.slice(1),
      agentSteps: result.agentSteps,
    };
  };
};
```

**与初始方案的主要差异:**
| 项目 | 初始方案 | 实际实现 |
|------|----------|----------|
| Agent 模式 | `createReactAgent` (LangChain prebuilt) | `runAgentLoop` + `prompt-builder` + `bindTools` |
| LLM 创建 | 硬编码 `ChatOllama` | `createLLM(llmConfig)` 依赖注入 |
| 工具获取 | 直接 `createCouponTools(couponService)` | `registry.getToolsByTag('coupon')` |
| System Prompt | 硬编码字符串 | `buildAgentPrompt()` 标准化构建 |
| 消息过滤 | 无 | `filterAgentMessages()` + `MAX_CONTEXT_MESSAGES` |
| 返回类型 | `Partial<typeof AgentState.State>` | `AgentNodeOutput`（含 `taskResults`, `agentSteps`） |
| 错误处理 | 简单 try-catch | `runAgentLoop` 内建错误处理 + fallback |

### Step 3: 注册流程

与 Wallet/Order 工具一样，Coupon 工具通过 `OnApplicationBootstrap` 编程式注册：

```
NestJS 启动时:
  CouponModule.onApplicationBootstrap()
    → this.toolRegistry.registerMany(createCouponTools(couponService))
    → TaggedTool[{ tool: getUserCoupons, tags: ['coupon'] }, ...] 存入 registry

AiCustomerService.onApplicationBootstrap()
  → buildCustomerGraph(llmConfig, registry)
  → createCouponAgentNode(llmConfig, registry)
  → registry.getToolsByTag('coupon') → 拿到 Coupon 工具
  → llm.bindTools(couponTools) → LLM 只看到 Coupon 工具
```

### Step 4: 优惠券查询的典型对话流程

```
用户: "我有哪些优惠券？"
Agent: 调用 getUserCoupons → 返回列表
Agent: "You have 2 coupons:
        1. 新人满50减10券 — discount 10, valid until 2025-12-31
        2. 全场9折券 — discount 10%, already used"

用户: "有什么券可以领吗？"
Agent: 调用 getClaimableCoupons → 返回列表
Agent: "You can claim these coupons:
        1. 新人满50减10券
        2. 满200减50券（限时）
        Which one would you like to claim?"

用户: "领第一张"
Agent: "Claim coupon [templateId: xxx]? Please confirm."
用户: "确认"
Agent: 调用 claimCoupon → 执行领取
Agent: "Successfully claimed the coupon!"

用户: "我有一个兑换码 ABC123"
Agent: 调用 redeemCouponCode("ABC123") → 兑换
Agent: "Successfully redeemed the coupon code!"
```

---

## ✅ 验证

```bash
# 编译检查
yarn workspace @lucky/api build

# 端到端测试
POST /api/v1/ai-customer/test-chat
{"message":"Show my coupons"}
# → code: 10000 ✅
# → 返回真实优惠券数据
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

### 写操作安全确认

`claimCoupon` 和 `redeemCouponCode` 都是写操作，通过 System Prompt 的硬规则要求 Agent 在执行前和用户确认。

### 错误处理

- 工具内 try-catch 包裹，失败返回 `toolFailure()` 给 LLM
- hardRules 禁止 LLM 重试相同参数的失败调用
- Agent 级别 fallback：如果 `runAgentLoop` 返回 error，输出友好的错误消息

### Tags 系统

所有 Coupon 工具都有 `tags: ['coupon']`，确保 `couponAgent` 的 LLM 只看到 Coupon 相关的工具，避免 Tool 选择错误。

---

## 🔜 下一步预告

在 [09-UserAddressAgent与Tools.md](09-UserAddressAgent与Tools.md) 中，我们将实现第四个 ReAct Agent：
- **User+Address Agent** — 处理个人信息查询、地址列表、地址详情
- **3 个 User Tools**：`user_profile`、`address_list`、`address_detail`
- **AuthService 的 profile() 方法使用**
