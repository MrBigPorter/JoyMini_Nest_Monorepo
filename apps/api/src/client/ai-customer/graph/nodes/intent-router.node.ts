/**
 * 9-Intent Classification Prompt
 *
 * Design principles:
 * - Each category has clear description + examples for accurate LLM classification
 * - Output only the classification word (StringOutputParser + trim)
 * - 'unknown' as fallback to avoid forced misclassification
 */
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { AgentState } from '@api/client/ai-customer/graph/state';
import { ChatOllama } from '@langchain/ollama';

/**
 * 9-Intent Classification Prompt
 *
 * Design principles:
 * - Each category has clear description + examples for accurate LLM classification
 * - Output only the classification word (StringOutputParser + trim)
 * - 'unknown' as fallback to avoid forced misclassification
 *
 * System Message = 给 LLM 的「岗前培训」，告诉它你是谁、要做什么、怎么做。没有这个培训，LLM 就像一个新员工不知道自己的岗位职责。
 * {input} 是模板变量
 * const prompt = ChatPromptTemplate.fromMessages([
 *   ['system', '你是分类器，只输出一个词'],
 *   ['human', '{input}'],  // ← {input} 是占位符
 * ]);
 *
 * // 调用时传入实际值
 * await chain.invoke({ input: 'Where is my order' });
 * // ↑ 这个对象替换了 {input}
 * 最终发给 LLM 的消息是：
 * System: 你是分类器，只输出一个词
 * Human: Where is my order
 */
const INTENT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You are an e-commerce customer service intent classifier. Classify the user input into one of the following nine categories. Output ONLY the category name, nothing else.

## Categories

### order — Order related
User inquires about order status, shipping, refund progress, order details, etc.
Examples: "Where is my order", "I want a refund", "Check order status", "Show my last order"

### wallet — Wallet / Balance
User inquires about wallet balance, recharge history, transactions, withdrawals, etc.
Examples: "How much money do I have", "Check my balance", "I want to withdraw", "My transaction history"

### coupon — Coupon
User inquires about their coupons, available coupons to claim, claiming a coupon, etc.
Examples: "What coupons do I have", "Any available coupons", "Claim a discount coupon"

### user — Personal info
User inquires about personal information, account details, membership level, shipping address, etc.
Examples: "My profile info", "My membership level", "My shipping address"

### product — Product / Group buy
User searches for products, checks product details, inquires about group buying, etc.
Examples: "Search for Bluetooth earphones", "How much is this item", "Any group buys available"

### lucky-draw — Lucky draw
User inquires about lottery tickets, winning records, performing a draw, etc.
Examples: "My lottery tickets", "Did I win", "I want to draw"

### rag — Policies / Rules
User asks about return policy, shipping policy, coupon rules, privacy policy, etc.
Examples: "How to return", "How long does shipping take", "Can I use this coupon", "Privacy policy"

### general — General chat
Greetings, thanks, self-introduction, casual chat that doesn't need data query.
Examples: "Hello", "Thank you", "Who are you", "Nice weather today"

### unknown — Cannot determine
Use this when none of the above categories fit. Falls back to general chat.
Examples: Gibberish, garbled text, incomprehensible input

Output only one word: order or wallet or coupon or user or product or lucky-draw or rag or general or unknown`,
  ],
  ['human', '{input}'],
]);

// Valid intent list (used to validate LLM output)
const VALID_INTENTS = [
  'order',
  'wallet',
  'coupon',
  'user',
  'product',
  'lucky-draw',
  'rag',
  'general',
  'unknown',
] as const;

export type Intent = (typeof VALID_INTENTS)[number];

export const intentRouterNode = async (
  state: typeof AgentState.State,
): Promise<Partial<typeof AgentState.State>> => {
  //从message中取得最后一条消息
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');
  //创建ollama模型实例（temperature=0 确保文档）
  const model = new ChatOllama({
    model: 'qwen3.5:0.8b',
    temperature: 0,
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  });
  //组装 chain: prompt=>model=>string parser
  //INTENT_PROMPT  ─── 格式化 Prompt，生成 System + Human 消息列表
  // .pipe(model) ─── 发给 ChatOllama，返回 AIMessage { content: 'order' }
  //.pipe(StringOutputParser) ─── 从 AIMessage 里提取纯文本 'order'
  const chain = INTENT_PROMPT.pipe(model).pipe(new StringOutputParser());
  //执行分类
  const raw = await chain.invoke({ input: userInput });
  const trimmed = raw.trim().toLowerCase();
  //验证结果是否在有效意图列表中
  const finalIntent: Intent = VALID_INTENTS.includes(trimmed as Intent)
    ? (trimmed as Intent)
    : 'unknown';
  console.log(`[intentRouter] "${userInput.slice(0, 50)}..." → ${finalIntent}`);
  // 6. 返回更新后的 state（写入 intent 字段）
  return {
    intent: finalIntent,
  };
};

export const routerByIntent = (state: typeof AgentState.State): string => {
  const routeMap: Record<string, string> = {
    order: 'orderAgent',
    wallet: 'walletAgent',
    coupon: 'couponAgent',
    user: 'userAgent',
    product: 'productAgent',
    'lucky-draw': 'luckyAgent',
    rag: 'ragNode',
    general: 'generalChat',
  };
  return routeMap[state.intent] || 'generalChat';
};
