# JoyMini AI 功能 × 专业术语映射表

> 目的：把 JoyMini 能做的业务功能，对应到 AI 面试/行业标准术语

## 一、当前已实现（7 项）

### A. 客户自助服务类（用户直接使用）

| # | 业务功能 | 用户怎么说 | AI 专业术语 | 后端实现 |
|---|---------|-----------|------------|---------|
| A1 | **自动翻译文章** | "帮我翻译这篇英文博客" | **Auto-Translation / Machine Translation** | [`AiService.translateText`](/apps/api/src/common/ai/ai.service.ts:656) + [`translateMarkdown`](/apps/api/src/common/ai/ai.service.ts:731) |
| A2 | **评论内容审核** | "发布评论自动审核" | **Content Moderation & Safety** | [`AiService.moderateComment`](/apps/api/src/common/ai/ai.service.ts:548) |
| A3 | **自动回复评论** | "有人评论了自动回复" | **Automated Response Generation** | [`AiService.generateAutoReply`](/apps/api/src/common/ai/ai.service.ts:620) |
| A4 | **KYC 证件识别** | "上传身份证自动识别" | **Multi-Modal / Vision / OCR** | [`AiService.generateContentFromImage`](/apps/api/src/common/ai/ai.service.ts:505) → KYC 模块 |

### B. AI 基础设施类（开发人员使用，用户无感知）

| # | 业务功能 | 做什么的 | AI 专业术语 | 后端实现 |
|---|---------|---------|------------|---------|
| B1 | **多模型自动切换** | Gemini 挂了自动换 DeepSeek | **Model Provider Abstraction / Auto-Failover** | [`AiService.getAvailableProviders`](/apps/api/src/common/ai/ai.service.ts:219) + 3 Provider 策略 |
| B2 | **接口熔断保护** | 连续失败 10 次自动停 5 分钟 | **Circuit Breaker Pattern** | [`AiService`](/apps/api/src/common/ai/ai.service.ts:63) `circuitBreaker` + `LIMITS.FAILURE_THRESHOLD` |
| B3 | **请求限流** | 每分钟最多 12 次请求 | **Rate Limiting / Throttling** | [`AiService`](/apps/api/src/common/ai/ai.service.ts:70) `LIMITS.RPM: 12` |
| B4 | **服务自动降级** | 负载高时从 FULL 降到 ESSENTIAL | **Service Degradation / Graceful Degradation** | [`AiServiceLevel`](/apps/api/src/common/ai/ai.service.ts:34) enum: FULL→ESSENTIAL→MINIMAL→DISABLED |
| B5 | **Token 用量监控** | 查看各模型消耗了多少 Token | **Observability / Token Tracking** | [`AiService.getUsageStats`](/apps/api/src/common/ai/ai.service.ts:957) |

---

## 二、Phase 1 要实现（新增 8 项业务工具）

### C. AI 智能客服（对话式业务处理）

| # | 业务功能 | 用户怎么说 | AI 专业术语 | 后端实现（规划中） |
|---|---------|-----------|------------|-----------------|
| C1 | **查订单详情** | "我的订单到哪里了" | **Tool-Using Agent + Function Calling** | [`OrderService.getOrderDetail`](/apps/api/src/client/orders/order.service.ts:609) → AI Tool |
| C2 | **查订单列表** | "帮我看看我的订单" | **Tool-Using Agent + Data Retrieval** | [`OrderService.listOrders`](/apps/api/src/client/orders/order.service.ts:532) → AI Tool |
| C3 | **申请退款** | "我要退款" | **Tool-Using Agent + Transactional Action** | [`OrderService.applyRefund`](/apps/api/src/client/orders/order.service.ts:484) → AI Tool *需确认* |
| C4 | **查余额** | "我账户还有多少钱" | **Tool-Using Agent + Data Retrieval** | [`WalletService.balance`](/apps/api/src/client/wallet/wallet.service.ts:75) → AI Tool |
| C5 | **查充值记录** | "我最近充值了多少钱" | **Tool-Using Agent + Data Retrieval** | [`ClientWalletService.getRechargeHistory`](/apps/api/src/client/wallet/client-wallet.service.ts:580) → AI Tool |
| C6 | **我的优惠券** | "我有哪些优惠券" | **Tool-Using Agent + Data Retrieval** | [`ClientCouponService.getMyCoupons`](/apps/api/src/client/coupon/coupon.service.ts:13) → AI Tool |
| C7 | **可领优惠券** | "有什么优惠券可以领" | **Tool-Using Agent + Data Retrieval** | [`ClientCouponService.getClaimableCoupons`](/apps/api/src/client/coupon/coupon.service.ts:173) → AI Tool |
| C8 | **领取优惠券** | "帮我领这个券" | **Tool-Using Agent + Transactional Action** | [`ClientCouponService.claimCoupon`](/apps/api/src/client/coupon/coupon.service.ts:71) → AI Tool |
| C9 | **查商品列表** | "有什么好东西推荐" / "看看商品" | **Tool-Using Agent + Data Retrieval** | [`TreasureService.list`](/apps/api/src/client/treasure/treasure.service.ts:30) → AI Tool |
| C10 | **查商品详情** | "这个商品多少钱" / "给我看看这个" | **Tool-Using Agent + Data Retrieval** | [`TreasureService.detail`](/apps/api/src/client/treasure/treasure.service.ts:159) → AI Tool |
| C11 | **查商品状态** | "这个还有货吗" / "有现货吗" | **Tool-Using Agent + Data Retrieval** | [`TreasureService.getStatus`](/apps/api/src/client/treasure/treasure.service.ts:225) → AI Tool |
| C12 | **热门团列表** | "什么商品在拼团" / "热门团购" | **Tool-Using Agent + Data Retrieval** | [`TreasureService.getHotGroups`](/apps/api/src/client/treasure/treasure.service.ts:265) → AI Tool |

