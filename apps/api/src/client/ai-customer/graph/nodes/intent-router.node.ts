/**
 * Intent Router — 意图分类节点
 *
 * ── 在哪里？ ──
 * StateGraph 入口后的第一个节点。所有用户消息必经之路。
 *
 * ── 是什么？ ──
 * Intent Classification（意图分类）：用 LLM 把用户输入分类成 9 种预定义意图之一。
 * Pipeline: INTENT_PROMPT → LLM(temperature=0) → StringOutputParser → 校验 → 写入 state
 *
 * ── 为什么用 LLM 做分类，不用规则匹配（if/else 或正则）？ ──
 * 1. 自然语言多样性：用户可以说"查余额"、"看看我还有多少钱"、"我的钱包里有多少"→
 *    正则需要写 3 条规则，LLM 一条就够
 * 2. 多领域检测：用户说"查余额和订单"→ LLM 可以输出 JSON { intent: 'supervised', tasks: [...] }
 *    正则基本做不到
 * 3. 可扩展性：新增一个意图只需改 Prompt，不用改代码
 *
 * ── 为什么 temperature=0？ ──
 * 分类任务需要确定性（每次同样的输入得到同样的输出）。
 * temperature=0 让 LLM 总是选择概率最高的分类，不会随机变化。
 *
 * ── 生活类比 ──
 * 便利店入口处的店员：
 * - 你说"买瓶水"→ 他指路到饮料区（wallet）
 * - 你说"取快递"→ 他指到快递架（order）
 * - 你说"买水和取快递"→ 他写一张纸条派两个部门（supervised）
 * - 如果听不懂 → 带你去综合服务台（unknown → generalChat）
 */
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { AgentState } from '@api/client/ai-customer/graph/state';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';
import {
  intentToFlowType,
  getInitialStatus,
} from '@api/client/ai-customer/graph/types/flow-types';

import { Logger } from '@nestjs/common';
const logger = new Logger('IntentRouter');

/**
 * INTENT_PROMPT — 9 意图分类 System Prompt
 *
 * ── 结构 ──
 * 1. Previous Intent：理解简短消息（"确认"、"好的"）的上下文
 * 2. Conversation History：最近 4 条历史消息
 * 3. Multi-domain detection：多领域检测（最高优先级）
 * 4. Agent Name Mapping：分类结果 → Agent 名称映射
 * 5. 9 个分类定义：每个分类有描述 + 关键词 + 正反面示例
 *
 * ── 为什么 Previous Intent 这么重要？ ──
 * 用户可能只说"确认"或"好的"。没有 previousIntent，系统不知道"确认什么"。
 * 有了它，LLM 就知道"上一轮用户在查余额，所以'确认'=确认查看余额"。
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
Domain: personal information, account details, membership, address management
Keywords: address, profile, personal info, membership

Examples:
- "view my profile" → user
- "update my profile" → user
- "add a new address" → user
- "change my shipping address" → user
- "delete my address" → user
- "show my addresses" → user

Negative examples (NOT user even though address-related):
- "where is my order" → order (delivery tracking, not address management)
- "track my delivery" → order (logistics, not address management)
- "check my parcel" → order (shipment tracking, not address management)

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
 * createIntentRouterNode — 创建意图分类节点函数
 *
 * ── 做什么？ ──
 * 1. 从 state.messages 中取得最后一条消息，作为用户输入
 * 2. 构建对话上下文（最近 4 条历史消息）
 * 3. 使用 ChatOllama + INTENT_PROMPT 对用户输入进行意图分类
 * 4. 如果是 JSON（多领域）→ 解析 JSON，设置 pendingTasks
 * 5. 如果是单领域 → 校验后在 VALID_INTENTS 列表中
 * 6. 话题切换检测：不同业务域间切换时清空 flowData
 * 7. 写入 messageTopics 标记当前 Human 消息的话题
 *
 * ── 生活类比 ──
 * 用户说 "帮我查看订单"
 *          ↓
 * 分拣员听了之后判断：
 * "这是 order 类别"
 *          ↓
 * 然后在纸条上写 intent = "order"
 *          ↓
 * 把纸条传给下一个工人
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
          const supervisedFlowType = intentToFlowType('supervised');
          return {
            intent: 'supervised',
            flowType: supervisedFlowType, // supervised 无特定业务类型
            flowStatus: getInitialStatus(supervisedFlowType),
            pendingTasks: parsed.tasks,
            taskResults: {},
            agentSteps: [],
            // 记录当前 Human 消息的话题，用于 supervisor 模式下按话题过滤
            messageTopics: { [state.messages.length - 1]: 'supervised' },
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

    // 把分类结果写回状态，传给下一个工人
    const matchedFlowType = intentToFlowType(finalIntent);

    // ---- 话题切换检测：跨业务域时清空 flowData ----
    // 将 FlowType 映射到业务域，用于判断用户是否从一类业务切换到另一类
    // 例如：WITHDRAWAL（wallet 域）→ COUPON_QUERY（coupon 域）= 话题切换
    const FLOWTYPE_DOMAIN: Record<string, string> = {
      WITHDRAWAL: 'wallet',
      DEPOSIT: 'wallet',
      BALANCE_QUERY: 'wallet',
      COUPON_QUERY: 'coupon',
      COUPON_CLAIM: 'coupon',
      ORDER_QUERY: 'order',
      POLICY: 'rag',
      GENERAL: 'general',
    };

    const currentDomain = state.flowType ? FLOWTYPE_DOMAIN[state.flowType] : '';
    // 计算新意图的业务域，与当前域比较：不同域 = 话题切换
    const newDomain = matchedFlowType ? FLOWTYPE_DOMAIN[matchedFlowType] : '';
    const isTopicSwitch =
      currentDomain !== '' && newDomain !== '' && currentDomain !== newDomain;
    // ---- 话题切换检测结束 ----

    return {
      intent: finalIntent,
      flowType: matchedFlowType,
      flowStatus: getInitialStatus(matchedFlowType),
      agentSteps: [],
      // 话题切换时清空 flowData（空对象触发 reducer 清空逻辑）
      // 非话题切换时不返回 flowData，避免 undefined 触发 reducer 意外清空
      ...(isTopicSwitch ? { flowData: {} as Record<string, any> } : {}),
      // 记录当前 Human 消息的话题，用于 supervisor 模式下按话题过滤
      messageTopics: { [state.messages.length - 1]: finalIntent },
    };
  };

/**
 * routerByIntent — Intent Router Node → Agent/RAG/GeneralChat 的路由函数
 *
 * ── 是什么？ ──
 * 根据 state.intent 返回对应的节点名称。是 StateGraph 的条件边路由函数。
 *
 * ── 怎么做？ ──
 * 查 routeMap：'order' → 'orderAgent', 'wallet' → 'walletAgent', ...
 * 如果 state.intent 为空或不在 map 中 → fallback 到 'generalChat'
 *
 * ── 为什么 fallback 到 generalChat 而不是报错？ ──
 * 用户可能说了一句 LLM 无法分类的话（如乱码、未知语言）。
 * fallback 到 generalChat 至少能给出"抱歉，我没理解您的问题"的友好回复。
 * 这比直接报 500 错误要好得多（Fault Tolerance / 容错设计）。
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
  const effectiveIntent = state.intent || '';
  return routeMap[effectiveIntent] || 'generalChat';
};
