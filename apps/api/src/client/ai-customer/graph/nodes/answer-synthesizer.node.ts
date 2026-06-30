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

    // 合并所有 Agent 的输出
    const agentOutput = Object.entries(taskResults || {})
      .map(([agent, result]) => `[${agent}]: ${result}`)
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
      //每轮结束，清空 taskResults 和 intent，下次请求重新分类
      taskResults: {},
      intent: '', // 清空 intent，下次请求走 IntentRouter 重新分类
      // Supervisor 流程结束 → 重置 supervisor 状态
      ...(state.pendingTasks && state.pendingTasks.length > 0
        ? {
            pendingTasks: [],
            supervisorRound: 0,
          }
        : {}),
    };
  };
