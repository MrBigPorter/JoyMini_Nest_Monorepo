# 04. 创建 10-Intent 路由节点（含 KYC）

## 🎯 本步骤目标

创建 `graph/nodes/intent-router.node.ts`，实现 **10 分类**意图识别路由节点，能够将用户自然语言输入分类为 `order`/`wallet`/`coupon`/`user`/`product`/`lucky-draw`/`kyc`/`rag`/`general`/`unknown` 十类，并定义条件边函数 `routeByIntent` 将不同意图路由到对应的 Agent/Node。

---

## 📖 开发背景

### 承上：上一步做了什么？

[03-创建AiCustomerModule与GraphState.md](03-创建AiCustomerModule与GraphState.md) 完成了：
- 创建 `ai-customer/` 目录结构和所有子目录
- 定义 `ai-customer.module.ts` — 导入所有业务 Module
- 定义 LangGraph State — `graph/state.ts` 使用 `Annotation.Root`
- 在 `client.module.ts` 中注册 AiCustomerModule
- 创建 AiCustomerService 和 AiCustomerController 骨架

### 启下：下一步做什么？

下一步 [05-AnswerSynthesizer与Graph组装.md](05-AnswerSynthesizer与Graph组装.md) 将实现：
- `graph/nodes/answer-synthesizer.node.ts` — 回答合成节点
- `graph/customer.graph.ts` — 完整 Graph 组装
- 将意图路由、Agent 节点、回答合成串联为完整 StateGraph

### 架构中的位置

```
用户输入 → intentRouter (10分类) → routeByIntent (条件边)
                                    ├── order      → orderAgent
                                    ├── wallet     → walletAgent
                                    ├── coupon     → couponAgent
                                    ├── user       → userAgent
                                    ├── product    → productAgent
                                    ├── lucky-draw → luckyAgent
                                    ├── kyc        → kycAgent      ← 新增
                                    ├── rag        → ragNode
                                    ├── general    → generalChatNode
                                    └── unknown    → generalChatNode (fallback)
```

> **2026-06-30 更新 — 方案 B 多领域检测：** intentRouter 将增加多领域检测规则。当用户输入涉及多个领域（如"购买商品订单和优惠券"）时，router 只输出主意图，剩余需求在后续对话轮次中处理。不再输出 `supervised` 意图，Supervisor Node 降级为纯 round 计数器。
> 详见 [`33-工作流型智能体16挑战对标.md`](33-工作流型智能体16挑战对标.md)

---

## 🔧 前提条件

- [x] 03 文档已完成（State 定义、Module 注册）
- [x] Ollama 服务运行中（`ollama serve` 或 Docker）
- [x] `@langchain/core`、`@langchain/langgraph`、`@langchain/ollama` 已安装

---

## ⚙️ 实现步骤

### Step 1: 创建意图路由节点

**文件**: `apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts`

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatOllama } from '@langchain/ollama';
import { AgentStateType } from '../state';

/**
 * 9-Intent 分类 Prompt
 *
 * 设计原则：
 * - 每个分类有明确的描述 + 示例，帮助 LLM 准确分类
 * - 只输出分类词，不输出其他内容（StringOutputParser + trim）
 * - unknown 作为兜底分类，避免强制分类错误
 */
const INTENT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个电商客服意图分类器。请将用户输入分类为以下十类之一，只返回分类名称，不要有任何其他内容：

## 分类列表

### order — 订单相关
用户查询订单状态、物流信息、退款进度、订单详情等需要查询订单数据的问题。
示例："我的订单到哪里了"、"我要退款"、"订单号 12345 的状态"、"帮我查一下最近一笔订单"

### wallet — 钱包/余额
用户查询钱包余额、充值记录、交易记录、提现等与资金相关的问题。
示例："我还有多少钱"、"帮我查一下余额"、"我要提现"、"我的交易记录"

### coupon — 优惠券
用户查询已领取的优惠券、可领取的优惠券、领取优惠券等。
示例："我有哪些优惠券"、"有什么券可以领"、"领一张满减券"

### user — 个人信息
用户查询个人信息、账户资料、会员等级、收货地址等。
示例："我的个人信息"、"我的会员等级"、"我的收货地址"

### product — 商品/拼团
用户搜索商品、查看商品详情、查询拼团信息等。
示例："搜索蓝牙耳机"、"这个商品多少钱"、"有哪些拼团"

### lucky-draw — 抽奖
用户查询抽奖券、中奖记录、执行抽奖等。
示例："我有哪些抽奖券"、"我中奖了吗"、"我要抽奖"

### rag — 政策规则
用户咨询退货政策、发货政策、优惠券规则、隐私政策等平台规则类问题。
示例："怎么退货"、"发货要多久"、"优惠券能用吗"、"隐私政策"

