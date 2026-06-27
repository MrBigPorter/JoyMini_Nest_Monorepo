import { AgentState } from '@api/client/ai-customer/graph/state';
import { IOrderService } from '@api/client/orders/order.service';
import { createOrderTools } from '@api/client/ai-customer/graph/tools/order-tools';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';
import { ToolMessage } from '@langchain/core/messages/tool';
import { Logger } from '@nestjs/common';
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
  orderService: IOrderService,
) => {
  const logger = new Logger('OrderAgent');
  return async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    const userId = state.userId;

    // 1. 创建工具（无需 userId 参数，由 LLM 通过 tool 参数传递）
    const tools = createOrderTools(orderService);
    const llm = createLLM(llmConfig, {
      temperature: 0,
    });

    // 2. 手动 Agent 循环（替代 createAgent），精确控制 maxIterations
    /**
     * 用户问"我的订单到哪了？"
     *   → LLM 思考："我需要查订单"
     *   → LLM 调用 getUserOrders(userId="...")
     *   → 拿到订单数据
     *   → LLM 再思考："订单已发货，预计明天到"
     *   → 用自然语言回答用户
     */
    const llmWithTools = llm.bindTools(tools);
    let currentMessages: any[] = [
      {
        role: 'system',
        content: `You are a professional order inquire assistant for JoyMini platform.
You have access to order query tools. Follow these rules:
1. First understand what the user needs (order list? specific order details?)
2. The current user's ID is: ${userId}
3. When calling tools, you MUST always include the userId parameter with the above ID
4. Use the appropriate tool to fetch the data
5. Present the information clearly and concisely in English
6. If the user asks about something outside order scope, politely guide them back
7. If a tool returns an error message, tell the user the order may not exist or may not belong to them, and suggest they check the order number.
`,
      },
      ...state.messages.slice(-6),
    ];
    let iterations = 0;
    const MAX_ITERATIONS = 3;
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
      };
    }

    const lastMessage = currentMessages[currentMessages.length - 1];
    const lastToolCall = (lastMessage as any)?.tool_calls?.[0];
    logger.log(
      `[order-agent] totalMsgs=${currentMessages.length}, toolCalls=${lastToolCall?.length ?? 0}`,
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
