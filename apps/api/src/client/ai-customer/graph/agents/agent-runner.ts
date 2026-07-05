/**
 * agent-runner — Agent 循环引擎
 *
 * ── 是什么？ ──
 * 手动实现的 ReAct Agent 循环（Reasoning + Acting = 推理 + 行动）。
 * 提取所有 Agent 共用的 while 循环 + tool 执行 + 错误处理逻辑。
 *
 * ── 为什么手动实现，不用 LangChain 的 createReactAgent？ ──
 * 1. 灵活提取 flow data：wallet agent 需要在工具执行前"截获" updateFlowData 调用
 * 2. 更细粒度的错误处理：可以区分"工具未找到"和"工具执行报错"
 * 3. 自定义迭代次数控制：MAX_ITERATIONS 常量控制，防止无限循环
 * 4. flowDataAccumulator 可选回调：只有 wallet agent 需要，其他 agent 不需要
 *
 * ── 生活类比 ──
 * 这就像你让助理去查一个事情：
 * 1. 你问："帮我查一下这个客户的订单状态"（LLM 思考）
 * 2. 助理说："我需要查一下客户 ID"→ 查数据库（工具调用）
 * 3. 助理看结果："找到了，这是物流信息"（LLM 再次思考）
 * 4. 如果还需要继续查 → 重复
 * 5. 助理说："好了，这就是全部信息" → 结束循环
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
 * FlowDataAccumulator — flow data 累加器
 *
 * ── 是什么？ ──
 * 用于 wallet agent 从工具调用中提取 flow 状态。
 * 原理：在工具执行前"截获" updateFlowData/updateFlowStatus 的参数，
 * 提前更新 accumulator，供后续构建结果时使用。
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
 * runAgentLoop — 执行 Agent 循环
 *
 * ── 流程 ──
 * 1. LLM 思考 → 输出 AIMessage（可能带 tool_calls）
 * 2. 如果 AIMessage 没有 tool_calls → LLM 已给出最终回答，退出循环
 * 3. 如果有 tool_calls → 逐个执行工具
 *    a. 如果传入了 flowDataAccumulator，在工具执行前提取 flow 状态
 *    b. 找到对应的工具 → invoke → 结果通过 stripToolResult 剥离包装
 *    c. 未找到工具 → 返回错误消息
 * 4. 工具结果作为 ToolMessage 追加到消息列表
 * 5. 重复直到 LLM 不再调用工具或达到 MAX_ITERATIONS
 *
 * ════════════════════════════════════════════════════════════════
 * 【运行示例 — productAgent 处理 "那我要买Women Crossbody Bag Set，团购价格多少，加上优惠券，我还有多少钱"]
 * ════════════════════════════════════════════════════════════════
 *
 * runAgentLoop 被 orchestrator 调用，传入:
 *   llmWithTools: ChatOpenAI.bindTools([searchProducts, getProductDetail, ...])
 *   initialMessages: [systemPrompt, ...contextMessages]
 *   tools: [searchProducts, getProductDetail, getGroupBuyProducts, ...]
 *   agentName: 'product'
 *
 * ── 循环执行过程 ──
 *
 * 迭代 #1:
 *   llmWithTools.invoke([systemPrompt, contextMessages])
 *   → LLM 思考: "用户想买 Women Crossbody Bag Set，查团购价。我需要调用 searchProducts"
 *   → AIMessage.tool_calls = [
 *       { name: 'searchProducts', args: { query: 'Women Crossbody Bag Set' }, id: 'call_abc123' }
 *     ]
 *
 *   执行 tool_call:
 *     foundTool = tools.find(t => t.name === 'searchProducts')
 *     result = await searchProducts.invoke({ query: 'Women Crossbody Bag Set' })
 *     → 返回: { ok: true, data: [{ name: 'Women Crossbody Bag Set', groupBuyPrice: 29.99, ... }] }
 *     lastToolCallInfo = { name: 'searchProducts', args: {...}, result: {...} }
 *     ToolMessage(stripToolResult(result), 'call_abc123')
 *     → ToolMessage({ data: [{ name: 'Women Crossbody Bag Set', groupBuyPrice: 29.99 }] })
 *     currentMessages.push(ToolMessage)
 *     iterations = 1, totalToolCalls = 1
 *
 * 迭代 #2:
 *   llmWithTools.invoke(currentMessages)  ← 现在包含系统提示 + 用户消息 + 上一个 AI 消息 + 工具结果
 *   → LLM 思考: "查到了，Women Crossbody Bag Set 团购价 $29.99。用户还问了优惠券和钱包，
 *     但这些不是 productAgent 的职责（Scope Restriction），我只回答商品信息"
 *   → AIMessage.content = "I found the Women Crossbody Bag Set! The group buy price is $29.99 🎉"
 *   → tool_calls = undefined (没有更多的工具调用)
 *
 *   没有 tool_calls → break 退出循环
 *
 * ── 循环结束后的结果 ──
 *   return {
 *     content: "I found the Women Crossbody Bag Set! The group buy price is $29.99 🎉",
 *     currentMessages: [systemPrompt, HumanMessage, AIMessage(tool_call), ToolMessage, AIMessage],
 *     agentSteps: [{ node: 'product', totalToolCalls: 1, iterations: 2, ... }],
 *     totalToolCalls: 1,
 *     iterations: 2,
 *     lastToolCallInfo: { name: 'searchProducts', args: {...}, result: {...} }
 *   }
 *
 * orchestrator 收到 result.content 后，将内容存入 agentOutputs:
 *   agentOutputs.push({ label: 'product', content: "I found the Women Crossbody Bag Set!..." })
 *
 * 然后继续迭代 #2 (coupon)、#3 (wallet)，最后合成完整回复。
 * ════════════════════════════════════════════════════════════════
 *
 * ── 为什么要 stripToolResult？ ──
 * 工具返回的是 { ok: true, data: { balance: 100 } }。
 * LLM 不需要看到 "ok" 字段，只需要 { balance: 100 }。
 * 这就是 stripToolResult 在创建 ToolMessage 前做的事。
 *
 * ── 为什么用 flowDataAccumulator？ ──
 * wallet agent 的提现流程需要跟踪状态：IDLE→FILLING→CONFIRMING→COMPLETED。
 * 每次 LLM 调用 updateFlowData/updateFlowStatus 时，accumulator 自动记录。
 * 这样在循环结束后，可以知道当前的 flow 状态，用于构建结果。
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
 * extractFlowData — 从工具调用中提取 flow data/status
 *
 * ── 为什么需要在工具执行前提取？ ──
 * updateFlowData 和 updateFlowStatus 是"元工具"——它们不查数据库，
 * 只是更新 state 里的 flow 状态。但 Agent 循环在 runAgentLoop 里执行，
 * 无法直接修改外部的 state。所以需要用 accumulator 先"记录"这些更新，
 * 循环结束后再统一应用到 state。
 *
 * ── 生活类比 ──
 * 就像填表时，你每填完一栏，助理在旁边记笔记："姓名填了张三"。
 * 等表全部填完后，助理把笔记整理成一份完整的表格。
 * 而不是每填一栏就提交一次表格。
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
