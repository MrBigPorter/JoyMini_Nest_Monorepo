import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentState } from './state';
import {
  createIntentRouterNode,
  routerByIntent,
} from './nodes/intent-router.node';
import {
  createWalletAgentNode,
  walletAgentNode,
} from '@api/client/ai-customer/graph/nodes/wallet-agent.node';
import { createAnswerSynthesizerNode } from './nodes/answer-synthesizer.node';
import { createGeneralChatNode } from './nodes/general-chat.node';
import { createOrderAgentNode, orderAgentNode } from './nodes/order-agent.node';
import { ragNode } from './nodes/rag.node';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';

/**
 * Build and compile the AI Customer StateGraph
 *
 * Node flow:
 * 1. START → intentRouter (classify user intent)
 * 2. intentRouter → routerByIntent (conditional edge to agent)
 * 3. Agent/RAG/GeneralChat → answerSynthesizer
 * 4. answerSynthesizer → END
 * 想象成一条生产线：
 * 用户说话 → [分拣员] → [工人A / 工人B / 工人C] → [包装员] → 回答用户
 */
export function buildCustomerGraph(
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) {
  //第 1 步：建工厂
  const workflow = new StateGraph(AgentState)
    // 第 2 步：招工人
    //intentRouter：听用户说了什么，判断是"查订单"还是"闲聊"还是"问政策"
    //每个 .addNode(name, executor) 就是招一个工人，给一个名字，告诉它用什么工具（llmConfig、orderService）
    .addNode('intentRouter', createIntentRouterNode(llmConfig))
    //工人C（知识库） ragNode：处理政策、优惠券、活动等知识问答的 RAG 节点
    .addNode('ragNode', ragNode)
    //orderAgent：处理订单相关问题的 agent 节点
    .addNode('orderAgent', createOrderAgentNode(llmConfig, registry))
    .addNode('walletAgent', createWalletAgentNode(llmConfig, registry))
    //// 工人B（闲聊）generalChat：处理闲聊问题的 agent 节点
    .addNode('generalChat', createGeneralChatNode(llmConfig))
    //包装员	answerSynthesizer：将 agent 或 RAG 的输出整理成最终的自然语言回答
    .addNode('answerSynthesizer', createAnswerSynthesizerNode(llmConfig))

    // ── Edges ── 生产线的起点 ── 铺传送带
    // Start → Intent Router
    //// 用户一说话，先到分拣员
    .addEdge(START, 'intentRouter')

    // Intent Router → Route by intent (conditional)
    //分拣员决定把东西送到哪个工人手上 ──
    .addConditionalEdges('intentRouter', routerByIntent, {
      ragNode: 'ragNode', // 如果是政策问题 → 送工人C
      generalChat: 'generalChat', // 如果是闲聊 → 送工人B
      orderAgent: 'orderAgent', // 如果是订单问题 → 送工人A
      walletAgent: 'walletAgent', // 如果是钱包问题 → 送工人D
      // 以下 agent 尚未实现 → fallback 到 generalChat
      couponAgent: 'generalChat',
      userAgent: 'generalChat',
      productAgent: 'generalChat',
      luckyAgent: 'generalChat',
    })

    // All agent/nodes → Answer Synthesizer
    //所有工人都把成品送到包装员 ──
    .addEdge('orderAgent', 'answerSynthesizer')
    .addEdge('walletAgent', 'answerSynthesizer')
    .addEdge('ragNode', 'answerSynthesizer')
    .addEdge('generalChat', 'answerSynthesizer')

    // Answer Synthesizer → END
    //包装完毕，发给用户 ──
    .addEdge('answerSynthesizer', END);

  // Compile the graph
  //LangGraph 的启动按钮。它会做两件事：
  //检查：所有 Node 是否都有入口和出口？有没有死循环？
  //生成执行计划：根据 edges 生成一个有向图，运行时按边执行
  return workflow.compile();
}