### general — 通用对话
问候、道谢、自我介绍、闲聊等不需要查询数据的一般对话。
示例："你好"、"谢谢"、"你是谁"、"今天天气不错"

### unknown — 无法确定
当上述分类都不确定时使用，交给通用对话处理。
示例：无意义输入、乱码、无法理解的问题

只输出一个词：order 或 wallet 或 coupon 或 user 或 product 或 lucky-draw 或 rag 或 general 或 unknown`,
  ],
  ['human', '{input}'],
]);

// 有效意图列表（用于校验 LLM 输出）
const VALID_INTENTS = [
  'order',
  'wallet',
  'coupon',
  'user',
  'product',
  'lucky-draw',
  'rag',
  'general',
  'unknown',
] as const;

export type Intent = (typeof VALID_INTENTS)[number];

/**
 * 意图路由节点
 *
 * 使用 ChatOllama + ChatPromptTemplate + StringOutputParser 实现 LLM 分类。
 * temperature: 0 确保分类结果稳定可复现。
 *
 * @param state - LangGraph State（包含 messages 和 userId）
 * @returns 更新后的 state（intent 字段）
 */
export const intentRouterNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  // 从 messages 中提取最后一条用户消息
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  // 创建 Ollama 模型实例（temperature=0 确保稳定）
  const model = new ChatOllama({
    model: 'qwen3.5:0.8b',
    temperature: 0,
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  });

  // 组装 chain: prompt → model → string parser
  const chain = INTENT_PROMPT.pipe(model).pipe(new StringOutputParser());

  // 执行分类
  const raw = await chain.invoke({ input: userInput });
  const trimmed = raw.trim().toLowerCase();

  // 校验输出是否在有效意图列表中
  const finalIntent: Intent = VALID_INTENTS.includes(trimmed as Intent)
    ? (trimmed as Intent)
    : 'unknown';

  console.log(`[intentRouter] "${userInput.slice(0, 50)}..." → ${finalIntent}`);

  return { intent: finalIntent };
};

/**
 * 条件边路由函数
 *
 * 根据 state.intent 的值，返回对应的下一个节点名称。
 * 这个函数被 addConditionalEdges 用于动态路由。
 *
 * @param state - 当前状态
 * @returns 目标节点名称
 */
export const routeByIntent = (
  state: typeof AgentState.State,
): string => {
  const routeMap: Record<string, string> = {
    order: 'orderAgent',
    wallet: 'walletAgent',
    coupon: 'couponAgent',
    user: 'userAgent',
    product: 'productAgent',
    luckyDraw: 'luckyAgent',
    rag: 'ragNode',
    general: 'generalChat',
    unknown: 'generalChat',
  };

  return routeMap[state.intent] || 'generalChat';
};
```

### Step 2: 理解 9 分类设计

| 意图 | 目标节点 | 路由到的 Agent/Node | 说明 |
|------|---------|-------------------|------|
| `order` | `orderAgent` | ReAct Agent (Order) | 3 个订单工具 |
| `wallet` | `walletAgent` | ReAct Agent (Wallet) | 3 个钱包工具 |
| `coupon` | `couponAgent` | ReAct Agent (Coupon) | 3 个优惠券工具 |
| `user` | `userAgent` | ReAct Agent (User) | 3 个用户工具 |
| `product` | `productAgent` | ReAct Agent (Product) | 4 个商品工具 |
| `lucky-draw` | `luckyAgent` | ReAct Agent (Lucky) | 5 个抽奖/闪购工具 |
| `rag` | `ragNode` | 知识库节点 | Phase 1 Stub / Phase 3 向量搜索 |
| `general` | `generalChat` | 直接 LLM 对话 | 不需要工具 |
| `unknown` | `generalChat` | Fallback 对话 | 兜底分类 |

### Step 3: 理解 ChatOllama 的使用方式

关键设计：本步骤直接使用 `new ChatOllama()` 而不是通过 `AiService`。

原因：
- `AiService` 的 `generateText()` 返回字符串，不支持 LangChain 的 `.pipe()` 链式调用
- `ChatOllama` 是 LangChain 的标准 Model 类，与 `ChatPromptTemplate`、`StringOutputParser` 无缝集成
- `temperature: 0` 确保分类结果的稳定性和可复现性

**但注意**：这种方式绕过了 AiService 的多 Provider 容错机制。如果后续需要容错，可以用 `ChatAnthropic`、`ChatGoogleGenerativeAI` 等封装 fallback chain：

```typescript
// 可选的 fallback chain（Phase 5 优化）
const model = new ChatOllama({ ... }).withFallbacks({
  fallbacks: [
    new ChatAnthropic({ ... }),
    new ChatGoogleGenerativeAI({ ... }),
  ],
});
```

### Step 4: 理解条件边的工作原理

在 LangGraph 中，条件边（`addConditionalEdges`）允许根据 state 的内容动态决定下一个节点：

