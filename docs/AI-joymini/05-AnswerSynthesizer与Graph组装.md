# 05. Answer Synthesizer + Graph 组装

## 🎯 本步骤目标

1. 创建 `graph/nodes/answer-synthesizer.node.ts` — 回答合成节点，将 Agent/RAG 输出转化为自然语言回复
2. 创建 `graph/nodes/general-chat.node.ts` — 通用对话节点，处理无需工具调用的闲聊
3. 创建 `graph/customer.graph.ts` — 完整 StateGraph 组装，连接所有节点
4. 更新 `ai-customer.service.ts` — 注入所有业务 Service，初始化并编译 Graph

完成本步骤后，LangGraph 的完整流程图将形成闭环，所有节点连通，可以被 invoke/streamEvents 调用。

---

## 📖 开发背景

### 承上：上一步做了什么？

[04-创建9Intent路由节点.md](04-创建9Intent路由节点.md) 完成了：
- `graph/nodes/intent-router.node.ts` — 9 分类意图识别
- `routeByIntent` 条件边函数 — 动态路由到对应节点
- 理解 ChatOllama 的使用方式和条件边工作原理

### 启下：下一步做什么？

从下一步开始进入 **Phase 2：7 个 ReAct Agent** 的开发：

| # | 文档 | Agent | 工具数 |
|---|------|-------|--------|
| 06 | [Order Agent + Tools](06-OrderAgent与Tools.md) | orderAgent | 3 |
| 07 | [Wallet Agent + Tools](07-WalletAgent与Tools.md) | walletAgent | 3 |
| 08 | [Coupon Agent + Tools](08-CouponAgent与Tools.md) | couponAgent | 3 |
| 09 | [User+Address Agent + Tools](09-UserAddressAgent与Tools.md) | userAgent | 3 |
| 10 | [Product+Group Agent + Tools](10-ProductGroupAgent与Tools.md) | productAgent | 4 |
| 11 | [LuckyDraw+Flash Agent + Tools](11-LuckyDrawFlashAgent与Tools.md) | luckyAgent | 5 |
| 12 | [KYC Agent + Tools](04-创建9Intent路由节点.md) | kycAgent ★新增 | 3 |

### 架构概览

```
                    ┌──────────────┐
                    │    START     │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ intentRouter │  ← 04 创建
                    └──────┬───────┘
                           │ routeByIntent (条件边)
         ┌────────┬───┬────┼────┬───┬────────┬────────┐
         ▼        ▼   ▼    ▼    ▼   ▼        ▼        ▼
    orderAgent  wallet  coupon user product lucky   ragNode  generalChat
         │        │   │    │    │   │        │        │
         └────────┴───┴────┴────┴───┴────────┴────────┘
                           │
                    ┌──────▼───────┐
                    │answerSynth   │  ← 本步骤创建
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │     END      │
                    └──────────────┘
```

---

## 🔧 前提条件

- [x] 04 文档已完成（Intent Router 节点）
- [x] `@langchain/core`, `@langchain/langgraph`, `@langchain/ollama` 已安装
- [x] 目录结构已创建（`graph/nodes/`, `graph/tools/`）

---

## ⚙️ 实现步骤

### Step 1: 创建 Answer Synthesizer 节点

**文件**: `apps/api/src/client/ai-customer/graph/nodes/answer-synthesizer.node.ts`

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatOllama } from '@langchain/ollama';
import { AgentStateType } from '../state';

/**
 * Answer Synthesizer — 回答合成节点
 *
 * 功能：把 Agent 工具调用结果或 RAG 查询结果，合成为自然语言回复。
 * 对于 generalChat 节点，其输出已经是最终答案，直接透传。
 *
 * 设计原则：
 * - 称呼用户为"亲"（电商客服风格）
 * - 语气友好、专业，内容简洁准确
 * - 如果 agentOutput 为空，给出友好提示
 */
const SYNTHESIZER_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是 JoyMini 电商平台的 AI 客服助手，名字叫小 Joy。

根据以下查询结果，为用户生成一个清晰、友好的回答。
称呼用户为"亲"，语气专业，内容简洁准确。

如果查询结果是数据列表，请以简洁的格式呈现（编号列表）。
如果查询结果是错误信息，请友好地告知用户并提供建议。
如果没有任何结果，请礼貌地告知用户。

Agent 查询结果：
{agentOutput}

