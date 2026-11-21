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

import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { AgentPromptConfig } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { replyLanguageInstruction } from '@api/common/utils/language';
import { buildAgentPrompt } from '@api/client/ai-customer/graph/agents/prompt-builder';
import {
  buildInitialMessages,
  createAgentLLM,
  buildAgentResult,
} from '@api/client/ai-customer/graph/agents/agent-result';
import {
  runAgentLoop,
  AgentLoopResult,
  FlowDataAccumulator,
} from '@api/client/ai-customer/graph/agents/agent-runner';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { CONTEXT_TOKEN_BUDGET } from '@api/client/ai-customer/graph/constants';
import { AgentNodeOutput } from '@api/client/ai-customer/graph/types/agent-types';
import { ConversationContextState } from '@api/client/ai-customer/graph/state';
import {
  formatContextSummary,
  trimContextToBudget,
} from '@api/client/ai-customer/graph/utils/context-manager';

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
  /**
   * 跨 Agent 共享的 flow 状态累加器。
   * 传入同一对象时，前一个 Agent 调用 updateFlowData/updateFlowStatus
   * 的结果会进入对象，orchestrator 在一个流水线结束后写回 state.flowState。
   */
  flowDataAccumulator?: FlowDataAccumulator;
  /** 对话内实体/纠正状态；会作为独立 SystemMessage 注入，不写进历史。 */
  contextState?: ConversationContextState;
  /** 当前待确认操作（用于摘要保护，不让确认信息被裁掉）。 */
  pendingConfirm?: { action?: string } | null;
  /** 覆盖默认 token 预算（测试/特殊 Agent 用）。 */
  contextTokenBudget?: number;
  /** 用户长期记忆（已格式化，作为独立 system 消息注入）。 */
  userMemory?: string;
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
  /** 本次执行期间累积的 flow 状态（可能被工具更新） */
  flowDataAccumulator?: FlowDataAccumulator;
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

  // ① Handoff — 获取域工具 + flow 状态工具 + 额外工具
  // updateFlowData/updateFlowStatus 注册在 'flow' 标签下，不是某个域独有；
  // 不注入的话 Agent 无法写 flow 状态，状态机就是死代码。
  const domainTools = opts.registry.getToolsByTag(opts.tag);
  const flowTools = opts.registry.getToolsByTag('flow');
  const seen = new Set<string>();
  const allTools = [
    ...domainTools,
    ...flowTools,
    ...(opts.extraTools ?? []),
  ].filter((tool) => {
    if (seen.has(tool.name)) return false;
    seen.add(tool.name);
    return true;
  });
  const llmWithTools = createAgentLLM(opts.llmConfig, allTools);

  // ② Filter — 按 token 预算裁剪，工具调用与结果成组保留
  const contextMessages = trimContextToBudget(opts.messages, {
    maxTokens: opts.contextTokenBudget ?? CONTEXT_TOKEN_BUDGET,
  });

  // ③ Prompt — 构建系统提示词 + 初始消息
  // flowContext 由 promptConfig 声明（order/wallet/kyc 等需要），
  // 不再在这里强制关闭；当前值来自 accumulator，第二轮能看到第一轮状态。
  const lastHuman = [...opts.messages]
    .reverse()
    .find(
      (message) =>
        message._getType?.() === 'human' || message.type === 'human',
    );
  const lastHumanText =
    typeof lastHuman?.content === 'string'
      ? lastHuman.content
      : Array.isArray(lastHuman?.content)
        ? lastHuman.content
            .map((part: any) =>
              typeof part === 'string' ? part : String(part?.text ?? ''),
            )
            .join(' ')
        : '';

  const systemPrompt = `${buildAgentPrompt({
    ...opts.promptConfig,
    userId: opts.userId,
    flowType: opts.flowDataAccumulator?.flowType ?? opts.promptConfig.flowType,
    flowStatus:
      opts.flowDataAccumulator?.flowStatus ?? opts.promptConfig.flowStatus,
  })}

${replyLanguageInstruction(lastHumanText)}`;
  // 结构化摘要作为独立 system 消息注入：不写进 state.messages，
  // 下一轮不会伪装成用户/AI 原话重复出现。
  const summary = formatContextSummary(opts.contextState, opts.pendingConfirm);
  const injected = [
    summary ? new SystemMessage(summary) : null,
    opts.userMemory ? new SystemMessage(opts.userMemory) : null,
  ].filter((item): item is SystemMessage => item !== null);
  const initialMessages = buildInitialMessages(
    systemPrompt,
    contextMessages,
    injected.length > 0 ? { inject: injected } : undefined,
  );

  // ④ Loop — 执行 ReAct Agent 循环
  const result = await runAgentLoop({
    llmWithTools,
    initialMessages,
    tools: allTools,
    agentName: opts.agentName,
    logger,
    confirmRequiredTools: new Set(opts.registry.getWriteToolNames()),
    flowDataAccumulator: opts.flowDataAccumulator,
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
    flowDataAccumulator: opts.flowDataAccumulator,
  };
}
