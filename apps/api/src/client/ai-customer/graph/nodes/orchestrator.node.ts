/**
 * Orchestrator Node — Pipeline Executor
 *
 * ── 是什么？ ──
 * 替换 Supervisor + answerSynthesizer + agentDoneRouter + supervisorRouter。
 * 从 state.labels[] 读取多标签分类结果，按分数降序 + 依赖排序，
 * 依次调用每个 Agent（流水线模式），最后合成最终回复。
 *
 * ── 和旧架构的区别 ──
 * 旧架构: intentRouter → supervisorNode → Router → Agent 1 → Router → Agent 2 → answerSynthesizer
 * 新架构: intentRouter → orchestrator → (for loop: Agent 1 → Agent 2 → ... ) → 合成 → END
 *
 * ── 为什么用 for loop 而不是 StateGraph 边？ ──
 * 1. StateGraph 的 Node 是"原子"操作，每个 Agent 是一个 Node。
 *    多个 Agent 需要多条条件边（65 行 → 2 行）。
 * 2. for loop 天然有序，依赖解析（product→coupon）容易实现。
 * 3. 所有 Agent 共享完整上下文（state.messages），无需按话题过滤。
 *    每个 Agent 的 Scope Restriction 自己处理"什么事能做"。
 *
 * ── 生活类比 ──
 * 就像流水线生产车间：
 * - 流水线主管（orchestrator）有一张任务清单（labels）
 * - 按优先级排序后，一个一个工位（Agent）传下去
 * - 每个工位只做自己擅长的事（Scope Restriction 自控）
 * - 最后质检合成最终产品（synthesizeFinalAnswer）
 */

import { AIMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Logger } from '@nestjs/common';
import {
  AgentState,
  DebugAgentExecution,
} from '@api/client/ai-customer/graph/state';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { MAX_CONTEXT_MESSAGES } from '@api/client/ai-customer/graph/constants';
import { buildAgentPrompt } from '@api/client/ai-customer/graph/agents/prompt-builder';

import { createLLM } from '@api/client/ai-customer/graph/llm-factory';
import { SYNTHESIZER_PROMPT } from '@api/client/ai-customer/graph/agents/prompts/synthesizer-prompt';
import { GENERAL_CHAT_PROMPT } from '@api/client/ai-customer/graph/agents/prompts/general-chat-prompt';
import { runStandardAgent } from '@api/client/ai-customer/graph/nodes/agent-factory';
import {
  AGENT_MAP,
  DEPENDENCY_MAP,
  AgentEntry,
} from '@api/client/ai-customer/graph/config/orchestrator.config';

// (AGENT_MAP + DEPENDENCY_MAP 已抽离到 config/orchestrator.config.ts)

function resolveExecutionOrder(labels: string[]): string[] {
  // 检查是否有依赖关系需要重排
  for (const [prerequisite, dependents] of Object.entries(DEPENDENCY_MAP)) {
    if (labels.includes(prerequisite)) {
      const matchedDependents = dependents.filter((d) => labels.includes(d));
      if (matchedDependents.length > 0) {
        // 排序: 前置依赖 → 依赖者 → 其他
        const others = labels.filter(
          (l) => l !== prerequisite && !matchedDependents.includes(l),
        );
        return [prerequisite, ...matchedDependents, ...others];
      }
    }
  }
  return labels; // 无需重排
}

// ============================================================
// General Chat — Direct LLM Handler
// (GENERAL_CHAT_PROMPT 已抽离到 prompts/general-chat-prompt.ts)
// ============================================================

async function handleGeneralChat(
  state: typeof AgentState.State,
  llmConfig: LlmProviderConfig,
): Promise<Partial<typeof AgentState.State>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  // Build conversation context from recent history (skip ToolMessages, keep Human + AI)
  const contextMessages = state.messages
    .slice(-10) // last 10 messages
    .filter((m) => m._getType() === 'human' || m._getType() === 'ai')
    .slice(0, -1); // exclude current user message
  const conversationContext =
    contextMessages.length > 0
      ? contextMessages
          .map(
            (m) =>
              `${m._getType() === 'human' ? 'User' : 'Assistant'}: ${
                typeof m.content === 'string'
                  ? m.content
                  : JSON.stringify(m.content)
              }`,
          )
          .join('\n')
      : '(no recent conversation)';

  const model = createLLM(llmConfig, { temperature: 0.7 });
  const chain = GENERAL_CHAT_PROMPT.pipe(model).pipe(new StringOutputParser());
  const result = await chain.invoke({
    input: userInput,
    conversationContext,
  });

  return {
    messages: [...state.messages, new AIMessage(result)],
    previousIntent: state.intent,
    labels: [],
  };
}

