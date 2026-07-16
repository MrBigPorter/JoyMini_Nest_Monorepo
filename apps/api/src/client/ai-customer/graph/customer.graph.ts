/**
 * Customer Graph — AI 客服 StateGraph
 *
 * ── 和旧架构的区别 ──
 * 旧架构: 10+ 节点, 65+ 行条件边 (intentRouter → supervisorRouter → agentDoneRouter → ...)
 * 新架构: 3 节点, 2 边
 *
 *   START
 *     │
 *     └─ intentGateway ──→ intentRouter
 *                            │
 *                            └─ orchestrator ──→ END
 *
 * ── 为什么能简化？ ──
 * 1. 多 Agent 调度从 StateGraph 条件边 → for loop（orchestrator.node.ts）
 * 2. labels[] 数组代替了 supervisorRouter + agentDoneRouter + pendingTasks
 * 3. 所有 Agent 共享完整上下文，无需 messageTopics 过滤
 * 4. orchestrator 自己处理合成回复，无需 answerSynthesizer 节点
 */
import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { AgentState } from './state';
import {
  createIntentRouterNode,
  routerByIntent,
} from './nodes/intent-router.node';
import { createOrchestratorNode } from './nodes/orchestrator.node';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import { RagRetrievalService } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import { PromptResolverService } from '@api/client/ai-customer/knowledge/prompt-resolver.service';

/**
 * intentGateway — 强制走 intentRouter 重新分类
 */
const intentGateway = (_state: typeof AgentState.State): string => {
  return 'intentRouter';
};

/**
 * buildCustomerGraph — 构建 AI 客服 StateGraph
 *
 * ── 节点流 ──
 * START → intentGateway → intentRouter → orchestrator → END
 *
 * Intent Router 使用嵌入向量分类（IntentClassifier），
 * 需要 AiService 实例来调用 generateEmbedding()。
 *
 * ════════════════════════════════════════════════════════════════
 * 【运行示例 — "那我要买Women Crossbody Bag Set，团购价格多少，加上优惠券，我还有多少钱"]
 * ════════════════════════════════════════════════════════════════
 *
 * 时间线（debug=true）:
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  STEP 1: START                                              │
 * │  intentGateway 无条件路由到 intentRouter                     │
 * └─────────────────────┬───────────────────────────────────────┘
 *                       │
 *                       ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │  STEP 2: intentRouter (IntentClassifier.classify)           │
 * │  输入: "那我要买Women Crossbody Bag Set..."                  │
 * │  行为:                                                     │
 * │    a. ensureSeeded() → 已有 61 条数据 → 跳过               │
 * │    b. generateEmbedding() → 向量                           │
 * │    c. pgvector TOP-5 → 域去重 → 阈值过滤                   │
 * │  输出:                                                     │
 * │    intent: 'product'                                       │
 * │    labels: [{product:0.86}, {coupon:0.60}, {wallet:0.59}]  │
 * │    debugInfo.embedding: { method, rawTop5, dedupedLabels } │
 * │  (debug=true 时写入)                                       │
 * └─────────────────────┬───────────────────────────────────────┘
 *                       │ routerByIntent → 始终返回 'orchestrator'
 *                       ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │  STEP 3: orchestrator (流水线执行器)                        │
 * │  输入: state.labels = [product:0.86, coupon:0.60, wallet:0.59]
 * │  行为:                                                     │
 * │    a. 排序: product(0.86) > coupon(0.60) > wallet(0.59)    │
 * │    b. 依赖解析: resolveExecutionOrder → [product,coupon,wallet]
 * │    c. Agent 循环:                                          │
 * │       ┌──────────────────────────────────────────────┐     │
 * │       │ 产品 Agent (productAgent)                    │     │
 * │       │ 工具: searchProducts, getGroupBuyProducts    │     │
 * │       │ 结果: "Women Crossbody Bag Set 团购价 $29.99"│     │
 * │       ├──────────────────────────────────────────────┤     │
 * │       │ 优惠券 Agent (couponAgent)                   │     │
 * │       │ 工具: getMyCoupons, claimCoupon              │     │
 * │       │ 结果: "您有 JOY10 优惠券可用"                 │     │
 * │       ├──────────────────────────────────────────────┤     │
 * │       │ 钱包 Agent (walletAgent)                     │     │
 * │       │ 工具: getWalletBalance, requestWithdrawOtp   │     │
 * │       │ 结果: "您的钱包余额为 $105.50"               │     │
 * │       └──────────────────────────────────────────────┘     │
 * │    d. 合成回复:                                            │
 * │       synthesizeAnswers([product,coupon,wallet], userInput)│
 * │       → "Women Crossbody Bag Set 团购价 $29.99 起!..."    │
 * │  输出:                                                     │
 * │    messages: [...原有, AIMessage(finalContent)]             │
 * │    labels: [] ← 清空                                       │
 * │    previousIntent: 'product'                               │
 * │    debugInfo.execution: { executionOrder, agents[] }       │
 * └─────────────────────┬───────────────────────────────────────┘
 *                       │
 *                       ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │  STEP 4: END                                                │
 * │  compiledGraph 返回最终 state                                │
 * │  ai-customer.service.ts 读取 result                         │
 * │  debug=true → 返回 { intent, agentOutput, debug:{...} }    │
 * └─────────────────────────────────────────────────────────────┘
 *
 * 第二轮对话（用户回复 "下单"）:
 *  START → intentGateway (强制走 intentRouter 重新分类)
 *       → intentRouter (classify("下单") → 短输入 + previousIntent='product'
 *         → embedding 可能 low confidence → LLM fallback → 'order')
 *       → orchestrator (executionOrder = ['order'])
 *       → END
 *
 * MemorySaver 线程 id='session-xyz' 确保两轮对话的 state 共享。
 * ════════════════════════════════════════════════════════════════
 *
 * @param llmConfig
 * @param registry
 * @param aiService          AiService 实例（用于 embedding 生成）
 * @param prismaService      PrismaService 实例（用于 pgvector 查询）
 * @param meilisearchService MeilisearchService 实例（用于 BM25 关键词搜索）
 * @param ragRetrievalService  RagRetrievalService 实例（用于 RAG 检索）
 * @param promptResolver      PromptResolverService 实例（用于运行时 prompt 合并）
 */
export function buildCustomerGraph(
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
  aiService: AiService,
  prismaService: PrismaService,
  meilisearchService: MeilisearchService,
  ragRetrievalService?: RagRetrievalService,
  promptResolver?: PromptResolverService,
) {
  const workflow = new StateGraph(AgentState)

    // 注册节点 — intentRouter 使用 IntentClassifier 分类意图
    .addNode(
      'intentRouter',
      createIntentRouterNode(
        llmConfig,
        aiService,
        prismaService,
        meilisearchService,
      ),
    )
    .addNode(
      'orchestrator',
      createOrchestratorNode(
        llmConfig,
        registry,
        ragRetrievalService,
        promptResolver,
      ),
    )

    // START → intentRouter（强制走 intentRouter 重新分类）
    .addConditionalEdges(START, intentGateway, {
      intentRouter: 'intentRouter',
    })

    // intentRouter → orchestrator（routerByIntent 始终返回 'orchestrator'）
    .addConditionalEdges('intentRouter', routerByIntent, {
      orchestrator: 'orchestrator',
    })

    // orchestrator → END
    .addEdge('orchestrator', END);

  // 编译图
  return workflow.compile({
    checkpointer: new MemorySaver(),
  });
}
