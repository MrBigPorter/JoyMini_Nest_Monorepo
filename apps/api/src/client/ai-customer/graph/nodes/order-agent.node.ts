import { AgentState } from '@api/client/ai-customer/graph/state';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';
import { ToolMessage } from '@langchain/core/messages/tool';
import { Logger } from '@nestjs/common';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { stripToolResult } from '@api/client/ai-customer/graph/tools/tool-result';
import { MAX_ITERATIONS } from '@api/client/ai-customer/graph/constants';
import { AgentNodeOutput } from '@api/client/ai-customer/graph/types/agent-types';
import { filterAgentMessages } from '@api/client/ai-customer/graph/utils/filter-messages';

/**
 * orderAgent 占位节点 — 用于 graph 无条件注册
 * Phase 1 阶段只是透传，等 chatStream 接入后由 createOrderAgentNode 替换
 */
export const orderAgentNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  return state;
};

/**
 * 生成 order agent 节点函数的工厂
 *
 * 方案A：userId 作为 tool 的 Zod 参数，由 LLM 自动传递。
 * 每次调用时从 state.userId 提取当前用户 ID，注入 messageModifier，
 * LLM 在调用 tool 时自动带上 userId 参数。
 */
export const createOrderAgentNode = (
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) => {
  const logger = new Logger('OrderAgent');
  return async (state: typeof AgentState.State): Promise<AgentNodeOutput> => {
    const userId = state.userId;

    const tools = registry.getToolsByTag('order');
    const llm = createLLM(llmConfig, {
      temperature: 0,
    });
    const llmWithTools = llm.bindTools(tools);

    // 2. 手动 Agent 循环（替代 createAgent），精确控制 maxIterations
    /**
     * 用户问"我的订单到哪了？"
     *   → LLM 思考："我需要查订单"
     *   → LLM 调用 getUserOrders(userId="...")
     *   → 拿到订单数据
     *   → LLM 再思考："订单已发货，预计明天到"
     *   → 用自然语言回答用户
     */
    let currentMessages: any[] = [
      {
        role: 'system',
        content: `You are the order inquiry assistant for JoyMini platform. Respond in English.

## Current User
The current user's ID is: "${userId}".
Use this ID when calling any tool that requires the userId parameter.
Do NOT ask the user for their userId — you already have it.

## Your Workflow (Follow these steps exactly)

Step 1: Understand what the user needs
- View all orders → getUserOrders
- View specific order detail → getOrderDetail

Step 2: Pick the right tool from the list above

Step 3: Call the tool to get real data (must pass userId parameter)

Step 4: Present the tool result to the user

Step 5: Respond in English

## Available Tools

1. **Order List** - View all orders of the user (supports pagination)
2. **Order Detail** - View detailed information of a specific order

## Hard Rules (Violation = mistake)

- **You MUST call at least one tool** to answer questions. NEVER make up data.
- Never use your own knowledge to fabricate order data. All data must come from tool calls.
- Always pass the userId parameter when calling tools.
- If a tool returns an error, tell the user the real error. Don't hide it.

## Example (Follow this pattern)

User: "Show me my orders"
→ You call getUserOrders(userId="${userId}")
→ After getting the result, present the ACTUAL data returned by the tool. Do NOT make up order numbers or amounts.
→ Reply with the real data, for example:
"You have [count from tool result] orders:
1. Order [orderNo from tool result] — ₱[total from tool result], [status from tool result]
2. Order [orderNo from tool result] — ₱[total from tool result], [status from tool result]"

## Display Format

- Show: order number, total amount, status, and creation date
- For order detail, also show: items, shipping address, tracking number
- If the question is not about orders, politely guide the user back
- If a tool returns an error, inform the user the order may not exist or may not belong to them, suggest checking the order number
`,
      },
      // Filter: remove tool_calls and other agents' AI pure-text (supervisor mode)
      ...filterAgentMessages(state.messages, state.pendingTasks).slice(-6),
    ];
    let iterations = 0;

    let totalToolCalls = 0;
    let lastToolCallInfo: {
      name: string;
      args: Record<string, any>;
      result?: string;
    } | null = null;
    try {
      while (iterations < MAX_ITERATIONS) {
        const response = await llmWithTools.invoke(currentMessages);
        currentMessages = [...currentMessages, response];
        if (response.tool_calls) {
          totalToolCalls += response.tool_calls.length;
        }
        if (!response.tool_calls || response.tool_calls.length === 0) {
          break; // LLM 没有调用工具 → 已给出最终回答
        }
        // 执行工具调用
        for (const toolCall of response.tool_calls) {
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
          }
        }
        iterations++;
      }
      // 然后
      logger.log(
        `[order-agent] totalMsgs=${currentMessages.length}, totalToolCalls=${totalToolCalls}`,
      );
    } catch (error) {
      logger.error(`[order-agent] agent error:`, error);
      return {
        taskResults: {
          orderAgent:
            'Sorry, I encountered an issue processing your order request. Please try again later.',
        },
        messages: state.messages,
        agentSteps: [],
      };
    }

    const lastMsg = currentMessages[currentMessages.length - 1];
    logger.log(
      `[order-agent] totalMsgs=${currentMessages.length}, totalToolCalls=${totalToolCalls}`,
    );
    if (lastToolCallInfo) {
      logger.log(
        `[order-agent] lastTool="${lastToolCallInfo.name}" args=${JSON.stringify(lastToolCallInfo.args)}`,
      );
    }

    const content = typeof lastMsg.content === 'string' ? lastMsg.content : '';

    return {
      taskResults: { orderAgent: content },
      messages: currentMessages.slice(1),
      agentSteps: [
        {
          node: 'orderAgent',
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
      ],
    } satisfies AgentNodeOutput;
  };
};