// ============================================================
// Answer Synthesizer — Merge Multiple Agent Outputs
// (SYNTHESIZER_PROMPT 已抽离到 prompts/synthesizer-prompt.ts)
// ============================================================

async function synthesizeAnswers(
  llmConfig: LlmProviderConfig,
  agentOutputs: { label: string; content: string }[],
  userInput: string,
): Promise<string> {
  const validOutputs = agentOutputs.filter(
    (o) => o.content && o.content.length > 0,
  );
  if (validOutputs.length === 0) {
    return 'Sorry, I could not find the information you requested. Please try again later or contact our customer support team for assistance.';
  }

  // 只有一个 Agent 输出 → 直接使用
  if (validOutputs.length === 1) {
    return validOutputs[0].content;
  }

  // 多个 Agent 输出 → 用 LLM 合成
  const agentOutput = validOutputs
    .map((o) => `[${o.label}]: ${o.content}`)
    .join('\n\n');

  const model = createLLM(llmConfig, { temperature: 0.5 });
  const chain = SYNTHESIZER_PROMPT.pipe(model).pipe(new StringOutputParser());
  return chain.invoke({
    agentOutput: agentOutput || 'No results found.',
    userInput,
  });
}

// ============================================================
// Orchestrator Node Factory
// ============================================================

/**
 * createOrchestratorNode — 创建流水线执行器
 *
 * ── 做什么？ ──
 * 1. 读取 state.labels[]（多标签分类结果）
 * 2. 按分数降序排序
 * 3. 解决依赖关系（product→coupon, order→coupon 等）
 * 4. 依次调用每个 Agent（流水线）
 * 5. 合成最终回复
 *
 * ════════════════════════════════════════════════════════════════
 * 【运行示例 — "那我要买Women Crossbody Bag Set，团购价格多少，加上优惠券，我还有多少钱"]
 * ════════════════════════════════════════════════════════════════
 *
 * 第1步: 读取 labels（来自 intentRouter）
 *   state.labels = [
 *     {label:'product', score:0.86},
 *     {label:'coupon',  score:0.60},
 *     {label:'wallet',  score:0.59}
 *   ]
 *
 * 第2步: 按分数降序排序
 *   sortedLabels = [
 *     {label:'product', score:0.86},
 *     {label:'coupon',  score:0.60},
 *     {label:'wallet',  score:0.59}
 *   ]
 *   labelNames = ['product', 'coupon', 'wallet']
 *
 * 第3步: 依赖解析 resolveExecutionOrder(['product','coupon','wallet'])
 *   DEPENDENCY_MAP = { product: ['coupon','wallet'], order: ['coupon','wallet'] }
 *   遍历: 找到 product → 它的依赖 [coupon,wallet] 都在 labelNames 中
 *   重排: [product, coupon, wallet] (前置依赖 first, 然后是依赖者, 最后其他)
 *   executionOrder = ['product', 'coupon', 'wallet']
 *
 * 第4步: 流水线循环 for (const label of executionOrder)
 *
 *   迭代 #1: label='product'
 *     entry = AGENT_MAP['product'] = { label:'product', tag:'product', ... }
 *     tools = registry.getToolsByTag('product')
 *     → [searchProducts, getProductDetail, getGroupBuyProducts, ...]
 *     buildAgentPrompt(entry.promptConfig) → systemPrompt
 *     contextMessages = state.messages.slice(-MAX_CONTEXT_MESSAGES)
 *     runAgentLoop({ llmWithTools, initialMessages, tools, agentName:'product', ... })
 *     → LLM 思考: "用户要买 Women Crossbody Bag Set，查团购价"
 *     → tool_call: searchProducts({ query: "Women Crossbody Bag Set" })
 *     → 返回: [Women Crossbody Bag Set, group buy price: $29.99]
 *     → LLM: "这款包团购价 $29.99"
 *     agentOutputs.push({ label:'product', content: "Women Crossbody Bag Set 团购价 $29.99" })
 *
 *   迭代 #2: label='coupon'
 *     tools = registry.getToolsByTag('coupon') → [getMyCoupons, claimCoupon, ...]
 *     runAgentLoop(...)
 *     → LLM: "用户有优惠券可用，查一下"
 *     → tool_call: getMyCoupons({ userId: '123' })
 *     → 返回: [{ code: 'JOY10', discount: '10%', validUntil: '2026-07-31' }]
 *     → LLM: "您有 JOY10 优惠券可用"
 *     agentOutputs.push({ label:'coupon', content: "您有 JOY10 优惠券" })
 *
 *   迭代 #3: label='wallet'
 *     tools = registry.getToolsByTag('wallet') → [getWalletBalance, ...]
 *     runAgentLoop(...)
 *     → LLM: "用户问余额，查钱包"
 *     → tool_call: getWalletBalance({ userId: '123' })
 *     → 返回: { balance: 105.50 }
 *     → agentOutputs.push({ label:'wallet', content: "钱包余额 $105.50" })
 *
 * 第5步: 合成回复 synthesizeAnswers(llmConfig, agentOutputs, userInput)
 *   agentOutput = 三段拼接:
 *     [product]: Women Crossbody Bag Set 团购价 $29.99
 *     [coupon]: 您有 10% 优惠券 JOY10 可用
 *     [wallet]: 您的钱包余额为 $105.50
 *   LLM 合成: "Women Crossbody Bag Set 团购价 $29.99 起! 您还有 JOY10 优惠券可叠加使用，
 *              钱包余额 $105.50 完全够支付，请问需要下单吗?"
 *
 * 第6步: 返回 stateUpdate（debug=true 时含 debugInfo.execution）
 *   {
 *     messages: [new AIMessage(finalContent)],
 *     labels: [],         ← 清空，下一轮重新分类
 *     previousIntent: 'product',
 *     debugInfo: {
 *       embedding: { ... },    ← 来自 intentRouter
 *       execution: {
 *         executionOrder: ['product', 'coupon', 'wallet'],
 *         agents: [
 *           { label:'product', tools:['searchProducts',...], status:'OK', ... },
 *           { label:'coupon',  tools:['getMyCoupons',...],   status:'OK', ... },
 *           { label:'wallet',  tools:['getWalletBalance',...],status:'OK', ... }
 *         ]
 *       }
 *     }
 *   }
 * ════════════════════════════════════════════════════════════════
 *
 * @param llmConfig - LLM 配置
 * @param registry - 工具注册表
 */
