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
import { createUserAgentNode } from '@api/client/ai-customer/graph/nodes/user-agent.node';

// ================================================================
// Phase 3: 每轮强制走 intentRouter，让 LLM 重新分类
// 不再使用 routeCache（避免话题切换时路由错误）。
// intentRouter 通过 previousIntent + conversationContext 理解简短消息。
// ================================================================
const intentGateway = (_state: typeof AgentState.State): string => {
  return 'intentRouter';
};

// ================================================================
// Agent 完成后的路由选择
// 1. pendingTasks > 0（Supervisor 模式）→ 返回 supervisorNode 派发下一任务
// 2. 否则 → answerSynthesizer 合成最终回复
// ================================================================
const agentDoneRouter = (state: typeof AgentState.State): string => {
  if (state.pendingTasks && state.pendingTasks.length > 0)
    return 'supervisorNode';
  return 'answerSynthesizer';
};

// ================================================================
// Supervisor 模式下按轮次派发子任务
// round 0: supervisor 尚未分解任务（不应到达此处）
// round 1: 派发 pendingTasks[0]（首个 Agent）
// round 2: 派发 pendingTasks[1]（第二个 Agent）
// 超过 maxRounds 或全部任务完成 → answerSynthesizer
// ================================================================
const supervisorRouter = (state: typeof AgentState.State): string => {
  const maxRounds = 5;
  const round = state.supervisorRound ?? 0;
  const taskIndex = round - 1; // round 从 1 开始，taskIndex 从 0 开始

  if (round >= maxRounds || taskIndex >= (state.pendingTasks.length ?? 0)) {
    return 'answerSynthesizer';
  }

  return state.pendingTasks[taskIndex].agent;
};

// ================================================================
// 构建 AI 客服 StateGraph
//
// 节点流：
//   START
//     │
//     └─ intentGateway ─→ intentRouter
//                            │
//                            ├── orderAgent / walletAgent / couponAgent / userAgent
//                            ├── ragNode（知识库问答）
//                            ├── generalChat（闲聊）
//                            └── supervisorNode（多 Agent 协作）
//                                   │
//                              supervisorRouter
//                                   │
//                              └── orderAgent / walletAgent / couponAgent / ...
//                                   │
//                              agentDoneRouter
//                                   │
//                              └── supervisorNode（继续派发） / answerSynthesizer（结束）
//
//   supervisorNode → supervisorRouter → Agent → agentDoneRouter → supervisorNode（循环）
//   直到所有 pendingTasks 执行完毕 → answerSynthesizer → END
// ================================================================

export function buildCustomerGraph(
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) {
  const workflow = new StateGraph(AgentState)

    // ── 注册所有节点 ──
    .addNode('intentRouter', createIntentRouterNode(llmConfig))
    .addNode('ragNode', ragNode)
    .addNode('orderAgent', createOrderAgentNode(llmConfig, registry))
    .addNode('walletAgent', createWalletAgentNode(llmConfig, registry))
    .addNode('couponAgent', createCouponAgentNode(llmConfig, registry))
    .addNode('userAgent', createUserAgentNode(llmConfig, registry))
    .addNode('generalChat', createGeneralChatNode(llmConfig))
    .addNode('answerSynthesizer', createAnswerSynthesizerNode(llmConfig))
    .addNode('supervisorNode', createSupervisorNode())

    // ── START → intentGateway（强制走 intentRouter 重新分类） ──
    .addConditionalEdges(START, intentGateway, {
      intentRouter: 'intentRouter',
      orderAgent: 'orderAgent',
      walletAgent: 'walletAgent',
      couponAgent: 'couponAgent',
      userAgent: 'userAgent',
      ragNode: 'ragNode',
      generalChat: 'generalChat',
      supervisorNode: 'supervisorNode',
    })

    // ── intentRouter → 按意图路由到对应节点 ──
    .addConditionalEdges('intentRouter', routerByIntent, {
      intentRouter: 'intentRouter', // 无法判断 → 重新分类
      ragNode: 'ragNode', // 知识库问答
      generalChat: 'generalChat', // 闲聊
      orderAgent: 'orderAgent', // 订单问题
      walletAgent: 'walletAgent', // 钱包问题
      couponAgent: 'couponAgent', // 优惠券问题
      supervisorNode: 'supervisorNode',
      userAgent: 'userAgent', // 用户资料问题
      productAgent: 'generalChat', // 未实现 → fallback
      luckyAgent: 'generalChat', // 未实现 → fallback
    })

    // ── 各 Agent/Node 完成后 → agentDoneRouter ──
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
    .addConditionalEdges('userAgent', agentDoneRouter, {
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

    // ── supervisorNode → supervisorRouter 按轮次派发下一任务 ──
    .addConditionalEdges('supervisorNode', supervisorRouter, {
      orderAgent: 'orderAgent',
      walletAgent: 'walletAgent',
      couponAgent: 'couponAgent',
      ragNode: 'ragNode',
      generalChat: 'generalChat',
      answerSynthesizer: 'answerSynthesizer',
    })

    // ── answerSynthesizer → END ──
    .addEdge('answerSynthesizer', END);

  // 编译图：检查所有 Node 是否有入口和出口、无死循环，生成执行计划
  return workflow.compile({
    checkpointer: new MemorySaver(),
  });
}
