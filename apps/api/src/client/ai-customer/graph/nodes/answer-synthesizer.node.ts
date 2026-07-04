/**
 * Answer Synthesizer — 回答合成节点
 *
 * ── 是什么？ ──
 * 把 Agent 工具调用结果或 RAG 查询结果，合成为自然语言回复。
 * 就像同声传译员：Agent 们给的是"数据语言"（JSON、数字、状态码），
 * Answer Synthesizer 把它"翻译"成人话。
 *
 * ── 为什么需要单独的合成步骤？ ──
 * Agent 返回的是原始数据：
 *   [walletAgent]: Balance is 1500.50
 * 用户需要的是自然语言：
 *   "亲，您的钱包余额是 1500.50 元哦，请问还有什么需要帮忙的吗？"
 *
 * ── 设计原则 ──
 * - 称呼用户为"亲"（电商客服风格）
 * - 语气友好、专业，内容简洁准确
 * - 如果 agentOutput 为空，给出友好提示
 */
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { AgentState } from '@api/client/ai-customer/graph/state';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { AIMessage } from '@langchain/core/messages';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';
import { cleanResult } from '@api/client/ai-customer/graph/utils/clean-result';

/**
 * SYNTHESIZER_PROMPT — 合成 Prompt
 *
 * ── 结构 ──
 * System Message = 给 LLM 的「岗前培训」，告诉它你是谁、要做什么、怎么做。
 * {agentOutput} 是占位符，表示 Agent 工具调用结果或 RAG 查询结果
 * {userInput} 是占位符，表示用户原始问题
 *
 * ── 生活类比 ──
 * 没有这个培训，LLM 就像一个新员工不知道自己的岗位职责。
 */
const SYNTHESIZER_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You are JoyMini, a friendly and professional e-commerce customer service AI assistant.

## IMPORTANT: Result Filtering Rule
The query results below come from MULTIPLE specialized agents. Some agents may include disclaimers like "this is outside my scope" or "I cannot help with that" or "please contact another team". IGNORE those disclaimers — each agent was only given their relevant part of the user's question. Only present the actual data and information from each agent's results. If an agent's result only contains a disclaimer with no useful data, silently skip that agent's output entirely.

Based on the following query results, generate a clear and friendly response for the user.
Keep your tone warm and professional, and keep responses concise.

If the results contain a list of items, present them in a numbered list format.
If the results contain an error message, politely inform the user and offer suggestions.
If there are no results, politely let the user know.

Agent Query Results:
{agentOutput}

User's original question: {userInput}`,
  ],
  ['human', '{userInput}'],
]);

/**
 * createAnswerSynthesizerNode — 创建回答合成节点函数
 *
 * ── 做什么？ ──
 * 1. 从 state 中获取 intent 和 taskResults
 * 2. 合并所有 Agent 的输出（过滤越权声明）
 * 3. 如果 agentOutput 为空 → 回复友好提示
 * 4. 如果 intent === 'general' → 直接透传（generalChat 的输出已经是最终答案）
 * 5. 否则 → 调用 LLM 生成最终回复
 * 6. 状态管理：记录 previousIntent、清空 taskResults（跨 domain 时）、重置 Supervisor 状态
 *
 * ── 为什么 generalChat 要直接透传？ ──
 * General Chat 节点输出的已经是自然语言回复，不需要再经过一轮 LLM 合成。
 * 如果再经过一轮，可能丢失原始回复的语气和细节。
 *
 * ── 为什么 intent 变化时才清空 taskResults？ ──
 * 同 domain 的 follow-up（如 coupon→coupon）保留上一轮数据，
 * 让 LLM 能基于上一轮结果继续对话。只有跨 domain 切换时才清空。
 */
export const createAnswerSynthesizerNode =
  (llmConfig: LlmProviderConfig) =>
  async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    // 从messages中取得最后一条消息
    const lastMessage = state.messages[state.messages.length - 1];
    const userInput =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content ?? '');
    const { intent, taskResults } = state;

    // 过滤越权声明：使用外部 cleanResult 模块
    // 每个 Agent 的 System Prompt 中有 Scope Restriction，
    // 但 LLM 可能仍然输出 "this is outside my scope" 等免责声明。
    // cleanResult 会移除这些声明，只保留实际数据。

    // 合并所有 Agent 的输出（过滤越权声明后）
    const agentOutput = Object.entries(taskResults || {})
      .map(([agent, result]) => `[${agent}]: ${cleanResult(String(result))}`)
      .join('\n\n');
    //如果agentOutput为空，返回友好提示
    if (!agentOutput) {
      return {
        messages: [
          ...state.messages,
          new AIMessage(
            'Sorry, I could not find the information you requested. Please try again later or contact our customer support team for assistance.',
          ),
        ],
      };
    }
    // generalChat 的输出已经是最终答案，直接透传
    if (intent === 'general') {
      return {
        messages: [...state.messages, new AIMessage(agentOutput)],
      };
    }

    const model = createLLM(llmConfig, { temperature: 0.5 });

    //agentOutput 可能是 Agent 工具调用结果或 RAG 查询结果，使用 SYNTHESIZER_PROMPT 格式化 Prompt
    //userInput 是用户原始问题，传给模型生成最终回复
    const chain = SYNTHESIZER_PROMPT.pipe(model).pipe(new StringOutputParser());
    const result = await chain.invoke({
      agentOutput: agentOutput || 'No results found.',
      userInput,
    });

    // 判断 intent 是否变化：只有跨 domain 切换时才清空 taskResults
    // 同 domain 的 follow-up（如 coupon→coupon）保留上一轮结构数据
    const intentChanged =
      state.previousIntent && state.intent !== state.previousIntent;

    return {
      messages: [...state.messages, new AIMessage(result)],
      // 记录当前 intent 作为下一轮的 previousIntent
      previousIntent: state.intent,
      // taskResults: intent 变化时清空（避免跨 domain 污染），
      // intent 不变时保留（支持同 domain 的 follow-up 上下文延续）
      ...(intentChanged ? { taskResults: {} } : {}),
      // Supervisor 流程结束 → 重置 supervisor 状态
      ...(state.pendingTasks && state.pendingTasks.length > 0
        ? {
            pendingTasks: [],
            supervisorRound: 0,
          }
        : {}),
    };
  };