export const createOrchestratorNode =
  (llmConfig: LlmProviderConfig, registry: ToolRegistryService) =>
  async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    const logger = new Logger('Orchestrator');
    const labels = state.labels ?? [];
    logger.log(
      `[orchestrator] processing labels: ${labels.map((l) => `${l.label}:${l.score.toFixed(2)}`).join(', ')}`,
    );

    // ================================================================
    // 1. 空 labels → fallback 到 generalChat
    // ================================================================
    if (labels.length === 0) {
      logger.log('[orchestrator] no labels, falling back to general chat');
      return handleGeneralChat(state, llmConfig);
    }

    // ================================================================
    // 2. 排序 + 依赖解析
    /**
     * ════════════════════════════════════════════════════════════════
     * 【运行示例】
     *
     * 原始 labels：
     *   [{label:'product',score:0.86}, {label:'wallet',score:0.59}, {label:'coupon',score:0.60}]
     *
     * 排序后：
     *   [{label:'product',score:0.86}, {label:'coupon',score:0.60}, {label:'wallet',score:0.59}]
     *
     * labelNames = ['product', 'coupon', 'wallet']
     * 依赖解析:
     *   DEPENDENCY_MAP['product'] = ['coupon','wallet']
     *   coupon 和 wallet 都在 labels 中 → 重排
     *   executionOrder = ['product', 'coupon', 'wallet']
     * ════════════════════════════════════════════════════════════════
     */
    // ================================================================
    const sortedLabels = [...labels].sort((a, b) => b.score - a.score);
    const labelNames = sortedLabels.map((l) => l.label);
    const executionOrder = resolveExecutionOrder(labelNames);

    logger.log(`[orchestrator] execution order: ${executionOrder.join(' → ')}`);

    // ================================================================
    // 3. 流水线执行
    // ================================================================
    const agentOutputs: { label: string; content: string }[] = [];

    // debug 执行追踪
    let debugAgents: DebugAgentExecution[] | undefined;
    if (state.debug) {
      debugAgents = [];
    }

    for (const label of executionOrder) {
      const entry = AGENT_MAP[label];
      if (!entry) {
        logger.warn(`[orchestrator] no agent configured for label: ${label}`);
        continue;
      }

      try {
        if (entry.type === 'direct') {
          // Direct handlers (general, rag, lucky-draw)
          if (label === 'general') {
            const result = await handleGeneralChat(state, llmConfig);
            const lastMsg = result.messages?.[result.messages.length - 1];
            const content =
              typeof lastMsg?.content === 'string' ? lastMsg.content : '';
            agentOutputs.push({ label: entry.label, content });
            if (debugAgents) {
              debugAgents.push({
                label: entry.label,
                tools: [],
                contextMessages: 0,
                lastMsg: '',
                status: 'OK',
                resultPreview: content.slice(0, 200),
              });
            }
          } else {
            // rag / lucky-draw — 未实现特殊处理，跳过
            logger.warn(
              `[orchestrator] direct handler not implemented for: ${label}`,
            );
            continue;
          }
        } else {
          // ================================================================
          // 标准 Agent 流水线（使用 runStandardAgent 工厂）
          // ================================================================

          const { result, tools, contextMessagesCount } =
            await runStandardAgent({
              userId: state.userId,
              messages: state.messages,
              promptConfig: entry.promptConfig,
              tag: entry.tag,
              agentName: entry.label,
              llmConfig,
              registry,
              logger,
            });

          // 🔍 日志
          const toolNames = tools.map((t) => t.name).join(', ');
          logger.log(
            `[orchestrator] ── ${entry.label} ──\n` +
              `  contextMessages: ${contextMessagesCount} msgs\n` +
              `  tools (${tools.length}): [${toolNames}]`,
          );

          // 结果处理
          if (result.error) {
            logger.error(
              `[orchestrator] ${entry.label} result: ERROR — ${result.error}`,
            );
            agentOutputs.push({
              label: entry.label,
              content: `Sorry, I encountered an issue processing your ${label} request.`,
            });
            if (debugAgents) {
              debugAgents.push({
                label: entry.label,
                tools: toolNames.split(', ').filter(Boolean),
                contextMessages: contextMessagesCount,
                lastMsg: '',
                status: 'ERROR',
                resultPreview: result.error.slice(0, 200),
              });
            }
          } else {
            logger.log(
              `[orchestrator] ${entry.label} result: OK — content preview: "${result.content.slice(0, 200)}..."`,
            );
            agentOutputs.push({ label: entry.label, content: result.content });
            if (debugAgents) {
              debugAgents.push({
                label: entry.label,
                tools: toolNames.split(', ').filter(Boolean),
                contextMessages: contextMessagesCount,
                lastMsg: '',
                status: 'OK',
                resultPreview: result.content.slice(0, 200),
              });
            }
          }
        }
      } catch (err: any) {
        logger.error(`[orchestrator] ${entry.label} exception: ${err.message}`);
        agentOutputs.push({
          label: entry.label,
          content: `Sorry, I encountered an issue processing your ${label} request.`,
        });
      }
    }

    // ================================================================
    // 4. 合成最终回复
    // ================================================================
    const lastMessage = state.messages[state.messages.length - 1];
    const userInput =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content ?? '');

    const finalContent = await synthesizeAnswers(
      llmConfig,
      agentOutputs,
      userInput,
    );

    const orchestratorResult: Partial<typeof AgentState.State> = {
      messages: [...state.messages, new AIMessage(finalContent)],
      previousIntent: state.intent,
      // 清空 labels，下一轮由 intentRouter 重新设置
      labels: [],
    };

    // debug=true 时写入执行流水线追踪数据
    if (state.debug && debugAgents) {
      orchestratorResult.debugInfo = {
        embedding: state.debugInfo?.embedding ?? {
          method: '',
          rawTop5: [],
          dedupedLabels: [],
        },
        execution: {
          executionOrder,
          agents: debugAgents,
        },
      };
    }

    return orchestratorResult;
  };