### D. AI 系统能力（支撑 C 的基础）

| # | 业务功能 | 做什么的 | AI 专业术语 | 后端实现（规划中） |
|---|---------|---------|------------|-----------------|
| D1 | **理解用户想做什么** | "我要退单"→意图=退款 | **Intent Classification & Routing** | LangGraph intentRouter 节点 |
| D2 | **记住对话上下文** | "我刚才问的那个订单" | **Conversation Memory / Context Management** | LangGraph State + MemorySaver |
| D3 | **工具调用决策** | 用户说查余额→调用 balance 工具 | **ReAct Reasoning Loop** | LangGraph agentNode + ToolNode |
| D4 | **结构化返回结果** | 返回 {orderNo, status, amount} 格式 | **Structured Output / Function Calling** | Zod schema + bindTools |
| D5 | **处理失败重试** | 工具异常→重试或给用户友好提示 | **Error Recovery / Graceful Error Handling** | Agent 条件路由 + fallback |

> ⚠️ 注意：`TreasureModule`、`OrderModule`、`ClientCouponModule` 当前 `exports: []`，需要在 Phase 1 实施时补充 `exports: [TreasureService, OrderService, ClientCouponService]` 以便 `AiCustomerModule` 注入。

---

## 三、Phase 2+ 远期规划

| # | 业务功能 | 用户怎么说 | AI 专业术语 | 备注 |
|---|---------|-----------|------------|------|
| E1 | **搜索知识库** | "你们退货政策是什么" | **RAG / Retrieval-Augmented Generation** | 需要实现向量嵌入和知识库 |
| E2 | **物流跟踪** | "快递到哪了" | **Tool-Using Agent + External API** | 对接物流查询接口 |
| E3 | **猜你想问** | 用户刚说完→自动推测下一步 | **Next Action Prediction** | 基于历史对话模式 |
| E4 | **投诉升级到人工** | "我要投诉！叫你们经理来" | **Handoff / Human-in-the-Loop** | 转接 admin 人工客服 |
| E5 | **多语言客服** | 用户用英文提问→自动翻译+回复 | **Multi-lingual Support + Auto-Translation** | 复用现有 AiService.translateText |
| E6 | **用户画像** | 老用户来了→知道他的偏好 | **User Profiling / Personalization** | 跨会话记忆用户特征 |
| E7 | **异常行为检测** | 短时间内多次退款→标记风险 | **Anomaly Detection** | 规则+LLM 判断 |
| E8 | **自动生成工单** | 退款申请→自动创建售后工单 | **Automated Workflow / Action Automation** | 调用业务系统接口 |

---

## 四、面试专用：JoyMini 功能一句话概括

按面试级别组织，可以直接用来回答"你做过的项目有什么功能"：

### 🟢 初级面试版本
> "我做了一个电商平台的 AI 基础设施，支持**文本生成**、**自动翻译**、**图片识别**和**内容审核**。用户发布文章会自动翻译成多语言，上传身份证会自动识别信息，评论会经过 AI 审核过滤敏感内容。"

