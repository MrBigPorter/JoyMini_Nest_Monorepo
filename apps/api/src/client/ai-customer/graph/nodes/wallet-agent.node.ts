// ============================================================
// wallet-agent.node.ts — Wallet & KYC Agent
// ============================================================
// 面试题对应: interview-ai-agent-order-system.md Q3/Q4/Q5/Q6/Q7/Q8
//
// 代码结构 = 面试答案结构 = LLM 执行流程:
//   ① 承接 Handoff     → 从 StateGraph 接收 state + 获取 domain + flow tools
//   ② 上下文过滤 Filter  → 提取本 Agent 相关对话
//   ③ Prompt 构造 Prompt → 10-section system prompt（含 extraSections）
//   ④ ReAct 循环 Loop   → LLM 思考→工具→结果，自动提取 flow data
//   ⑤ 结果输出 Output   → 成功/失败 + flowData/flowType/flowStatus
// ============================================================
// 特殊说明（Q8: 工程化考量）:
//   - Wallet 是唯一"写操作" Agent（提现申请）
//   - 使用 flow tools（updateFlowData / updateFlowStatus）跟踪流程状态
//   - 支持 debug 模式：序列化完整消息到 agentSteps
//   - OTP 验证：两阶段确认（preview → OTP → execute）
// ============================================================

import { type LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { Logger } from '@nestjs/common';
import { AgentState } from '@api/client/ai-customer/graph/state';
import { MAX_CONTEXT_MESSAGES } from '@api/client/ai-customer/graph/constants';
import { AgentNodeOutput } from '@api/client/ai-customer/graph/types/agent-types';
import { serializeMessages } from '@api/client/ai-customer/graph/utils/serialize-messages';
import { prepareAgentContext } from '@api/client/ai-customer/graph/utils/prepare-context';
import { buildAgentPrompt } from '@api/client/ai-customer/graph/agents/prompt-builder';
import {
  runAgentLoop,
  FlowDataAccumulator,
} from '@api/client/ai-customer/graph/agents/agent-runner';
import {
  buildAgentResult,
  buildInitialMessages,
  createAgentLLM,
} from '@api/client/ai-customer/graph/agents/agent-result';
import { walletPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/wallet-prompt';

/**
 * walletAgent 占位节点 — 用于 graph 无条件注册
 */
export const walletAgentNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  return state;
};

/**
 * 生成 wallet agent 节点函数的工厂
 *
 * 特殊处理（区别于标准 Agent）:
 * 1. 获取两组工具：domain tools（wallet）+ flow tools（updateFlowData/updateFlowStatus）
 * 2. 使用 FlowDataAccumulator 自动从工具调用中提取 flow 状态
 * 3. debug 模式下序列化完整消息链到 agentSteps
 * 4. 返回 flowData/flowType/flowStatus 供下游 answerSynthesizer 使用
 */
export const createWalletAgentNode = (
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) => {
  const logger = new Logger('WalletAgent');
  return async (state: typeof AgentState.State): Promise<AgentNodeOutput> => {
    // ================================================================
    // ① 承接 — Flow Handoff（Q3: 从 StateGraph 接收 state）
    //    特殊：获取 domain tools + flow tools 两组工具
    // ================================================================
    const { messages, userId, debug } = state;
    const flowDataAccumulator: FlowDataAccumulator = { flowData: {} };
    const tools = [
      ...registry.getToolsByTag('wallet'),
      ...registry.getToolsByTag('flow'),
    ];
    const llmWithTools = createAgentLLM(llmConfig, tools);
    logger.log(
      `[wallet-agent] userId=${userId}, tools=${tools.map((t) => t.name).join(',')}`,
    );

    // ================================================================
    // ② 上下文过滤 — Context Filtering（Q5: 历史窗口 + 跨Agent隔离）
    // ================================================================
    const agentContext = prepareAgentContext(
      messages,
      state.pendingTasks,
      state.messageTopics,
      'walletAgent',
    ).slice(-MAX_CONTEXT_MESSAGES);

    // ================================================================
    // ③ Prompt 构造 — System Prompt（Q6: 数据转换 + Q7: 规则注入）
    //    特殊：wallet 有 extraSections（金额追踪提醒）
    // ================================================================
    const systemPrompt = buildAgentPrompt({
      ...walletPromptConfig,
      userId,
      flowType: state.flowType,
      flowStatus: state.flowStatus,
    });
    const initialMessages = buildInitialMessages(systemPrompt, agentContext);

    // ================================================================
    // ④ ReAct 循环 — LLM + Tools 手动循环（Q5: 手动 while）
    //    特殊：传入 flowDataAccumulator 自动提取 flow 状态
    // ================================================================
    const result = await runAgentLoop({
      llmWithTools,
      initialMessages,
      tools,
      agentName: 'walletAgent',
      logger,
      flowDataAccumulator,
    });

    // ================================================================
    // ⑤ 结果输出 — Error Handling + Result Output（Q7: 两层防御）
    //    特殊：
    //     - 错误路径：使用 state.messages（修复 Bug 1）
    //     - 成功路径：携带 flowData/flowType/flowStatus
    //     - debug 模式：序列化消息到 agentSteps
    // ================================================================
    if (result.error) {
      logger.error(`[wallet-agent] agent error:`, result.error);
    }

    // 处理 debug 模式下的消息序列化
    const agentSteps = result.agentSteps.map((step) => ({
      ...step,
      messages: debug ? serializeMessages(result.currentMessages) : undefined,
    }));

    return buildAgentResult('walletAgent')
      .agentSteps(agentSteps)
      .flowData(
        Object.keys(flowDataAccumulator.flowData).length > 0
          ? flowDataAccumulator.flowData
          : undefined,
      )
      .flowType(flowDataAccumulator.flowType)
      .flowStatus(flowDataAccumulator.flowStatus)
      .from(result, state.messages);
  };
};
