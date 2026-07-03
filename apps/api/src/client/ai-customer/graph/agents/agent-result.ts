/**
 * agent-result — 统一成功/失败结果构建 + Agent 初始化工具
 *
 * 抽取 4 个 Agent 中重复的：
 *   - error/success 结果构建逻辑（Q7 "两层防御 — Agent 层兜底"）
 *   - LLM + Tools 初始化逻辑（Section ①）
 *   - initialMessages 构造逻辑（Section ③）
 *
 * 面试概念对应：
 *   Q7 "两层防御 — Agent 层兜底"
 *   统一错误消息管理，确保所有 Agent 输出相同形状的 AgentNodeOutput
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
  FlowType,
  FlowStatus,
} from '@api/client/ai-customer/graph/types/flow-types';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';

/**
 * 构建错误结果
 *
 * 当 Agent 循环抛出异常或 result.error 存在时调用。
 * 使用 state.messages（原始输入消息）而非 result.currentMessages，
 * 避免将 tool_calls/tool 消息暴露给下游 answerSynthesizer。
 *
 * @param agentName - Agent 名称（用于 taskResults key）
 * @param messages - 原始输入消息（state.messages）
 * @param errorMessage - 可选的自定义错误消息（默认通用兜底消息）
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
 * 链式结果构建器 — 封装 if/else + extra 收集
 *
 * 将 4 个 Agent 中重复的"检查 error → 构建 error/success 结果"模式
 * 封装为链式调用。支持通过 .flowData()/.agentSteps() 等注入 extra 字段。
 *
 * 面试概念对应：
 *   Q7 "两层防御 — Agent 层兜底"
 *   统一出口，减少各 Agent 节点中的样板代码
 *
 * @example
 * // coupon/user/order — 无 extra
 * return buildAgentResult('couponAgent').from(result, state.messages);
 *
 * @example
 * // wallet — 链式注入 extra
 * return buildAgentResult('walletAgent')
 *   .agentSteps(agentSteps)
 *   .flowData(flowData)
 *   .flowType(flowType)
 *   .flowStatus(flowStatus)
 *   .from(result, state.messages);
 */
export function buildAgentResult(agentName: string) {
  const extra: {
    agentSteps?: AgentStep[];
    flowData?: Record<string, any>;
    flowType?: FlowType;
    flowStatus?: FlowStatus;
  } = {};

  const api = {
    agentSteps(steps: AgentStep[]) {
      extra.agentSteps = steps;
      return api;
    },
    flowData(data?: Record<string, any>) {
      extra.flowData = data;
      return api;
    },
    flowType(type?: FlowType) {
      extra.flowType = type;
      return api;
    },
    flowStatus(status?: FlowStatus) {
      extra.flowStatus = status;
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
 * 构建成功结果
 *
 * 当 Agent 循环成功完成时调用。
 * 使用 result.currentMessages 保留本轮 Agent 产生的所有消息
 * （包括 tool_calls/tool 结果），供 answerSynthesizer 构建上下文。
 *
 * @param agentName - Agent 名称（用于 taskResults key）
 * @param result - AgentLoopResult（来自 runAgentLoop 的返回值）
 * @param extra - 可选扩展字段（agentSteps / flowData / flowType / flowStatus）
 */
export function buildSuccessResult(
  agentName: string,
  result: AgentLoopResult,
  extra?: {
    agentSteps?: AgentStep[];
    flowData?: Record<string, any>;
    flowType?: FlowType;
    flowStatus?: FlowStatus;
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
 * 将 4 个 Agent 中重复的 "createLLM + bindTools" 模式封装为统一函数。
 * tools 由调用方从 registry 显式获取，来源清晰可见。
 *
 * 面试概念对应：
 *   Q4 "为什么用 LangGraph" + Q5 "手动 ReAct 循环"
 *   统一入口，确保所有 Agent 使用相同的 LLM 创建方式
 *
 * @example
 * // 标准 Agent
 * const tools = registry.getToolsByTag('order');
 * const llmWithTools = createAgentLLM(llmConfig, tools);
 *
 * @example
 * // Wallet Agent（合并 domain + flow tools）
 * const tools = [...registry.getToolsByTag('wallet'), ...registry.getToolsByTag('flow')];
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
 * 将 4 个 Agent 中重复的 initialMessages 构造逻辑封装为统一函数。
 * 默认固定行为: [{ role: 'system', content: systemPrompt }, ...filteredMessages]
 * 支持通过 options.inject 插入额外消息（如记忆上下文、摘要等）。
 *
 * 面试概念对应：
 *   Q6 "数据转换 — 将业务数据注入 System Prompt"
 *   统一入口，减少各 Agent 节点中的样板代码
 *
 * @example
 * // 默认 — 所有 4 个 Agent 的标准用法
 * const initialMessages = buildInitialMessages(systemPrompt, filteredMessages);
 *
 * @example
 * // 带注入消息（如未来需要插入记忆摘要）
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
