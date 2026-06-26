# AI 客服助手 — Spec-Coding 自驱开发检查清单

> **项目**: JoyMini Nest Monorepo
> **目标**: 自行编码实现 AI 客服助手（LangGraph StateGraph + NestJS + Next.js）
> **定位**: 自驱开发 → 每完成一项划掉一项，面试时可展示完整项目
> **面试级别**: 完成 Phase 0~2 → **中级 AI 工程师（8-10 项能力）**；完成 Phase 3~4 → **高级 AI 工程师（12+ 项能力）**
> **格式参考**: [`study/LLM/spec-coding/02-spec-structure.md`](../../study/LLM/spec-coding/02-spec-structure.md)

---

## 📋 使用说明

1. **你是开发者** — 本文档只给你提示和方向，不贴完整代码。每项看懂后自行实现。
2. **每完成一项，把 `[ ]` 改为 `[x]`**，同时在对应区域写备注（踩了什么坑、有什么思考）。
3. **面试准备** — 每项都有 `专业术语` 和 `自测点`，是面试官的常见问题来源。
4. **参考文件** — 先用参考文件研究模式，再自行编码。

---

## 目录

- [Phase 0：前置准备（必须先做）](#phase-0前置准备必须先做)
- [Phase 1：核心 Agent 引擎（apps/api 后端）](#phase-1核心-agent-引擎appsapi-后端)
  - [1.1 模块基础](#11-模块基础)
  - [1.2 Graph State 定义](#12-graph-state-定义)
  - [1.3 Tool 工具层（8 个工具）](#13-tool-工具层8-个工具)
  - [1.4 Graph 节点层（5 个节点）](#14-graph-节点层5-个节点)
  - [1.5 Graph 构建与编排](#15-graph-构建与编排)
  - [1.6 Service 层](#16-service-层)
  - [1.7 Controller 层（REST + SSE）](#17-controller-层rest--sse)
  - [1.8 模块注册](#18-模块注册)
- [Phase 2：前端聊天 UI（apps/frontend-blog）](#phase-2前端聊天-uiappsfrontend-blog)
- [Phase 3：RAG 知识库与持久化记忆（增强）](#phase-3rag-知识库与持久化记忆增强)
- [Phase 4：高级进阶（面试加分项）](#phase-4高级进阶面试加分项)
- [附录](#附录)

---

## Phase 0：前置准备（必须先做）

### P0-01 安装 LangGraph 依赖

| 项目 | 内容 |
|------|------|
| **描述** | 在 [`apps/api`](../../apps/api) 中安装 `@langchain/core` 和 `@langchain/langgraph` |
| **专业术语** | **Dependency Injection Ready** — 确保第三方库可被 NestJS DI 容器管理 |
| **操作要点** | ① 在 [`apps/api/package.json`](../../apps/api/package.json) 中添加依赖；② 从 monorepo 根目录执行 `yarn workspace @lucky/api add @langchain/core @langchain/langgraph` |
| **自测点** | `import { StateGraph } from '@langchain/langgraph'` 能正常编译 |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/server/package.json`](../../study/LLM/project/jisu-ai-customer/server/package.json)（看它引了哪些 langchain 包） |
| **💡 提示** | ⚠️ 注意版本兼容：`@langchain/langgraph` v1.2.x + `@langchain/core` v0.3.x。不要装 latest，装 study 项目已验证的版本。 |
| **状态** | [x] DONE — `yarn workspace @lucky/api add @langchain/core@^0.3.0 @langchain/langgraph@^0.2.0` |

### P0-02 修复 Module Exports（DI 关键）

| 项目 | 内容 |
|------|------|
| **描述** | [`OrderModule`](../../apps/api/src/client/orders/order.module.ts:14) 和 [`ClientCouponModule`](../../apps/api/src/client/coupon/coupon.module.ts:10) 的 `exports: []` 是空的，必须暴露 Service 才能让 AI 模块注入 |
| **专业术语** | **NestJS Module Encapsulation** — 模块默认不暴露 provider，需要在 exports 显式声明 |
| **操作要点** | ① `OrderModule` → `exports: [OrderService]`；② `ClientCouponModule` → `exports: [ClientCouponService]`；③ `WalletModule` 已经导出了，不需要改 |
| **自测点** | 检查 [`WalletModule`](../../apps/api/src/client/wallet/wallet.module.ts:11) 的 exports 写法做参考，确保 OrderModule 和 ClientCouponModule 写对 |
| **参考文件** | [`wallet.module.ts`](../../apps/api/src/client/wallet/wallet.module.ts)（正确 exports 的参考） |
| **💡 提示** | 如果改完后报 circular dependency，用 `forwardRef(() => Module)`。但这里的依赖关系是单向的（AI 模块 → 业务模块），一般不会出现循环依赖。 |
| **状态** | [x] DONE — OrderModule, ClientCouponModule, TreasureModule, KycModule 全部加了 exports |

---

## Phase 1：核心 Agent 引擎（apps/api 后端）

所有文件放在：`apps/api/src/client/ai-customer/`

```
apps/api/src/client/ai-customer/
├── ai-customer.module.ts
├── ai-customer.controller.ts
├── ai-customer.service.ts
├── graph/
│   ├── state.ts
│   ├── customer.graph.ts
│   ├── nodes/
│   │   ├── intent-router.node.ts
│   │   ├── order-agent.node.ts
│   │   ├── coupon-agent.node.ts
│   │   ├── rag.node.ts
│   │   └── answer-synthesizer.node.ts
│   └── tools/
│       ├── order-tools.ts
│       ├── wallet-tools.ts
│       └── coupon-tools.ts
└── dto/
    └── ai-customer.dto.ts
```

### 1.1 模块基础

#### F-01 创建 `ai-customer.module.ts`

| 项目 | 内容 |
|------|------|
| **描述** | NestJS Module 定义， imports 里引入 PrismaModule、OrderModule、WalletModule、ClientCouponModule、AiModule |
| **专业术语** | **NestJS Module Metadata** — `@Module({ imports, controllers, providers })` |
| **自测点** | ① 所有 imports 的模块都存在且 exports 了需要的 Service；② provider 列表里有 `AiCustomerService`；③ controller 列表里有 `AiCustomerController` |
| **参考文件** | [`coupon.module.ts`](../../apps/api/src/client/coupon/coupon.module.ts)（简单的模块定义模式）、[`order.module.ts`](../../apps/api/src/client/orders/order.module.ts)（多 imports 的模式） |
| **💡 提示** | `AiModule` 在 [`apps/api/src/common/ai/ai.module.ts`](../../apps/api/src/common/ai/ai.module.ts)，要检查它是否 export 了 `AiService`。如果没 export，需要先改 AiModule 的 exports。 |
| **状态** | [x] DONE — 2026-06-25, 10 个业务模块 + Controller + Service 全部注册，build 编译通过 |

---

### 1.2 Graph State 定义

#### F-02 创建 `graph/state.ts`

| 项目 | 内容 |
|------|------|
| **描述** | 使用 LangGraph 的 `Annotation.Root` 定义 StateGraph 的状态类型 |
| **专业术语** | **LangGraph Annotation State** — 声明式状态定义，每个字段有 reducer 和 default |
| **自测点** | ① `Annotation.Root` 写法正确；② `...MessagesAnnotation.spec` 展开包含了 messages；③ 所有自定义字段（userInput, intent, orderResult, walletResult, couponResult, ragResult, finalAnswer, steps）都定义了 reducer（用 `(_, next) => next` 覆盖模式）和 default |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/server/src/graphs/state.js`](../../study/LLM/project/jisu-ai-customer/server/src/graphs/state.js)（JS→TS 翻译，注意加类型） |
| **💡 提示** | ⚠️ `MessagesAnnotation.spec` 的展开方式在 TypeScript 中可能有点不同。如果 `...MessagesAnnotation.spec` 报错，试试显式定义 `messages: Annotation<BaseMessage[]>({ ... })`。LangGraph v1.2.x 的 TS API 与 JS 略有差异。 |
| **状态** | [x] DONE — 2026-06-25, AgentState 定义了 messages/intent/agentSteps/sources 四个字段 |

---

### 1.3 Tool 工具层（8 个工具）

⚠️ **核心原则**：所有工具必须是 **READ-ONLY**（除了 `claimCoupon` 是安全的写入操作）。工具不能执行扣款、删除等危险操作。

#### F-03 创建 `graph/tools/order-tools.ts`（3 个工具）

| 项目 | 内容 |
|------|------|
| **描述** | 3 个订单查询工具，包装 [`OrderService`](../../apps/api/src/client/orders/order.service.ts) 的方法 |
| **专业术语** | **Tool Wrapper Pattern** — 将 NestJS Service 方法适配为 LangChain `tool()` 函数；**Zod Schema** — 用 Zod 定义工具参数结构 |
| **工具列表** | ① `getOrderDetail` — 按订单号查详情，调 [`OrderService.getOrderDetail()`](../../apps/api/src/client/orders/order.service.ts:609)；② `listOrders` — 查用户订单列表，调 [`OrderService.listOrders()`](../../apps/api/src/client/orders/order.service.ts:532)；③ `getOrderStatus` — 查订单状态（轻量查询） |
| **自测点** | ① 每个工具都用 `tool()` 函数创建，有 name/description/schema；② description 写中文，LLM 能理解什么时候调用；③ 错误时返回 `JSON.stringify({ error: '...' })` 而非 throw；④ 数据脱敏：不返回用户手机号、地址等敏感信息 |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/server/src/tools/order-tools.js`](../../study/LLM/project/jisu-ai-customer/server/src/tools/order-tools.js)（JS→TS 翻译，关注 `tool()` 用法和 Zod schema）、[`order.service.ts`](../../apps/api/src/client/orders/order.service.ts)（看有哪些可调用的方法） |
| **💡 提示** | ⚠️ 工具函数需要访问 `OrderService` 实例。但 `tool()` 是函数式 API，不能直接注入。解决方案：用**工厂模式**——写一个 `createOrderTools(orderService: OrderService)` 函数返回工具数组。这样在 `AiCustomerService` 中注入 service 后调用工厂函数。 |
| **状态** | [ ] TODO |

#### F-04 创建 `graph/tools/wallet-tools.ts`（2 个工具）

| 项目 | 内容 |
|------|------|
| **描述** | 2 个钱包查询工具，包装 [`WalletService`](../../apps/api/src/client/wallet/wallet.service.ts) 和 [`ClientWalletService`](../../apps/api/src/client/wallet/client-wallet.service.ts) |
| **专业术语** | **Cross-Service Tool Composition** — 一个工具可以调用多个 Service 的方法 |
| **工具列表** | ① `getBalance` — 查钱包余额，调 [`WalletService.balance()`](../../apps/api/src/client/wallet/wallet.service.ts:75)；② `getRechargeHistory` — 查充值记录，调 [`ClientWalletService.getRechargeHistory()`](../../apps/api/src/client/wallet/client-wallet.service.ts:580) |
| **自测点** | ① 余额查询返回的数据结构清晰（包含余额、冻结金额等）；② 充值记录按时间倒序；③ 没有交易相关的写操作工具 |
| **参考文件** | [`wallet.service.ts`](../../apps/api/src/client/wallet/wallet.service.ts)、[`client-wallet.service.ts`](../../apps/api/src/client/wallet/client-wallet.service.ts) |
| **💡 提示** | `WalletService.balance()` 的参数是什么？先去读它的方法签名。一般需要 `userId`。工具函数里怎么拿到当前用户的 userId？→ 通过闭包捕获（工厂函数参数传入）。 |
| **状态** | [ ] TODO |

#### F-05 创建 `graph/tools/coupon-tools.ts`（3 个工具）

| 项目 | 内容 |
|------|------|
| **描述** | 3 个优惠券工具，包装 [`ClientCouponService`](../../apps/api/src/client/coupon/coupon.service.ts) |
| **专业术语** | **Safe Write Operation** — `claimCoupon` 是唯一允许的写入操作，本质是用户可见的权益领取 |
| **工具列表** | ① `getMyCoupons` — 查我的优惠券，调 [`ClientCouponService.getMyCoupons()`](../../apps/api/src/client/coupon/coupon.service.ts:13)；② `getClaimableCoupons` — 查可领取的优惠券，调 [`ClientCouponService.getClaimableCoupons()`](../../apps/api/src/client/coupon/coupon.service.ts:173)；③ `claimCoupon` — 领取优惠券，调 [`ClientCouponService.claimCoupon()`](../../apps/api/src/client/coupon/coupon.service.ts:71) |
| **自测点** | ① `claimCoupon` 成功后返回优惠券信息；② 重复领取返回友好的错误信息（不是 throw 500）；③ 三种工具都传了正确的 userId |
| **参考文件** | [`coupon.service.ts`](../../apps/api/src/client/coupon/coupon.service.ts) |
| **💡 提示** | `claimCoupon` 是写入操作，要考虑幂等性。如果用户重复调用同一个 couponId，应该返回"已领取过"而不是报错。先去读 `claimCoupon` 的内部实现确认。 |
| **状态** | [ ] TODO |

---

### 1.4 Graph 节点层（5 个节点）

#### F-06 创建 `graph/nodes/intent-router.node.ts`

| 项目 | 内容 |
|------|------|
| **描述** | 使用 LLM 对用户输入做意图分类，路由到不同的处理节点 |
| **专业术语** | **Intent Classification & Routing** — 用 LLM 做分类器（比传统 NLP 更灵活）；**Conditional Edge** — StateGraph 的条件边根据意图值选择下一个节点 |
| **意图分类** | 9 个意图：`order`、`wallet`、`coupon`、`user`、`product`、`lucky-draw`、`rag`、`general`、`unknown` |
| **自测点** | ① Prompt 写清楚了 9 个意图的定义和例子（英文版）；② 输出只返回分类词；③ 不符合任何分类的 fallback 到 `unknown` → `generalChat`；④ 路由映射函数 `routeByIntent` 也一起实现了；⑤ 使用 `ChatOllama` 直接调用（复用 AiService 后续优化） |
| **参考文件** | [`intent-router.node.ts`](../../apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts) |
| **💡 提示** | 当前使用 `ChatOllama` 直接调用（不通过 AiService），因为 LangChain 的 `.pipe()` 链式调用需要 ChatModel 接口。Phase 5 会用 `withFallbacks()` 统一替换。 |
| **状态** | [x] DONE — 2026-06-25, 9 分类英文 Prompt + intentRouterNode + routeByIntent 全部实现，`@langchain/ollama` 依赖已安装 |

#### F-07 创建 `graph/nodes/order-agent.node.ts`

| 项目 | 内容 |
|------|------|
| **描述** | ReAct Agent 节点，绑定 order-tools + wallet-tools，能自动决定调用哪些工具 |
| **专业术语** | **ReAct Agent (Reasoning + Acting)** — Agent 自主推理→决定调用工具→观察结果→继续推理的循环；**ToolNode** — LangGraph 内置的工具执行节点 |
| **自测点** | ① 用 `createReactAgent` 创建，绑定 5 个工具（3 order + 2 wallet）；② System Prompt 包含：角色定位、调用规则、安全约束；③ 返回 `orderResult`（包含 answer 和 steps）；④ 错误时有 fallback 信息 |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/server/src/graphs/nodes/order-agent.js`](../../study/LLM/project/jisu-ai-customer/server/src/graphs/nodes/order-agent.js)（关键模式）、[`customer-agent.js`](../../study/LLM/project/jisu-ai-customer/server/src/agents/customer-agent.js)（createReactAgent 用法） |
| **💡 提示** | ⚠️ 这里的重点问题：`createReactAgent` 在 Node.js 中怎么和 NestJS DI 结合？答案还是**工厂模式**——service 实例通过闭包传入 agent 构造函数。另外注意 `createReactAgent` 的 TS 类型签名可能与 JS 版本不同。 |
| **状态** | [ ] TODO |

#### F-08 创建 `graph/nodes/coupon-agent.node.ts`

| 项目 | 内容 |
|------|------|
| **描述** | ReAct Agent 节点，绑定 coupon-tools（3 个工具） |
| **专业术语** | **Domain-Specific Agent** — 专门处理优惠券领域的 Agent，与 order-agent 职责分离 |
| **自测点** | ① 绑定 3 个 coupon 工具；② System Prompt 包含优惠券相关的回复规则（如：只能领取可领取的、不能帮别人领）；③ 返回 `couponResult`（含 answer 和 steps）；④ `claimCoupon` 成功/失败的返回信息清晰 |
| **参考文件** | F-07 的 `order-agent.node.ts`（同模式，不同工具集） |
| **💡 提示** | 注意：`claimCoupon` 是写操作，prompt 中要强调：必须先让用户确认再调用！如果用户没说"帮我领取"，Agent 不应该擅自调用。 |
| **状态** | [ ] TODO |

#### F-09 创建 `graph/nodes/rag.node.ts`

| 项目 | 内容 |
|------|------|
| **描述** | 知识库检索节点（Phase 1 为 stub，Phase 3 替换为真实 pgvector 查询） |
| **专业术语** | **RAG (Retrieval-Augmented Generation)** — 检索增强生成；**Stub Pattern** — 先返回占位响应，后续替换为真实实现 |
| **自测点** | ① Phase 1 返回友好提示"知识库正在建设中，请稍后再试"；② 告诉用户知识库当前不支持哪些类型的查询；③ 返回格式与 Phase 3 兼容（包含 `ragResult.answer` 和 `ragResult.sources`） |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/server/src/graphs/nodes/rag-node.js`](../../study/LLM/project/jisu-ai-customer/server/src/graphs/nodes/rag-node.js) |
| **💡 提示** | 返回结构要提前设计好，方便 Phase 3 替换时不用改其他节点。用接口/类型定义好 `RagResult { answer: string; sources: Source[] }`。 |
| **状态** | [ ] TODO |

#### F-10 创建 `graph/nodes/answer-synthesizer.node.ts`

| 项目 | 内容 |
|------|------|
| **描述** | 最终答案合成节点，汇总 orderAgent/couponAgent/ragNode 的结果，生成自然语言回答 |
| **专业术语** | **Answer Synthesis** — 多源信息融合；**Conditional Composition** — 根据现有结果动态决定合成策略 |
| **自测点** | ① `general` 意图直接透传（不走 LLM 二次处理）；② `order/wallet/coupon` 意图：用已有结果（orderResult/walletResult/couponResult）组装成友好回复，LLM 润色；③ `knowledge` 意图：用 ragResult 的 answer + sources 合成；④ 如果没有任何结果，返回 fallback 信息；⑤ 返回 `finalAnswer` 并更新 `messages` |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/server/src/graphs/nodes/answer-synthesizer.js`](../../study/LLM/project/jisu-ai-customer/server/src/graphs/nodes/answer-synthesizer.js) |
| **💡 提示** | 这里有一个重要的设计权衡：**直接用 LLM 合成 vs 模板组装**。LLM 合成更自然但有延迟和成本；模板组装更快但不够灵活。建议：简单场景（如查余额）用模板，复杂场景（如多订单汇总）走 LLM。 |
| **状态** | [ ] TODO |

---

### 1.5 Graph 构建与编排

#### F-11 创建 `graph/customer.graph.ts`

| 项目 | 内容 |
|------|------|
| **描述** | StateGraph 的构建入口，组装所有节点和边 |
| **专业术语** | **StateGraph Builder** — LangGraph 的编译时图构建；**Conditional Edge Mapping** — 条件边的目标映射表 |
| **流程图** | ```
START → intentRouter
  ├─→ order → orderAgent → answerSynthesizer → END
  ├─→ wallet → orderAgent → answerSynthesizer → END
  ├─→ coupon → couponAgent → answerSynthesizer → END
  ├─→ knowledge → ragNode → answerSynthesizer → END
  └─→ general → answerSynthesizer → END
``` |
| **自测点** | ① 所有 5 个节点都 addNode 了；② 条件边映射正确（5 个意图各有一个目标）；③ `addEdge(START, 'intentRouter')` 写了；④ `addEdge('answerSynthesizer', END)` 写了；⑤ 调用 `graph.compile()` 返回 `CompiledGraph` |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/server/src/graphs/customer-graph.js`](../../study/LLM/project/jisu-ai-customer/server/src/graphs/customer-graph.js) |
| **💡 提示** | ⚠️ 注意 TS 中 `StateGraph` 的泛型：`new StateGraph<typeof AiCustomerState>(AiCustomerState)`。节点函数的签名必须是 `(state: typeof AiCustomerState.State) => Partial<typeof AiCustomerState.Update>`。 |
| **状态** | [ ] TODO |

---

### 1.6 Service 层

#### F-12 创建 `ai-customer.service.ts`

| 项目 | 内容 |
|------|------|
| **描述** | Graph 编排器，封装 `graph.invoke()` 和 `graph.stream()`，管理 MemorySaver 生命周期 |
| **专业术语** | **Graph Orchestrator** — 图的调用入口；**MemorySaver** — LangGraph 内置的内存级 checkpointer（对话历史保持在同一 thread）；**Checkpointer** — 持久化检查点（Phase 3 升级为 PostgreSQL） |
| **核心方法** | ① `chat()` — 非流式调用，用 `graph.invoke()` 返回完整结果；② `chatStream()` — 流式调用，用 `graph.stream()` 逐事件 yield；③ 每个请求传入 `thread_id`（用 userId 或 sessionId） |
| **自测点** | ① 构造函数中注入所有需要的 Service，调用工厂函数创建 graph；② `thread_id` 是 conversation 级别的标识，同一个 conversation 共用历史；③ stream 方法正确处理了 `for await...of` 的异步迭代；④ 错误捕获友好（不暴露内部错误栈） |
| **参考文件** | [`travel-agent` 的 AgentService 注入模式](../study/LLM/project/travel-agent/)——如果存在的话；看 LangGraph TS 文档中 `stream()` 的用法 |
| **💡 提示** | ⚠️ `MemorySaver` 在 TS 中的导入路径：`import { MemorySaver } from '@langchain/langgraph'`。另外注意：`graph.invoke()` 的第二个参数是 `{ configurable: { thread_id: string } }`。如果 `thread_id` 为空，MemorySaver 无法工作。 |
| **状态** | [ ] TODO |

---

### 1.7 Controller 层（REST + SSE）

#### F-13 创建 `ai-customer.controller.ts`

| 项目 | 内容 |
|------|------|
| **描述** | 对外暴露 REST（非流式）和 SSE（流式）端点 |
| **专业术语** | **Server-Sent Events (SSE)** — 服务器单向推送协议，比 WebSocket 更轻量；**NestJS @Sse()** — `@nestjs/common` 内置的 SSE 装饰器 |
| **端点设计** | ① `POST /ai-customer/chat` — 非流式聊天（body: `{ message, threadId? }`）；② `GET /ai-customer/chat/stream?message=...&threadId=...` — SSE 流式聊天 |
| **自测点** | ① POST 端点用 `@Post()` + `@Body()` + DTO 校验；② SSE 端点用 `@Sse()` 装饰器，返回 `Observable<MessageEvent>`；③ 两个端点都用 `@UseGuards(JwtAuthGuard)` 保护；④ 从 request 中提取 `userId`（用 `@CurrentUserId()` 或从 JWT 解析） |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/server/src/routes/agent.js`](../../study/LLM/project/jisu-ai-customer/server/src/routes/agent.js)（SSE 模式参考）、NestJS 官方文档中 `@Sse()` 的用法 |
| **💡 提示** | ⚠️ NestJS 的 `@Sse()` 需要返回 `Observable<MessageEvent>`（RxJS）。但 `graph.stream()` 是 async generator。需要用 `from()` 将 async generator 转为 Observable。示例：`return from(streamGenerator).pipe(map(data => ({ data: JSON.stringify(data) })))`。 |
| **状态** | [ ] TODO |

---

### 1.8 模块注册

#### F-14 在 [`client.module.ts`](../../apps/api/src/client/client.module.ts) 中注册

| 项目 | 内容 |
|------|------|
| **描述** | 将 `AiCustomerModule` 加入 `ClientModule` 的 imports 数组 |
| **专业术语** | **Module Registration** — NestJS 模块树的根注册 |
| **自测点** | ① `import { AiCustomerModule } from './ai-customer/ai-customer.module'` 正确；② 在 `imports: [...]` 数组中添加了 `AiCustomerModule`；③ `yarn workspace @lucky/api start:dev` 能正常启动，无模块加载错误 |
| **参考文件** | [`client.module.ts`](../../apps/api/src/client/client.module.ts)（看其他模块是如何 import 的） |
| **💡 提示** | 如果报 `OrderService` not available 之类的错误，说明 `OrderModule` 没有 exports `OrderService`。回 Phase 0-02 确认。 |
| **状态** | [x] DONE — 2026-06-25, 在 ClientModule 中注册 AiCustomerModule，build 编译通过 ✅ |

---

## Phase 2：前端聊天 UI（apps/frontend-blog）

所有前端文件放在 `apps/frontend-blog/src/` 下。

#### F-15 创建 `app/[locale]/ai-chat/page.tsx`

| 项目 | 内容 |
|------|------|
| **描述** | Next.js App Router 的 Server Component，设置页面元数据和布局骨架 |
| **专业术语** | **Server Component (RSC)** — 在服务端渲染，不包含客户端交互逻辑；**i18n Route** — `[locale]` 动态路由段 |
| **自测点** | ① 使用 `generateMetadata` 导出页面元数据；② 渲染 Client Component (`page.client.tsx`)；③ 布局与现有博客页面一致（导航栏、页脚等） |
| **参考文件** | [`apps/frontend-blog/src/app/[locale]/`](../../apps/frontend-blog/src/app/[locale]/) 下的其他 page.tsx 文件 |
| **💡 提示** | Server Component 不能使用 hooks（useState、useEffect 等）。页面逻辑全部放到 `page.client.tsx` 中。 |
| **状态** | [ ] TODO |

#### F-16 创建 `app/[locale]/ai-chat/page.client.tsx`

| 项目 | 内容 |
|------|------|
| **描述** | Client Component，实现聊天交互 UI（消息列表 + 输入框 + SSE 实时展示） |
| **专业术语** | **Client Component** — 使用 `'use client'` 指令；**Streaming UI Pattern** — 实时渲染逐字到达的 SSE 数据 |
| **UI 结构** | ① MessageList — 滚动消息列表，新消息自动滚到底部；② ChatInput — 输入框 + 发送按钮；③ LoadingState — 等待 AI 响应时的动画；④ 消息气泡：用户消息右对齐，AI 消息左对齐 |
| **自测点** | ① 发送消息后输入框清空并 disabled；② SSE 响应逐字显示（不阻塞 UI）；③ 消息列表自动滚动；④ 错误时显示错误提示；⑤ 移动端适配 |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/client/src/views/ChatView.vue`](../../study/LLM/project/jisu-ai-customer/client/src/views/ChatView.vue)（Vue 3 参考，注意翻译成 React） |
| **💡 提示** | ⚠️ 使用 `useIsClient` Hook 保护浏览器 API（localStorage、scrollIntoView 等），避免 hydration 错误。参考项目约定的 hydration 安全规则。 |
| **状态** | [ ] TODO |

#### F-17 创建 `lib/hooks/useAiChat.ts`

| 项目 | 内容 |
|------|------|
| **描述** | 自定义 Hook，封装 SSE 连接的生命周期管理 |
| **专业术语** | **SSE Consumption Hook** — 管理 EventSource/fetch-stream 的连接、断线重连、事件分发 |
| **Hook 接口** | ```typescript
interface UseAiChatReturn {
  messages: ChatMessage[];
  sendMessage: (text: string) => Promise<void>;
  isStreaming: boolean;
  error: string | null;
  clearMessages: () => void;
}
``` |
| **自测点** | ① 使用 `fetch` 的响应式流（`response.body.getReader()`）而非 `EventSource`（因为 POST 请求只能用 fetch）；② 正确解析 SSE 事件流（`data: {...}\n\n`）；③ 区分事件类型（answer/done/error）；④ 组件卸载时中止 fetch；⑤ 断网时友好提示 |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/client/src/composables/useGraph.js`](../../study/LLM/project/jisu-ai-customer/client/src/composables/useGraph.js)（Vue 3 composable → React hook 翻译） |
| **💡 提示** | ⚠️ SSE 流的解析不要用简单的 `JSON.parse`。因为流式数据可能被 TCP 分包截断。正确的做法：用 `TextDecoder` 解码字节流，按 `\n\n` 分割事件，再解析每个 `data:` 行。或者直接用 `@microsoft/fetch-event-source` 库。 |
| **状态** | [ ] TODO |

#### F-18 创建 `lib/api/aiChatApi.ts`

| 项目 | 内容 |
|------|------|
| **描述** | API 客户端，封装对后端 AI 客服端点的 HTTP 调用 |
| **专业术语** | **API Client Layer** — 将 HTTP 请求抽象为类型安全的函数调用 |
| **方法** | ① `sendMessage(message, threadId?)` → POST 非流式；② `sendMessageStream(message, threadId?)` → GET SSE 流式（返回 Response 对象） |
| **自测点** | ① 使用现有的 `http` 实例或自定义 fetch 封装；② 请求路径正确（`/api/client/v1/ai-customer/chat` 等）；③ JWT token 自动附带（从 cookie 或 header 中读取） |
| **参考文件** | [`frontendBlogApi.ts`](../../apps/frontend-blog/src/lib/api/frontendBlogApi.ts)（现有 API 客户端的写法模式） |
| **💡 提示** | API 路径前缀参考其他 client 端点的模式。一般来说是 `/api/client/v1/ai-customer/...`。确认路由前缀与 NestJS Controller 的 `@Controller('ai-customer')` 一致。 |
| **状态** | [ ] TODO |

---

## Phase 3：RAG 知识库与持久化记忆（增强）

#### F-19 Prisma 迁移：KnowledgeDocument + KnowledgeEmbedding

| 项目 | 内容 |
|------|------|
| **描述** | 在 [`schema.prisma`](../../apps/api/prisma/schema.prisma) 中新增两个模型，用于存储知识库文档和向量嵌入 |
| **专业术语** | **Prisma Migration** — 数据库 Schema 变更管理；**pgvector** — PostgreSQL 的向量扩展 |
| **自测点** | ① `KnowledgeDocument` 模型包含 id/title/content/category/timestamps；② `KnowledgeEmbedding` 模型包含 id/documentId/content/embedding（`vector(1536)`）；③ 外键关系正确（onDelete: Cascade）；④ 执行 `prisma migrate dev` 成功 |
| **参考文件** | [`ai-customer-service-sdd.md` 的 6.1 节](../../plans/joymini-nest-monorepo/ai-customer-service-sdd.md:227)（有完整的 Prisma 模型定义） |
| **💡 提示** | ⚠️ `vector(1536)` 是 `Unsupported` 类型，Prisma Client 无法直接操作。需要使用 Prisma 的 `$queryRawUnsafe` 或 `@prisma/client` 的扩展 API。或者用更简单的方式：embedding 存为 JSON 字符串，查询时用原始 SQL。 |
| **状态** | [ ] TODO |

#### F-20 pgvector 设置 + 数据导入脚本

| 项目 | 内容 |
|------|------|
| **描述** | 创建数据导入脚本，读取知识库文档 → 生成 embedding → 存入 pgvector |
| **专业术语** | **Data Ingestion Pipeline** — 文档→分块→向量化→存储的完整流程；**Embedding Model** — 将文本转为向量（如 text-embedding-004） |
| **自测点** | ① 脚本读取 markdown/文本文件；② 将长文档分块（chunk size ~500 tokens，overlap ~50）；③ 调用 embedding 模型生成向量；④ 向量和文本一起存入 KnowledgeEmbedding 表；⑤ 脚本可重复运行（幂等） |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/server/src/scripts/ingest.js`](../../study/LLM/project/jisu-ai-customer/server/src/scripts/ingest.js)、[`study/LLM/project/jisu-ai-customer/server/src/data/knowledge/products.md`](../../study/LLM/project/jisu-ai-customer/server/src/data/knowledge/products.md)（知识库文档格式） |
| **💡 提示** | 分块策略是 RAG 质量的关键。太小的块丢失上下文，太大的块稀释语义。先用简单的固定大小分块（recursive character splitter），后续再优化。AiService 中已经有 `generateEmbedding()` 方法吗？去确认一下。 |
| **状态** | [ ] TODO |

#### F-21 完整 `rag.node.ts`（替换 Phase 1 的 Stub）

| 项目 | 内容 |
|------|------|
| **描述** | 用真实的 pgvector 相似度搜索替换 Phase 1 的占位实现 |
| **专业术语** | **Vector Similarity Search** — 余弦相似度或内积距离搜索；**RAG Pipeline** — 检索→格式化→LLM 生成的完整链路 |
| **实施步骤** | ① 用户输入 → 生成 embedding；② pgvector 查询最相似的前 K 条（K=3~5）；③ 格式化检索结果（title + content）；④ 构建 RAG Prompt，注入上下文；⑤ LLM 生成回答（带来源引用） |
| **自测点** | ① 返回 `ragResult.answer`（LLM 生成的回答）和 `ragResult.sources`（检索到的文档来源列表）；② 无匹配时友好提示；③ 来源信息包含 title 和内容摘要 |
| **参考文件** | [`study/LLM/project/jisu-ai-customer/server/src/graphs/nodes/rag-node.js`](../../study/LLM/project/jisu-ai-customer/server/src/graphs/nodes/rag-node.js) |
| **💡 提示** | ⚠️ pgvector 查询在 Prisma 中需要原始 SQL。示例：`SELECT * FROM knowledge_embeddings ORDER BY embedding <-> '[vec]' LIMIT 5`。`<->` 是余弦距离运算符。如果 embedding 维度过大（如 1536），考虑降维或使用更小的模型。 |
| **状态** | [ ] TODO |

#### F-22 PostgreSQL Checkpointer（持久化记忆）

| 项目 | 内容 |
|------|------|
| **描述** | 将 MemorySaver 替换为 PostgreSQL checkpointer，实现跨会话的对话历史持久化 |
| **专业术语** | **Postgres Checkpointer** — LangGraph 的 PostgreSQL 检查点实现；**Session Persistence** — 会话级持久化 |
| **自测点** | ① 安装 `@langchain/langgraph-checkpoint-postgres`；② 替换 `new MemorySaver()` 为 `PostgresSaver` 或自定义 Prisma checkpointer；③ 数据库连接配置正确；④ 刷新页面后对话历史恢复；⑤ 支持分页加载历史消息 |
| **参考文件** | [`study/LLM/langgraph/langgraph-backend/src/langgraph/langgraph.service.ts`](../../study/LLM/langgraph/langgraph-backend/src/langgraph/langgraph.service.ts:72)（MemorySaver → Postgres 的升级模式参考） |
| **💡 提示** | LangGraph 的 Postgres checkpointer 可能需要额外的表。如果不想依赖社区包，可以自己用 Prisma 实现 checkpointer 接口：定义一个 `Checkpoint` 表（thread_id, checkpoint_ns, state JSON），实现 `getCheckpoint()` 和 `setCheckpoint()` 方法。 |
| **状态** | [ ] TODO |

---

## Phase 4：高级进阶（面试加分项）

#### F-23 Multi-Agent Supervisor Pattern

| 项目 | 内容 |
|------|------|
| **描述** | 引入 Supervisor Agent，管理多个 Specialist Agent（order/coupon/knowledge），支持复杂任务分解 |
| **专业术语** | **Multi-Agent Orchestration** — 多智能体编排，Supervisor 决定哪个 Agent 处理当前任务 |
| **💡 提示** | 参考 `langchain` 项目的 Supervisor + Worker 模式。你的 Supervisor 可以是 LLM 调用，也可以是规则引擎。 |
| **状态** | [ ] TODO |

#### F-24 Human-in-the-Loop（HITL）审批

| 项目 | 内容 |
|------|------|
| **描述** | 敏感操作（如优惠券领取大额优惠）需要人工确认 |
| **专业术语** | **Human-in-the-Loop** — 在 Agent 流程中插入人工审核节点；**Interrupt Mechanism** — LangGraph 的 `interrupt()` 函数 |
| **💡 提示** | 用 LangGraph 的 `interrupt` 函数在 Agent 执行前暂停，等待人工确认后再继续。前端需要展示"等待审批"的状态。 |
| **状态** | [ ] TODO |

#### F-25 用户画像提取

| 项目 | 内容 |
|------|------|
| **描述** | 从对话中自动提取用户特征（语言偏好、常见问题类型、消费习惯）并持久化 |
| **专业术语** | **Cross-Session User Profiling** — 跨会话用户画像；**Structured Output Extraction** — 用 `withStructuredOutput` 提取结构化数据 |
| **💡 提示** | 参考 `workmind7` 的实现：每次对话结束后，调用 LLM 提取用户画像字段，更新到 User 表或单独的 Profile 表。 |
| **状态** | [ ] TODO |

#### F-26 Agent 工作流可视化

| 项目 | 内容 |
|------|------|
| **描述** | 前端实时展示 Agent 的思考链和工具调用过程 |
| **专业术语** | **Agent Workflow Visualization** — 流程图/节点追踪可视化 |
| **💡 提示** | 参考 `jisu-ai-customer` 的 D3.js 可视化和 `langchain` 的 React 组件。SSE 的 `node` 事件可以用来高亮当前执行的节点。 |
| **状态** | [ ] TODO |

#### F-27 MCP Server 暴露

| 项目 | 内容 |
|------|------|
| **描述** | 将 AI 客服 Agent 暴露为 MCP (Model Context Protocol) Server，让其他 AI 工具可以调用 |
| **专业术语** | **Model Context Protocol (MCP)** — Anthropic 提出的 AI 工具互操作标准 |
| **💡 提示** | 参考 `study/LLM/mcp/` 学习 MCP Server 的搭建方式。将 Agent 封装为 MCP 工具，其他 AI 应用可以通过 MCP 协议调用你的客服能力。 |
| **状态** | [ ] TODO |

---

## 附录

### A. 各阶段 AI 能力覆盖对照

| # | AI 能力 | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|---|---------|:-------:|:-------:|:-------:|:-------:|:-------:|
| 1 | Intent Classification & Routing | — | ✅ | ✅ | ✅ | ✅ |
| 2 | Tool-Using Agent / ReAct Pattern | — | ✅ | ✅ | ✅ | ✅ |
| 3 | Retrieval-Augmented Generation | — | ⚠️ Stub | ⚠️ Stub | ✅ | ✅ |
| 4 | Conversation Memory & Persistence | — | ⚠️ MemorySaver | ⚠️ MemorySaver | ✅ | ✅ |
| 5 | Multi-Agent Orchestration | — | ❌ | ❌ | ❌ | ✅ |
| 6 | Human-in-the-Loop | — | ❌ | ❌ | ❌ | ✅ |
| 7 | Streaming Response (SSE) | — | ✅ | ✅ | ✅ | ✅ |
| 14 | Model Provider Abstraction | — | ✅ (复用 AiService) | ✅ | ✅ | ✅ |
| 15 | Circuit Breaker & Rate Limiting | — | ✅ (复用 AiService) | ✅ | ✅ | ✅ |
| 17 | Cross-Session User Profiling | — | ❌ | ❌ | ❌ | ✅ |
| 19 | Agent Workflow Visualization | — | ❌ | ❌ | ❌ | ✅ |

### B. 面试准备速查

| 面试问题方向 | 对应功能 | 参考文件 |
|------------|---------|---------|
| "你是怎么设计 Agent 架构的？" | F-11 StateGraph | [`customer-graph.js`](../../study/LLM/project/jisu-ai-customer/server/src/graphs/customer-graph.js) |
| "工具调用怎么实现的？" | F-03~F-05 Tools | [`order-tools.js`](../../study/LLM/project/jisu-ai-customer/server/src/tools/order-tools.js) |
| "意图分类怎么做的？" | F-06 Intent Router | [`intent-router.node.ts`](../../apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts) |
| "SSE 流式怎么实现的？" | F-13 Controller | [`agent.js`](../../study/LLM/project/jisu-ai-customer/server/src/routes/agent.js) |
| "NestJS DI 怎么集成 LangGraph？" | F-01 + F-12 | 工厂模式 + Module exports |
| "安全方面怎么考虑的？" | P0-02 + F-13 Guard | Module exports 修复 + JwtAuthGuard |
| "如果做 RAG 你会怎么设计？" | F-19~F-21 | pgvector + ingestion pipeline |
| "多 Agent 怎么做？" | F-23 | Supervisor + Worker 模式 |

### C. 参考文档索引

| 文档 | 用途 |
|------|------|
| [`ai-customer-service-sdd.md`](../../plans/joymini-nest-monorepo/ai-customer-service-sdd.md) | 完整的需求规格定义（API设计、数据模型、验收标准） |
| [`phase1-implementation-plan.md`](../../plans/joymini-nest-monorepo/phase1-implementation-plan.md) | Phase 1 的详细实现计划（架构图、时序图、风险分析） |
| [`ai-capabilities-master-table.md`](../../plans/joymini-nest-monorepo/ai-capabilities-master-table.md) | AI 能力全景图、面试级别对照、各项目能力对比 |
| [`spec-coding/02-spec-structure.md`](../../study/LLM/spec-coding/02-spec-structure.md) | 本文件所遵循的 spec 结构规范 |

### D. 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-06-24 | v1.0 | 初始版本，覆盖 Phase 0~4 共 27 项功能 |
| 2026-06-25 | v1.1 | F-06（intent-router.node.ts）标记为 DONE；更新意图分类为 9 类；更新参考文件链接 |

---

> **最后提醒**：本文档的目的是**让你自己写代码**。每项功能只给提示不给完整代码，正是为了你在实现过程中真正理解每一行代码的作用。遇到困难时，先读参考文件理解模式，再动手。加油！💪
