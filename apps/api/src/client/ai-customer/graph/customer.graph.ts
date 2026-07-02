import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { AgentState } from './state';
import {
  createIntentRouterNode,
  routerByIntent,
} from './nodes/intent-router.node';
import { createWalletAgentNode } from '@api/client/ai-customer/graph/nodes/wallet-agent.node';
import { createAnswerSynthesizerNode } from './nodes/answer-synthesizer.node';
import { createGeneralChatNode } from './nodes/general-chat.node';
import { createOrderAgentNode } from './nodes/order-agent.node';
import { createCouponAgentNode } from './nodes/coupon-agent.node';
import { ragNode } from './nodes/rag.node';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { createSupervisorNode } from '@api/client/ai-customer/graph/nodes/supervisor.node';

/**
 * intentGateway — 入口路由
 *
 * Phase 3: 每轮都走 intentRouter 让 LLM 重新分类。
 * 不再使用 routeCache 作为快捷路由（避免话题切换时路由错误）。
 * intentRouter 通过 previousIntent + conversationContext 理解简短消息的上下文。
 */
const intentGateway = (_state: typeof AgentState.State): string => {
  return 'intentRouter';
};

/**
 * Unified Agent Done Router
 * Replaces rerouteGateway. Handles 3 cases:
 * 1. Agent triggered reroute → re-classify at intentRouter
 * 2. Supervisor mode active → return to supervisorNode for next task
 * 3. Normal completion → answerSynthesizer
 */
const agentDoneRouter = (state: typeof AgentState.State): string => {
  if (state.pendingTasks && state.pendingTasks.length > 0)
    return 'supervisorNode';
  return 'answerSynthesizer';
};

/**
 * Supervisor Router
 * Routes to the next unexecuted task's agent.
 * If all tasks done or max rounds reached → answerSynthesizer.
 */

const supervisorRouter = (state: typeof AgentState.State): string => {
  const maxRounds = 5;
  // 取得上一步createSupervisorNode=》supervisorRound=1
  const round = state.supervisorRound ?? 0;
  // round 0: supervisor hasn't decomposed tasks yet (shouldn't reach here)
  // round 1: dispatch pendingTasks[0] (first agent)
  // round 2: dispatch pendingTasks[1] (second agent)
  // etc.
  //取得0轮的对应的任务索引,比如walletAgent
  const taskIndex = round - 1;
  //最后返回walletAgent，然后walletAgent连接着agentDoneRouter=》supervisorNode
  if (round >= maxRounds || taskIndex >= (state.pendingTasks.length ?? 0)) {
    return 'answerSynthesizer';
  }

  return state.pendingTasks[taskIndex].agent;
};
/**
 * Build and compile the AI Customer StateGraph
 *
 * === Phase 2 路由机制 ===
 * intentGateway 优先检查 state.routeCache：
 *   - 有 routeCache → 直接路由到对应 Agent（跳过 LLM 分类）
 *   - 无 routeCache → 走 intentRouter 让 LLM 分类
 * intentRouter 同时写入 state.intent + state.routeCache
 * answerSynthesizer 每轮清空 intent 但保留 routeCache
 *
 * Node flow:
 * 1. START → intentGateway
 * 2. intentGateway → (有 routeCache) → routerByIntent → Agent
 * 2. intentGateway → (无 routeCache) → intentRouter → routerByIntent → Agent
 * 3. Agent/RAG/GeneralChat → answerSynthesizer
 * 4. answerSynthesizer → END
 *
 * Turn 1: "I want to withdraw"（首次对话，routeCache 为空）
 *   START → intentGateway (routeCache='' → 'intentRouter')
 *     → intentRouter 分类 'wallet'
 *     → routerByIntent → walletAgent
 *     → answerSynthesizer → END
 *     [state.intent = ''; state.routeCache = 'wallet']  ← intent 清空但 routeCache 保留
 *
 * Turn 2: "My balance is 500"（routeCache='wallet' 命中）
 *   START → intentGateway (routeCache='wallet' → 'wallet')  ← 跳过 LLM 分类！
 *     → walletAgent 直接
 *     → answerSynthesizer → END
 *
 *     完整链条：
 *
 * START
 *   │
 *   ├─ intentGateway (有 routeCache) ─→ routerByIntent
 *   │                                      │
 *   │                                      ├── orderAgent / walletAgent / couponAgent / ...
 *   │                                      │
 *   └─ intentGateway (无 routeCache) ─→ intentRouter
 *                                           │
 *                                           └── routerByIntent ─→ orderAgent / walletAgent /
 *                                                                  ragNode / generalChat /
 *                                                                  couponAgent / supervisorNode
 *                                                                       │
 *                                                                  supervisorNode
 *                                                                       │
 *                                                                  supervisorRouter
 *                                                                       │
 *                                                                  └─ orderAgent / walletAgent /
 *                                                                     couponAgent / ragNode /
 *                                                                     generalChat / answerSynthesizer
 */