用户原始问题：{userInput}`,
  ],
  ['human', '{userInput}'],
]);

/**
 * Answer Synthesizer Node
 *
 * 接收来自 Agent 节点或 RAG 节点的 agentOutput，
 * 使用 ChatOllama 生成最终的自然语言回复。
 *
 * 对于 generalChat 节点，agentOutput 已经是最终答案，直接透传。
 */
export const answerSynthesizerNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  // 从 messages 中提取最后一条用户消息
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  const { intent, agentOutput } = state;

  // 如果 agentOutput 为空，返回友好提示
  if (!agentOutput) {
    return {
      messages: [
        {
          role: 'assistant',
          content: '亲，抱歉我没能查到相关信息，请稍后再试或联系人工客服哦～',
        },
      ],
    };
  }

  // generalChat 的输出已经是最终答案，直接透传
  if (intent === 'general') {
    return {
      messages: [
        {
          role: 'assistant',
          content: agentOutput,
        },
      ],
    };
  }

  const model = new ChatOllama({
    model: 'qwen3.5:0.8b',
    temperature: 0.5,
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  });

  const chain = SYNTHESIZER_PROMPT.pipe(model).pipe(new StringOutputParser());

  const result = await chain.invoke({
    agentOutput: agentOutput || '无查询结果',
    userInput,
  });

  return {
    messages: [
      {
        role: 'assistant',
        content: result,
      },
    ],
  };
};
```

### Step 2: 创建 General Chat 节点

**文件**: `apps/api/src/client/ai-customer/graph/nodes/general-chat.node.ts`

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatOllama } from '@langchain/ollama';
import { AgentStateType } from '../state';

/**
 * General Chat — 通用对话节点
 *
 * 处理无需调用任何工具的闲聊类问题（问候、道谢、自我介绍等）。
 * 同时也是 unknown 意图的 fallback 处理节点。
 *
 * 输出直接设置到 agentOutput，answerSynthesizer 会将其透传。
 */
const GENERAL_CHAT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是 JoyMini 电商平台的 AI 客服助手，名字叫小 Joy。

你是一个友好、热情的电商客服助手。你可以：
1. 回答关于 JoyMini 平台的一般性问题
2. 进行日常寒暄和闲聊
3. 引导用户使用具体功能（查订单、查余额、看商品等）

注意：
- 如果用户有明确的查询需求（如查订单、查余额），引导用户使用对应功能
- 保持回复简洁、友好
- 不确定的信息不要编造，引导用户咨询人工客服`,
  ],
  ['human', '{input}'],
]);

/**
 * General Chat Node
 *
 * 直接用 LLM 生成回复，不需要工具调用。
 * 输出写入 agentOutput，由 answerSynthesizer 透传给用户。
 */
export const generalChatNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  const model = new ChatOllama({
    model: 'qwen3.5:0.8b',
    temperature: 0.7,
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  });

  const chain = GENERAL_CHAT_PROMPT.pipe(model).pipe(new StringOutputParser());
  const result = await chain.invoke({ input: userInput });

  return {
    agentOutput: result,
    messages: [
      {
        role: 'assistant',
        content: result,
      },
    ],
  };
};
```

### Step 3: 创建 Graph 组装文件

**文件**: `apps/api/src/client/ai-customer/graph/customer.graph.ts`

