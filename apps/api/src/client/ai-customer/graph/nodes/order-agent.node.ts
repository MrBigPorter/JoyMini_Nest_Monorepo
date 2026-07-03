// ============================================================
// order-agent.node.ts — Order Inquiry Agent
// ============================================================
// 面试题对应: interview-ai-agent-order-system.md Q3/Q4/Q5/Q6/Q7
//
// 代码结构 = 面试答案结构 = LLM 执行流程:
//   ① 承接 Handoff     → 从 StateGraph 接收 state
//   ② 上下文过滤 Filter  → 提取本 Agent 相关对话
//   ③ Prompt 构造 Prompt → 10-section system prompt
//   ④ ReAct 循环 Loop   → LLM 思考→工具→结果 最多3轮
//   ⑤ 结果输出 Output   → 成功/失败 → AgentNodeOutput
// ============================================================

import { AgentState } from '@api/client/ai-customer/graph/state';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { Logger } from '@nestjs/common';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { AgentNodeOutput } from '@api/client/ai-customer/graph/types/agent-types';
import { prepareAgentContext } from '@api/client/ai-customer/graph/utils/prepare-context';
import { MAX_CONTEXT_MESSAGES } from '@api/client/ai-customer/graph/constants';
import { buildAgentPrompt } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { runAgentLoop } from '@api/client/ai-customer/graph/agents/agent-runner';
import {
  buildAgentResult,
  buildInitialMessages,
  createAgentLLM,
} from '@api/client/ai-customer/graph/agents/agent-result';
import { orderPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/order-prompt';

/**
 * orderAgent 占位节点 — 用于 graph 无条件注册
 */
export const orderAgentNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  return state;
};

/**
 * 生成 order agent 节点函数的工厂
 */
export const createOrderAgentNode = (
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) => {
  const logger = new Logger('OrderAgent');
  return async (state: typeof AgentState.State): Promise<AgentNodeOutput> => {
    // ================================================================
    // ① 承接 — Flow Handoff（Q3: 从 StateGraph 接收 state）
    // ================================================================
    const userId = state.userId;
    const tools = registry.getToolsByTag('order');
    const llmWithTools = createAgentLLM(llmConfig, tools);

    // ================================================================
    // ② 上下文过滤 — Context Filtering（Q5: 历史窗口 + 跨Agent隔离）
    // ================================================================
    const agentContext = prepareAgentContext(
      state.messages,
      state.pendingTasks,
      state.messageTopics,
      'orderAgent',
    ).slice(-MAX_CONTEXT_MESSAGES);

    // ================================================================
    // ③ Prompt 构造 — System Prompt（Q6: 数据转换 + Q7: 规则注入）
    // ================================================================
    const systemPrompt = buildAgentPrompt({
      ...orderPromptConfig,
      userId,
      flowType: state.flowType,
      flowStatus: state.flowStatus,
    });
    const initialMessages = buildInitialMessages(systemPrompt, agentContext);

    // ================================================================
    // ④ ReAct 循环 — LLM + Tools 手动循环（Q5: 手动 while）
    // ================================================================
    const result = await runAgentLoop({
      llmWithTools,
      initialMessages,
      tools,
      agentName: 'orderAgent',
      logger,
    });

    // ================================================================
    // ⑤ 结果输出 — Error Handling + Result Output（Q7: 两层防御）
    // ================================================================
    return buildAgentResult('orderAgent').from(result, state.messages);
  };
};