export function buildCustomerGraph(
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) {
  //第 1 步：建工厂
  const workflow = new StateGraph(AgentState)
    // 第 2 步：招工人
    //intentRouter：听用户说了什么，判断是"查订单"还是"闲聊"还是"查优惠券"
    //每个 .addNode(name, executor) 就是招一个工人，给一个名字，告诉它用什么工具（llmConfig、orderService）
    .addNode('intentRouter', createIntentRouterNode(llmConfig))
    //工人C（知识库） ragNode：处理政策、优惠券、活动等知识问答的 RAG 节点
    .addNode('ragNode', ragNode)
    //orderAgent：处理订单相关问题的 agent 节点
    .addNode('orderAgent', createOrderAgentNode(llmConfig, registry))
    .addNode('walletAgent', createWalletAgentNode(llmConfig, registry))
    //couponAgent：处理优惠券相关问题的 agent 节点
    .addNode('couponAgent', createCouponAgentNode(llmConfig, registry))
    //// 工人B（闲聊）generalChat：处理闲聊问题的 agent 节点
    .addNode('generalChat', createGeneralChatNode(llmConfig))
    //包装员	answerSynthesizer：将 agent 或 RAG 的输出整理成最终的自然语言回答
    .addNode('answerSynthesizer', createAnswerSynthesizerNode(llmConfig))
    .addNode('supervisorNode', createSupervisorNode())

    //// 多轮时 state.intent 已有值 → 跳过 intentRouter，直接去 agent
    .addConditionalEdges(START, intentGateway, {
      intentRouter: 'intentRouter',
      orderAgent: 'orderAgent',
      walletAgent: 'walletAgent',
      couponAgent: 'couponAgent',
      ragNode: 'ragNode',
      generalChat: 'generalChat',
      supervisorNode: 'supervisorNode',
    })

    // ── Edges ── 生产线的起点 ── 铺传送带
    // Start → Intent Router
    //// 用户一说话，先到分拣员
    //.addEdge(START, 'intentRouter')

    // Intent Router → Route by intent (conditional)
    //分拣员决定把东西送到哪个工人手上 ──
    .addConditionalEdges('intentRouter', routerByIntent, {
      intentRouter: 'intentRouter', // 如果分拣员无法判断 → 送回分拣员
      ragNode: 'ragNode', // 如果是政策问题 → 送工人C
      generalChat: 'generalChat', // 如果是闲聊 → 送工人B
      orderAgent: 'orderAgent', // 如果是订单问题 → 送工人A
      walletAgent: 'walletAgent', // 如果是钱包问题 → 送工人D
      couponAgent: 'couponAgent', // 如果是优惠券问题 → 送工人E（已实现）
      supervisorNode: 'supervisorNode',
      // 以下 agent 尚未实现 → fallback 到 generalChat
      userAgent: 'generalChat',
      productAgent: 'generalChat',
      luckyAgent: 'generalChat',
    })

    // All agent/nodes → Answer Synthesizer (via agentDoneRouter for supervisor loopback)
    //所有工人都把成品送到包装员 ──
    .addConditionalEdges('orderAgent', agentDoneRouter, {
      supervisorNode: 'supervisorNode',
      answerSynthesizer: 'answerSynthesizer',
    })
    .addConditionalEdges('walletAgent', agentDoneRouter, {
      supervisorNode: 'supervisorNode',
      answerSynthesizer: 'answerSynthesizer',
    })
    .addConditionalEdges('couponAgent', agentDoneRouter, {
      supervisorNode: 'supervisorNode',
      answerSynthesizer: 'answerSynthesizer',
    })
    .addConditionalEdges('ragNode', agentDoneRouter, {
      supervisorNode: 'supervisorNode',
      answerSynthesizer: 'answerSynthesizer',
    })
    .addConditionalEdges('generalChat', agentDoneRouter, {
      supervisorNode: 'supervisorNode',
      answerSynthesizer: 'answerSynthesizer',
    })
    .addConditionalEdges('supervisorNode', supervisorRouter, {
      orderAgent: 'orderAgent',
      walletAgent: 'walletAgent',
      couponAgent: 'couponAgent',
      ragNode: 'ragNode',
      generalChat: 'generalChat',
      answerSynthesizer: 'answerSynthesizer',
    })

    // Answer Synthesizer → END
    //包装完毕，发给用户 ──
    .addEdge('answerSynthesizer', END);

  // Compile the graph
  //LangGraph 的启动按钮。它会做两件事：
  //检查：所有 Node 是否都有入口和出口？有没有死循环？
  //生成执行计划：根据 edges 生成一个有向图，运行时按边执行
  // MemorySaver：把每次运行的状态保存在内存中，方便调试
  return workflow.compile({
    checkpointer: new MemorySaver(),
  });
}