```typescript
import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentState } from './state';
import { intentRouterNode, routeByIntent } from './nodes/intent-router.node';
import { answerSynthesizerNode } from './nodes/answer-synthesizer.node';
import { generalChatNode } from './nodes/general-chat.node';

// Agent nodes (to be implemented in Phase 2 docs 06-11)
import { orderAgentNode } from './nodes/order-agent.node';
import { walletAgentNode } from './nodes/wallet-agent.node';
import { couponAgentNode } from './nodes/coupon-agent.node';
import { userAgentNode } from './nodes/user-agent.node';
import { productAgentNode } from './nodes/product-agent.node';
import { luckyAgentNode } from './nodes/lucky-agent.node';
import { ragNode } from './nodes/rag.node';

/**
 * Build and compile the AI Customer StateGraph
 *
 * Node flow:
 * 1. START → intentRouter (classify user intent)
 * 2. intentRouter → routeByIntent (conditional edge to agent)
 * 3. Agent/RAG/GeneralChat → answerSynthesizer
 * 4. answerSynthesizer → END
 */
export function buildCustomerGraph() {
  const workflow = new StateGraph(AgentState)
    // ── Register all nodes ──
    .addNode('intentRouter', intentRouterNode)
    .addNode('orderAgent', orderAgentNode)
    .addNode('walletAgent', walletAgentNode)
    .addNode('couponAgent', couponAgentNode)
    .addNode('userAgent', userAgentNode)
    .addNode('productAgent', productAgentNode)
    .addNode('luckyAgent', luckyAgentNode)
    .addNode('ragNode', ragNode)
    .addNode('generalChat', generalChatNode)
    .addNode('answerSynthesizer', answerSynthesizerNode)

    // ── Edges ──
    // Start → Intent Router
    .addEdge(START, 'intentRouter')

    // Intent Router → Route by intent (conditional)
    .addConditionalEdges('intentRouter', routeByIntent, {
      orderAgent: 'orderAgent',
      walletAgent: 'walletAgent',
      couponAgent: 'couponAgent',
      userAgent: 'userAgent',
      productAgent: 'productAgent',
      luckyAgent: 'luckyAgent',
      ragNode: 'ragNode',
      generalChat: 'generalChat',
    })

    // All agent/nodes → Answer Synthesizer
    .addEdge('orderAgent', 'answerSynthesizer')
    .addEdge('walletAgent', 'answerSynthesizer')
    .addEdge('couponAgent', 'answerSynthesizer')
    .addEdge('userAgent', 'answerSynthesizer')
    .addEdge('productAgent', 'answerSynthesizer')
    .addEdge('luckyAgent', 'answerSynthesizer')
    .addEdge('ragNode', 'answerSynthesizer')
    .addEdge('generalChat', 'answerSynthesizer')

    // Answer Synthesizer → END
    .addEdge('answerSynthesizer', END);

  // Compile the graph
  return workflow.compile();
}
```

### Step 4: 创建 RAG Node Stub（Phase 1 占位）

**文件**: `apps/api/src/client/ai-customer/graph/nodes/rag.node.ts`

```typescript
/**
 * RAG Node — Phase 1 Stub
 *
 * Phase 1: 静态政策文档加载（从 knowledge/ 目录读取 .md 文件）
 * Phase 3: 替换为完整的 pgvector 向量搜索（见文档 17）
 *
 * 本文件是占位节点，用于确保 Graph 编译通过。
 * Phase 2 阶段所有 Agent 节点也是占位状态，Phase 1 的 RAG 也保持简单。
 */
import { AgentStateType } from '../state';

export const ragNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  // Phase 1 Stub: 简单的政策文档查找
  // 后续将在文档 12 中实现完整逻辑
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  return {
    agentOutput: `【知识库查询结果】\n用户问题：${userInput}\n\n抱歉，知识库功能正在建设中，请稍后再试。如需人工帮助，请联系客服。`,
  };
};
```

### Step 5: 更新 AiCustomerService — 注入所有 Service 并初始化 Graph

**文件**: `apps/api/src/client/ai-customer/ai-customer.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AiService } from '@api/common/ai/ai.service';
import { OrderService } from '@api/client/orders/order.service';
import { WalletService, ClientWalletService } from '@api/client/wallet/wallet.service';
import { ClientCouponService } from '@api/client/coupon/coupon.service';
import { AuthService } from '@api/client/auth/auth.service';
import { TreasureService } from '@api/client/treasure/treasure.service';
import { AddressService } from '@api/client/address/address.service';
import { ClientFlashSaleService } from '@api/client/flash-sale/flash-sale.service';
import { GroupService } from '@api/common/group/group.service';
import { LuckyDrawService } from '@api/common/lucky-draw/lucky-draw.service';
import { buildCustomerGraph } from './graph/customer.graph';

@Injectable()
export class AiCustomerService implements OnModuleInit {
  private readonly logger = new Logger(AiCustomerService.name);
  private compiledGraph: ReturnType<typeof buildCustomerGraph> | null = null;

  constructor(
    private readonly aiService: AiService,
    private readonly orderService: OrderService,
    private readonly walletService: WalletService,
    private readonly clientWalletService: ClientWalletService,
    private readonly couponService: ClientCouponService,
    private readonly authService: AuthService,
    private readonly treasureService: TreasureService,
    private readonly addressService: AddressService,
    private readonly flashSaleService: ClientFlashSaleService,
    private readonly groupService: GroupService,
    private readonly luckyDrawService: LuckyDrawService,
  ) {}

  async onModuleInit() {
    await this.initGraph();
  }

  /**
   * Initialize and compile the LangGraph
   * Builds the graph and stores the compiled instance
   */
  async initGraph() {
    if (this.compiledGraph) return;
    try {
      this.compiledGraph = buildCustomerGraph();
      this.logger.log('AiCustomer Graph compiled successfully');
    } catch (error) {
      this.logger.error('Failed to compile AiCustomer Graph', error);
      throw error;
    }
  }

  /**
   * Get the compiled graph instance
   */
  getGraph() {
    if (!this.compiledGraph) {
      throw new Error('Graph not initialized. Call initGraph() first.');
    }
    return this.compiledGraph;
  }

  /**
   * Main chat entry point — will be implemented in step 14 with SSE
   */
  async chatStream(input: string, userId: string, sessionId: string) {
    throw new Error('Not implemented yet — see step 14');
  }
}
```

