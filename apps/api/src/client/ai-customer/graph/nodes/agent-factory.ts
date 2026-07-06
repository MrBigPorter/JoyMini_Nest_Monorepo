/**
 * agent-factory.ts — 标准 Agent 执行工厂
 *
 * ── 是什么？ ──
 * 封装 orchestrator 流水线中"标准 Agent"的执行逻辑，消除每次循环中的重复代码。
 * 标准 Agent 的 5 步流程：
 *   ① Prompt 构建（buildAgentPrompt）
 *   ② 上下文过滤（messages.slice）
 *   ③ 初始消息构建（buildInitialMessages）
 *   ④ 工具获取（getToolsByTag）
 *   ⑤ Agent 循环执行（runAgentLoop）
 *
 * ── 为什么不在 graph 节点层用？ ──
 * 参见 orchestrator.node.ts 的注释：
 * 所有 Agent 在 orchestrator 的 for-loop 中顺序执行，不是独立的 StateGraph 节点。
 * 所以工厂不是图节点工厂（像旧架构的 createOrderAgentNode），
 * 而是"一次 Agent 执行"的封装。
 *
 * ── 使用方法 ──
 * import { runStandardAgent } from './agent-factory';
 *
 * const result = await runStandardAgent({
 *   promptConfig: entry.promptConfig,
 *   tag: entry.tag,
 *   agentName: entry.label,
 *   userId: state.userId,
 *   messages: state.messages,
 *   llmConfig,
 *   registry,
 *   logger,
 * });
 *
 * ── 与 agent-tags.ts 的关系 ──
 * agent-tags.ts 定义"哪些 Agent 存在"（静态配置），
 * 此工厂定义"Agent 如何执行"（运行时逻辑）。
 */

import { BaseMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { AgentPromptConfig } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { buildAgentPrompt } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { buildInitialMessages, createAgentLLM, buildAgentResult } from '@api/client/ai-customer/graph/agents/agent-result';
import { runAgentLoop, AgentLoopResult } from '@api/client/ai-customer/graph/agents/agent-runner';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { MAX_CONTEXT_MESSAGES } from '@api/client/ai-customer/graph/constants';
import { AgentNodeOutput } from '@api/client/ai-customer/graph/types/agent-types';

// ============================================================
// Interfaces
// ============================================================

export interface RunStandardAgentOptions {
  /** 当前用户的 ID */
  userId: string;
  /** 完整对话消息列表 */
  messages: BaseMessage[];
  /** Agent 的 prompt 配置（不含 userId） */
  promptConfig: Omit<AgentPromptConfig, 'userId'>;
  /** 工具标签（对应 AGENT_BASE_MAP 的 key） */
  tag: string;
  /** Agent 名称（日志用） */
  agentName: string;
  /** LLM 配置 */
  llmConfig: LlmProviderConfig;
  /** 工具注册表 */
  registry: ToolRegistryService;
  /** Logger 实例 */
  logger: Logger;
  /** 额外工具（如 wallet 的 flow tools） */
  extraTools?: DynamicStructuredTool[];
}

export interface RunStandardAgentResult {
  /** AgentLoop 原始结果 */
  result: AgentLoopResult;
  /** 构建好的 AgentNodeOutput */
  output: AgentNodeOutput;
  /** 使用的工具列表 */
  tools: DynamicStructuredTool[];
  /** 上下文消息数量 */
  contextMessagesCount: number;
}

// ============================================================
// Factory: runStandardAgent
// ============================================================

/**
 * runStandardAgent — 执行一次标准 Agent 流水线
 *
 * 封装 orchestrator 中每个 Agent 的标准执行流程。
 * 适用于：order, coupon, user, product, lucky-draw, kyc 等标准 ReAct Agent。
 *
 * ── 不适用场景 ──
 * - wallet（需要 flow tools 特殊注入）— 使用 runStandardAgent 传入 extraTools 即可
 * - general/rag（type='direct'，不走 LLM+Tools）
 *
 * ── 5 步流程详解 ──
 * ① Handoff（工具获取）: registry.getToolsByTag(tag) 获取域工具
 * ② Filter（上下文过滤）: messages.slice(-MAX_CONTEXT_MESSAGES)
 * ③ Prompt（系统提示词）: buildAgentPrompt + buildInitialMessages
 * ④ Loop（ReAct 循环）: runAgentLoop
 * ⑤ Output（结果构建）: buildAgentResult
 */
export async function runStandardAgent(
  opts: RunStandardAgentOptions,
): Promise<RunStandardAgentResult> {
  const logger = opts.logger;

  // ① Handoff — 获取域工具 + 额外工具
  const domainTools = opts.registry.getToolsByTag(opts.tag);
  const allTools = [...domainTools, ...(opts.extraTools ?? [])];
  const llmWithTools = createAgentLLM(opts.llmConfig, allTools);

  // ② Filter — 上下文过滤（取最近 N 条消息）
  const contextMessages = opts.messages.slice(-MAX_CONTEXT_MESSAGES);

  // ③ Prompt — 构建系统提示词 + 初始消息
  const systemPrompt = buildAgentPrompt({
    ...opts.promptConfig,
    userId: opts.userId,
    flowContext: false,
  });
  const initialMessages = buildInitialMessages(systemPrompt, contextMessages);

  // ④ Loop — 执行 ReAct Agent 循环
  const result = await runAgentLoop({
    llmWithTools,
    initialMessages,
    tools: allTools,
    agentName: opts.agentName,
    logger,
  });

  // ⑤ Output — 构建结果
  if (result.error) {
    logger.error(`[${opts.agentName}] agent error: ${result.error}`);
  }
  const output = buildAgentResult(opts.agentName).from(result, opts.messages);

  return {
    result,
    output,
    tools: allTools,
    contextMessagesCount: contextMessages.length,
  };
}
