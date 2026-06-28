import {
  createLLM,
  type LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { Logger } from '@nestjs/common';
import { AgentState } from '@api/client/ai-customer/graph/state';
import { MAX_ITERATIONS } from '@api/client/ai-customer/graph/constants';
import { ToolMessage } from '@langchain/core/messages/tool';
import { AgentNodeOutput } from '@api/client/ai-customer/graph/types/agent-types';

/**
 * walletAgent 占位节点 — 用于 graph 无条件注册
 * Phase 1 阶段只是透传，等 chatStream 接入后由 createWalletAgentNode 替换
 */
export const walletAgentNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  return state;
};

/**
 * 生成 wallet agent 节点函数的工厂
 *
 * 方案A：userId 作为 tool 的 Zod 参数，由 LLM 自动传递。
 * 每次调用时从 state.userId 提取当前用户 ID，注入 messageModifier，
 * LLM 在调用 tool 时自动带上 userId 参数。
 */
export const createWalletAgentNode = (
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) => {
  const logger = new Logger('WalletAgent');
  return async (state: typeof AgentState.State): Promise<AgentNodeOutput> => {
    const { messages, userId } = state;
    let iterations = 0;
    let totalToolCalls = 0;
    const tools = registry.getToolsByTag('wallet');
    logger.log(
      `[wallet-agent] userId=${userId}, tools=${tools.map((t) => t.name).join(',')}`,
    );
    const llmWithTools = createLLM(llmConfig, {
      temperature: 0,
    }).bindTools(tools);

    let currentMessages: any[] = [
      {
        role: 'system',
        content: `You are the wallet and KYC assistant for JoyMini platform. Respond in English.

You can query the following information:

1. **Wallet Balance** - Query cash balance (real money), coin balance (in-app currency), frozen amount, total recharge/withdraw
2. **Transaction History** - View recharge/withdraw records, filterable by type
3. **KYC Status** - Check real-name verification status

Rules:
- You can only **query** information — no operations (no withdraw, no transfer)
- Transaction history supports pagination (page, pageSize params)
- Current user ID: ${userId}
- Always pass the userId parameter when calling tools
- If the user asks to withdraw, inform them this feature is not yet available
- Present data clearly and concisely in English

Important - Cash vs Coins distinction:
- **Cash balance** (realBalance) is REAL MONEY (PHP pesos). Use ₱ or PHP as the unit.
- **Coin balance** (coinBalance) is IN-APP CURRENCY, NOT real money. Use "coins" as the unit.
- Cash and coins are SEPARATE assets. They CANNOT be converted or added together.
- NEVER combine them or say "you have X total balance".
- Always present them separately with their respective units clearly labeled.
`,
      },
      ...state.messages.slice(-6),
    ];

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
              new ToolMessage(result, toolCall?.id ?? ''),
            ];
          } else {
            logger.warn(`[WalletAgent] tool "${toolCall.name}" not found`);
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
        `[wallet-agent] totalMsgs=${currentMessages.length}, totalToolCalls=${totalToolCalls}`,
      );
    } catch (error) {
      logger.error(`[wallet-agent] agent error:`, error);
      return {
        agentOutput:
          'Sorry, I encountered an issue processing your wallet request. Please try again later.',
        messages: state.messages,
        agentSteps: [],
      };
    }

    const lastMessage = currentMessages[currentMessages.length - 1];
    const lastToolCall = (lastMessage as any)?.tool_calls?.[0];
    logger.log(
      `[wallet-agent] totalMsgs=${currentMessages.length}, totalToolCalls=${totalToolCalls}`,
    );
    if (lastToolCall) {
      logger.log(
        `[wallet-agent] lastTool="${lastToolCall.name}" args=${JSON.stringify(
          lastToolCall.args,
        )}`,
      );
    }
    const content =
      typeof lastMessage.content === 'string'
        ? lastMessage.content
        : lastMessage.content;
    return {
      agentOutput: content,
      messages: state.messages,
      agentSteps: [
        {
          node: 'walletAgent',
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
