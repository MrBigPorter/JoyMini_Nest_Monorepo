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
 * orderAgent 占位节点 — 用于 graph 无条件注册
 */
export const orderAgentNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  return state;
};

/**
 * 生成 order agent 节点函数的工厂
 *
 * 通过 prompt-builder 自动构建标准化 system prompt，
 * 通过 agent-runner 执行 ReAct 循环。
 */
export const createOrderAgentNode = (
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) => {
  const logger = new Logger('OrderAgent');
  return async (state: typeof AgentState.State): Promise<AgentNodeOutput> => {
    const userId = state.userId;
    const tools = registry.getToolsByTag('order');
    const llm = createLLM(llmConfig, { temperature: 0 });
    const llmWithTools = llm.bindTools(tools);

    const systemPrompt = buildAgentPrompt({
      role: 'You are the order inquiry assistant for JoyMini platform. Respond in English.',
      domainName: 'order',
      userId,
      workflow: `Step 1: Understand what the user needs
- View all orders → getUserOrders
- View specific order detail → getOrderDetail

Step 2: Pick the right tool from the list above

Step 3: Call the tool to get real data (must pass userId parameter)

Step 4: Present the tool result to the user

Step 5: Respond in English`,
      availableTools: `1. **Order List** - View all orders of the user (supports pagination)
2. **Order Detail** - View detailed information of a specific order`,
      examples: `User: "Show me my orders"
→ You call getUserOrders(userId="${userId}")
→ After getting the result, present the ACTUAL data returned by the tool. Do NOT make up order numbers or amounts.
→ Reply with the real data, for example:
"You have [count from tool result] orders:
1. Order [orderNo from tool result] — ₱[total from tool result], [status from tool result]
2. Order [orderNo from tool result] — ₱[total from tool result], [status from tool result]"`,
      displayFormat: `- Show: order number, total amount, status, and creation date
- For order detail, also show: items, shipping address, tracking number
- If a tool returns an error, inform the user the order may not exist or may not belong to them, suggest checking the order number`,
      scopeRestriction: {
        domain: 'order',
        handles: ['order list', 'order detail', 'order status', 'tracking'],
        outside: ['wallet', 'coupons', 'products', 'lucky-draw'],
      },
    });

    const initialMessages = [
      { role: 'system', content: systemPrompt },
      ...filterAgentMessages(
        state.messages,
        state.pendingTasks,
        state.messageTopics,
        'orderAgent',
      ).slice(-MAX_CONTEXT_MESSAGES),
    ];

    const result = await runAgentLoop({
      llmWithTools,
      initialMessages,
      tools,
      agentName: 'orderAgent',
      logger,
    });

    if (result.error) {
      return {
        taskResults: {
          orderAgent:
            'Sorry, I encountered an issue processing your order request. Please try again later.',
        },
        messages: state.messages,
        agentSteps: [],
      };
    }

    return {
      taskResults: { orderAgent: result.content },
      messages: result.currentMessages.slice(1),
      agentSteps: result.agentSteps,
    } satisfies AgentNodeOutput;
  };
};
