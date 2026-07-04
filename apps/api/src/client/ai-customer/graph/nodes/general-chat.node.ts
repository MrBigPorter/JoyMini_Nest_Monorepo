/**
 * General Chat — 通用对话节点
 *
 * ── 是什么？ ──
 * 处理无需调用任何工具的闲聊类问题（问候、道谢、自我介绍等）。
 * 同时也是 unknown 意图的 fallback 处理节点。
 *
 * ── 为什么需要专门的闲聊节点？ ──
 * 1. 节约成本：闲聊不需要调用工具（查数据库），走专门的轻量 LLM 即可
 * 2. 避免误触发：如果把"你好"发给 Wallet Agent，它会尝试调用"查余额"工具，浪费资源
 * 3. Fault Tolerance（容错）：Unknown 意图 falling back 到 generalChat，
 *    至少能给用户一个友好回复，而不是报错
 *
 * ── 生活类比 ──
 * 就像客服中心里的"闲聊专线"。你打电话说"你好，今天天气不错"→
 * 自动转接到闲聊专线，那边有个机器人陪你聊天。
 * 你说"我要查订单"→ 再转接到"业务专线"（其他 Agent）。
 *
 * ── 怎么做？ ──
 * 纯 LLM 对话节点，不绑定任何工具（不调用 bindTools）。
 * 输出直接设置到 messages。
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
 * createGeneralChatNode — 创建通用对话节点函数
 *
 * ── 做什么？ ──
 * 1. 从 messages 中取出用户最后一条消息
 * 2. 直接用 LLM 生成回复（不绑定工具）
 * 3. 写入 taskResults + messages
 *
 * ── 为什么不走 Agent 循环？ ──
 * 闲聊不需要工具调用。走 Agent 循环（LLM 思考→是否调用工具→...）是浪费。
 * 直接用 prompt → LLM → 回复，一步到位。
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
    return {
      messages: [new AIMessage(result)],
    };
  };
