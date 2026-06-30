import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { AgentState } from './state';
import {
  createIntentRouterNode,
  Intent,
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
 * 定义所有支持的意图类型
 * 这些意图类型用于在 intentRouter 节点中进行分类和路由
 *
 */
const FLOW_INTENTS: Intent[] = ['order', 'wallet', 'coupon', 'rag', 'supervised'];

/**
 * 根据 state.intent 决定下一步的节点
 * 如果 state.intent 是已知的意图类型，则直接返回该意图作为下一节点
 * 否则返回 'intentRouter'，表示需要重新分类用户意图
 * @param state
 */
const intentGateway = (state: typeof AgentState.State): string => {
  if (state.intent && FLOW_INTENTS.includes(state.intent as Intent)) {
    return routerByIntent(state);
  }
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
  if (state.pendingTasks && state.pendingTasks.length > 0) return 'supervisorNode';
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
 * Node flow:
 * 1. START → intentRouter (classify user intent)
 * 2. intentRouter → routerByIntent (conditional edge to agent)
 * 3. Agent/RAG/GeneralChat → answerSynthesizer
 * 4. answerSynthesizer → END
 * Turn 1: "I want to withdraw"
 *   START → intentGateway (intent='' → 'intentRouter')
 *     → intentRouter 分类 'wallet'
 *     → routerByIntent → walletAgent
 *     → answerSynthesizer → END
 *     [state.intent = 'wallet']
 *
 * Turn 2: "My balance is 500"
 *   START → intentGateway (intent='wallet' → 'wallet')  ← 跳过分类！
 *     → walletAgent 直接
 *     → answerSynthesizer → END
 *
 *     完整链条：
 *
 * START
 *   │
 *   ├─ intentGateway (有意图) ─→ orderAgent / walletAgent / ragNode / supervisorNode
 *   │                              │
 *   └─ intentGateway (无意图) ─→ intentRouter
 *                                   │
 *                                   ├── routerByIntent ─→ orderAgent / walletAgent / ragNode /
 *                                   │                      generalChat / supervisorNode /
 *                                   │                      couponAgent→generalChat / 等
 *                                   │
 *                                   └── supervisorNode
 *                                         │
 *                                         └── supervisorRouter ─→ orderAgent / walletAgent /
 *                                                                 couponAgent→generalChat /
 *                                                                 ragNode / generalChat /
 *                                                                 answerSynthesizer
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
