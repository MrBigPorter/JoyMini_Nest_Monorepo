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

import {
  AIMessage,
  SystemMessage,
  HumanMessage,
} from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Logger } from '@nestjs/common';
import {
  AgentState,
  DebugAgentExecution,
  OrchestratorStateUpdate,
} from '@api/client/ai-customer/graph/state';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { extractUserInput } from '@api/client/ai-customer/graph/utils/extract-user-input';
import { formatMessage } from '@api/client/ai-customer/graph/utils/format-message-preview';
import { RagRetrievalService } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import { PromptResolverService } from '@api/client/ai-customer/knowledge/prompt-resolver.service';
import {
  RAG_PROMPT,
  RAG_FALLBACK_PROMPT,
} from '@api/client/ai-customer/graph/agents/prompts/rag-prompt';

import { createLLM } from '@api/client/ai-customer/graph/llm-factory';
import type { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { SYNTHESIZER_PROMPT } from '@api/client/ai-customer/graph/agents/prompts/synthesizer-prompt';
import { GENERAL_CHAT_PROMPT } from '@api/client/ai-customer/graph/agents/prompts/general-chat-prompt';
import { runStandardAgent } from '@api/client/ai-customer/graph/nodes/agent-factory';
import {
  AGENT_MAP,
  DEPENDENCY_MAP,
} from '@api/client/ai-customer/graph/config/orchestrator.config';

import { resolveExecutionOrder } from './orchestrator-utils/dependency-resolver';
import {
  CONFIRM_REQUIRED_TOOLS,
  mapToolToAction,
  buildConfirmSummary,
  NEGATIVE_KEYWORDS,
} from './orchestrator-utils/confirm-utils';
import { decideMultiIntentWithLLM } from './orchestrator-utils/multi-intent-decider';
import {
  handleGeneralChat,
  handleRagQuery,
} from './orchestrator-utils/direct-handlers';
import {
  synthesizeAnswers,
  pushAgentResult,
  pushDirectResult,
  AGENT_ERROR_MSG,
} from './orchestrator-utils/result-utils';
import { detectTransferRequest } from './orchestrator-utils/transfer-detector';
import { emitStage } from '@api/common/logger/structured-logger';

// (AGENT_MAP + DEPENDENCY_MAP 已抽离到 config/orchestrator.config.ts)

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
 * @param ragRetrievalService - RAG 检索服务（可选）
 * @param promptResolver - Prompt 运行时合并服务（可选，向后兼容）
 */
export const createOrchestratorNode =
  (
    llmConfig: LlmProviderConfig,
    registry: ToolRegistryService,
    ragRetrievalService?: RagRetrievalService,
    promptResolver?: PromptResolverService,
  ) =>
  async (state: typeof AgentState.State): Promise<OrchestratorStateUpdate> => {
    // 意图决策耗时从这里开始算（#89 FR-3：进入节点 → 决策完成）
    const nodeStartedAt = Date.now();
    const logger = new Logger('Orchestrator');
    const labels = state.labels ?? [];

    /** 标签压成 top3、两位小数：labels 可能被 BM25 + 向量各送一份，全量会撑爆日志 */
    const top3 = (list: { label: string; score: number }[]) =>
      [...list]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((l) => ({ label: l.label, score: Number(l.score.toFixed(2)) }));

    logger.log(
      `[orchestrator] processing labels: ${labels.map((l) => `${l.label}:${l.score.toFixed(2)}`).join(', ')}`,
    );

    // ================================================================
    // 0. 转人工检测（必须放在所有 fallback 之前）
    // ================================================================
    //
    // ── 为什么放在最前？ ──
    // 转人工是"用户的明确指令"，不依赖意图分类的质量。
    // 如果放在 MIN_SCORE 过滤之后，会出现反常识的结果：
    //   用户越着急、句子越不完整 → 意图分数越低 → 越早被当成闲聊 return
    //   → "我要转人工" 反而永远转不出去。
    // 所以先看"是不是要找人工"，再看他"要办什么业务"。
    const userInput = extractUserInput(state);
    const transfer = detectTransferRequest(userInput, state);
    if (transfer.shouldTransfer) {
      logger.log(
        `[orchestrator] transfer request detected: ${transfer.reason}`,
      );

      // 转人工也是一条出口，必须补 intent 事件：
      // 否则按 intent 统计的意图分布会漏掉全部转人工对话（#89 AC-2）
      emitStage('intent', {
        intent: 'transfer',
        labels: top3(labels),
        fallback: 'transfer_request',
        executionOrder: ['transfer'],
        latencyMs: Date.now() - nodeStartedAt,
      });
      emitStage('transfer', {
        source: 'orchestrator',
        reason: transfer.reason,
      });

      try {
        const model = createLLM(llmConfig, { temperature: 0.5 });
        const transferInput = extractUserInput(state);
        const response = await model.invoke([
          new SystemMessage(
            'The user has requested to speak with a human agent. ' +
              'Generate a brief, warm acknowledgment (1-2 sentences) confirming their request ' +
              'and telling them you are transferring them to a human representative. ' +
              'Be empathetic and professional. Do not ask questions or continue the conversation.',
          ),
          new HumanMessage(transferInput),
        ]);
        const content =
          typeof response.content === 'string'
            ? response.content
            : 'I understand you want to speak with a human agent. Let me transfer you now.';
        return {
          messages: [...state.messages, new AIMessage(content)],
          transferToHuman: true,
          transferReason: transfer.reason,
          labels: [],
          pendingConfirm: null,
        };
      } catch (err) {
        logger.warn(
          `[orchestrator] LLM transfer message failed, using fallback: ${err}`,
        );
        return {
          transferToHuman: true,
          transferReason: transfer.reason,
          labels: [],
          pendingConfirm: null,
        };
      }
    }

    // ================================================================
    // 1. 空 labels → fallback 到 generalChat
    // ================================================================
    if (labels.length === 0) {
      emitStage('intent', {
        intent: 'general',
        labels: [],
        fallback: 'no_labels',
        latencyMs: Date.now() - nodeStartedAt,
      });
      logger.log('[orchestrator] no labels, falling back to general chat');
      return handleGeneralChat(state, llmConfig);
    }

    // ================================================================
    // 2. 排序 + Score Gap Check
    // ================================================================
    //
    // Score Gap Check 是两层过滤：
    //   Step 1 — MIN_SCORE: 去掉绝对分数太低的"噪音"标签
    //   Step 2 — SCORE_GAP: 检查第1名和第2名的差距
    //     ├─ gap ≥ 0.15 → 只执行 top-1（明确主意图）
    //     ├─ gap < 0.15 → 保留与 top-1 差距内的候选者（模糊意图，排除尾部）
    //     └─ 无标签 → fallback 到 generalChat
    //
    // ── 为什么需要 MIN_SCORE？ ──
    // 如果所有标签分数都很低（如 rag=0.35, wallet=0.15），gap=0.20 看似"明确"，
    // 但这是低分中的明确，实际上 query 可能跟任何业务都不相关。
    // MIN_SCORE 确保只有"有信心"的标签才会被考虑执行。
    //
    // ── 为什么需要 close-contenders？ ──
    // 如果 rag=0.90, wallet=0.88, order=0.50, product=0.30，gap=0.02 < 0.15，
    // 此时不应该把 order 和 product 也放进去执行，它们是被高分的 rag/wallet 带进来的。
    // close-contenders 策略只保留与 top-1 差距 < SCORE_GAP 的标签。
    // ================================================================

    const MIN_SCORE = 0.7; // 绝对分数及格线（和 IntentClassifier 阈值对齐）
    const SCORE_MARGIN = 0.05;

    // Step 1: 按分数降序排列
    const sortedLabels = [...labels].sort((a, b) => b.score - a.score);

    // Step 2: MIN_SCORE 过滤 — 去掉低分噪音标签
    const validLabels = sortedLabels.filter((l) => l.score >= MIN_SCORE);

    let effectiveLabels: string[] = [];

    if (validLabels.length === 0) {
      // 没有标签达到 MIN_SCORE → fallback 到 generalChat
      // 这里把 sortedLabels 的 top3 记下来：能看到"最高分也只有 0.6"这类信息
      emitStage('intent', {
        intent: 'general',
        labels: top3(sortedLabels),
        fallback: 'below_min_score',
        latencyMs: Date.now() - nodeStartedAt,
      });
      logger.log(
        `[orchestrator] no labels above MIN_SCORE (${MIN_SCORE}), ` +
          `falling back to general chat`,
      );
      return handleGeneralChat(state, llmConfig);
    }

    // 去重：同一 domain 可能出现多次（BM25 + vector 各来一次），取最高分
    const uniqueDomains = new Map<string, number>();
    for (const l of validLabels) {
      const existing = uniqueDomains.get(l.label) ?? 0;
      if (l.score > existing) uniqueDomains.set(l.label, l.score);
    }
    const domainLabels = Array.from(uniqueDomains.entries())
      .map(([label, score]) => ({ label, score }))
      .sort((a, b) => b.score - a.score);

    // ── 转人工检测已在函数开头完成（见「0. 转人工检测」）──

    if (domainLabels.length === 1) {
      // 只有一个域及格，直接执行
      effectiveLabels = [domainLabels[0].label];
      logger.log(
        `[orchestrator] single domain above MIN_SCORE: ${effectiveLabels[0]}`,
      );
    } else if (
      domainLabels.length > 1 &&
      domainLabels[0].score - domainLabels[1].score < SCORE_MARGIN
    ) {
      // TOP1 和 TOP2 差距 < margin → 不确定，问用户

      // 多个域 → 用 LLM 判断是全部执行、选一个、还是问用户
      logger.log(
        `[orchestrator] multiple domains (${domainLabels.map((l) => `${l.label}:${l.score.toFixed(2)}`).join(', ')}), asking LLM to decide`,
      );

      // 获取上一轮 AI 回复（用于上下文理解用户的简短回复）
      const lastAiMsg = [...state.messages]
        .reverse()
        .find((m) => m.type === 'ai');
      const lastAssistantMessage = lastAiMsg
        ? typeof lastAiMsg.content === 'string'
          ? lastAiMsg.content.slice(0, 200)
          : JSON.stringify(lastAiMsg.content).slice(0, 200)
        : '';

      const llmDecision = await decideMultiIntentWithLLM(
        llmConfig,
        extractUserInput(state),
        domainLabels,
        logger,
        state.previousIntent,
        lastAssistantMessage,
      );

      if (llmDecision.action === 'ask') {
        // LLM 认为不确定 → 回复反问句，不执行任何 agent
        // 反问句内容不写日志（#89 FR-7），意图可以由 stage="intent" 事件统计
        return {
          messages: [
            ...state.messages,
            new AIMessage(
              llmDecision.message ?? 'Could you please clarify your request?',
            ),
          ],
          previousIntent: state.intent,
          labels: [],
          pendingConfirm: null,
        };
      }

      if (llmDecision.action === 'single') {
        effectiveLabels = [llmDecision.domain!];
        logger.log(
          `[orchestrator] LLM chose single domain: ${llmDecision.domain}`,
        );
      } else {
        // 'all' → 执行所有匹配的域
        effectiveLabels = domainLabels.map((l) => l.label);
        logger.log(
          `[orchestrator] LLM decided to execute all domains: ${effectiveLabels.join(', ')}`,
        );
      }
    } else if (domainLabels.length > 0) {
      // 多域名但 TOP1 明显领先（gap >= margin）→ 直接执行 TOP1
      effectiveLabels = [domainLabels[0].label];
      logger.log(
        `[orchestrator] clear winner: ${effectiveLabels[0]} (gap=${(domainLabels[0].score - (domainLabels[1]?.score ?? 0)).toFixed(2)})`,
      );
    }

    const executionOrder = resolveExecutionOrder(effectiveLabels);

    // 决策已完成，此时记 intent：耗时只含分类 + 路由，不含后面 agent 跑工具
    emitStage('intent', {
      intent: effectiveLabels[0] ?? 'general',
      labels: top3(labels),
      fallback: 'none',
      latencyMs: Date.now() - nodeStartedAt,
      executionOrder,
    });

    logger.log(
      `[orchestrator] execution order: ${executionOrder.join(' → ')} ` +
        `(from effective labels: ${effectiveLabels.join(', ')})`,
    );

    // ================================================================
    // 3. 流水线执行
    // ================================================================
    const agentOutputs: { label: string; content: string }[] = [];

    // debug 执行追踪
    let debugAgents: DebugAgentExecution[] | undefined;
    if (state.debug) {
      debugAgents = [];
    }

    // ──────────────────────────────────────────────────────────────
    // 3a. 流水线循环：按 executionOrder 依次执行每个 Agent
    // ──────────────────────────────────────────────────────────────
    // executionOrder 保证前置依赖先执行（product → coupon/wallet）
    // 每个 iteration 处理一个 label（一个 Agent）
    //
    // Agent 分为两种类型:
    //   type='direct' → 直接 LLM 调用（generalChat, RAG），无需工具
    //   type='agent'  → 标准 Agent 流水线（含 ToolRegistry + runAgentLoop）
    // ──────────────────────────────────────────────────────────────
    let hasTransferRequest = false;
    let hasPendingConfirm: typeof AgentState.State.pendingConfirm = null;
    for (const label of executionOrder) {
      // 从 AGENT_MAP 查找 Agent 配置
      // AGENT_MAP 在 orchestrator.config.ts 中定义，包含:
      // - label/tag: 标签和工具标签
      // - type: 'direct' | 'agent'
      // - promptConfig: 自定义系统提示词配置（仅 agent 类型）
      const entry = AGENT_MAP[label];
      if (!entry) {
        logger.warn(`[orchestrator] no agent configured for label: ${label}`);
        continue;
      }

      try {
        if (entry.type === 'direct') {
          // ================================================================
          // Direct Handlers — 无需 tool binding 的简单 LLM 调用
          // ================================================================
          // 使用 Record<string, Handler> 替代三层的 if-else 嵌套:
          //   if (label === 'general') → else if (label === 'rag') → else warn
          // Lookup O(1)，新增 direct handler 只需在 Record 中添加一条
          //
          // 当前支持的 direct handler:
          // - general: 通用聊天（无工具，纯 LLM）
          // - rag: 知识库检索（retrieve → LLM generate）
          const directHandlers: Record<string, () => Promise<boolean>> = {
            general: async () => {
              const result = await handleGeneralChat(state, llmConfig);
              pushDirectResult(entry.label, result, agentOutputs, debugAgents);
              return true;
            },
            rag: async () => {
              if (!ragRetrievalService) {
                logger.warn(
                  '[orchestrator] RagRetrievalService not available, skipping rag',
                );
                return false;
              }
              const result = await handleRagQuery(
                state,
                llmConfig,
                ragRetrievalService,
              );
              pushDirectResult(entry.label, result, agentOutputs, debugAgents);
              return true;
            },
          };
          const handler = directHandlers[label];
          if (handler) {
            if (!(await handler())) continue;
          } else {
            logger.warn(
              `[orchestrator] direct handler not implemented for: ${label}`,
            );
          }
        } else {
          // ================================================================
          // 标准 Agent 流水线（tag-based tool binding + runAgentLoop）
          // ================================================================
          // 流程:
          //   1. runStandardAgent 根据 tag 从 ToolRegistry 获取工具列表
          //   2. 构建 systemPrompt（promptConfig + 工具描述）
          //   3. 执行 runAgentLoop（LLM 思考 → 工具调用 → 返回结果）
          //   4. runStandardAgent 返回 { result, tools, contextMessagesCount }
          //
          // runStandardAgent 封装了以下逻辑:
          //   - buildAgentPrompt(entry.promptConfig) → systemPrompt
          //   - state.messages.slice(-MAX_CONTEXT_MESSAGES) → contextMessages
          //   - createLLM(...).bindTools(tools) → llmWithTools
          //   - runAgentLoop({ llmWithTools, initialMessages, tools, agentName })
          // Merge DB prompt override over TS defaults (if PromptResolver available)
          logger.log(
            `[orchestrator] mergeConfig(${entry.tag}): promptConfig keys=[${Object.keys(entry.promptConfig).sort().join(', ')}]`,
          );
          const mergedResult = promptResolver
            ? await promptResolver.mergeConfig(entry.tag, entry.promptConfig)
            : { config: entry.promptConfig, version: null, promptName: null };

          const { result, tools, contextMessagesCount } =
            await runStandardAgent({
              userId: state.userId,
              messages: state.messages,
              promptConfig: mergedResult.config,
              tag: entry.tag,
              agentName: entry.label,
              llmConfig,
              registry,
              logger,
            });

          // 日志：记录该 Agent 的执行上下文和工具绑定情况
          const toolNames = tools.map((t) => t.name).join(', ');
          logger.log(
            `[orchestrator] ── ${entry.label} ──\n` +
              `  contextMessages: ${contextMessagesCount} msgs\n` +
              `  tools (${tools.length}): [${toolNames}]`,
          );

          // 分别记录成功/失败的日志（pushAgentResult 内部统一处理结果写入）
          if (result.error) {
            logger.error(
              `[orchestrator] ${entry.label} result: ERROR — ${result.error}`,
            );
          } else {
            logger.log(
              `[orchestrator] ${entry.label} result: OK — contentLength=${result.content.length}`,
            );
          }

          // ── 写操作拦截：检测是否需要用户确认 ──
          const lastTool = result.pendingToolCall; //工具被截停、未执行）——若读 lastToolCallInfo（已执行），
          // 卡片出现时操作已提交，用户再点确认 = 双执行（资金风险）
          if (lastTool && CONFIRM_REQUIRED_TOOLS.has(lastTool.name)) {
            logger.log(
              `[orchestrator] ${entry.label} called write tool "${lastTool.name}", intercepting`,
            );
            hasPendingConfirm = {
              action: mapToolToAction(lastTool.name),
              params: lastTool.args,
              summary: buildConfirmSummary(lastTool),
            };
            break; // 停止流水线，等待用户确认
          }

          const pushResult = pushAgentResult(
            entry.label,
            result,
            agentOutputs,
            debugAgents,
            toolNames,
            contextMessagesCount,
          );
          if (pushResult.forceTransfer) hasTransferRequest = true;
          // Fire-and-forget eval log if this agent had a DB prompt override
          if (
            promptResolver &&
            mergedResult.promptName &&
            mergedResult.version
          ) {
            const toolFailCount = result.error ? result.totalToolCalls : 0;
            promptResolver
              .recordEval({
                promptName: mergedResult.promptName,
                version: mergedResult.version,
                sessionId: `${state.userId}:${Date.now()}`,
                toolCallCount: result.totalToolCalls,
                toolFailCount,
              })
              .catch(() => {}); // Fire-and-forget: suppress unhandled rejection
          }
        }
      } catch (err: any) {
        // ── 异常安全 ──
        // 即使某个 Agent 抛出异常，整个流水线不应中断。
        // 其他 Agent 仍需继续执行（例如 coupon 异常不应阻塞 wallet）。
        // 错误信息写入 agentOutputs（含友好提示），不会让用户看到堆栈。
        logger.error(`[orchestrator] ${entry.label} exception: ${err.message}`);
        agentOutputs.push({
          label: entry.label,
          content: AGENT_ERROR_MSG(label),
        });
        // 注意: 异常时 debugAgents 不会追加（无 debug 记录）
        // 这是有意为之 — 异常意味着未完成标准流程，debug 信息不完整
      }
    }

    // ================================================================
    // 4. 合成最终回复
    // ================================================================
    const synthesizeInput = extractUserInput(state);

    // 如果有待确认操作，跳过最终合成，直接返回，保存 pendingConfirm在 state 里，等待 AiCustomerService SSE 发 confirm 事件给前端
    if (hasPendingConfirm) {
      const orchestratorResult: OrchestratorStateUpdate = {
        messages: [
          ...state.messages,
          new AIMessage('Please confirm the details.'),
        ],
        previousIntent: state.intent,
        labels: [],
        pendingConfirm: hasPendingConfirm,
      };
      return orchestratorResult;
    }

    const finalContent = await synthesizeAnswers(
      llmConfig,
      agentOutputs,
      userInput,
    );

    // 工具侧判定转人工（agent 返回 [TRANSFER_TO_HUMAN]）也要记一条 transfer 事件。
    // 否则按 reason 统计转人工来源时，这条出口是黑洞 —— 只有 chat.done 能看到
    // transferred=true，却不知道是谁触发的（#89 AC-5 覆盖所有出口）。
    if (hasTransferRequest) {
      emitStage('transfer', { source: 'agent', reason: 'agent_request' });
    }

    const orchestratorResult: OrchestratorStateUpdate = {
      messages: [...state.messages, new AIMessage(finalContent)],
      previousIntent: state.intent,
      labels: [],
      pendingConfirm: null,
      transferToHuman: hasTransferRequest,
      // 第二条转人工路径：某个 agent 结果带 forceTransfer（工具侧判定要转）
      // 没有这个字段的话，服务端只能记成 'unknown'，转人工原因分布就会多出一个黑洞
      transferReason: hasTransferRequest ? 'agent_request' : '',
      repeatCount:
        state.intent === state.previousIntent
          ? (state.repeatCount ?? 0) + 1
          : 0,
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