### Step 6: 更新 AiCustomerModule — 添加所有 Provider

**文件**: `apps/api/src/client/ai-customer/ai-customer.module.ts`

现在添加所有导入的 Service 的对应 Module，以及更新 providers 列表：

```diff
// apps/api/src/client/ai-customer/ai-customer.module.ts
import { Module } from '@nestjs/common';
import { OrderModule } from '@api/client/orders/order.module';
import { WalletModule } from '@api/client/wallet/wallet.module';
import { CouponModule } from '@api/client/coupon/coupon.module';
import { TreasureModule } from '@api/client/treasure/treasure.module';
import { AddressModule } from '@api/client/address/address.module';
import { FlashSaleModule } from '@api/client/flash-sale/flash-sale.module';
import { GroupModule } from '@api/common/group/group.module';
import { LuckyDrawModule } from '@api/common/lucky-draw/lucky-draw.module';
import { AuthModule } from '@api/client/auth/auth.module';
import { AiCustomerController } from './ai-customer.controller';
import { AiCustomerService } from './ai-customer.service';

@Module({
  imports: [
    OrderModule,
    WalletModule,
    CouponModule,
    TreasureModule,
    AddressModule,
    FlashSaleModule,
    GroupModule,
    LuckyDrawModule,
    AuthModule,
  ],
  controllers: [AiCustomerController],
  providers: [AiCustomerService],
})
export class AiCustomerModule {}
```

---

## ✅ 验证

```bash
# 编译检查
yarn workspace @lucky/api build

# 测试 Graph 是否可编译
yarn workspace @lucky/api start:dev &
# 检查日志中是否出现 "AiCustomer Graph compiled successfully"
```

---

## 📝 技术要点

### StateGraph 节点注册顺序

LangGraph 中节点的注册顺序不影响执行顺序。执行顺序由 `.addEdge()` 和 `.addConditionalEdges()` 决定。但建议按照逻辑流程顺序注册，方便阅读。

### 为什么 generalChat 节点也走 answerSynthesizer？

虽然 generalChat 的输出已经是最终答案，但统一走 answerSynthesizer 可以：
1. 保持图结构一致（所有 Agent/Node → answerSynthesizer → END）
2. 方便在 answerSynthesizer 中做统一的后处理（如格式检查、长度限制）
3. 便于后续增加 logging、analytics 等横切关注点

### `OnModuleInit` vs 懒加载

本步骤使用 `OnModuleInit` 在应用启动时编译 Graph。优点是首次请求无延迟。如果 Graph 编译耗时较长（如加载模型），也可以改为懒加载，在 `chatStream()` 首次调用时初始化。

### 占位节点说明

`orderAgent`、`walletAgent` 等 6 个 Agent 节点和 `ragNode` 目前是**占位状态**（需要导入但尚未实现完整逻辑）。它们的真实实现将在 Phase 2（文档 06-11）和 Phase 3（文档 12）中完成。

当前只需要创建对应的 `.node.ts` 文件并导出默认节点函数（返回空 `agentOutput`），确保 Graph 编译通过即可。

---

## 🔜 下一步预告

在 [06-OrderAgent与Tools.md](06-OrderAgent与Tools.md) 中，我们将开始实现 Phase 2 的第一个 ReAct Agent：
- **Order Agent** — 使用 `createReactAgent` 构建
- **Order Tools** — 3 个工具：`orderListTool`、`orderDetailTool`、`applyRefundTool`
- **Tool 工厂函数模式** — 将 NestJS Service 注入到 LangChain tool() 中
