# 37 — Prompt 架构分析与优化方案

## 1. 背景

在 Bug 1-5 + Plan B 实现过程中，我们发现了一个深层问题：**Agent 的 prompt 质量决定了 LLM 行为是否可靠**。

具体暴露的问题：
- couponAgent 的 prompt 没有强制 tool calling → LLM 用训练知识编造了优惠券数据
- INTENT_PROMPT 里的 JSON 示例与 LangChain parseFString 冲突 → 运行时崩溃
- 三个 Agent 的 prompt 结构不一致，userId 注入方式混用

对应学习路线第 5 步：Prompt 工程

## 2. 项目现有 6 个 prompt 清单

| 编号 | 名称 | 文件位置 | 用途 | 模板方式 |
|------|------|---------|------|---------|
| P1 | INTENT_PROMPT | intent-router.node.ts:52 | 意图分类 + 多领域检测 | ChatPromptTemplate |
| P2 | orderAgent system | order-agent.node.ts:55 | 订单查询 Agent 行为指令 | 模板字符串内联 |
| P3 | walletAgent system | wallet-agent.node.ts:65 | 钱包/KYC Agent 行为指令 | 模板字符串内联 |
| P4 | couponAgent system | coupon-agent.node.ts:46 | 优惠券 Agent 行为指令 | 模板字符串内联 |
| P5 | SYNTHESIZER_PROMPT | answer-synthesizer.node.ts:33 | 回答合成 | ChatPromptTemplate |
| P6 | GENERAL_CHAT_PROMPT | general-chat.node.ts:18 | 闲聊/通用对话 | ChatPromptTemplate |

## 3. 对照 5 条 Prompt 最佳实践的差距分析

### 3.1 精确的角色设定 + 具体的任务描述 + 明确的格式要求

书中说：精确的角色设定 + 具体的任务描述 + 明确的格式要求，是写好提示词的基本功

| Prompt | 角色设定 | 任务描述 | 格式要求 |
|--------|---------|---------|---------|
| P1 | ✅ classifier and task planner | ✅ 9 分类详细描述 | ✅ Output ONLY one word |
| P2 | ✅ order inquiry assistant | ⚠️ You can query 被动式 | ❌ 无 |
| P3 | ✅ wallet and KYC assistant | ✅ 两步提现流程详细 | ⚠️ 松散 |
| P4 | ✅ coupon inquiry assistant | ⚠️ You can help users with 被动式 | ❌ 无 |
| P5 | ✅ JoyMini CS AI | ✅ 条件处理逻辑 | ⚠️ 松散 |
| P6 | ✅ JoyMini CS AI | ⚠️ 模糊 | ❌ 无 |

**问题**：P2、P4 使用了**被动描述**（You can query、You can help users with），没有用**主动指令**告诉 LLM 必须做什么。对比 P3 walletAgent 用了 `## Withdrawal Rules (TWO-STEP process)` 的**主动指令式**，效果更好。

### 3.2 Few-shot：2~5 个示例

书中说：Few-shot：2~5 个示例比描述格式更有效，选最典型的输入输出配对

| Prompt | 示例数量 | 评价 |
|--------|---------|------|
| P1 | 10 multi + 9 single | ✅ 但数量偏多 |
| P2 | 0 | ❌ |
| P3 | 0 | ❌ |
| P4 | 0 | ❌ |
| P5 | 0 | ❌ |
| P6 | 0 | ❌ |

**这是 couponAgent 出问题的直接原因**：如果 P4 有个完整的 tool calling 示例，LLM 就知道必须走"思考→调工具→拿结果→回答"的流程，不会直接编造数据。

### 3.3 Chain of Thought：定义思考步骤

书中说：Chain of Thought：在 system 里定义思考步骤，引导模型先分析再给结论

所有 Agent prompt 都缺少显式的 CoT 步骤。

### 3.4 结构化输出：withStructuredOutput + Zod

书中说：结构化输出：生产项目里用 withStructuredOutput + Zod 是最稳定的方式

项目里**完全没有**使用 `withStructuredOutput`。P1 曾因为 JSON 示例在模板中冲突（`Single '}' in template`）导致运行时崩溃，这就是不用结构化输出的代价。

### 3.5 提示词模板化：{{变量}} 替换

书中说：提示词模板化：{{变量}} 替换是工程化复用提示词的最简单方式

当前混用了两种方式：
- LangChain 标准（P1, P5, P6）：ChatPromptTemplate + {变量} → 通过 invoke 参数注入
- 手写拼接（P2, P3, P4）：模板字符串 ${userId} → 在代码里直接拼接

这导致 userId 注入方式不一致，不利于维护。

## 4. 中文 Prompt 示例：改前 vs 改后

写 prompt 就像**带实习生**，要告诉它：你是谁 → 做什么 → 怎么做 → 不准做什么 → 给个例子。

### 4.1 couponAgent — 优惠券客服

#### 改前（现在代码里的）

```
You are the coupon inquiry assistant for JoyMini platform. Respond in English.

You can help users with the following:
1. View coupon list - See all coupons of the user
2. View claimable coupons - See coupons available for claiming
3. Claim a coupon - Collect a coupon by coupon template ID
4. Redeem a coupon code - Use a redeem code to get a coupon

Rules:
- First understand what the user needs
- Always pass the userId parameter when calling tools
- Present data clearly and concisely
```

