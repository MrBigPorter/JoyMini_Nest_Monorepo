import { AgentState } from '@api/client/ai-customer/graph/state';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';
import { ToolMessage } from '@langchain/core/messages/tool';
import { Logger } from '@nestjs/common';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { MAX_ITERATIONS } from '@api/client/ai-customer/graph/constants';
import { AgentNodeOutput } from '@api/client/ai-customer/graph/types/agent-types';

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

You can query the following information:
1. Order List - View all orders of the user
2. Order Detail - View detailed information of a specific order

Rules:
- First understand what the user needs (order list? or a specific order detail?)
- Current user ID: ${userId}
- Always pass the userId parameter when calling tools
- Present data clearly and concisely in English
- If the user asks about something outside orders, politely guide them back
- If a tool returns an error, inform the user the order may not exist or may not belong to them, suggest checking the order number
`,
      },
      ...state.messages.slice(-6),
    ];
    let iterations = 0;
    let totalToolCalls = 0;
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
            currentMessages = [
              ...currentMessages,
              new ToolMessage(result, toolCall.id ?? ''),
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
        agentOutput:
          'Sorry, I encountered an issue processing your order request. Please try again later.',
        messages: state.messages,
        agentSteps: [],
      };
    }

    const lastMessage = currentMessages[currentMessages.length - 1];
    const lastToolCall = (lastMessage as any)?.tool_calls?.[0];
    logger.log(
      `[order-agent] totalMsgs=${currentMessages.length}, totalToolCalls=${totalToolCalls}`,
    );
    if (lastToolCall) {
      logger.log(
        `[order-agent] lastTool="${lastToolCall.name}" args=${JSON.stringify(lastToolCall.args)}`,
      );
    }

    const content =
      typeof lastMessage.content === 'string' ? lastMessage.content : '';

    return {
      // 纯文本输出 → 传给 answerSynthesizer
      agentOutput: content,
      // 保留原始的输入消息（不是 agent 内部消息）
      messages: state.messages,
      agentSteps: [
        {
          node: 'orderAgent',
          totalToolCalls,
          iterations,
          lastToolCall: lastToolCall
            ? { name: lastToolCall.name, args: lastToolCall.args }
            : null,
          totalMessages: currentMessages.length,
        },
      ],
    };
  };
};
