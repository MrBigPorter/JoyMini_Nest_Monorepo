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

import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Logger } from '@nestjs/common';
import { AgentState } from '@api/client/ai-customer/graph/state';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import {
  MAX_CONTEXT_MESSAGES,
  MAX_ITERATIONS,
} from '@api/client/ai-customer/graph/constants';
import {
  buildAgentPrompt,
  AgentPromptConfig,
} from '@api/client/ai-customer/graph/agents/prompt-builder';
import { runAgentLoop } from '@api/client/ai-customer/graph/agents/agent-runner';

import {
  buildInitialMessages,
  createAgentLLM,
} from '@api/client/ai-customer/graph/agents/agent-result';
import { createLLM } from '@api/client/ai-customer/graph/llm-factory';
import { orderPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/order-prompt';
import { walletPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/wallet-prompt';
import { couponPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/coupon-prompt';
import { userPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/user-prompt';
import { productPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/product-prompt';

// ============================================================
// Types
// ============================================================

interface AgentEntry {
  /** 节点名称（日志用），如 'orderAgent' */
  label: string;
  /** 工具标签，如 'order' */
  tag: string;
  /** Prompt 配置 */
  promptConfig: Omit<AgentPromptConfig, 'userId'>;
  /** Agent 类型 */
  type: 'agent' | 'direct';
}

// ============================================================
// Agent 注册表
// ============================================================

const AGENT_MAP: Record<string, AgentEntry> = {
  order: {
    label: 'orderAgent',
    tag: 'order',
    promptConfig: orderPromptConfig,
    type: 'agent',
  },
  wallet: {
    label: 'walletAgent',
    tag: 'wallet',
    promptConfig: walletPromptConfig,
    type: 'agent',
  },
  coupon: {
    label: 'couponAgent',
    tag: 'coupon',
    promptConfig: couponPromptConfig,
    type: 'agent',
  },
  user: {
    label: 'userAgent',
    tag: 'user',
    promptConfig: userPromptConfig,
    type: 'agent',
  },
  product: {
    label: 'productAgent',
    tag: 'product',
    promptConfig: productPromptConfig,
    type: 'agent',
  },
  general: {
    label: 'generalChat',
    tag: 'general',
    promptConfig: null as unknown as Omit<AgentPromptConfig, 'userId'>,
    type: 'direct',
  },
  rag: {
    label: 'ragNode',
    tag: 'rag',
    promptConfig: null as unknown as Omit<AgentPromptConfig, 'userId'>,
    type: 'direct',
  },
  'lucky-draw': {
    label: 'luckyAgent',
    tag: 'lucky-draw',
    promptConfig: null as unknown as Omit<AgentPromptConfig, 'userId'>,
    type: 'direct',
  },
};

// ============================================================
// Dependency Resolution
// ============================================================

/**
 * 依赖解析规则：
 * - product → coupon/wallet: 先知道商品信息，才能问优惠券/钱包
 * - order → coupon/wallet: 先知道订单信息，才能问优惠券/钱包
 *
 * 其他标签按分数降序执行，互不依赖。
 */
const DEPENDENCY_MAP: Record<string, string[]> = {
  product: ['coupon', 'wallet'],
  order: ['coupon', 'wallet'],
  coupon: ['product'],
};

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
// ============================================================

const GENERAL_CHAT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You are JoyMini, a friendly and helpful e-commerce customer service AI assistant. 
    
    You are a friendly and enthusiastic customer service assistant. You can:
    1. Answer general questions about the JoyMini platform
    2. Engage in casual conversation and greetings
    3. Guide users to use specific features (check orders, check balance, browse products, etc.)
    
    Note:
    - If the user has a specific inquiry (e.g., check order, check balance), guide them to use the relevant feature
    - Keep responses concise and friendly
    - Do not make up information you are unsure about; guide the user to contact human support
    `,
  ],
  ['human', '{input}'],
]);

async function handleGeneralChat(
  state: typeof AgentState.State,
  llmConfig: LlmProviderConfig,
): Promise<Partial<typeof AgentState.State>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  const model = createLLM(llmConfig, { temperature: 0.7 });
  const chain = GENERAL_CHAT_PROMPT.pipe(model).pipe(new StringOutputParser());
  const result = await chain.invoke({ input: userInput });

  return {
    messages: [...state.messages, new AIMessage(result)],
    previousIntent: state.intent,
    labels: [],
  };
}

// ============================================================
// Answer Synthesizer — Merge Multiple Agent Outputs
// ============================================================

const SYNTHESIZER_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You are JoyMini, a friendly and professional e-commerce customer service AI assistant.

You have received results from MULTIPLE specialized assistants on the same customer inquiry.
Each result is prefixed with [agentName]:. Your job is to merge these results into a single,
coherent, friendly response that addresses ALL parts of the user's question.

Guidelines:
- Present information from ALL assistants in a natural, flowing response
- Use numbered lists or bullet points for clarity when showing multiple items
- Keep your tone warm and professional
- Keep responses concise but complete
- If an assistant returned an error or disclaimer, silently skip it

Results from assistants:
{agentOutput}

User's original question: {userInput}`,
  ],
  ['human', '{userInput}'],
]);

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
    // ================================================================
    const sortedLabels = [...labels].sort((a, b) => b.score - a.score);
    const labelNames = sortedLabels.map((l) => l.label);
    const executionOrder = resolveExecutionOrder(labelNames);

    logger.log(`[orchestrator] execution order: ${executionOrder.join(' → ')}`);

    // ================================================================
    // 3. 流水线执行
    // ================================================================
    const agentOutputs: { label: string; content: string }[] = [];

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
          } else {
            // rag / lucky-draw — 未实现特殊处理，跳过
            logger.warn(
              `[orchestrator] direct handler not implemented for: ${label}`,
            );
            continue;
          }
        } else {
          // ================================================================
          // 标准 Agent 流水线
          // ================================================================

          // Build system prompt (disable flowContext since conversation provides context)
          const systemPrompt = buildAgentPrompt({
            ...entry.promptConfig,
            userId: state.userId,
            flowContext: false,
          });

          // Build context: full conversation history
          const contextMessages = state.messages.slice(-MAX_CONTEXT_MESSAGES);
          const initialMessages = buildInitialMessages(
            systemPrompt,
            contextMessages,
          );

          // Get tools
          const tools = registry.getToolsByTag(entry.tag);
          const llmWithTools = createAgentLLM(llmConfig, tools);

          logger.log(
            `[orchestrator] running ${entry.label} with ${tools.length} tools`,
          );

          // Run agent loop
          const result = await runAgentLoop({
            llmWithTools,
            initialMessages,
            tools,
            agentName: entry.label,
            logger,
          });

          if (result.error) {
            logger.error(
              `[orchestrator] ${entry.label} error: ${result.error}`,
            );
            agentOutputs.push({
              label: entry.label,
              content: `Sorry, I encountered an issue processing your ${label} request.`,
            });
          } else {
            agentOutputs.push({ label: entry.label, content: result.content });
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

    return {
      messages: [...state.messages, new AIMessage(finalContent)],
      previousIntent: state.intent,
      // 清空 labels，下一轮由 intentRouter 重新设置
      labels: [],
    };
  };
