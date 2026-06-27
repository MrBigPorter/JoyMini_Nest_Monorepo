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
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';

/**
 * 要素 1：System Message = 规则 + 示例
 * 你说："写好规则，给 demo 做参考，这样明确不会随意跑题"
 * 9-Intent Classification Prompt
 * System Message 就是 "岗前培训手册"，不给 LLM 定规则，它就会自由发挥。给 demo 示例是让 LLM 知道你想要的具体格式，不是抽象描述。
 *
 * 要素 2：输出格式约束
 * 你说："只可以输出一个字：订单，钱包，优惠券..."
 * Prompt 约束 + 代码兜底 = 双层保险。LLM 可能不听话，所以代码层还要再做一次校验。
 *
 * 要素 3：Human + 占位符
 * 没有 {input} 这个占位符，LLM 就不知道用户问了什么。它是运行时动态注入的变量。
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

/**
 * Intent Router Node
 *
 * 1. 从 state.messages 中取得最后一条消息，作为用户输入
 * 2. 使用 ChatOllama + INTENT_PROMPT 对用户输入进行意图分类
 * 3. 将分类结果写入 state.intent
 *
 * 用户说 "帮我查看订单"
 *          ↓
 * 分拣员听了之后判断：
 * "这是 order 类别"
 *          ↓
 * 然后在纸条上写 intent = "order"
 *          ↓
 * 把纸条传给下一个工人
 *
 * 类比： 这就好比给一个新员工一份「问题分类手册」：
 *
 * 如果客人说「我的货到哪了」→ 分到 订单组
 * 如果客人说「你好」→ 分到 闲聊组
 * 如果客人说「怎么退货」→ 分到 政策组
 *
 * @param llmConfig
 */
export const createIntentRouterNode =
  (llmConfig: LlmProviderConfig) =>
  async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    //从对话里取出用户最后说的那句话
    const lastMessage = state.messages[state.messages.length - 1];
    console.log('lastMessage', lastMessage);

    // 比如 "帮我查看订单"
    const userInput =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content ?? '');
    //创建ollama模型实例（temperature=0 确保文档）
    console.log(
      `[intentRouter] classify user input: "${userInput.slice(0, 50)}..."`,
    );

    // 创建 LLM 实例（temperature=0 保证每次分类结果一致）
    const model = createLLM(llmConfig, { temperature: 0 });

    // 组装一条流水线
    // INTENT_PROMPT(用户输入) → LLM 分类 → 提取纯文本结果
    const chain = INTENT_PROMPT.pipe(model).pipe(new StringOutputParser());
    //执行分类，LLM 返回 "order"
    const raw = await chain.invoke({ input: userInput });
    //清理一下，转小写
    const trimmed = raw.trim().toLowerCase();
    //检查结果是否在允许的列表里
    const finalIntent: Intent = VALID_INTENTS.includes(trimmed as Intent)
      ? (trimmed as Intent)
      : 'unknown';

    // 6. ：把分类结果写回状态，传给下一个工人
    return {
      intent: finalIntent,
    };
  };

/**
 * Intent Router Node → Agent/RAG/GeneralChat 的路由函数
 *
 * 根据 state.intent 返回对应的节点名称
 * 1. order → orderAgent
 * 2. wallet → walletAgent
 * 3. coupon → couponAgent
 * 4. user → userAgent
 * 5. product → productAgent
 * 6. lucky-draw → luckyAgent
 * 7. rag → ragNode
 * 8. general → generalChat
 * 9. unknown → generalChat (fallback)
 *
 * @param state
 */
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
