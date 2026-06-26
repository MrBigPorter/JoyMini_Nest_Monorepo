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
import { ChatOllama } from '@langchain/ollama';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { AIMessage } from '@langchain/core/messages';

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

export const answerSynthesizerNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  // 从messages中取得最后一条消息
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');
  const { intent, agentOutput } = state;

  //如果agentOutput为空，返回友好提示
  if (!agentOutput) {
    return {
      messages: [
        new AIMessage(
          'Sorry, I could not find the information you requested. Please try again later or contact our customer support team for assistance.',
        ),
      ],
    };
  }
  // generalChat 的输出已经是最终答案，直接透传
  if (intent === 'general') {
    return {
      messages: [new AIMessage(agentOutput)],
    };
  }

  const model = new ChatOllama({
    model: 'qwen3.5:0.8b',
    temperature: 0.5,
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  });

  //agentOutput 可能是 Agent 工具调用结果或 RAG 查询结果，使用 SYNTHESIZER_PROMPT 格式化 Prompt
  //userInput 是用户原始问题，传给模型生成最终回复
  const chain = SYNTHESIZER_PROMPT.pipe(model).pipe(new StringOutputParser());
  const result = await chain.invoke({
    agentOutput: agentOutput || 'No results found.',
    userInput,
  });

  return {
    messages: [new AIMessage(result)],
  };
};
