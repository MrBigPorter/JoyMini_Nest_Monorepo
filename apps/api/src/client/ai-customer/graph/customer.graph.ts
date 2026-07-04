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
 * @param llmConfig
 * @param registry
 */
export function buildCustomerGraph(
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) {
  const workflow = new StateGraph(AgentState)

    // 注册节点
    .addNode('intentRouter', createIntentRouterNode(llmConfig))
    .addNode('orchestrator', createOrchestratorNode(llmConfig, registry))

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
