import { ChatOllama } from '@langchain/ollama';
import { AgentState } from '@api/client/ai-customer/graph/state';
import { OrderService } from '@api/client/orders/order.service';
import { createOrderTools } from '@api/client/ai-customer/graph/tools/order-tools';
import { createAgent } from 'langchain';
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
  llm: ChatOllama,
  orderService: OrderService,
) => {
  return async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    const userId = state.userId;

    // 1. 创建工具（无需 userId 参数，由 LLM 通过 tool 参数传递）
    const tools = createOrderTools(orderService);

    // 2. 创建 ReAct Agent，把 userId 注入到 messageModifier
    //    LLM 会在调用 tool 时自动包含 userId 参数
    /**
     * 用户问"我的订单到哪了？"
     *   → LLM 思考："我需要查订单"
     *   → LLM 调用 getUserTools(userId="...")
     *   → 拿到订单数据
     *   → LLM 再思考："订单已发货，预计明天到"
     *   → 用自然语言回答用户
     */
    const agentApp = createAgent({
      model: llm,
      tools,
      systemPrompt: `You are a professional order inquire assistant for JoyMini platform.
You have access to order query tools. Follow these rules:
1. First understand what the user needs (order list? specific order details?)
2. The current user's ID is: ${userId}
3. When calling tools, you MUST always include the userId parameter with the above ID
4. Use the appropriate tool to fetch the data
5. Present the information clearly and concisely in English
6. If the user asks about something outside order scope, politely guide them back`,
    });

    // 3. 调用 agent
    const result = await agentApp.invoke({
      messages: state.messages,
    });
    const lastMessage = result.messages[result.messages.length - 1];
    const content =
      typeof lastMessage.content === 'string' ? lastMessage.content : '';

    return {
      // 纯文本输出 → 传给 answerSynthesizer
      agentOutput: content,
      // 保留原始的输入消息（不是 agent 内部消息）
      messages: state.messages,
    };
  };
};
