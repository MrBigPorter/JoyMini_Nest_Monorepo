/**
 * Answer Synthesizer — 回答合成节点
 *
 * 功能：把 Agent 工具调用结果或 RAG 查询结果，合成为自然语言回复。
 * 对于 generalChat 节点，其输出已经是最终答案，直接透传。
 *
 * 设计原则：
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
 * Answer Synthesizer Prompt
 *
 * 设计原则：
 * - 称呼用户为"亲"（电商客服风格）
 * - 语气友好、专业，内容简洁准确
 * - 如果 agentOutput 为空，给出友好提示
 *
 * System Message = 给 LLM 的「岗前培训」，告诉它你是谁、要做什么、怎么做。没有这个培训，LLM 就像一个新员工不知道自己的岗位职责。
 * {agentOutput} 是占位符，表示 Agent 工具调用结果或 RAG 查询结果
 * {userInput} 是占位符，表示用户原始问题
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
 * Answer Synthesizer Node
 *
 * 接收来自 Agent 节点或 RAG 节点的 agentOutput，
 * 使用 ChatOllama 生成最终的自然语言回复。
 *
 * 对于 generalChat 节点，agentOutput 已经是最终答案，直接透传。
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
    // 参见 @api/client/ai-customer/graph/utils/clean-result.ts

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

    return {
      messages: [...state.messages, new AIMessage(result)],
      // Phase 3: 每轮都走 intentRouter 重新分类，不再使用 routeCache 快捷路由。
      // 保留 intent 让下一轮 intentRouter 能拿到准确的 previousIntent。
      // taskResults 仍然需要清空，避免下一轮 agent 看到上一轮的工具结果。
      taskResults: {},
      // Supervisor 流程结束 → 重置 supervisor 状态
      ...(state.pendingTasks && state.pendingTasks.length > 0
        ? {
            pendingTasks: [],
            supervisorRound: 0,
          }
        : {}),
    };
  };
