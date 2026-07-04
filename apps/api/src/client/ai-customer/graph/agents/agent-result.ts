/**
 * agent-result — 统一成功/失败结果构建 + Agent 初始化工具
 *
 * ── 是什么？ ──
 * 抽取 4 个 Agent 中重复的：
 *   - error/success 结果构建逻辑
 *   - LLM + Tools 初始化逻辑（createAgentLLM）
 *   - initialMessages 构造逻辑（buildInitialMessages）
 *
 * ── 为什么需要这个文件？ ──
 * 重构前，4 个 Agent（wallet/order/coupon/user）各自有相同的 if/else 结果处理代码。
 * 当一个 Agent 的 Bug 修复了（如 Bug 1: 错误路径需要用 state.messages 而非 result.currentMessages），
 * 其他 3 个 Agent 可能忘记同步修复。
 * 抽取到统一函数 → 修复一次，所有 Agent 受益。
 *
 * ── 生活类比 ──
 * 这就像 4 家分店都用同一个"客户投诉处理流程"模板。
 * 如果总店修改了流程，4 家分店自动同步，不需要每家单独去改。
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
 * buildErrorResult — 构建错误结果
 *
 * ── 做什么？ ──
 * 当 Agent 循环抛出异常或 result.error 存在时调用。
 *
 * ── 为什么用 state.messages 而不是 result.currentMessages？ ──
 * Bug 1 修复：result.currentMessages 包含 tool_calls/tool 消息，
 * 如果传给 answerSynthesizer，它会把工具调用的内部细节也合成到回复里。
 * state.messages（原始输入消息）只包含 Human 和 AI 纯文本，更干净。
 *
 * ── 怎么做？ ──
 * return { taskResults: { [agentName]: errorMessage }, messages, agentSteps: [] }
 * 其中 errorMessage 是给用户看的友好提示，不是给开发者看的技术错误。
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
 * buildAgentResult — 链式结果构建器
 *
 * ── 是什么？ ──
 * Builder Pattern（建造者模式）：一步步构建结果对象。
 * 将 4 个 Agent 中重复的"检查 error → 构建 error/success 结果"模式封装为链式调用。
 *
 * ── 生活类比 ──
 * 就像在赛百味点三明治：先选面包（.agentSteps()）、再加肉（.flowData()）、
 * 再加酱料（.flowType()）、最后结账（.from()）。
 * 每一步都是可选的，最后一步决定"做好了"。
 *
 * @example
 * // 标准 Agent — 无 extra
 * return buildAgentResult('orderAgent').from(result, state.messages);
 *
 * @example
 * // Wallet Agent — 链式注入 extra
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
 * buildSuccessResult — 构建成功结果
 *
 * ── 做什么？ ──
 * 当 Agent 循环成功完成时调用。
 * 使用 result.currentMessages 保留本轮 Agent 产生的所有消息
 *（包括 tool_calls/tool 结果），供 answerSynthesizer 构建上下文。
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
