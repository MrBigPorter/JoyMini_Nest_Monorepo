import {
  createLLM,
  type LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { Logger } from '@nestjs/common';
import { AgentState } from '@api/client/ai-customer/graph/state';
import {
  MAX_CONTEXT_MESSAGES,
} from '@api/client/ai-customer/graph/constants';
import { AgentNodeOutput } from '@api/client/ai-customer/graph/types/agent-types';
import { serializeMessages } from '@api/client/ai-customer/graph/utils/serialize-messages';
import { filterAgentMessages } from '@api/client/ai-customer/graph/utils/filter-messages';
import {
  FlowType,
  FlowStatus,
} from '@api/client/ai-customer/graph/types/flow-types';
import { buildAgentPrompt } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { runAgentLoop, FlowDataAccumulator } from '@api/client/ai-customer/graph/agents/agent-runner';

/**
 * walletAgent 无条件注册存根
 *
 * 主实现在 createWalletAgentNode（下方），此 export 仅用于 graph 编译时
 * 无条件注册一个节点名（walletAgent），graph 运行时通过 StateGraph 节点名
 * 查找 createWalletAgentNode 返回的实际闭包执行。
 *
 * 保留此存根是为了满足 LangGraph 编译时节点注册的要求。
 * 实际逻辑完全由 createWalletAgentNode 完成。
 */
export const walletAgentNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  return state;
};

/**
 * 生成 wallet agent 节点函数的工厂
 *
 * 通过 prompt-builder 自动构建标准化 system prompt，
 * 通过 agent-runner 执行 ReAct 循环并自动提取 flow data。
 */
