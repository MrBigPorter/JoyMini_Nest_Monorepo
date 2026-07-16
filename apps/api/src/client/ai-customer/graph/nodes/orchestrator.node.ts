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
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Logger } from '@nestjs/common';
import {
  AgentState,
  DebugAgentExecution,
} from '@api/client/ai-customer/graph/state';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
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
import { SYNTHESIZER_PROMPT } from '@api/client/ai-customer/graph/agents/prompts/synthesizer-prompt';
import { GENERAL_CHAT_PROMPT } from '@api/client/ai-customer/graph/agents/prompts/general-chat-prompt';
import { runStandardAgent } from '@api/client/ai-customer/graph/nodes/agent-factory';
import {
  AGENT_MAP,
  DEPENDENCY_MAP,
} from '@api/client/ai-customer/graph/config/orchestrator.config';

// (AGENT_MAP + DEPENDENCY_MAP 已抽离到 config/orchestrator.config.ts)

/**
 * resolveExecutionOrder — 依赖解析排序
 *
 * ── 为什么需要？ ──
 * 某些 Agent 必须在其他 Agent 之前执行，否则 LLM 会因缺少上下文而出错。
 * 例如: "这个包的团购价多少，我有优惠券吗"
 *   - product Agent 要先执行，查出商品信息（价格、团购价）
 *   - 如果 coupon Agent 先执行，它不知道商品信息 → 无法正确推荐优惠券
 * 所以依赖规则是: product 必须先于 coupon/wallet 执行。
 *
 * ── DEPENDENCY_MAP 结构 ──
 *   { product: ['coupon', 'wallet'], order: ['coupon', 'wallet'] }
 *   ↑ 前置条件         ↑ 依赖它的 Agent
 *
 * ── 排序算法 ──
 *   1. 遍历 DEPENDENCY_MAP 的每个 entry
 *   2. 检查前置条件 (product) 是否在 labels 中
 *   3. 如果是，找出 labels 中哪些依赖者 (coupon,wallet) 也同时存在
 *   4. 重排: [前置条件, ...依赖者, ...其他]
 *   5. 如果无依赖关系，保持原顺序
 *
 * @param labels - 原始 label 数组（已按分数降序）
 * @returns 重排后的 label 数组
 *
 * @example
 * resolveExecutionOrder(['wallet', 'product', 'coupon'])
 * // DEPENDENCY_MAP['product'] = ['coupon','wallet']
 * // → ['product', 'coupon', 'wallet']
 */
function resolveExecutionOrder(labels: string[]): string[] {
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
  return labels;
}

// ============================================================
// Multi-Intent LLM Decider — 多个 domain 匹配时由 LLM 判断
// ============================================================
//
// decideMultiIntentWithLLM — 当多个 domain 同时高于阈值时，
// 用 LLM 判断：全部执行 / 只选一个 / 问用户。
//
// 用于替代旧的 SCORE_GAP 逻辑（不同来源的分数不可比）。
//
// @returns { action, domain?, message? }
//   action = "single" → 只执行 domain
//   action = "all"    → 执行全部
//   action = "ask"    → 反问用户（message 里放问句）
// ============================================================

const MULTI_INTENT_DECISION_PROMPT = ChatPromptTemplate.fromTemplate(
  `You are an intent routing assistant. The user's message matched multiple business domains.

Previous intent: {previousIntent}
Previous assistant message: "{previousAssistantMessage}"

User message: "{userInput}"

Matched domains:
{domainList}

Your job: decide what to do.
- If the user clearly wants ONE specific thing → respond: single:<domainName>
- If the user's message relates to ALL matched domains → respond: all
- If you are UNCERTAIN which one the user wants → respond: ask:<your clarifying question in the user's language>

Rules:
1. Use PREVIOUS INTENT as context. If user's short reply (e.g. "status", "yes", "check it") follows up on previous conversation, route to the relevant domain.
2. "single" when user clearly wants one thing (consider previous context)
3. "all" when query touches multiple domains
4. "ask" when ambiguous - generate a clarifying question

Examples:
- previous=kyc, user="status" → single:kyc (user wants KYC status follow-up)
- previous=kyc, user="check it" → single:kyc
- previous=coupon, user="balance" → single:wallet (user switched topics)
- "show my coupons" → single:coupon
- "kyc" → ask:Would you like to check your KYC verification status or learn about KYC policies?

Respond with ONLY one line, no explanation.`,
);

interface MultiIntentDecision {
  action: 'single' | 'all' | 'ask';
  domain?: string;
  message?: string;
}

