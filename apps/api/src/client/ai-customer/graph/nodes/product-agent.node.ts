// ============================================================
// product-agent.node.ts — Product Search & Browse Agent
// ============================================================
// 代码结构 = LLM 执行流程:
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
import { MAX_CONTEXT_MESSAGES } from '@api/client/ai-customer/graph/constants';
import { buildAgentPrompt } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { runAgentLoop } from '@api/client/ai-customer/graph/agents/agent-runner';
import {
  buildAgentResult,
  buildInitialMessages,
  createAgentLLM,
} from '@api/client/ai-customer/graph/agents/agent-result';
import { productPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/product-prompt';

/**
 * productAgent 占位节点 — 用于 graph 无条件注册
 */
export const productAgentNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  return state;
};

/**
 * 生成 product agent 节点函数的工厂
 */
export const createProductAgentNode = (
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) => {
  const logger = new Logger('ProductAgent');
  return async (state: typeof AgentState.State): Promise<AgentNodeOutput> => {
    // ================================================================
    // ① 承接 — Flow Handoff
    // ================================================================
    const userId = state.userId;
    const tools = registry.getToolsByTag('product');
    const llmWithTools = createAgentLLM(llmConfig, tools);

    // ================================================================
    // ② 上下文过滤 — Context Filtering
    // ================================================================
    const agentContext = state.messages.slice(-MAX_CONTEXT_MESSAGES);

    // ================================================================
    // ③ Prompt 构造 — System Prompt
    // ================================================================
    const systemPrompt = buildAgentPrompt({
      ...productPromptConfig,
      userId,
    });
    const initialMessages = buildInitialMessages(systemPrompt, agentContext);

    // ================================================================
    // ④ ReAct 循环 — LLM + Tools 手动循环
    // ================================================================
    const result = await runAgentLoop({
      llmWithTools,
      initialMessages,
      tools,
      agentName: 'productAgent',
      logger,
    });

    // ================================================================
    // ⑤ 结果输出 — Error Handling + Result Output
    // ================================================================
    return buildAgentResult('productAgent').from(result, state.messages);
  };
};
