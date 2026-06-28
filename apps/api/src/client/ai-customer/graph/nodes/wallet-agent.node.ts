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
    //messages：对话历史（HumanMessage、AIMessage、ToolMessage 等数组）
    const { messages, userId } = state;
    // iterations：LLM 思考-调用工具的轮数上限（防死循环）
    //totalToolCalls：统计总共调用了多少次工具（用于日志）
    let iterations = 0;
    let totalToolCalls = 0;
    // 获取工具
    const tools = registry.getToolsByTag('wallet');
    logger.log(
      `[wallet-agent] userId=${userId}, tools=${tools.map((t) => t.name).join(',')}`,
    );
    /**
     * 这相当于给 LLM 发了一本 工具说明书：
     *
     * 可用工具：
     * 1. getWalletBalance: 查余额，参数：userId
     * 2. getKycStatus: 查实名认证，参数：userId
     */
    const llmWithTools = createLLM(llmConfig, {
      temperature: 0,
    }).bindTools(tools); // 注册工具说明书

    let currentMessages: any[] = [
      //第 1 条是 system prompt（给 LLM 的角色设定和行为规则）
      {
        role: 'system',
        content: `You are the wallet and KYC assistant for JoyMini platform. Respond in English.

You can query information AND process withdrawals:

1. **Wallet Balance** - Query cash balance (real money), coin balance (in-app currency), frozen amount, total recharge/withdraw
2. **Transaction History** - View recharge/withdraw records, filterable by type
3. **KYC Status** - Check real-name verification status
4. **Payment Channels** - List available withdrawal channels (e.g. GCash, PayMaya, Bank)
5. **Apply Withdraw** - Submit a withdrawal request(requires: amount, account, accountName, channelId)

## Withdrawal Rules (TWO-STEP process):
### Step 1 - Preview
- If the user explicitly says "submit", "confirm", "提交", "确认" in their request, SKIP preview and go DIRECTLY to Step 2 (call applyWithdraw with the confirmed details).
- Otherwise, call \`getPaymentChannels\` (pass the amount to filter matching channels)
- Present matching channel options: name, min/max amount, fee information
- Ask user to confirm: amount, channel, account number, account name

### Step 2 - Confirm & Execute
- ONLY after user confirms, call \`applyWithdraw\` with the confirmed details
- IMPORTANT: \`applyWithdraw\` internally checks KYC + balance + prevents duplicates
- Return the withdrawal result (withdrawNo, status) to the user

##Rules:
- You can ONLY **query** KYC status — do NOT ask users to submit KYC documents
- If KYC is not completed, tell the user: "Please complete KYC verification in your profile first"
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
      ...state.messages.slice(-6), // 只取最近 6 条对话
    ];

    try {
      // 手动实现的 ReAct Agent 循环
      while (iterations < MAX_ITERATIONS) {
        //llmWithTools.invoke() — LLM 返回"我想用哪个工具"
        const response = await llmWithTools.invoke(currentMessages);
        //currentMessages = [...currentMessages, response];
        currentMessages = [...currentMessages, response];
        // 判断是否结束
        if (response.tool_calls) {
          totalToolCalls += response.tool_calls.length;
        }
        if (!response.tool_calls || response.tool_calls.length === 0) {
          break; // LLM 没有调用工具 → 已给出最终回答
        }
        // 执行工具调用
        //因为 LLM 只是一个文本生成模型，它没法直接去查数据库、调 API。它只能输出"我想调用 X"的文本描述。真正执行工具的是你的 Node.js 代码。
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