async function decideMultiIntentWithLLM(
  llmConfig: LlmProviderConfig,
  userInput: string,
  domains: { label: string; score: number }[],
  logger: Logger,
  previousIntent?: string,
  previousAssistantMessage?: string,
): Promise<MultiIntentDecision> {
  const domainList = domains
    .map(
      (d, i) =>
        `${i + 1}. ${d.label} (score: ${d.score.toFixed(2)})`,
    )
    .join('\n');

  const model = createLLM(llmConfig, { temperature: 0 });
  const chain = MULTI_INTENT_DECISION_PROMPT.pipe(model).pipe(
    new StringOutputParser(),
  );
  const raw = await chain.invoke({
    userInput,
    domainList,
    previousIntent: previousIntent || 'none',
    previousAssistantMessage: previousAssistantMessage || '(no previous message)',
  });
  const trimmed = raw.trim().toLowerCase();

  logger.log(`[orchestrator] multi-intent LLM raw decision: "${trimmed}"`);

  if (trimmed.startsWith('single:')) {
    const domain = trimmed.slice(7).trim();
    return { action: 'single', domain };
  }

  if (trimmed === 'all') {
    return { action: 'all' };
  }

  if (trimmed.startsWith('ask:')) {
    const message = trimmed.slice(4).trim();
    return { action: 'ask', message };
  }

  // Fallback: if LLM returns something unexpected, ask user
  return {
    action: 'ask',
    message:
      'I found several topics that might match your request. Could you please clarify what you need?',
  };
}

// ============================================================
// General Chat — Direct LLM Handler（fallback）
// (GENERAL_CHAT_PROMPT 已抽离到 prompts/general-chat-prompt.ts)
// ============================================================

/**
 * handleGeneralChat — 无标签匹配时的 fallback 通用对话处理器
 *
 * ── 什么时候触发？ ──
 * intentRouter 没有匹配到任何业务标签（product/coupon/wallet/...）
 * → labels 为空数组 → orchestrator 执行此处理器
 *
 * ── 和标准 Agent 的区别 ──
 * 1. 没有工具调用能力，只是纯 LLM 聊天
 * 2. 用 GENERAL_CHAT_PROMPT（企业信息 + 客服角色）生成回复
 * 3. 上下文限制更严格（最多保留 9 条历史 → 防止超出无工具模型的 token 限制）
 *
 * ── 流程 ──
 * 1. 提取用户最新输入（extractUserInput）
 * 2. 截取最近对话上下文：
 *    - 取 state.messages 最后 10 条
 *    - 过滤只留 human/ai 消息（跳过 ToolMessage）
 *    - 去掉最后一条（当前用户消息 — 作为 input 单独传入）
 * 3. 用 GENERAL_CHAT_PROMPT + LLM 生成回复
 * 4. 返回: labels=[] → 下一轮 intentRouter 重新分类
 */