export const createWalletAgentNode = (
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) => {
  const logger = new Logger('WalletAgent');
  return async (state: typeof AgentState.State): Promise<AgentNodeOutput> => {
    const { messages, userId, debug } = state;
    // Flow state accumulators
    const flowDataAccumulator: FlowDataAccumulator = {
      flowData: {},
    };
    // 获取工具（domain tools + flow tools）
    const domainTools = registry.getToolsByTag('wallet');
    const flowTools = registry.getToolsByTag('flow');
    const tools = [...domainTools, ...flowTools];
    logger.log(
      `[wallet-agent] userId=${userId}, tools=${tools.map((t) => t.name).join(',')}`,
    );

    const llmWithTools = createLLM(llmConfig, {
      temperature: 0,
    }).bindTools(tools);

    const systemPrompt = buildAgentPrompt({
      role: 'You are the wallet and KYC assistant for JoyMini platform. Respond in English.',
      domainName: 'wallet',
      userId,
      flowContext: true,
      workflow: `Step 1: Understand what the user needs
- Check balance / transactions → getWalletBalance / getWalletTransactions
- Check KYC status → getKycStatus
- View payment channels → getPaymentChannels
- Withdraw money → follow the Withdrawal Rules below

Step 2: Pick the right tool from the available list

Step 3: Call the tool to get real data (must pass userId parameter)

Step 4: Present the tool result to the user

Step 5: If more info needed, continue the conversation with the user`,
      availableTools: `1. **Wallet Balance** - Query cash balance (real money), coin balance (in-app currency), frozen amount, total recharge/withdraw
2. **Transaction History** - View recharge/withdraw records, filterable by type
3. **KYC Status** - Check real-name verification status
4. **Payment Channels** - List available withdrawal channels (e.g. GCash, PayMaya, Bank)
5. **Apply Withdraw** - Submit a withdrawal request (requires: amount, account, accountName, channelId)`,
      domainRules: `## Withdrawal Rules (TWO-STEP process):

### Step 1 - Preview
- If the user explicitly says "submit", "confirm", "提交", "确认" in their request, SKIP preview and go DIRECTLY to Step 2 (call applyWithdraw with the confirmed details).
- Otherwise, call \`getPaymentChannels\` (pass the amount to filter matching channels)
- Present matching channel options: name, min/max amount, fee information
- Ask user to confirm: amount, channel, account number, account name

### Step 2 - Confirm & Execute
- ONLY after user confirms, call \`applyWithdraw\` with the confirmed details
- IMPORTANT: \`applyWithdraw\` internally checks KYC + balance + prevents duplicates
- Return the withdrawal result (withdrawNo, status) to the user

### OTP VERIFICATION:
- After user confirms withdrawal details, call requestWithdrawOtp to send verification code
- Tell user "to check their phone/email for the OTP, Please input the OTP to confirm the withdrawal"
- Only after user provides the OTP code, call verifyWithdrawOtp
- Only proceed with applyWithdraw after verifyWithdrawOtp returns success
- If user provides OTP together with withdrawal request in one message, verify OTP first then proceed`,
      scopeRestriction: {
        domain: 'wallet/KYC',
        handles: ['balance', 'transactions', 'withdrawal', 'payment channels', 'KYC'],
        outside: ['coupons', 'orders', 'products', 'lucky-draw'],
      },
      hardRules: [
        '- You can ONLY **query** KYC status — do NOT ask users to submit KYC documents',
        '- If KYC is not completed, tell the user: "Please complete KYC verification in your profile first"',
      ],
      examples: `User: "What's my balance?"
→ You call getWalletBalance(userId="${userId}")
→ After getting the result, present the ACTUAL data returned by the tool. Do NOT make up amounts.
→ Reply with the real data, for example:
"Your balance:
- Cash: ₱[amount from tool result]
- Coins: [amount from tool result] coins
- Frozen: ₱[amount from tool result]"`,
      extraSections: [
        `## CRITICAL - Amount Tracking:
- The user specifies a withdrawal amount
- You MUST remember this exact amount throughout the entire flow
- When calling applyWithdraw, ALWAYS use the amount the user originally specified`,
      ],
      displayFormat: `- **Cash balance** (realBalance) is REAL MONEY (PHP pesos). Use ₱ or PHP as the unit.
- **Coin balance** (coinBalance) is IN-APP CURRENCY, NOT real money. Use "coins" as the unit.
- Cash and coins are SEPARATE assets. They CANNOT be converted or added together.
- NEVER combine them or say "you have X total balance".
- Always present them separately with their respective units clearly labeled.
- Transaction history supports pagination (page, pageSize params)`,
    });

    const initialMessages = [
      {
        role: 'system',
        content: systemPrompt,
      },
      // Filter: remove tool_calls and other agents' AI pure-text (supervisor mode)
      ...filterAgentMessages(
        state.messages,
        state.pendingTasks,
        state.messageTopics,
        'walletAgent',
      ).slice(
        -MAX_CONTEXT_MESSAGES,
      ),
    ];

    const result = await runAgentLoop({
      llmWithTools,
      initialMessages,
      tools,
      agentName: 'walletAgent',
      logger,
      flowDataAccumulator,
    });

    if (result.error) {
      logger.error(`[wallet-agent] agent error:`, result.error);
      return {
        taskResults: {
          walletAgent:
            'Sorry, I encountered an issue processing your wallet request. Please try again later.',
        },
        messages: result.currentMessages.slice(1),
        agentSteps: [],
      };
    }

    // Add debug messages if debug mode is enabled
    const agentSteps = result.agentSteps.map((step) => ({
      ...step,
      messages: debug ? serializeMessages(result.currentMessages) : undefined,
    }));

    return {
      taskResults: { walletAgent: result.content },
      messages: result.currentMessages.slice(1),
      agentSteps,
      // Return accumulated flow data so LangGraph merge reducer persists it to state.flowData
      flowData:
        Object.keys(flowDataAccumulator.flowData).length > 0
          ? flowDataAccumulator.flowData
          : undefined,
      // Return latest flow type so LangGraph replace reducer persists it to state.flowType
      flowType: flowDataAccumulator.flowType,
      // Return latest flow status so LangGraph replace reducer persists it to state.flowStatus
      flowStatus: flowDataAccumulator.flowStatus,
    } satisfies AgentNodeOutput;
  };
};
