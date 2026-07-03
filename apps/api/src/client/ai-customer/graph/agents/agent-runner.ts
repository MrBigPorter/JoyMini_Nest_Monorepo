/**
 * agent-runner — Agent 循环引擎
 *
 * 提取所有 Agent 共用的 while 循环 + tool 执行 + 错误处理逻辑。
 * 支持可选的 flow data 累积回调（wallet agent 使用）。
 */

import { Logger } from '@nestjs/common';
import { ToolMessage } from '@langchain/core/messages/tool';
import { Runnable } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { stripToolResult } from '@api/client/ai-customer/graph/tools/tool-result';
import { MAX_ITERATIONS } from '@api/client/ai-customer/graph/constants';
import { AgentStep } from '@api/client/ai-customer/graph/types/agent-types';
import {
  FlowType,
  FlowStatus,
} from '@api/client/ai-customer/graph/types/flow-types';

// ============================================================
// Types
// ============================================================

export interface LastToolCallInfo {
  name: string;
  args: Record<string, any>;
  result?: string;
}

/**
 * Flow data accumulator — 用于 wallet agent 从工具调用中提取 flow 状态
 */
export interface FlowDataAccumulator {
  flowData: Record<string, any>;
  flowType?: FlowType;
  flowStatus?: FlowStatus;
}

export interface AgentLoopResult {
  /** The final text content from the last AI message */
  content: string;
  /** All messages including system prompt and tool results */
  currentMessages: any[];
  /** Agent execution steps summary */
  agentSteps: AgentStep[];
  /** Total number of tool calls made */
  totalToolCalls: number;
  /** Number of loop iterations */
  iterations: number;
  /** Information about the last tool call (if any) */
  lastToolCallInfo: LastToolCallInfo | null;
  /** Error message if the loop failed */
  error?: string;
  /** Maximum iterations reached (potential infinite loop detection) */
  maxIterationsReached?: boolean;
}

export interface AgentLoopOptions {
  /** LLM with bound tools */
  llmWithTools: Runnable;
  /** Initial messages (system prompt + filtered conversation history) */
  initialMessages: any[];
  /** Available tools for this agent */
  tools: DynamicStructuredTool[];
  /** Agent name for logging */
  agentName: string;
  /** NestJS Logger instance */
  logger: Logger;
  /**
   * Optional flow data accumulator.
   * If provided, the runner automatically extracts flow data from
   * updateFlowData/updateFlowStatus tool calls before executing them.
   * Used by wallet agent for flow state management.
   */
  flowDataAccumulator?: FlowDataAccumulator;
}

// ============================================================
// Agent Loop Runner
// ============================================================

/**
 * 执行 Agent 循环
 *
 * 手动实现的 ReAct Agent 循环：
 * 1. LLM 思考 → 决定是否调用工具
 * 2. 如果调用工具 → 执行工具 → 把结果喂回 LLM
 * 3. 重复直到 LLM 不再调用工具或达到最大迭代次数
 *
 * @param options - Agent 循环配置
 * @returns AgentLoopResult
 */
export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    llmWithTools,
    initialMessages,
    tools,
    agentName,
    logger,
    flowDataAccumulator,
  } = options;
  let currentMessages = [...initialMessages];

  let iterations = 0;
  let totalToolCalls = 0;
  let lastToolCallInfo: LastToolCallInfo | null = null;

  try {
    while (iterations < MAX_ITERATIONS) {
      const response = await llmWithTools.invoke(currentMessages);
      currentMessages = [...currentMessages, response];

      if (response.tool_calls) {
        totalToolCalls += response.tool_calls.length;
      }

      // LLM 没有调用工具 → 已给出最终回答，退出循环
      if (!response.tool_calls || response.tool_calls.length === 0) {
        break;
      }

      // 执行工具调用
      for (const toolCall of response.tool_calls) {
        // Extract flow data BEFORE executing the tool (wallet agent only)
        if (flowDataAccumulator) {
          extractFlowData(toolCall, flowDataAccumulator);
        }

        const foundTool = tools.find((t) => t.name === toolCall.name);
        if (foundTool) {
          const result = await (foundTool as any).invoke(toolCall.args);
          lastToolCallInfo = {
            name: toolCall.name,
            args: toolCall.args,
            result,
          };
          currentMessages = [
            ...currentMessages,
            new ToolMessage(stripToolResult(result), toolCall.id ?? ''),
          ];
        } else {
          logger.warn(`[${agentName}] tool "${toolCall.name}" not found`);
          currentMessages = [
            ...currentMessages,
            new ToolMessage(
              `Error: Tool "${toolCall.name}" not found`,
              toolCall.id ?? '',
            ),
          ];
        }
      }
      iterations++;
    }

    logger.log(
      `[${agentName}] totalMsgs=${currentMessages.length}, totalToolCalls=${totalToolCalls}`,
    );

    // Build result
    const lastMsg = currentMessages[currentMessages.length - 1];
    const content =
      typeof lastMsg.content === 'string'
        ? lastMsg.content
        : JSON.stringify(lastMsg.content ?? '');

    const agentSteps: AgentStep[] = [
      {
        node: agentName,
        totalToolCalls,
        iterations,
        lastToolCall: lastToolCallInfo
          ? {
              name: lastToolCallInfo.name,
              args: lastToolCallInfo.args,
              result: lastToolCallInfo.result,
            }
          : null,
        totalMessages: currentMessages.length,
      },
    ];

    return {
      content,
      currentMessages,
      agentSteps,
      totalToolCalls,
      iterations,
      lastToolCallInfo,
    };
  } catch (error) {
    logger.error(`[${agentName}] agent error:`, error);
    return {
      content: '',
      currentMessages,
      agentSteps: [],
      totalToolCalls: 0,
      iterations,
      lastToolCallInfo: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * 从工具调用中提取 flow data/status（wallet agent 专用）
 */
function extractFlowData(
  toolCall: { name: string; args?: Record<string, any> },
  accumulator: FlowDataAccumulator,
): void {
  if (toolCall.name === 'updateFlowData' && toolCall.args?.data) {
    Object.assign(accumulator.flowData, toolCall.args.data);
  }
  if (toolCall.name === 'updateFlowStatus' && toolCall.args?.flowStatus) {
    accumulator.flowStatus = toolCall.args.flowStatus as FlowStatus;
    if (toolCall.args?.flowType) {
      accumulator.flowType = toolCall.args.flowType as FlowType;
    }
  }
}