async function handleGeneralChat(
  state: typeof AgentState.State,
  llmConfig: LlmProviderConfig,
): Promise<Partial<typeof AgentState.State>> {
  const userInput = extractUserInput(state);

  // Build conversation context from recent history (skip ToolMessages, keep Human + AI)
  const contextMessages = state.messages
    .slice(-10) // last 10 messages
    .filter((m) => m.type === 'human' || m.type === 'ai')
    .slice(0, -1); // exclude current user message
  const conversationContext =
    contextMessages.length > 0
      ? contextMessages.map(formatMessage).join('\n')
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
// RAG Query Handler — DB-backed knowledge retrieval
// ============================================================

/**
 * handleRagQuery — 知识库检索处理器
 *
 * ── 什么时候触发？ ──
 * intentRouter 标签包含 'rag' → orchestrator 直接路由到此处
 * （不是标准 Agent 流水线，而是 direct handler，因为 RAG 不需要工具调用）
 *
 * ── 二分支流程 ──
 * 分支 A（检索到文档）:
 *   1. ragRetrievalService.retrieve(query, topK=3) → 从 PostgreSQL 向量库检索
 *   2. 将文档片段格式化为 markdown（含 title/domain/priority 元信息）
 *   3. RAG_PROMPT + LLM → 基于文档生成回答
 *
 * 分支 B（无相关文档）:
 *   1. 日志警告
 *   2. RAG_FALLBACK_PROMPT + LLM → 礼貌提示"未找到相关信息，请重试或联系客服"
 *   3. 不清空 labels → 但这里设置 labels=[] 因为 RAG 是独立标签
 *
 * ── 为什么是 direct handler 而不是标准 Agent？ ──
 * 标准 Agent 需要 ToolRegistry → tool binding → runAgentLoop。
 * RAG 只是一个简单的 "检索 → 生成" 流程，没有工具调用。
 * 用 direct handler 避免了不必要的复杂度。
 */
async function handleRagQuery(
  state: typeof AgentState.State,
  llmConfig: LlmProviderConfig,
  ragRetrievalService: RagRetrievalService,
): Promise<Partial<typeof AgentState.State>> {
  const logger = new Logger('Orchestrator');
  const userInput = extractUserInput(state);

  // Retrieve relevant documents from DB
  const results = await ragRetrievalService.retrieve(userInput, { topK: 3 });

  if (results.length === 0) {
    // Fallback: no docs found
    logger.log(
      '[orchestrator] RAG: no relevant documents found, using fallback',
    );
    const model = createLLM(llmConfig, { temperature: 0.3 });
    const chain = RAG_FALLBACK_PROMPT.pipe(model).pipe(
      new StringOutputParser(),
    );
    const result = await chain.invoke({ input: userInput });
    return {
      messages: [...state.messages, new AIMessage(result)],
      previousIntent: state.intent,
      labels: [],
    };
  }

  const documents = results
    .map(
      (r) =>
        `## ${r.title} (domain: ${r.domain}, priority: ${r.priority})\n${r.content}`,
    )
    .join('\n\n---\n\n');

  const model = createLLM(llmConfig, { temperature: 0.3 });
  const chain = RAG_PROMPT.pipe(model).pipe(new StringOutputParser());
  const result = await chain.invoke({ input: userInput, documents });

  return {
    messages: [...state.messages, new AIMessage(result)],
    previousIntent: state.intent,
    labels: [],
  };
}

// ============================================================
// Answer Synthesizer — 合并多个 Agent 输出 → 最终回复
// (SYNTHESIZER_PROMPT 已抽离到 prompts/synthesizer-prompt.ts)
// ============================================================

/**
 * synthesizeAnswers — 将多个 Agent 的输出合并为一条最终回复
 *
 * ── 为什么需要合成？ ──
 * 流水线中各 Agent 独立输出（product: "团购价 $29.99"，coupon: "有10%优惠券"）。
 * 如果直接拼接返回，用户体验差（多条割裂的消息）。
 * 合成器将这些输出整理为一条流畅的回复。
 *
 * ── 三路逻辑 ──
 * 1. 所有输出为空 → 返回固定 fallback 字符串（无 LLM 调用）
 * 2. 只有一个 Agent 有输出 → 直接返回内容（避免不必要的 LLM 调用）
 * 3. 多个 Agent 都有输出 → 用 SYNTHESIZER_PROMPT + LLM 合并
 *    - 格式: [label]: content \n\n [label2]: content2
 *    - LLM 负责将这些片段组织为连贯的一段话
 *
 * ── 为什么 single-output 不走 LLM？ ──
 * 性能优化：如果只有一个 Agent 执行了有效操作（如纯查余额），
 * 没必要浪费一次 LLM 调用来"重新表达"同一句话。
 */
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

  // 只有一个 Agent 输出 → 直接使用（无需 LLM 二次处理）
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
// Shared Helpers — 提取公共结果处理逻辑，消除代码重复
// ============================================================

/**
 * pushDirectResult — 将 direct handler 的结果推入 agentOutputs + debugAgents
 *
 * ── 用途 ──
 * 专用于 generalChat 和 RAG 这两种 direct handler。
 * 它们不走标准 Agent 流水线（无 runAgentLoop），但输出格式仍需统一。
 *
 * ── 和 pushAgentResult 的区别 ──
 * direct handler 的结果是 Partial<AgentState>（含 messages 数组），
 * 没有 error/content 字段，所以从 messages 中提取最后一条消息的内容。
 * 而标准 Agent 返回 { content?, error? } 结构。
 *
 * @param label - 标签名（'general' | 'rag'）
 * @param result - direct handler 的返回结果（含 messages[]）
 * @param agentOutputs - 全局输出数组（mutate）
 * @param debugAgents - debug 追踪数组（可选，mutate）
 */
function pushDirectResult(
  label: string,
  result: Partial<typeof AgentState.State>,
  agentOutputs: { label: string; content: string }[],
  debugAgents?: DebugAgentExecution[],
): void {
  const lastMsg = result.messages?.[result.messages.length - 1];
  const content = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
  agentOutputs.push({ label, content });
  if (debugAgents) {
    debugAgents.push({
      label,
      tools: [],
      contextMessages: 0,
      lastMsg: '',
      status: 'OK',
      resultPreview: content.slice(0, 200),
    });
  }
}

/**
 * AGENT_ERROR_MSG — 生成标准 Agent 错误提示文案
 *
 * ── 用途 ──
 * 当标准 Agent 返回 error 或 catch 块捕获异常时，
 * 用统一格式生成面向用户的友好错误消息。
 * 防止 LLM 级别的错误详情暴露给用户。
 *
 * @param label - 出错的 Agent 标签名
 * @returns "Sorry, I encountered an issue processing your {label} request."
 *
 * @example
 * AGENT_ERROR_MSG('coupon')
 * // → "Sorry, I encountered an issue processing your coupon request."
 */
function AGENT_ERROR_MSG(label: string): string {
  return `Sorry, I encountered an issue processing your ${label} request.`;
}

/**
 * pushAgentResult — 将标准 Agent 的执行结果推入 agentOutputs + debugAgents
 *
 * ── 解决的问题 ──
 * 之前每个 Agent 执行后都有 24 行重复的 if(result.error)/else 块，
 * 分别处理成功/失败两种路径的 push 逻辑。
 * 此函数统一处理两种路径，调用方只需一行。
 *
 * ── 逻辑 ──
 * 1. 检查 result.error 是否存在
 * 2. 有 error → content = AGENT_ERROR_MSG(label)；debug 状态标注 'ERROR'
 * 3. 无 error → content = result.content；debug 状态标注 'OK'
 * 4. 统一推入 agentOutputs 和 debugAgents
 *
 * ── 和 pushDirectResult 的区别 ──
 * pushAgentResult 接收标准 Agent 的 { content?, error? } 结构，
 * 且需要 toolNames/contextMessagesCount 等 debug 信息。
 * pushDirectResult 接收 direct handler 的 Partial<AgentState> 结构。
 *
 * @param label - Agent 标签名
 * @param result - runStandardAgent 的返回结果（含 content/error）
 * @param agentOutputs - 全局输出数组（mutate）
 * @param debugAgents - debug 追踪数组（可选，mutate）
 * @param toolNames - 绑定的工具名列表（逗号分隔）
 * @param contextMessagesCount - 传给 Agent 的上下文消息数
 * @param logger - 日志（未使用，保留兼容）
 */
function pushAgentResult(
  label: string,
  result: { content?: string; error?: string },
  agentOutputs: { label: string; content: string }[],
  debugAgents: DebugAgentExecution[] | undefined,
  toolNames: string,
  contextMessagesCount: number,
  logger?: Logger,
): void {
  const isError = !!result.error;
  const content = isError ? AGENT_ERROR_MSG(label) : (result.content ?? '');

  agentOutputs.push({ label, content });

  if (debugAgents) {
    debugAgents.push({
      label,
      tools: toolNames.split(', ').filter(Boolean),
      contextMessages: contextMessagesCount,
      lastMsg: '',
      status: isError ? 'ERROR' : 'OK',
      resultPreview: (isError ? result.error! : content).slice(0, 200),
    });
  }
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

    const MIN_SCORE = 0.5; // 绝对分数及格线（和 IntentClassifier 阈值对齐）

    // Step 1: 按分数降序排列
    const sortedLabels = [...labels].sort((a, b) => b.score - a.score);

    // Step 2: MIN_SCORE 过滤 — 去掉低分噪音标签
    const validLabels = sortedLabels.filter((l) => l.score >= MIN_SCORE);

    let effectiveLabels: string[] = [];

    if (validLabels.length === 0) {
      // 没有标签达到 MIN_SCORE → fallback 到 generalChat
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

    if (domainLabels.length === 1) {
      // 只有一个域及格，直接执行
      effectiveLabels = [domainLabels[0].label];
      logger.log(
        `[orchestrator] single domain above MIN_SCORE: ${effectiveLabels[0]}`,
      );
    } else {
      // 多个域 → 用 LLM 判断是全部执行、选一个、还是问用户
      logger.log(
        `[orchestrator] multiple domains (${domainLabels.map((l) => `${l.label}:${l.score.toFixed(2)}`).join(', ')}), asking LLM to decide`,
      );

      // 获取上一轮 AI 回复（用于上下文理解用户的简短回复）
      const lastAiMsg = [...state.messages]
        .reverse()
        .find((m) => m.type === 'ai');
      const lastAssistantMessage = lastAiMsg
        ? (typeof lastAiMsg.content === 'string'
            ? lastAiMsg.content.slice(0, 200)
            : JSON.stringify(lastAiMsg.content).slice(0, 200))
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
        logger.log(
          `[orchestrator] LLM decided to ask user: ${llmDecision.message}`,
        );
        return {
          messages: [...state.messages, new AIMessage(llmDecision.message ?? 'Could you please clarify your request?')],
          previousIntent: state.intent,
          labels: [],
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
    }

    const executionOrder = resolveExecutionOrder(effectiveLabels);

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
              `[orchestrator] ${entry.label} result: OK — content preview: "${result.content.slice(0, 200)}..."`,
            );
          }
          pushAgentResult(
            entry.label,
            result,
            agentOutputs,
            debugAgents,
            toolNames,
            contextMessagesCount,
          );

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
    const userInput = extractUserInput(state);

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
