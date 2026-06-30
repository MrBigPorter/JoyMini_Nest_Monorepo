/**
 * General Chat — 通用对话节点
 *
 * 处理无需调用任何工具的闲聊类问题（问候、道谢、自我介绍等）。
 * 同时也是 unknown 意图的 fallback 处理节点。
 *
 * 输出直接设置到 agentOutput，answerSynthesizer 会将其透传。
 */
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { AgentState } from '@api/client/ai-customer/graph/state';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { AIMessage } from '@langchain/core/messages';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';

const GENERAL_CHAT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You are JoyMini, a friendly and helpful e-commerce customer service AI assistant. 
    
    You are a friendly and enthusiastic customer  service  assistant.You can:
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

/**
 * General Chat Node
 *
 * 直接用 LLM 生成回复，不需要工具调用。
 * 输出写入 agentOutput，由 answerSynthesizer 透传给用户。
 */

export const createGeneralChatNode =
  (llmConfig: LlmProviderConfig) =>
  async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    const lastMessage = state.messages[state.messages.length - 1];
    // 拿到用户输入的信息
    const userInput =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content ?? '');

    //创建ollama模型实例（temperature=0.7，允许一定的创造性）
    const model = createLLM(llmConfig, { temperature: 0.7 });

    //组装 chain: prompt=>model=>string parser
    //GENERAL_CHAT_PROMPT.pipe(model) ─── 格式化 Prompt，生成 System + Human 消息列表
    // .pipe(model) ─── 发给 ChatOllama，返回 AIMessage { content: '...' }
    //.pipe(StringOutputParser) ─── 从 AIMessage 里提取纯文本 '...'
    const chain = GENERAL_CHAT_PROMPT.pipe(model).pipe(
      new StringOutputParser(),
    );
    //执行生成回复
    const result = await chain.invoke({ input: userInput });
    //AIMessage 会被 answerSynthesizer 透传给用户
    return {
      taskResults: { generalChat: result },
      messages: [new AIMessage(result)],
    };
  };
