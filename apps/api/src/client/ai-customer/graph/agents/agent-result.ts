/**
 * agent-result — 统一成功/失败结果构建 + Agent 初始化工具
 *
 * ── 是什么？ ──
 * 抽取所有 Agent 中重复的：
 *   - error/success 结果构建逻辑
 *   - LLM + Tools 初始化逻辑（createAgentLLM）
 *   - initialMessages 构造逻辑（buildInitialMessages）
 *
 * ── 简化说明 ──
 * 新架构（Pipeline Orchestrator）移除了 flowData/flowType/flowStatus 从 state 的存储。
 * wallet agent 的 flowDataAccumulator 仍然是 Agent 内部的本地变量（不在 state 层级）。
 * buildAgentResult 相应简化 —— 只保留 agentSteps 扩展，移除 flowData/flowType/flowStatus。
 */

import { BaseMessage } from '@langchain/core/messages';
import { Runnable } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import {
  AgentNodeOutput,
  AgentStep,
} from '@api/client/ai-customer/graph/types/agent-types';
import { AgentLoopResult } from '@api/client/ai-customer/graph/agents/agent-runner';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';

/**
 * buildErrorResult — 构建错误结果
 */
export function buildErrorResult(
  agentName: string,
  messages: BaseMessage[],
  errorMessage?: string,
): AgentNodeOutput {
  return {
    taskResults: {
      [agentName]:
        errorMessage ??
        `Sorry, I encountered an issue processing your request. Please try again later.`,
    },
    messages,
    agentSteps: [],
  };
}

/**
 * buildAgentResult — 链式结果构建器
 *
 * @example
 * // 标准用法
 * return buildAgentResult('orderAgent').from(result, state.messages);
 *
 * @example
 * // 带 agentSteps 扩展
 * return buildAgentResult('walletAgent')
 *   .agentSteps(agentSteps)
 *   .from(result, state.messages);
 */
export function buildAgentResult(agentName: string) {
  const extra: {
    agentSteps?: AgentStep[];
  } = {};

  const api = {
    agentSteps(steps: AgentStep[]) {
      extra.agentSteps = steps;
      return api;
    },
    from(result: AgentLoopResult, messages: BaseMessage[]): AgentNodeOutput {
      if (result.error) return buildErrorResult(agentName, messages);
      return buildSuccessResult(agentName, result, extra);
    },
  };
  return api;
}

/**
 * buildSuccessResult — 构建成功结果
 */
export function buildSuccessResult(
  agentName: string,
  result: AgentLoopResult,
  extra?: {
    agentSteps?: AgentStep[];
  },
): AgentNodeOutput {
  return {
    taskResults: { [agentName]: result.content },
    messages: result.currentMessages.slice(1),
    agentSteps: result.agentSteps,
    ...extra,
  } satisfies AgentNodeOutput;
}

/**
 * createAgentLLM — 统一 LLM 创建（绑定 Tools）
 *
 * ── 做什么？ ──
 * 将 4 个 Agent 中重复的 "createLLM + bindTools" 模式封装为统一函数。
 * tools 由调用方从 registry 显式获取，来源清晰可见。
 *
 * ── 为什么 bindTools？ ──
 * LangChain 的 bindTools 是告诉 LLM"你可以使用这些工具"。
 * LLM 在生成回复时，如果觉得需要调用工具，就会在 AIMessage 里输出 tool_calls。
 * 没有 bindTools，LLM 就不知道可以用什么工具。
 *
 * @example
 * const tools = registry.getToolsByTag('order');
 * const llmWithTools = createAgentLLM(llmConfig, tools);
 */
export function createAgentLLM(
  llmConfig: LlmProviderConfig,
  tools: DynamicStructuredTool[],
): Runnable {
  return createLLM(llmConfig, { temperature: 0 }).bindTools(tools);
}

/**
 * ================================================================
 * buildInitialMessages — 统一 initialMessages 构建
 * ================================================================
 *
 * ── 是什么？ ──
 * LLM 的输入消息列表格式：[{ role: 'system', content: systemPrompt }, ...历史对话]。
 * 这个函数负责组装这个列表。
 *
 * ── 怎么做？ ──
 * 默认固定行为：system message + filtered history。
 * 支持通过 options.inject 插入额外消息（如记忆上下文、摘要等）。
 * inject 参数是为未来扩展预留的（如长期记忆）。
 *
 * @example
 * // 标准用法
 * const initialMessages = buildInitialMessages(systemPrompt, filteredMessages);
 *
 * @example
 * // 带注入消息（未来扩展：记忆摘要）
 * const initialMessages = buildInitialMessages(systemPrompt, filteredMessages, {
 *   inject: [memoryMessage],
 * });
 */
export interface BuildInitialMessagesOptions {
  /**
   * 在 system prompt 和 filtered history 之间插入的额外消息。
   * 例如: 长期记忆摘要、上下文回顾等。
   */
  inject?: BaseMessage[];
}

export function buildInitialMessages(
  systemPrompt: string,
  filteredMessages: BaseMessage[],
  options?: BuildInitialMessagesOptions,
): (BaseMessage | { role: 'system'; content: string })[] {
  const systemMessage: { role: 'system'; content: string } = {
    role: 'system',
    content: systemPrompt,
  };

  if (options?.inject && options.inject.length > 0) {
    return [systemMessage, ...options.inject, ...filteredMessages];
  }

  return [systemMessage, ...filteredMessages];
}