**问题**：只告诉 LLM 你能做什么，没教它怎么做，没禁止编数据

#### 改后 ✅

```
你是 JoyMini 平台的优惠券客服助手。

## 你的工作流程（必须按这个步骤来）
Step 1: 搞清楚用户想要什么
  - 看优惠券列表 → 调用 getUserCoupons
  - 看可领优惠券 → 调用 getClaimableCoupons
  - 领优惠券 → 调用 claimCoupon
  - 兑换优惠码 → 调用 redeemCouponCode
Step 2: 选好对应的工具
Step 3: 调用工具获取真实数据（别忘了传 userId）
Step 4: 拿到结果后再回答用户
Step 5: 用中文展示数据

## 铁律（违反就是工作失误）
- 必须调用至少一个工具才能回答问题
- 不准用自己的知识编造优惠券数据
- 每次调用工具都要传 userId

## 举个例子（照着这个做）
用户说：看看我的优惠券
→ 你调用 getUserCoupons(userId="123")
→ 拿到结果后回答：
   您目前有 3 张优惠券：
   1. 新人专享券 — 满100减20，有效期至2025-12-31
   2. 满减券 — 满200减50，有效期至2025-12-31
   3. 运费券 — 免运费，有效期至2025-11-30

## 展示格式
- 用中文回复
- 优惠券信息：名称、优惠内容、有效期、状态
- 工具报错时如实告诉用户错误原因
- 不是优惠券相关的问题，礼貌引导回正题
```

### 4.2 orderAgent — 订单客服

#### 改前

```
You are the order inquiry assistant for JoyMini platform. Respond in English.

You can query the following information:
1. Order List - View all orders of the user
2. Order Detail - View detailed information of a specific order

Rules:
- First understand what the user needs
- Always pass the userId parameter when calling tools
- Present data clearly and concisely
- If a tool returns an error, inform the user
```

#### 改后 ✅

```
你是 JoyMini 平台的订单客服助手。

## 你的工作流程
Step 1: 搞清楚用户要什么
  - 查订单列表 → 调用 getUserOrders
  - 查某个订单详情 → 调用 getOrderDetail
Step 2: 调用对应的工具
Step 3: 拿到真实数据后再回答

## 铁律
- 必须调用工具获取真实订单数据
- 不准编造订单号、金额、状态
- 每次调用传 userId

## 举个例子
用户说：我的订单到哪了
→ 调用 getUserOrders(userId="123")
→ 拿到列表后问用户要查哪个订单
用户说：JOY20260630001
→ 调用 getOrderDetail(userId="123", orderId="JOY20260630001")
→ 回答：您的订单 JOY20260630001 已发货，预计明天送达
```

### 4.3 walletAgent — 钱包/取款客服

#### 改前

```
You are the wallet and KYC assistant for JoyMini platform. Respond in English.

You can query information AND process withdrawals:
1. Wallet Balance - Query cash balance...
2. Transaction History - View records...
3. KYC Status - Check verification status...
...
```

walletAgent 的 prompt 已经比另外两个详细（有两步提现流程），但同样缺少强制 tool calling + 禁止编数据的要求。

#### 改后 ✅

在现有 prompt 最前面加：

```
## 铁律
- 必须调用工具获取真实数据
- 不准编造余额、交易记录、KYC 状态
- 每一步都要拿到工具返回结果后才能进入下一步

## 你的工作流程
Step 1: 理解用户需求（查余额？查记录？查实名？提现？）
Step 2: 选择对应的工具
Step 3: 调用工具获取数据
Step 4: 用工具返回的真实数据回答用户
```

### 4.4 写 Prompt 的实习生口诀

| 维度 | 带实习生 | 写 prompt |
|------|---------|----------|
| 你是谁 | 告诉实习生岗位职责 | 你是 JoyMini 优惠券客服助手 |
| 做什么 | 告诉他要处理什么业务 | 4 项能力：看券/领券/兑换/看可领券 |
| 怎么做 | 教他具体步骤 | 5 步 CoT：理解→选工具→调用→等结果→回答 |
| 给例子 | 演示一个完整案例 | 用户说看优惠券→调 getUserCoupons→展示结果 |
| 不准做什么 | 规定红线 | 不准编数据，必须查数据库 |

## 5. 优化优先级

| 优先级 | 改进项 | 影响范围 | 工作量 | 预期效果 |
|--------|--------|---------|--------|---------|
| **P0** | 强制 tool calling 规则 + CoT | 3 个 Agent | 小 | 消除数据幻觉 |
| **P0** | 三个 Agent 加 few-shot 示例 | 3 个 Agent | 小 | 确保 tool call 流程 |
| **P1** | Prompt 与 node 分离 | 全部 6 个 prompt | 中 | 可维护性 |
| **P1** | INTENT_PROMPT 改用结构化输出 | 1 个 prompt | 中 | 消除 JSON 解析 bug |
| **P2** | 统一 userId 注入 | 3 个 Agent | 中 | 一致性 |

## 6. 参考

- 学习路线 Ch0.8 Prompt 工程基础
- docs/AI-joymini/ 系列文档
- Bug 1-5 + Plan B 测试暴露的 prompt 问题

## 7. 变更记录

| 日期 | 变更内容 |
|------|---------|
| 2026-06-30 | 创建，基于 Bug 1-5 + Plan B 测试暴露的 prompt 问题 |
