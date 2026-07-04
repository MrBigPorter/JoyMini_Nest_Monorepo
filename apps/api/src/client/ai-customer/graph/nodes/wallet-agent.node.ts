/**
 * Wallet & KYC Agent Node
 *
 * ── 是什么？ ──
 * 智能客服系统中唯一处理"写操作"（提现申请）的 Agent。
 * 继承 5-section 标准模板（Handoff → Filter → Prompt → Loop → Output），
 * 额外引入两组特殊工具（domain tools + flow tools）实现多步骤工作流。
 *
 * ── 为什么需要特殊处理（区别于 OrderAgent / UserAgent）？ ──
 * 1. 写操作涉及资金安全，必须分步骤执行（预览 → OTP → 确认）
 * 2. 提现流程需要追踪用户每步提供的信息（金额、银行卡号、OTP 验证码）
 * 3. 需要 flow tools 来管理流程状态（updateFlowData / updateFlowStatus）
 * 4. OTP 验证实现两阶段提交：预览结果 → 用户确认 → 发送 OTP → 验证执行
 * 5. Debug 模式：将完整消息链序列化到 agentSteps，用于问题排查
 *
 * ── 5-section 模板详解（面试概念: 5-Section Template Pattern）──
 * ① Handoff（承接）:
 *    从 StateGraph 接收 state，获取两组工具（domain + flow）。
 *    就像餐厅里传菜员把订单交给厨师，厨师还要额外拿一本"流程记录本"。
 *
 * ② Filter（过滤）:
 *    prepareAgentContext() 提取本 Agent 相关的对话历史。
 *    就像厨师只看自己菜品的订单，不看其他灶台的订单（跨Agent隔离）。
 *
 * ③ Prompt（构造）:
 *    buildAgentPrompt() + extraSections（金额追踪提醒等特殊规则）。
 *    就像厨师有一份详细的菜谱，还有特殊标注"注意：这桌客人对花生过敏"。
 *
 * ④ Loop（循环）:
 *    runAgentLoop() + flowDataAccumulator 自动从工具调用中提取 flow 状态。
 *    就像厨师在做饭过程中不断记录"已放盐、还在煮、马上好"。
 *    flowDataAccumulator 无需手动管理，每步工具调用后自动检查并提取。
 *
 * ⑤ Output（输出）:
 *    buildAgentResult() 返回结果 + flowData/flowType/flowStatus。
 *    就像菜品完成后，厨师还要在订单上标注"已完成"，方便服务员（answerSynthesizer）回答。
 *
 * ── 生活类比 ──
 * 想象去银行柜台办理汇款:
 * - ① 柜员先查看你的身份证（Handoff — state 接收，确认 userId）
 * - ② 柜员调取你的账户历史（Filter — 上下文过滤，只看相关记录）
 * - ③ 柜员拿到汇款操作指南（Prompt — system prompt + 金额追踪规则）
 * - ④ 柜员问你金额→你确认→输 OTP（Loop — 多轮工具调用，flowData 累积）
 * - ⑤ 柜员打印回执"已汇出 $100"（Output — buildAgentResult 返回）
 *
 * ── 面试概念映射 ──
 * - 5-Section Template Pattern: 所有 Agent 复用统一结构（Template Method）
 * - Flow Tools + FlowDataAccumulator: 工作流状态机（State Machine Pattern）
 * - Debug Mode 消息序列化: 可观测性（Observability / Telemetry）
 * - OTP 两阶段验证: 两阶段提交协议（Two-Phase Commit, 2PC）
 * - extraSections: 模板方法模式中的钩子方法（Template Method Hook）
 * - getToolsByTag('wallet') + getToolsByTag('flow'): 依赖注入 + 标签路由
 */

// ============================================================
// wallet-agent.node.ts — Wallet & KYC Agent
// ============================================================
// 代码结构 = 面试答案结构 = LLM 执行流程:
//   ① 承接 Handoff     → 从 StateGraph 接收 state + 获取 domain + flow tools
//   ② 上下文过滤 Filter  → 提取本 Agent 相关对话
//   ③ Prompt 构造 Prompt → 10-section system prompt（含 extraSections）
//   ④ ReAct 循环 Loop   → LLM 思考→工具→结果，自动提取 flow data
//   ⑤ 结果输出 Output   → 成功/失败 + flowData/flowType/flowStatus
// ============================================================
// 特殊说明:
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
import { buildAgentPrompt } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { runAgentLoop } from '@api/client/ai-customer/graph/agents/agent-runner';
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
    // ① 承接 — Flow Handoff
    //    从 StateGraph 接收 state
    // ================================================================
    const { messages, userId, debug } = state;
    const tools = registry.getToolsByTag('wallet');
    const llmWithTools = createAgentLLM(llmConfig, tools);
    logger.log(
      `[wallet-agent] userId=${userId}, tools=${tools.map((t) => t.name).join(',')}`,
    );

    // ================================================================
    // ② 上下文过滤 — Context Filtering
    //    使用完整对话历史的最近窗口
    // ================================================================
    const agentContext = messages.slice(-MAX_CONTEXT_MESSAGES);

    // ================================================================
    // ③ Prompt 构造 — System Prompt
    //    10-section system prompt（含 extraSections 金额追踪提醒）
    // ================================================================
    const systemPrompt = buildAgentPrompt({
      ...walletPromptConfig,
      userId,
    });
    const initialMessages = buildInitialMessages(systemPrompt, agentContext);

    // ================================================================
    // ④ ReAct 循环 — LLM + Tools 手动循环
    // ================================================================
    const result = await runAgentLoop({
      llmWithTools,
      initialMessages,
      tools,
      agentName: 'walletAgent',
      logger,
    });

    // ================================================================
    // ⑤ 结果输出 — Error Handling + Result Output
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
      .from(result, state.messages);
  };
};