### 🟡 中级面试版本
> "我设计了一个**多供应商 LLM 服务层**，支持 Gemini/Groq/DeepSeek 自动切换和熔断降级。在这个基础上，用 **LangGraph** 构建了**智能客服 Agent**，用户可以通过对话查询订单、查看余额、领取优惠券、搜索商品——Agent 会自动理解用户意图、调用对应的业务服务、返回结构化结果。"

### 🔴 高级面试版本
> "我构建了一个完整的 **AI Agent 平台**，包含三层架构：
> 1. **基础设施层** — 多模型抽象、熔断限流、服务降级、Token 监控，支撑日均 XX 次 AI 调用
> 2. **Agent 引擎层** — 基于 LangGraph 的 **ReAct Agent**，支持意图分类、工具调用、对话记忆、结构化输出
> 3. **业务工具层** — **12 个业务工具**直接注入 NestJS Service（订单/钱包/优惠券/商品），与现有业务代码无缝集成
>
> 同时还有**内容审核、多模态识别、自动翻译**等生产级能力，这些在教学项目中很少见。"

---

## 五、完整功能-术语对照速查表

| 分类 | JoyMini 功能 | 专业术语 (English) | 中文术语 |
|------|------------|-------------------|---------|
| 🤖 Agent | 智能客服对话 | `Tool-Using Agent / ReAct Agent` | 工具调用式智能体 |
| 🤖 Agent | 理解用户意图 | `Intent Classification & Routing` | 意图分类与路由 |
| 🤖 Agent | 记住对话上下文 | `Conversation Memory / Context Management` | 对话记忆管理 |
| 🤖 Agent | 工具调用决策 | `ReAct Reasoning Loop` | 推理-行动循环 |
| 🤖 Agent | 业务工具调用 | `Tool Execution / Function Calling` | 工具执行/函数调用 |
| 📝 内容 | 文章自动翻译 | `Auto-Translation / Machine Translation` | 自动翻译 |
| 📝 内容 | 评论审核过滤 | `Content Moderation & Safety` | 内容审核与安全 |
| 📝 内容 | 评论自动回复 | `Automated Response Generation` | 自动回复生成 |
| 🖼️ 多模态 | 证件 OCR 识别 | `Multi-Modal / Vision / OCR` | 多模态视觉识别 |
| 🔧 基础设施 | 多模型自动切换 | `Model Provider Abstraction / Multi-Provider` | 模型供应商抽象 |
| 🔧 基础设施 | 熔断保护 | `Circuit Breaker Pattern` | 熔断模式 |
| 🔧 基础设施 | 请求限流 | `Rate Limiting / Throttling` | 速率限制 |
| 🔧 基础设施 | 服务自动降级 | `Automatic Service Degradation` | 服务自动降级 |
| 🔧 基础设施 | Token 用量监控 | `Observability / Token Tracking` | 可观测性 |
| 📦 Phase 1 | 查订单 | `Tool-Using Agent + Data Retrieval` | 工具调用 + 数据查询 |
| 📦 Phase 1 | 查余额 | `Tool-Using Agent + Data Retrieval` | 工具调用 + 数据查询 |
| 📦 Phase 1 | 领优惠券 | `Tool-Using Agent + Transactional Action` | 工具调用 + 事务操作 |
| 📦 Phase 1 | 退款申请 | `Tool-Using Agent + Transactional Action` | 工具调用 + 事务操作 |
| 📦 Phase 1 | **查商品** | **`Tool-Using Agent + Data Retrieval`** | **工具调用 + 数据查询** |
| 📦 Phase 1 | **热门团** | **`Tool-Using Agent + Data Retrieval`** | **工具调用 + 数据查询** |
| 📦 Phase 1 | 失败重试 | `Error Recovery / Retry Logic` | 错误恢复/重试逻辑 |
| 🚀 Phase 2 | 知识库问答 | `RAG / Retrieval-Augmented Generation` | 检索增强生成 |
| 🚀 Phase 2 | 转人工 | `Human-in-the-Loop / Handoff` | 人机协作/转接 |
| 🚀 Phase 2 | 用户画像 | `User Profiling / Personalization` | 用户画像/个性化 |
| 🚀 Phase 2 | 多语言客服 | `Multi-lingual Support` | 多语言支持 |
