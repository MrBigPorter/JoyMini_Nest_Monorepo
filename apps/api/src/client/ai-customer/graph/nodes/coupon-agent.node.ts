import { AgentState } from '@api/client/ai-customer/graph/state';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';
import { Logger } from '@nestjs/common';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { AgentNodeOutput } from '@api/client/ai-customer/graph/types/agent-types';
import { filterAgentMessages } from '@api/client/ai-customer/graph/utils/filter-messages';
import { MAX_CONTEXT_MESSAGES } from '@api/client/ai-customer/graph/constants';
import { buildAgentPrompt } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { runAgentLoop } from '@api/client/ai-customer/graph/agents/agent-runner';

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
 * 通过 prompt-builder 自动构建标准化 system prompt，
 * 通过 agent-runner 执行 ReAct 循环。
 */
export const createCouponAgentNode = (
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) => {
  const logger = new Logger('CouponAgent');
  return async (state: typeof AgentState.State): Promise<AgentNodeOutput> => {
    const userId = state.userId;
    const tools = registry.getToolsByTag('coupon');
    const llm = createLLM(llmConfig, { temperature: 0 });
    const llmWithTools = llm.bindTools(tools);

    const systemPrompt = buildAgentPrompt({
      role: 'You are the coupon inquiry assistant for JoyMini platform. Respond in English.',
      domainName: 'coupon',
      userId,
      workflow: `Step 1: Understand what the user needs
- View my coupons list → getUserCoupons
- View claimable coupons → getClaimableCoupons
- Claim a coupon → claimCoupon
- Redeem a coupon code → redeemCouponCode

Step 2: Pick the right tool from the list above

Step 3: Call the tool to get real data (must pass userId parameter)

Step 4: Present the tool result to the user

Step 5: Respond in English`,
      examples: `User: "Show me my coupons"
→ You call getUserCoupons(userId="${userId}")
→ After getting the result, present the ACTUAL data returned by the tool. Do NOT make up coupon names or amounts.
→ Reply with the real data, for example:
"You have 2 coupons:
1. [name from tool result] — [discount from tool result], valid until [expiry from tool result]
2. [name from tool result] — [discount from tool result], valid until [expiry from tool result]"`,
      displayFormat: `- Show: coupon name, discount value, minimum purchase, validity period, and status`,
      scopeRestriction: {
        domain: 'coupon',
        handles: ['coupon list', 'claimable coupons', 'claim coupon', 'redeem code'],
        outside: ['wallet', 'orders', 'products', 'lucky-draw'],
      },
      hardRules: [
        '- **If a tool call fails (returns an error/failure), DO NOT retry the same call with the same parameters.** Tell the user why it failed and suggest alternatives.',
        '- If the conversation history already shows a failed tool call for the same coupon/code, do NOT call the same tool again — just inform the user based on the previous result.',
      ],
    });

    const initialMessages = [
      { role: 'system', content: systemPrompt },
      ...filterAgentMessages(
        state.messages,
        state.pendingTasks,
        state.messageTopics,
        'couponAgent',
      ).slice(-MAX_CONTEXT_MESSAGES),
    ];

    const result = await runAgentLoop({
      llmWithTools,
      initialMessages,
      tools,
      agentName: 'couponAgent',
      logger,
    });

    if (result.error) {
      return {
        taskResults: {
          couponAgent:
            'Sorry, I encountered an issue processing your coupon request. Please try again later.',
        },
        messages: state.messages,
        agentSteps: [],
      };
    }

    return {
      taskResults: { couponAgent: result.content },
      messages: result.currentMessages.slice(1),
      agentSteps: result.agentSteps,
    } satisfies AgentNodeOutput;
  };
};
