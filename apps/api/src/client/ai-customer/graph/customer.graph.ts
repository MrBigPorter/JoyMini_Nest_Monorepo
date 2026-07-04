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
import { createProductAgentNode } from '@api/client/ai-customer/graph/nodes/product-agent.node';

/**
 * ================================================================
 * intentGateway — 强制走 intentRouter 重新分类
 * ================================================================
 *
 * ── 是什么？ ──
 * START 到 intentRouter 的桥梁。总是返回 'intentRouter'。
 *
 * ── 为什么不用 routeCache？ ──
 * 每轮都强制走 intentRouter 重新分类，确保：
 * 1. 用户切换话题时（"查余额"→"帮我看看订单"）能正确重路由
 * 2. intentRouter 通过 previousIntent + conversationContext 理解简短消息（"确认"、"好的"）
 * 3. 避免话题切换时路由错误
 *
 * ── 生活类比 ──
 * 就像便利店入口的自助问询台。每个顾客进店都经过问询台，即使老顾客也不例外。
 * 因为老顾客今天可能是来退货的，不是来买东西的。
 */
const intentGateway = (_state: typeof AgentState.State): string => {
  return 'intentRouter';
};

/**
 * ================================================================
 * agentDoneRouter — Agent 完成后的路由选择
 * ================================================================
 *
 * ── 做什么？ ──
 * 1. pendingTasks > 0（Supervisor 模式）→ 返回 supervisorNode 派发下一任务
 * 2. 否则 → answerSynthesizer 合成最终回复
 *
 * ── 生活类比 ──
 * 一个工人做完一件活，车间主任（supervisorRouter）看看派工单上还有没有活：
 * 还有→继续干下一件；没有了→去做总结报告（answerSynthesizer）。
 */
const agentDoneRouter = (state: typeof AgentState.State): string => {
  if (state.pendingTasks && state.pendingTasks.length > 0)
    return 'supervisorNode';
  return 'answerSynthesizer';
};

/**
 * ================================================================
 * supervisorRouter — Supervisor 模式下按轮次派发子任务
 * ================================================================
 *
 * ── 为什么这么设计？ ──
 * 方案 A（弃用）：IntentRouter 只分类 → Supervisor 用 LLM 分解任务 → 5 种幻觉根因
 * 方案 B（当前）：IntentRouter 同时处理分类 + 多领域检测（JSON 输出），
 *                Supervisor 只做轮次计数和 dispatch
 *
 * round 0: supervisor 尚未分解任务（不应到达此处）
 * round 1: 派发 pendingTasks[0]（首个 Agent）
 * round 2: 派发 pendingTasks[1]（第二个 Agent）
 * 超过 maxRounds 或全部任务完成 → answerSynthesizer
 *
 * ── 生活类比 ──
 * 车间主任手里有一张派工单：[A 组查余额, B 组查订单]。
 * 主任喊"A 组去！"→ round=1，taskIndex=0，去 pendingTasks[0]
 * A 组干完回来。主任喊"B 组去！"→ round=2，taskIndex=1，去 pendingTasks[1]
 * B 组干完回来。主任看派工单空了 → 去写报告（answerSynthesizer）。
 */
const supervisorRouter = (state: typeof AgentState.State): string => {
  const maxRounds = 5;
  const round = state.supervisorRound ?? 0;
  const taskIndex = round - 1; // round 从 1 开始，taskIndex 从 0 开始

  if (round >= maxRounds || taskIndex >= (state.pendingTasks.length ?? 0)) {
    return 'answerSynthesizer';
  }

  return state.pendingTasks[taskIndex].agent;
};

