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
 * couponAgent 占位节点 — 用于 graph 无条件注册
 * Phase 1 阶段只是透传，等 chatStream 接入后由 createCouponAgentNode 替换
 */
export const couponAgentNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  return state;
};

/**
 * 生成 coupon agent 节点函数的工厂
 *
 * 方案A：userId 作为 tool 的 Zod 参数，由 LLM 自动传递。
 * 每次调用时从 state.userId 提取当前用户 ID，注入 messageModifier，
 * LLM 在调用 tool 时自动带上 userId 参数。
 */
export const createCouponAgentNode = (
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) => {
  const logger = new Logger('CouponAgent');
  return async (state: typeof AgentState.State): Promise<AgentNodeOutput> => {
    const userId = state.userId;

    const tools = registry.getToolsByTag('coupon');
    const llm = createLLM(llmConfig, {
      temperature: 0,
    });
    const llmWithTools = llm.bindTools(tools);

    let currentMessages: any[] = [
      {
        role: 'system',
        content: `You are the coupon inquiry assistant for JoyMini platform. Respond in English.

## Current User
The current user's ID is: "${userId}".
Use this ID when calling any tool that requires the userId parameter.
Do NOT ask the user for their userId — you already have it.

## Your Workflow (Follow these steps exactly)

Step 1: Understand what the user needs
- View my coupons list → getUserCoupons
- View claimable coupons → getClaimableCoupons
- Claim a coupon → claimCoupon
- Redeem a coupon code → redeemCouponCode

Step 2: Pick the right tool from the list above

Step 3: Call the tool to get real data (must pass userId parameter)

Step 4: Present the tool result to the user

Step 5: Respond in English

## Hard Rules (Violation = mistake)

- **You MUST call at least one tool** to answer questions. NEVER make up data.
- Never use your own knowledge to fabricate coupon data. All data must come from tool calls.
- Always pass the userId parameter when calling tools.
- If a tool returns an error, tell the user the real error. Don't hide it.
- **If a tool call fails (returns an error/failure), DO NOT retry the same call with the same parameters.** Tell the user why it failed and suggest alternatives.
- If the conversation history already shows a failed tool call for the same coupon/code, do NOT call the same tool again — just inform the user based on the previous result.

## Example (Follow this pattern)

User: "Show me my coupons"
→ You call getUserCoupons(userId="${userId}")
→ After getting the result, present the ACTUAL data returned by the tool. Do NOT make up coupon names or amounts.
→ Reply with the real data, for example:
"You have 2 coupons:
1. [name from tool result] — [discount from tool result], valid until [expiry from tool result]
2. [name from tool result] — [discount from tool result], valid until [expiry from tool result]"

## Display Format

- Show: coupon name, discount value, minimum purchase, validity period, and status
- If the question is not about coupons, politely guide the user back
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
            // 记录最后一次工具调用的详情（即使后面还有迭代也保留最后有工具调用的那次）
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
      logger.log(
        `[coupon-agent] totalMsgs=${currentMessages.length}, totalToolCalls=${totalToolCalls}`,
      );
    } catch (error) {
      logger.error(`[coupon-agent] agent error:`, error);
      return {
        taskResults: {
          couponAgent:
            'Sorry, I encountered an issue processing your coupon request. Please try again later.',
        },
        messages: state.messages,
        agentSteps: [],
      };
    }

    logger.log(
      `[coupon-agent] totalMsgs=${currentMessages.length}, totalToolCalls=${totalToolCalls}`,
    );
    if (lastToolCallInfo) {
      logger.log(
        `[coupon-agent] lastTool="${lastToolCallInfo.name}" args=${JSON.stringify(lastToolCallInfo.args)}`,
      );
    }

    const lastMsg = currentMessages[currentMessages.length - 1];
    const content = typeof lastMsg.content === 'string' ? lastMsg.content : '';

    return {
      taskResults: { couponAgent: content },
      messages: currentMessages.slice(1),
      agentSteps: [
        {
          node: 'couponAgent',
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