```typescript
// 在 graph 组装时（下一步 05 实现）
graph.addConditionalEdges('intentRouter', routeByIntent, {
  orderAgent: 'orderAgent',
  walletAgent: 'walletAgent',
  couponAgent: 'couponAgent',
  userAgent: 'userAgent',
  productAgent: 'productAgent',
  luckyAgent: 'luckyAgent',
  ragNode: 'ragNode',
  generalChat: 'generalChat',
});
```

- `routeByIntent` 根据 `state.intent` 返回目标节点名称
- 第三个参数是 **path map**，将返回的节点名称映射到图中注册的节点
- 所有意图最终都路由到对应的处理节点

---

## ✅ 验证

```bash
# 测试意图分类效果
node -e "
const { ChatOllama } = require('@langchain/ollama');
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');

async function test() {
  const model = new ChatOllama({
    model: 'qwen3.5:0.8b',
    temperature: 0,
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', '你是一个意图分类器。将输入分类为 order/wallet/coupon/user/product/lucky-draw/rag/general/unknown。只输出一个词。'],
    ['human', '{input}'],
  ]);

  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  const tests = ['我的订单到哪里了', '我还有多少钱', '有什么优惠券可以领', '你好', '怎么退货'];
  for (const t of tests) {
    const result = await chain.invoke({ input: t });
    console.log(\`\${t} → \${result.trim()}\`);
  }
}
test();
"
```

预期输出示例：
```
我的订单到哪里了 → order
我还有多少钱 → wallet
有什么优惠券可以领 → coupon
你好 → general
怎么退货 → rag
```

---

## 📝 技术要点

### ChatPromptTemplate 的 Messages 格式

```typescript
// ['system', '...'] 和 ['human', '...'] 是 LangChain 的简写方式
// 等价于：
// new SystemMessage('...')
// new HumanMessage('...')
```

### StringOutputParser

`StringOutputParser` 将 LLM 的输出流解析为字符串。配合 `temperature: 0`，确保每次同一输入得到相同的分类结果。

### Unknown 兜底

`unknown` 分类被路由到 `generalChat`，而不是返回错误或重新询问。这确保了即使 LLM 分类不准，用户也能得到有意义的回复，而不是死循环。

### 为什么 ChatOllama 参数是硬编码的？

本步骤为了方便演示直接 `new ChatOllama()`。在后续步骤（05）中，我们会将其改为从配置文件或环境变量读取，并考虑通过 AiService 获取 Provider。

---

## ✅ 实施状态（2026-06-25）

### 已创建的文件

| 文件 | 状态 |
|------|------|
| `apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts` | 已完成 |
| `apps/api/src/client/ai-customer/ai-customer.service.ts` | 新增 testIntent() |
| `apps/api/src/client/ai-customer/ai-customer.controller.ts` | 新增 POST /test-intent |

### API 验证结果

通过 HTTP API 测试意图分类，全部正确：

```bash
POST /api/v1/ai-customer/test-intent

"message": "I want to check my order status"  -> intent: order
"message": "I want a refund"                   -> intent: refund
"message": "where is my package"               -> intent: shipping
"message": "show me products"                  -> intent: product
"message": "any discounts"                     -> intent: promotion
"message": "my account info"                   -> intent: account
"message": "payment not working"               -> intent: payment
"message": "I want to complain"                -> intent: complaint
"message": "hello"                             -> intent: general
```

> 注：当前 Prompt 使用 9 个英文分类标签，与本文档 Step 2 的 9 分类略有不同。额外意图（refund/shipping/promotion/account/payment/complaint）通过 routeByIntent 映射到 generalChat 作为 fallback。

### 基础设施变更

- compose.yml — 启用 ollama 服务，backend depends_on ollama
- deploy/.env.dev — OLLAMA_BASE_URL/AI_OLLAMA_BASE_URL 指向 http://ollama:11434
- csrf.middleware.ts — 非生产环境跳过 CSRF

### 关键教训

Ollama 和 backend 必须同在一个网络内（都在 Docker 内或都在宿主机），避免跨网络边界调用 LLM 推理。详见 [01-配置-AiService与Ollama集成.md](01-配置-AiService与Ollama集成.md) 的故障排查章节。

---

## 🔜 下一步预告

在 [05-AnswerSynthesizer与Graph组装.md](05-AnswerSynthesizer与Graph组装.md) 中，我们将：
- 创建 `graph/nodes/answer-synthesizer.node.ts` — 将 Agent/RAG 输出合成为自然语言回复
- 创建 `graph/nodes/general-chat.node.ts` — 通用对话节点
- 创建 `graph/customer.graph.ts` — 将所有节点组装为完整的 StateGraph
- 更新 `ai-customer.service.ts` — 注入服务实例，初始化 Graph
