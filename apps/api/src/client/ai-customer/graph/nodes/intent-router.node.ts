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

import { Logger } from '@nestjs/common';
const logger = new Logger('IntentRouter');

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
    `You are an e-commerce customer service intent classifier and task planner.

## Previous Intent
{previousIntent}
If the user's current input is a follow-up, detail, or continuation of the previous topic, KEEP the previous intent.
Only change intent if the user clearly switches to a different topic.

## Conversation History (for context)
{conversationContext}

The Conversation History shows recent messages between user and assistant.
Use it to understand the context when the user's current input is short or ambiguous,
like 'yes', 'confirm', 'ok', '确认', '是的', '好的' — these are likely follow-ups
to the previous topic. Output the SAME intent as the previous topic.

## CRITICAL: Multi-domain detection (HIGHEST PRIORITY)
If the user mentions topics from MULTIPLE independent domains in the SAME sentence, you must output a JSON plan.

## Output Format

### For single-domain requests (one topic only):
Output ONLY the category name (one word), nothing else.

### For multi-domain requests (multiple topics in one sentence):
Output a JSON object with intent and tasks array:
{{"intent":"supervised","tasks":[{{"agent":"walletAgent","description":"Check wallet balance"}},{{"agent":"orderAgent","description":"Check order status"}}]}}

## Agent Name Mapping
- order → orderAgent
- wallet → walletAgent
- coupon → couponAgent
- rag → ragNode
- general → generalChat
- user → userAgent
- product → productAgent
- lucky-draw → luckyAgent

## Categories

### supervised (MULTI-DOMAIN — JSON OUTPUT)
The user asks about MULTIPLE independent domains in ONE sentence. Different agents are needed for different parts.
You MUST output a JSON object with tasks array (see Output Format above).

Examples that MUST output JSON (supervised with tasks):
- "查一下我的余额和订单" → {{"intent":"supervised","tasks":[{{"agent":"walletAgent","description":"查余额"}},{{"agent":"orderAgent","description":"查订单"}}]}}
- "帮我看看钱包和订单状态" → {{"intent":"supervised","tasks":[{{"agent":"walletAgent","description":"看钱包状态"}},{{"agent":"orderAgent","description":"看订单状态"}}]}}
- "查询取款记录和商品订单" → {{"intent":"supervised","tasks":[{{"agent":"walletAgent","description":"查取款记录"}},{{"agent":"orderAgent","description":"查商品订单"}}]}}
- "商品订单和优惠券" → {{"intent":"supervised","tasks":[{{"agent":"orderAgent","description":"查商品订单"}},{{"agent":"couponAgent","description":"查优惠券"}}]}}
- "查取款和优惠券" → {{"intent":"supervised","tasks":[{{"agent":"walletAgent","description":"查取款"}},{{"agent":"couponAgent","description":"查优惠券"}}]}}
- "check my balance and orders" → {{"intent":"supervised","tasks":[{{"agent":"walletAgent","description":"Check balance"}},{{"agent":"orderAgent","description":"Check orders"}}]}}
- "check my wallet and find my order" → {{"intent":"supervised","tasks":[{{"agent":"walletAgent","description":"Check wallet"}},{{"agent":"orderAgent","description":"Find order"}}]}}
- "我想查余额和订单" → {{"intent":"supervised","tasks":[{{"agent":"walletAgent","description":"查余额"}},{{"agent":"orderAgent","description":"查订单"}}]}}
- "查看我的取款和商品" → {{"intent":"supervised","tasks":[{{"agent":"walletAgent","description":"查取款"}},{{"agent":"orderAgent","description":"查商品"}}]}}
- "购买商品订单和优惠券" → {{"intent":"supervised","tasks":[{{"agent":"orderAgent","description":"购买商品订单"}},{{"agent":"couponAgent","description":"查优惠券"}}]}}

Examples that are NOT supervised (single domain, output ONE WORD only):
- "查我的余额" → wallet
- "查我的取款记录" → wallet
- "查我的订单" → order
- "查我的商品" → order
- "查优惠券" → coupon
- "check my balance" → wallet
- "check my withdrawal records" → wallet
- "check my orders" → order
- "where is my delivery" → order

### order (single domain)
Domain: product acquisition lifecycle (what did I buy? where is my delivery?)
Keywords: order, orders, delivery, 订单, 商品, 物流, 快递

### wallet (single domain)
Domain: money flow (balance, deposits, withdrawals)
Keywords: balance, withdraw, deposit, recharge, 余额, 取款, 钱包, 充值, 提现

### coupon (single domain)
Domain: discounts/offers
Keywords: coupon, discount, 优惠券, 折扣

### user (single domain)
Domain: personal information, account details, membership

### product (single domain)
Domain: product search/browsing

### lucky-draw (single domain)
Domain: lottery/raffle, winning records

### rag (single domain)
Domain: policies, rules, return policy, shipping policy

### general (single domain)
Domain: casual chat, greetings, thanks

### unknown (single domain)
Use when none of the above fit.

## CRITICAL RULES
1. For single-domain requests: output ONLY ONE WORD (the category name).
2. For multi-domain requests: output VALID JSON with "intent":"supervised" and "tasks" array.
3. No markdown, no backticks, no extra text in either case.
4. Each task's "agent" must be from the Agent Name Mapping above.`,
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
  'supervised', //多步骤请求
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
    logger.debug('lastMessage', lastMessage);

    // 比如 "帮我查看订单"
    const userInput =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content ?? '');
    //创建ollama模型实例（temperature=0 确保文档）
    logger.log(
      `[intentRouter] classify user input: "${userInput.slice(0, 50)}..."`,
    );

    // 构建对话上下文：取最近 4 条历史消息（排除当前最后一条用户消息）
    const contextMessages = state.messages.slice(-5, -1);
    const conversationContext = contextMessages
      .map((msg) => {
        const type =
          typeof msg._getType === 'function' ? msg._getType() : 'unknown';
        const role =
          type === 'human' ? 'User' : type === 'ai' ? 'Assistant' : type;
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content ?? '');
        // 截断长内容，避免 token 浪费
        const truncated =
          content.length > 200 ? content.slice(0, 200) + '...' : content;
        return `${role}: ${truncated}`;
      })
      .join('\n');

    // 创建 LLM 实例（temperature=0 保证每次分类结果一致）
    const model = createLLM(llmConfig, { temperature: 0 });

    // 组装一条流水线
    // INTENT_PROMPT(用户输入) → LLM 分类 → 提取纯文本结果
    const chain = INTENT_PROMPT.pipe(model).pipe(new StringOutputParser());
    //执行分类，LLM 返回 "order"
    const raw = await chain.invoke({
      input: userInput,
      previousIntent: state.intent || 'none',
      conversationContext: conversationContext || '(no recent history)',
    });

    // 方案 B：尝试解析 JSON（多领域检测）
    // LLM 输出可能有两种格式：
    // 1. JSON: {"intent":"supervised","tasks":[{"agent":"walletAgent","description":"查余额"}]}
    // 2. Single word: "order", "wallet", etc.
    const trimmed = raw.trim();
    // 检查是否以 { 开头 → JSON 格式（多领域）
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.intent === 'supervised' && Array.isArray(parsed.tasks)) {
          logger.log(
            `[intentRouter] multi-domain detected: ${parsed.tasks.length} tasks`,
          );
          parsed.tasks.forEach((t: { agent: string; description: string }) =>
            logger.log(`  → ${t.agent}: ${t.description}`),
          );
          return {
            intent: 'supervised',
            pendingTasks: parsed.tasks,
            taskResults: {},
            agentSteps: [],
          };
        }
      } catch {
        logger.warn(
          `[intentRouter] failed to parse JSON: ${trimmed.slice(0, 100)}`,
        );
      }
    }

    // 清理一下，转小写
    const singleWord = trimmed.toLowerCase();
    //检查结果是否在允许的列表里
    const finalIntent: Intent = VALID_INTENTS.includes(singleWord as Intent)
      ? (singleWord as Intent)
      : 'unknown';

    logger.log(`[intentRouter] classified as: ${finalIntent}`);

    // 6. ：把分类结果写回状态，传给下一个工人
    return {
      intent: finalIntent,
      taskResults: {},
      agentSteps: [],
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
    supervised: 'supervisorNode',
  };
  return routeMap[state.intent] || 'generalChat';
};