/**
 * ================================================================
 * buildCustomerGraph — 构建 AI 客服 StateGraph
 * ================================================================
 *
 * ── 是什么？ ──
 * 核心函数。使用 StateGraph（LangGraph 的状态图）定义整个 AI 客服流程。
 *
 * ── 为什么用 StateGraph？ ──
 * StateGraph = 有状态的有向图。编译时检查所有节点都有入口出口、没有死循环。
 * 就像地铁线路图：每个站是一个 Node，铁轨是 Edge，
 * 你刷地铁卡进站（START），到终点站出站（END）。
 *
 * ── 节点流 ──
 *   START
 *     │
 *     └─ intentGateway ──→ intentRouter
 *                            │
 *                            ├── orderAgent / walletAgent / couponAgent / userAgent
 *                            ├── ragNode（知识库问答）
 *                            ├── generalChat（闲聊）
 *                            └── supervisorNode（多 Agent 协作）
 *                                   │
 *                              supervisorRouter
 *                                   │
 *                              └── orderAgent / walletAgent / couponAgent / ...
 *                                   │
 *                              agentDoneRouter
 *                                   │
 *                              └── supervisorNode（继续派发） / answerSynthesizer（结束）
 *
 *   supervisorNode → supervisorRouter → Agent → agentDoneRouter → supervisorNode（循环）
 *   直到所有 pendingTasks 执行完毕 → answerSynthesizer → END
 *
 * ── 生活类比 ──
 * 就像一家餐厅的厨房流水线：
 * - 前台（intentRouter）接单：这张单是"牛排"（order）、"咖啡"（general）、"套餐"（supervised）
 * - 不同类型的单子分到不同厨师（Agent）
 * - 如果是一份套餐（多领域），主厨（supervisorNode）协调多个厨师分工
 * - 所有菜品完成后，摆盘师（answerSynthesizer）摆盘上桌
 * - MemorySaver（checkpointer）就像厨房的冰箱——每桌客人的订单状态都存着，不会丢
 */
export function buildCustomerGraph(
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) {
  const workflow = new StateGraph(AgentState)

    // ── 注册所有节点 ──
    // 每个 .addNode(name, factory) 就像在工厂里设置一个工位
    // name = 工位名称，factory = 在这个工位上干活的工人
    .addNode('intentRouter', createIntentRouterNode(llmConfig))
    .addNode('ragNode', ragNode)
    .addNode('orderAgent', createOrderAgentNode(llmConfig, registry))
    .addNode('walletAgent', createWalletAgentNode(llmConfig, registry))
    .addNode('couponAgent', createCouponAgentNode(llmConfig, registry))
    .addNode('userAgent', createUserAgentNode(llmConfig, registry))
    .addNode('productAgent', createProductAgentNode(llmConfig, registry))
    .addNode('generalChat', createGeneralChatNode(llmConfig))
    .addNode('answerSynthesizer', createAnswerSynthesizerNode(llmConfig))
    .addNode('supervisorNode', createSupervisorNode())

    // ── START → intentGateway（强制走 intentRouter 重新分类） ──
    // .addConditionalEdges(from, router, { name: target })
    // 第三个参数是一个 Map：router 返回值 → 目标节点
    .addConditionalEdges(START, intentGateway, {
      intentRouter: 'intentRouter',
      orderAgent: 'orderAgent',
      walletAgent: 'walletAgent',
      couponAgent: 'couponAgent',
      userAgent: 'userAgent',
      productAgent: 'productAgent',
      ragNode: 'ragNode',
      generalChat: 'generalChat',
      supervisorNode: 'supervisorNode',
    })

    // ── intentRouter → 按意图路由到对应节点 ──
    // routerByIntent 根据 state.intent 返回对应的节点名称
    .addConditionalEdges('intentRouter', routerByIntent, {
      intentRouter: 'intentRouter', // 无法判断 → 重新分类
      ragNode: 'ragNode', // 知识库问答
      generalChat: 'generalChat', // 闲聊
      orderAgent: 'orderAgent', // 订单问题
      walletAgent: 'walletAgent', // 钱包问题
      couponAgent: 'couponAgent', // 优惠券问题
      supervisorNode: 'supervisorNode',
      userAgent: 'userAgent', // 用户资料问题
      productAgent: 'productAgent', // 商品搜索/浏览
      luckyAgent: 'generalChat', // 未实现 → fallback
    })

    // ── 各 Agent/Node 完成后 → agentDoneRouter ──
    // 每个 Agent 干完活后，别直接走，先问问 agentDoneRouter：
    // "还有没有其他 Agent 要干活？"（supervisor 模式）
    // "还是直接去合成回复？"（单 Agent 模式）
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
    .addConditionalEdges('productAgent', agentDoneRouter, {
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
      userAgent: 'userAgent',
      productAgent: 'productAgent',
      ragNode: 'ragNode',
      generalChat: 'generalChat',
      answerSynthesizer: 'answerSynthesizer',
    })

    // ── answerSynthesizer → END ──
    .addEdge('answerSynthesizer', END);

  // 编译图：检查所有 Node 是否有入口和出口、无死循环，生成执行计划
  return workflow.compile({
    checkpointer: new MemorySaver(), // MemorySaver = 对话状态的"冰箱"，存储多轮对话历史
  });
}
