# JoyMini Nest Monorepo — 全项目 Spec Code 分析

> 基于 Spec Coding 方法论，借鉴极速购 `jisu-ai-customer` 的 LLM 架构思维，
> 对整个 JoyMini 电商平台进行模块化 AI 能力分析。

---

## 目录

1. [概述](#一概述)
2. [目标](#二目标)
3. [极速购 LLM 架构模式回顾](#三极速购-llm-架构模式回顾)
4. [全项目模块清单](#四全项目模块清单)
5. [各模块 AI 结合分析](#五各模块-ai-结合分析)
6. [LLM 功能模块映射](#六llm-功能模块映射)
7. [API 设计](#七api-设计)
8. [数据模型](#八数据模型)
9. [业务流程](#九业务流程)
10. [验收标准](#十验收标准)
11. [附录](#十一附录)

---

## 一、概述

### 1.1 项目现状

JoyMini 是一个菲律宾电商平台（社交电商/Social Commerce），技术栈为：

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端 API | NestJS + Prisma + PostgreSQL | 统一后端，分 Client 和 Admin 两组模块 |
| 客户端前端 | Next.js `frontend-blog` | 面向终端消费者（文章、商品浏览、登录） |
| 管理后台 | Next.js `admin-next` | 面向运营管理员（订单、财务、客服、KYC 等） |
| IM 即时通讯 | NestJS ChatService + WebSocket/EventEmitter2 | 内置 IM 系统支持私聊、群聊、客服 |
| AI 基础设施 | NestJS AiService | 多 Provider 自动降级、熔断、限流 |
| 共享包 | `packages/shared` | 枚举、类型、工具函数 |
| UI 组件 | `packages/ui` | shadcn/ui 组件库 |

### 1.2 什么是 Spec Code 分析

本节运用 Spec Coding 方法论的"反向归纳"思路——先扫描全部代码模块，再以 **LLM 优先** 的视角重新审视每个模块，找出可以被 AI 赋能的业务场景。

> 参考: [`study/LLM/spec-coding/16-incremental-sdd-development.md`](study/LLM/spec-coding/16-incremental-sdd-development.md)

### 1.3 极速购的启发

极速购 [`study/LLM/jisu-ai-customer/`](study/LLM/jisu-ai-customer/) 是一个完整的大模型应用教学项目，包含了 AI 智能客服的 **7 个核心模式**。这 7 个模式将直接指导我们对 JoyMini 每个模块的 AI 改造。

---

## 二、目标

1. **全面盘点** JoyMini 所有业务模块（Client 15 个 + Admin 22 个 + Common 10+ 个）
2. **LLM 映射**：将每个模块映射到极速购的 LLM 架构模式
3. **优先级排序**：按业务价值 + 实现难度确定实施顺序
4. **统一架构**：所有 AI 功能共享 AiService + StateGraph + SSE 基础设施
5. **渐进式落地**：不一次改完，分 4 个 Phase 逐步交付

---

## 三、极速购 LLM 架构模式回顾

来自 [`study/LLM/jisu-ai-customer/spec-analysis.md`](study/LLM/jisu-ai-customer/spec-analysis.md)

### 7 个核心 LLM 模式

```
┌────────────────────────────────────────────────────────┐
│                    7 个 LLM 核心模式                       │
├────────────────────────────────────────────────────────┤
│                                                        │
│  1. 意图路由 IntentRouter   LLM 分类用户意图               │
│      └─ order / knowledge / general                    │
│                                                        │
│  2. ReAct Agent             带工具调用的自主 Agent         │
│      └─ 3 tools: getOrderInfo / getLogistics / getUserOrders│
│                                                        │
│  3. RAG 检索增强生成         知识库问答                    │
│      └─ pgvector → Retriever → Prompt → LLM             │
│                                                        │
│  4. LCEL Chain              LangChain 可组合管道         │
│      └─ PromptTemplate | model | outputParser           │
│                                                        │
│  5. StateGraph              有状态的多步工作流            │
│      └─ 5 nodes: intentRouter → orderAgent/ragNode/generalChat → answerSynthesizer │
│                                                        │
│  6. Tool Calling            结构化工具定义与调用           │
│      └─ Zod schema → tool() → bindTools → invoke        │
│                                                        │
│  7. SSE Streaming           实时流式响应                  │
│      └─ 7 events: node / step / steps / answer / sources / done / error │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 极速购的 StateGraph 结构（直接复用）

```
                    ┌──────────────┐
                    │  userInput   │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │ intentRouter │ ← LLM 分类
                    └──────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
    ┌─────────────┐ ┌───────────┐ ┌──────────────┐
    │ orderAgent  │ │  ragNode  │ │ generalChat  │
    │ (ReAct)     │ │  (RAG)    │ │ (LCEL Chain) │
    └──────┬──────┘ └─────┬─────┘ └──────┬───────┘
           │              │              │
           └──────────────┴──────────────┘
                              ▼
                    ┌──────────────────┐
                    │ answerSynthesizer│
                    └────────┬─────────┘
                             ▼
                    ┌──────────────────┐
                    │   finalAnswer    │
                    └──────────────────┘
```

---

## 四、全项目模块清单

### 4.1 Client 端模块（面向终端用户）

| # | 模块 | 路径 | 核心功能 | AI 潜力 |
|---|------|------|---------|---------|
| C-01 | Auth | [`client/auth/`](apps/api/src/client/auth/) | 登录注册 OAuth | ⭐ 客服身份识别基础 |
| C-02 | Orders | [`client/orders/`](apps/api/src/client/orders/) | 下单、查订单、退款 | ⭐⭐⭐ AI 订单助手 |
| C-03 | Wallet | [`client/wallet/`](apps/api/src/client/wallet/) | 充值、提现、转账 | ⭐⭐ AI 财务助手 |
| C-04 | Treasure | [`client/treasure/`](apps/api/src/client/treasure/) | 商品浏览 | ⭐⭐ AI 商品推荐 |
| C-05 | Coupon | [`client/coupon/`](apps/api/src/client/coupon/) | 领券、用券 | ⭐ AI 优惠建议 |
| C-06 | KYC | [`client/kyc/`](apps/api/src/client/kyc/) | 身份认证 | ⭐ AI 材料审核辅助 |
| C-07 | Flash Sale | [`client/flash-sale/`](apps/api/src/client/flash-sale/) | 秒杀 | ⭐ AI 秒杀提醒 |
| C-08 | Lucky Draw | [`client/lucky-draw/`](apps/api/src/client/lucky-draw/) | 抽奖 | ⭐ AI 抽奖规则说明 |
| C-09 | Address | [`client/address/`](apps/api/src/client/address/) | 地址管理 | ⭐ 地址填写辅助 |
| C-10 | Notification | [`client/notification/`](apps/api/src/client/notification/) | 推送管理 | ⭐ AI 个性化推送 |
| C-11 | Banners | [`client/banners/`](apps/api/src/client/banners/) | 首页横幅 | - |
| C-12 | Category | [`client/category/`](apps/api/src/client/category/) | 商品分类 | ⭐ AI 分类导航 |
| C-13 | Sections | [`client/sections/`](apps/api/src/client/sections/) | 首页板块 | - |
| C-14 | System Config | [`client/system-config/`](apps/api/src/client/system-config/) | 系统配置 | - |
| C-15 | Group | [`client/group/`](apps/api/src/client/group/) | 拼团管理 | ⭐ 拼团状态查询 |

### 4.2 Admin 端模块（面向运营管理）

| # | 模块 | 路径 | 核心功能 | AI 潜力 |
|---|------|------|---------|---------|
| A-01 | Auth | [`admin/auth/`](apps/api/src/admin/auth/) | 管理员登录 | - |
| A-02 | Order | [`admin/order/`](apps/api/src/admin/order/) | 订单管理/退款审核 | ⭐⭐⭐ AI 订单异常检测 |
| A-03 | Finance | [`admin/finance/`](apps/api/src/admin/finance/) | 财务对账/提现审核 | ⭐⭐⭐ AI 风控+审核 |
| A-04 | KYC | [`admin/kyc/`](apps/api/src/admin/kyc/) | KYC 审核 | ⭐⭐⭐ AI 材料初审 |
| A-05 | Chat | [`admin/chat/`](apps/api/src/admin/chat/) | 人工客服 IM | ⭐⭐⭐ AI 辅助回复 |
| A-06 | Support Channel | [`admin/support-channel/`](apps/api/src/admin/support-channel/) | 客服渠道管理 | ⭐⭐⭐ AI 客服后端 |
| A-07 | Client User | [`admin/client-user/`](apps/api/src/admin/client-user/) | 用户管理 | ⭐ AI 用户画像 |
| A-08 | Stats | [`admin/stats/`](apps/api/src/admin/stats/) | 数据统计 | ⭐⭐ AI 报表生成 |
| A-09 | Treasure | [`admin/treasure/`](apps/api/src/admin/treasure/) | 商品管理 | - |
| A-10 | Banner | [`admin/banner/`](apps/api/src/admin/banner/) | 横幅管理 | - |
| A-11 | Coupon | [`admin/coupon/`](apps/api/src/admin/coupon/) | 优惠券管理 | - |
| A-12 | Category | [`admin/category/`](apps/api/src/admin/category/) | 分类管理 | - |
| A-13 | Ads | [`admin/ads/`](apps/api/src/admin/ads/) | 广告管理 | - |
| A-14 | Flash Sale | [`admin/flash-sale/`](apps/api/src/admin/flash-sale/) | 秒杀配置 | - |
| A-15 | Lucky Draw | [`admin/lucky-draw/`](apps/api/src/admin/lucky-draw/) | 抽奖活动 | - |
| A-16 | Notification | [`admin/notification/`](apps/api/src/admin/notification/) | 推送管理 | ⭐ AI 推送文案 |
| A-17 | Group | [`admin/group/`](apps/api/src/admin/group/) | 拼团管理 | - |
| A-18 | Act Section | [`admin/act-section/`](apps/api/src/admin/act-section/) | 活动板块 | - |
| A-19 | Login Log | [`admin/login-log/`](apps/api/src/admin/login-log/) | 登录日志 | ⭐ 异常登录 AI 检测 |
| A-20 | Operation Log | [`admin/operation-log/`](apps/api/src/admin/operation-log/) | 操作日志 | - |
| A-21 | System Config | [`admin/system-config/`](apps/api/src/admin/system-config/) | 系统配置 | - |
| A-22 | Register App | [`admin/register-application/`](apps/api/src/admin/register-application/) | 管理员注册审批 | - |

### 4.3 Common 基础设施模块

| # | 模块 | 路径 | 功能 |
|---|------|------|------|
| M-01 | AiService | [`common/ai/ai.service.ts`](apps/api/src/common/ai/ai.service.ts) | 多 Provider LLM、熔断、限流 |
| M-02 | ChatService | [`common/chat/chat.service.ts`](apps/api/src/common/chat/chat.service.ts) | IM 即时通讯 |
| M-03 | Events | [`common/events/`](apps/api/src/common/events/) | WebSocket + EventEmitter2 |
| M-04 | Prisma | [`common/prisma/`](apps/api/src/common/prisma/) | 数据库连接 |
| M-05 | Redis | [`common/redis/`](apps/api/src/common/redis/) | 缓存 + 分布式锁 |
| M-06 | Upload | [`common/upload/`](apps/api/src/common/upload/) | 文件上传 |
| M-07 | Media | [`common/media/`](apps/api/src/common/media/) | 媒体处理 |

---

## 五、各模块 AI 结合分析

### 5.1 高优先级 (P0) — 直接复用极速购思路

#### P0-1: AI 订单助手 (Client F-01)

**关联模块**: [`client/orders/`](apps/api/src/client/orders/), [`admin/order/`](apps/api/src/admin/order/)

**极速购模式映射**:

| 极速购组件 | JoyMini 对应 | 说明 |
|-----------|-------------|------|
| `getOrderInfoTool` | 查 Prisma `Order` 表 | 按 orderNo 或 userId 查订单详情 |
| `getLogisticsTool` | 查 `Order.trackingNo` + `Order.logisticsCo` | 物流公司 + 单号 |
| `getUserOrdersTool` | `Order.findMany({ userId })` | 用户订单列表 |
| `orderAgent` → `orderAgentNode` | 相同的 ReAct Agent 结构 | 只需替换数据源为 Prisma |
| Mock Data [`mock.js:3-37`](study/LLM/jisu-ai-customer/server/src/data/mock.js) | 真实 `Order` 表字段 | 丰富度远超 mock 数据 |

**关键 Prisma 数据字段** 来自 [`Order` 模型](apps/api/prisma/schema.prisma:738)：

```typescript
Order {
  orderId, orderNo, userId
  orderStatus       // 1待支付 2已支付 3取消 4退款
  payStatus         // 0未支付 1已支付
  refundStatus
  shippingStatus    // 0待发货 1已发货 2已签收
  trackingNo, logisticsCo
  finalAmount, unitPrice, buyQuantity
  shippingAddress   // JSON
  refundReason
}
```

---

#### P0-2: AI 知识库 / RAG (Client F-02)

**极速购模式映射**:

| 极速购组件 | JoyMini 对应 | 说明 |
|-----------|-------------|------|
| `pgvector` 向量库 | 新增 `KnowledgeEmbedding` 表 | 复用 pgvector 扩展 |
| 知识文档 | 新增 `KnowledgeDocument` 表 + Admin CRUD | 管理员维护 FAQ/政策 |
| `ragChain` | 相同 LCEL 管道结构 | 替换 embedding 模型为 AiService |
| `ragChainWithSources` | 相同 + 来源展示 | 前端显示来源标签 |

**知识库内容建议**:
- 平台政策 FAQ（退款流程、发货规则）
- 商品常见问题
- 优惠券使用说明
- 充值提现指南

---

#### P0-3: AI 智能客服入口 (Client F-03)

**位置**: [`frontend-blog`](apps/frontend-blog/) 新增 `/ai-assistant` 页面

**极速购前端模式映射**:

| 极速购 Vue 视图 | JoyMini React 实现 | 关键组件 |
|----------------|-------------------|---------|
| [`ChatView.vue`](study/LLM/jisu-ai-customer/client/src/views/ChatView.vue) | `AiChatView.tsx` | shadcn Card + Avatar + Button |
| [`AgentView.vue`](study/LLM/jisu-ai-customer/client/src/views/AgentView.vue) | `AiAgentView.tsx` | Step cards + 动画 |
| [`GraphView.vue`](study/LLM/jisu-ai-customer/client/src/views/GraphView.vue) | `AiGraphTrace.tsx` | 折叠面板 |
| [`RagView.vue`](study/LLM/jisu-ai-customer/client/src/views/RagView.vue) | `AiRagSources.tsx` | 来源 Badge 标签 |

**SSE Composable 映射**:

| 极速购 composable | React 替代 |
|------------------|-----------|
| [`useChat.js`](study/LLM/jisu-ai-customer/client/src/composables/useChat.js) | `useAiChat.ts` (ahooks useRequest + EventSource) |
| [`useAgent.js`](study/LLM/jisu-ai-customer/client/src/composables/useAgent.js) | `useAiAgent.ts` |
| [`useGraph.js`](study/LLM/jisu-ai-customer/client/src/composables/useGraph.js) | `useAiGraph.ts` |
| [`useRag.js`](study/LLM/jisu-ai-customer/client/src/composables/useRag.js) | `useAiRag.ts` |

---

### 5.2 中优先级 (P1) — 扩展 AI 能力

#### P1-1: AI 财务助手 (Client Wallet)

**关联**: [`client/wallet/`](apps/api/src/client/wallet/), [`admin/finance/`](apps/api/src/admin/finance/)

**LLM 模式**: RAG + Intent Routing

**能力**:
- "我上周充了多少钱？" → 查 `RechargeOrder` → 自然语言回答
- "提现多久到账？" → RAG 知识库 → 政策说明
- "我的余额是多少？" → 查 `UserWallet` → 直接回答

**新增 Tool**:
```typescript
getBalanceTool(userId)      // UserWallet.balance
getRechargeHistoryTool(userId, dateRange)
getWithdrawStatusTool(withdrawId)
```

#### P1-2: AI KYC 辅助审核 (Admin)

**关联**: [`admin/kyc/`](apps/api/src/admin/kyc/), [`client/kyc/`](apps/api/src/client/kyc/)

**LLM 模式**: Vision LLM + RAG

**能力**:
- AI 预审 KYC 材料（身份证图片 OCR 辅助）
- 标记可疑材料（AI 辅助判断）
- 自动生成审核意见草稿

#### P1-3: AI 辅助回复 (Admin Chat)

**关联**: [`admin/chat/`](apps/api/src/admin/chat/)

**LLM 模式**: RAG + LCEL Chain

**能力**:
- 客服输入"帮我查一下订单 xxx" → AI 自动查单填充回复
- AI 建议回复（基于历史对话 + 知识库）

---

### 5.3 低优先级 (P2) — 锦上添花

| 模块 | AI 能力 | 模式 |
|------|---------|------|
| 个性化推送文案 | AI 生成推送标题 | LCEL Chain |
| 异常登录检测 | AI 分析登录模式 | Intent Router |
| 商品推荐 | AI 基于浏览历史推荐 | RAG |
| 报表自然语言查询 | "上个月收入多少" → SQL | Intent Router + Tool |

---

## 六、LLM 功能模块映射

### 6.1 架构总图

```
┌──────────────────────────────────────────────────────────┐
│                    Frontend 层                            │
│                                                          │
│  frontend-blog (Next.js)           admin-next (Next.js)   │
│  ┌─────────────────────┐          ┌──────────────────┐   │
│  │ /ai-assistant       │          │ /customer-service │   │
│  │ AI 智能客服对话界面  │          │ AI 辅助回复       │   │
│  └─────────┬───────────┘          └────────┬─────────┘   │
│            │ SSE stream                     │ SSE stream   │
└────────────┼────────────────────────────────┼─────────────┘
             │                                │
┌────────────┼────────────────────────────────┼─────────────┐
│            ▼                                ▼             │
│   apps/api (NestJS)                    API 层              │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │            AI Assistant Module                       │ │
│  │                                                     │ │
│  │  ┌─────────────┐   ┌──────────────────────────┐     │ │
│  │  │ Controller  │──→│ AiCustomerService        │     │ │
│  │  │ /ai/stream  │   │  ├─ intentRouter()       │     │ │
│  │  └─────────────┘   │  ├─ orderAgentNode()     │     │ │
│  │                    │  ├─ ragNode()             │     │ │
│  │                    │  ├─ generalChatNode()     │     │ │
│  │                    │  └─ answerSynthesizer()   │     │ │
│  │                    └──────────┬───────────────┘     │ │
│  │                               │                     │ │
│  │  ┌────────────────────────────┼──────────────────┐  │ │
│  │  │         Tools              │                  │  │ │
│  │  │  ┌──────────────────┐      │                  │  │ │
│  │  │  │ Order Tools      │      ▼                  │  │ │
│  │  │  │ └─ Prisma Order  │  AiService              │  │ │
│  │  │  │ └─ Gemini/Groq/DeepSeek                    │  │ │
│  │  │  │ Wallet Tools     │  └─ Circuit Breaker     │  │ │
│  │  │  │ RAG Tools        │  └─ Rate Limiter        │  │ │
│  │  │  └──────────────────┘  └─ Auto Degradation    │  │ │
│  │  └───────────────────────────────────────────────┘  │ │
│  │                                                     │ │
│  │  Prisma ─── Order / User / ChatMessage /             │ │
│  │             KnowledgeDocument / KnowledgeEmbedding   │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 6.2 极速购模式 → JoyMini 映射表

| 极速购组件 | 文件 | JoyMini 映射 | 改动量 |
|-----------|------|-------------|--------|
| `deepseek.js` 模型 | [`server/src/models/deepseek.js`](study/LLM/jisu-ai-customer/server/src/models/deepseek.js) | `AiService.generateText()` | 替换外部调用 |
| `embedding.js` | [`server/src/models/embedding.js`](study/LLM/jisu-ai-customer/server/src/models/embedding.js) | `AiService.generateEmbedding()` | 替换外部调用 |
| `customer-service.js` 提示词 | [`server/src/prompts/customer-service.js`](study/LLM/jisu-ai-customer/server/src/prompts/customer-service.js) | 新建 `prompts/` 目录 | 改写为符合 JoyMini 业务 |
| `order-tools.js` | [`server/src/tools/order-tools.js`](study/LLM/jisu-ai-customer/server/src/tools/order-tools.js) | 新建 `tools/` 目录 | mock→Prisma 替换 |
| `customer-agent.js` | [`server/src/agents/customer-agent.js`](study/LLM/jisu-ai-customer/server/src/agents/customer-agent.js) | `AiCustomerAgentService` | JS→TS + NestJS |
| `basic-chat.js` | [`server/src/chains/basic-chat.js`](study/LLM/jisu-ai-customer/server/src/chains/basic-chat.js) | `lcml/` 目录 | JS→TS + NestJS |
| `rag-chain.js` | [`server/src/chains/rag-chain.js`](study/LLM/jisu-ai-customer/server/src/chains/rag-chain.js) | `rag/` 目录 | pgvector 复用 |
| `customer-graph.js` | [`server/src/graphs/customer-graph.js`](study/LLM/jisu-ai-customer/server/src/graphs/customer-graph.js) | `graph/` 目录 | 结构完全复用 |
| `intent-router.js` | [`server/src/graphs/nodes/intent-router.js`](study/LLM/jisu-ai-customer/server/src/graphs/nodes/intent-router.js) | `graph/nodes/` | 意图微调 |
| `order-agent.js` | [`server/src/graphs/nodes/order-agent.js`](study/LLM/jisu-ai-customer/server/src/graphs/nodes/order-agent.js) | `graph/nodes/` | 数据源替换 |
| `rag-node.js` | [`server/src/graphs/nodes/rag-node.js`](study/LLM/jisu-ai-customer/server/src/graphs/nodes/rag-node.js) | `graph/nodes/` | 结构复用 |
| `general-chat.js` | [`server/src/graphs/nodes/general-chat.js`](study/LLM/jisu-ai-customer/server/src/graphs/nodes/general-chat.js) | `graph/nodes/` | 提示词改写 |
| `answer-synthesizer.js` | [`server/src/graphs/nodes/answer-synthesizer.js`](study/LLM/jisu-ai-customer/server/src/graphs/nodes/answer-synthesizer.js) | `graph/nodes/` | 结构复用 |
| SSE 路由 `/graph/stream` | [`server/src/routes/graph.js`](study/LLM/jisu-ai-customer/server/src/routes/graph.js) | `AiCustomerController` | Express→NestJS |

### 6.3 Intent Router 扩展意图

极速购只有 3 个意图，JoyMini 扩展为 6 个：

```typescript
type CustomerIntent =
  | 'order'       // 订单查询
  | 'logistics'   // 物流查询
  | 'wallet'      // 钱包/充值/提现
  | 'knowledge'   // 知识库 FAQ
  | 'coupon'      // 优惠券
  | 'general'     // 闲聊
```

### 6.4 Tools 扩展

极速购 3 个工具 → JoyMini 7 个工具：

```typescript
// 订单类
getOrderInfoTool(orderNo, userId)       // Order 表查询
getLogisticsTool(trackingNo)            // 物流状态
getUserOrdersTool(userId, status?, page?) // 订单列表

// 钱包类
getBalanceTool(userId)                  // UserWallet.balance
getRechargeHistoryTool(userId, page?)   // RechargeOrder 表

// 优惠券类
getUserCouponsTool(userId)              // UserCoupon 表

// 知识库
searchKnowledgeTool(query)              // pgvector 检索
```

---

## 七、API 设计

### 7.1 客户端 API（面向终端用户）

> 放在 `apps/api/src/client/ai/` 目录

```
POST /v1/client/ai/chat         非流式对话
POST /v1/client/ai/stream       SSE 流式对话
POST /v1/client/ai/order        Agent: 指定订单查询
POST /v1/client/ai/rag/query    RAG: 知识库问答
GET  /v1/client/ai/history      对话历史
```

### 7.2 SSE 事件格式

复用极速购 7 种事件类型，统一为 JoyMini 格式：

```
event: node       // 节点执行通知
data: {"node":"intentRouter","status":"running"}

event: steps      // Agent 工具调用步骤
data: {"steps":[{"tool":"getOrderInfoTool","args":{...}}]}

event: answer     // 最终回答 (流式)
data: "您的订单 ORD-001 当前状态是..."

event: sources    // RAG 来源
data: {"sources":[{"title":"退款政策","score":0.95}]}

event: done       // 完成
data: {}


event: error      // 错误
data: {"message":"查询失败"}
```

### 7.3 管理端 API（面向客服辅助）

```
POST /v1/admin/ai/suggest-reply    AI 建议回复
POST /v1/admin/ai/order-inquiry    AI 订单速查
POST /v1/admin/ai/translate        实时翻译
```

---

## 八、数据模型

### 8.1 新增 Prisma 模型

```prisma
// 知识库文档
model KnowledgeDocument {
  id          String   @id @default(cuid())
  title       String   @db.VarChar(200)
  content     String
  category    String?  @db.VarChar(50)   // FAQ / POLICY / PRODUCT
  tags        String[]                    // 标签
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  createdBy   String?  @db.VarChar(32)   // AdminUser.id

  embeddings  KnowledgeEmbedding[]

  @@index([category])
  @@index([isActive])
  @@map("knowledge_documents")
}

// 向量嵌入
model KnowledgeEmbedding {
  id           String   @id @default(cuid())
  documentId   String
  document     KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  chunkIndex   Int               // 分块序号
  chunkContent String            // 分块文本
  embedding    Unsupported("vector(1536)") // pgvector
  createdAt    DateTime @default(now())

  @@index([documentId])
  @@map("knowledge_embeddings")
}
```

### 8.2 复用已有模型

| 模型 | 路径 | 用途 |
|------|------|------|
| [`User`](apps/api/prisma/schema.prisma:12) | User | 用户身份、VIP 等级 |
| [`Order`](apps/api/prisma/schema.prisma:738) | Order | 订单查询、物流、退款 |
| [`ChatMessage`](apps/api/prisma/schema.prisma:1264) | ChatMessage | 对话历史持久化 |
| [`Conversation`](apps/api/prisma/schema.prisma:1186) | Conversation | AI 会话管理（type: SUPPORT） |
| [`UserWallet`](apps/api/prisma/schema.prisma:52) | wallet | 余额查询 |
| [`RechargeOrder`](apps/api/prisma/schema.prisma:874) | RechargeOrder | 充值记录 |
| [`UserCoupon`](apps/api/prisma/schema.prisma:847) | UserCoupon | 优惠券查询 |

### 8.3 对话历史存储方案

利用现有 [`ChatMessage`](apps/api/prisma/schema.prisma:1264) + [`Conversation`](apps/api/prisma/schema.prisma:1186) 模型：

```typescript
// AI 会话：type = SUPPORT, botUserId = AI Bot 的 UserId
const conversation = await prisma.conversation.create({
  data: {
    type: 'SUPPORT',
    // 关联 SupportChannel.botUserId
    businessId: `ai:${userId}`,
    members: {
      create: [
        { userId: userId, role: 'MEMBER' },         // 用户
        { userId: botUserId, role: 'MEMBER' },       // AI Bot
      ]
    }
  }
})

// 消息存储：与现有 IM 统一
await prisma.chatMessage.create({
  data: {
    conversationId: conversation.id,
    senderId: userId,       // 用户发 / botUserId AI 发
    type: 0,                // Text
    content: messageText,
    seqId: nextSeqId,
  }
})
```

---

## 九、业务流程

### 9.1 客户发起 AI 对话 — 完整流程

```
┌─────────────────────────────────────────────────────────┐
│                  用户输入消息                              │
│  "我的订单 ORD-001 到哪了？"                              │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  1. SSE 连接 /v1/client/ai/stream                        │
│     event: node {"node":"intentRouter","status":"running"}│
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  2. Intent Router (LLM 分类)                             │
│     Prompt: 识别用户意图                                  │
│     输入: "我的订单 ORD-001 到哪了？"                      │
│     输出: { intent: "order" }                             │
│     event: node {"node":"intentRouter","status":"done"}   │
└─────────────────────┬───────────────────────────────────┘
                      │ intent === "order"
                      ▼
┌─────────────────────────────────────────────────────────┐
│  3. Order Agent (ReAct)                                 │
│     event: node {"node":"orderAgent","status":"running"} │
│                                                          │
│     Thought: 用户查询订单，需要调用 getOrderInfoTool       │
│     Action: getOrderInfoTool({ orderNo: "ORD-001" })     │
│     event: steps [{"tool":"getOrderInfoTool",...}]        │
│                                                          │
│     Observation: { orderStatus: 2, shippingStatus: 1,    │
│                    trackingNo: "SF1234567890", ...}       │
│                                                          │
│     Thought: 订单已发货，有物流单号，查物流                │
│     Action: getLogisticsTool({ trackingNo: "SF123..." }) │
│     event: steps [{"tool":"getLogisticsTool",...}]        │
│                                                          │
│     Observation: [{ status: "运输中", location: "上海" }] │
│     Final Answer: 已获取完整信息                          │
│     event: node {"node":"orderAgent","status":"done"}     │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  4. Answer Synthesizer                                   │
│     event: node {"node":"answerSynthesizer","status":"running"}│
│                                                          │
│     输入: orderResult + userInput                        │
│     输出: "您的订单 ORD-001 已由顺丰发出，                  │
│            快递单号 SF1234567890，当前运输中，               │
│            预计明天送达。😊"                              │
│                                                          │
│     event: answer "您的订单 ORD-001" (流式逐字推送)       │
│     event: answer " 已由顺丰发出..."                       │
│     event: done                                           │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  5. 前端渲染 (frontend-blog /ai-assistant)               │
│     - 显示消息气泡                                       │
│     - 显示工具调用步骤卡片 (可折叠)                        │
│     - 显示处理链路 GraphTrace (可折叠)                     │
│     - 消息持久化到 ChatMessage 表                          │
└─────────────────────────────────────────────────────────┘
```

### 9.2 知识库问答流程

```
用户: "怎么申请退款？"

1. Intent Router → "knowledge"
2. RAG Node:
   a. 用户问题 → AiService.generateEmbedding() → vector(1536)
   b. pgvector 相似度搜索 (k=4) → 返回匹配文档块
   c. context + question → RAG Prompt → LLM
   d. event: sources [{"title":"退款流程","score":0.92}, ...]
   e. event: answer "申请退款需要..."
3. Answer Synthesizer → 格式化最终回答
```

### 9.3 普通聊天流程

```
用户: "你好，今天心情不错！"

1. Intent Router → "general"
2. General Chat Node:
   a. 取最近 8 条聊天记录作为上下文
   b. ChatPromptTemplate(messages_history + user_input)
   c. LLM (temperature=0.7) → 流式回答
   d. event: answer "今天天气确实不错！有什么我能帮您的吗？😊"
3. Answer Synthesizer → 直接透传
```

---

## 十、验收标准

### 10.1 Phase 1 — 核心后端 (P0)

| # | 标准 | 验证方式 |
|---|------|---------|
| AC-01 | AiCustomerModule 可注册到 ClientModule | `yarn workspace @lucky/api start` 不报错 |
| AC-02 | SSE 端点 `/v1/client/ai/stream` 返回 200 | curl 测试 |
| AC-03 | Intent Router 正确分类 `order/knowledge/general` | 测试 10 条不同输入 |
| AC-04 | Order Agent 从 Prisma 查询真实订单 | 与现有 OrderService 结果一致 |
| AC-05 | RAG Node 从 pgvector 检索知识 | 返回非空结果 |
| AC-06 | 7 种 SSE 事件全部推送 | 前端 EventSource 接收 |
| AC-07 | AiService 容灾：主 Provider 失败自动切换 | 模拟 DeepSeek 不可用 |

### 10.2 Phase 2 — 客户端前端 (P0)

| # | 标准 | 验证方式 |
|---|------|---------|
| AC-08 | `/ai-assistant` 页面可访问 | 浏览器打开 |
| AC-09 | 消息输入 + Enter 发送 | 交互测试 |
| AC-10 | SSE 流式逐字显示 | 视觉检查 |
| AC-11 | 工具调用步骤卡片显示 | 查询订单时可见 |
| AC-12 | RAG 来源标签显示 | 知识问答时可见 |
| AC-13 | 对话历史持久化、刷新不丢失 | 刷新页面 → 历史恢复 |
| AC-14 | 移动端适配 | 手机浏览器测试 |
| AC-15 | i18n 支持（zh/en） | 切换语言测试 |

### 10.3 Phase 3 — 管理端 (P1)

| # | 标准 | 验证方式 |
|---|------|---------|
| AC-16 | 管理员可管理知识库文档 | CRUD 测试 |
| AC-17 | 管理员可查看 AI 对话日志 | 列表展示 |
| AC-18 | AI 辅助回复可用 | 人工客服界面测试 |

---

## 十一、附录

### 11.1 实施路线图

```
Phase 1: 核心后端 (P0)
├── apps/api/src/client/ai/           ← 新建 AI 模块
│   ├── ai-customer.module.ts
│   ├── ai-customer.controller.ts     ← SSE 端点
│   ├── ai-customer.service.ts        ← 编排
│   ├── graph/
│   │   ├── customer-graph.ts         ← StateGraph (5 nodes)
│   │   └── nodes/                    ← 5 nodes
│   ├── tools/                        ← 7 tools
│   ├── agents/customer-agent.ts      ← ReAct Agent
│   ├── chains/                       ← LCEL chains
│   └── prompts/                      ← 提示词
├── apps/api/prisma/                  ← KnowledgeDocument + KnowledgeEmbedding
└── apps/api/src/scripts/ingest.ts    ← 知识库导入脚本

Phase 2: 客户端前端 (P0)
├── apps/frontend-blog/src/app/[locale]/ai-assistant/
│   ├── page.tsx                      ← 页面入口
│   └── AiAssistantClientView.tsx     ← 客户端组件
├── apps/frontend-blog/src/components/ai/
│   ├── AiChatMessage.tsx             ← 消息气泡
│   ├── AiToolSteps.tsx               ← 工具步骤卡片
│   ├── AiGraphTrace.tsx              ← 处理链路折叠
│   ├── AiRagSources.tsx              ← 来源标签
│   └── AiWelcomeScreen.tsx           ← 欢迎页/快捷问题
├── apps/frontend-blog/src/hooks/     ← SSE hooks
│   ├── useAiChat.ts
│   └── useAiStream.ts
└── apps/frontend-blog/src/lib/api/   ← API 调用
    └── aiApi.ts

Phase 3: 管理端知识库管理 (P1)
├── apps/api/src/admin/knowledge/     ← CRUD API
└── apps/admin-next/src/views/knowledge/  ← 管理页面

Phase 4: 扩展 AI 能力 (P1+P2)
├── 财务助手 (Wallet Tools)
├── KYC 辅助审核
├── Admin 辅助回复
└── 个性化推送
```

### 11.2 文件变更清单

**新增文件 (Backend): 20+**

| 文件 | 说明 |
|------|------|
| `apps/api/src/client/ai/ai-customer.module.ts` | AI 模块定义 |
| `apps/api/src/client/ai/ai-customer.controller.ts` | SSE 控制器 |
| `apps/api/src/client/ai/ai-customer.service.ts` | 业务编排 |
| `apps/api/src/client/ai/dto/ai-chat.dto.ts` | DTO |
| `apps/api/src/client/ai/graph/customer-graph.ts` | StateGraph |
| `apps/api/src/client/ai/graph/state.ts` | GraphState 定义 |
| `apps/api/src/client/ai/graph/nodes/intent-router.ts` | 意图路由 |
| `apps/api/src/client/ai/graph/nodes/order-agent.ts` | 订单 Agent |
| `apps/api/src/client/ai/graph/nodes/rag-node.ts` | RAG 节点 |
| `apps/api/src/client/ai/graph/nodes/general-chat.ts` | 通用聊天 |
| `apps/api/src/client/ai/graph/nodes/answer-synthesizer.ts` | 答案合成 |
| `apps/api/src/client/ai/agents/customer-agent.ts` | ReAct Agent |
| `apps/api/src/client/ai/tools/order-tools.ts` | 订单工具 |
| `apps/api/src/client/ai/tools/wallet-tools.ts` | 钱包工具 |
| `apps/api/src/client/ai/tools/coupon-tools.ts` | 优惠券工具 |
| `apps/api/src/client/ai/tools/knowledge-tools.ts` | 知识库工具 |
| `apps/api/src/client/ai/chains/basic-chat.ts` | 基础对话链 |
| `apps/api/src/client/ai/chains/rag-chain.ts` | RAG 链 |
| `apps/api/src/client/ai/prompts/customer-service.ts` | 系统提示词 |
| `apps/api/src/client/ai/prompts/intent-router.ts` | 意图路由提示词 |

**修改文件: 3**

| 文件 | 修改内容 |
|------|---------|
| `apps/api/src/client/client.module.ts` | 添加 `AiCustomerModule` |
| `apps/api/prisma/schema.prisma` | 添加 `KnowledgeDocument` + `KnowledgeEmbedding` |
| `apps/api/package.json` | 添加 `@langchain/core` 等依赖 |

**新增文件 (Frontend): 12+**

| 文件 | 说明 |
|------|------|
| `apps/frontend-blog/src/app/[locale]/ai-assistant/page.tsx` | 页面 |
| `apps/frontend-blog/src/app/[locale]/ai-assistant/AiAssistantClientView.tsx` | 客户端组件 |
| `apps/frontend-blog/src/components/ai/AiChatMessage.tsx` | 消息气泡 |
| `apps/frontend-blog/src/components/ai/AiToolSteps.tsx` | 工具步骤 |
| `apps/frontend-blog/src/components/ai/AiGraphTrace.tsx` | 链路追踪 |
| `apps/frontend-blog/src/components/ai/AiRagSources.tsx` | 来源标签 |
| `apps/frontend-blog/src/components/ai/AiWelcomeScreen.tsx` | 欢迎页 |
| `apps/frontend-blog/src/hooks/useAiChat.ts` | SSE hook |
| `apps/frontend-blog/src/hooks/useAiStream.ts` | 流式处理 |
| `apps/frontend-blog/src/lib/api/aiApi.ts` | API 调用 |

### 11.3 极速购 vs JoyMini 差异总结

| 维度 | 极速购（教学） | JoyMini（生产） |
|------|--------------|----------------|
| 框架 | Express.js | NestJS |
| 语言 | JavaScript | TypeScript |
| 数据源 | Mock 3 条订单 | Prisma + PostgreSQL 真实数据 |
| 消息存储 | 无（前端 ref[]） | ChatMessage 表持久化 |
| AI Provider | 单一 DeepSeek | AiService 多 Provider |
| 容灾 | 无 | 熔断 + 限流 + 自动降级 |
| 认证 | 无 | JWT + OAuth + Roles |
| 前端 | Vue 3 + Vite | Next.js + Tailwind + shadcn |
| i18n | 无 | 多语言支持 |
| 部署 | npm run dev | Docker + CI/CD |
| 队列 | 无 | BullMQ + Redis |
| 缓存 | 无 | Redis Cache |

---

> **文档状态**: v1.0 初稿
> **下一步**: 用户确认后 → 按 Phase 1 开始实施
