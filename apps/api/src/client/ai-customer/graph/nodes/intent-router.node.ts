/**
 * Intent Router — 多标签意图分类节点
 *
 * ── 和旧架构的区别 ──
 * 旧架构: 输出单个词（'order'）或 JSON（多域 supervised）
 * 新架构: 总是输出 JSON 格式 `{"intent":"...","labels":[{"label":"...","score":0.xx},...]}`
 *         labels 数组支持多标签，每个标签带置信度分数
 *
 * ── 为什么总是 JSON？ ──
 * 1. 统一解析逻辑：不再区分"单域/多域"格式
 * 2. 多标签支持：一个句子可以包含多个意图，每个带分数
 * 3. 确定性路由：orchestrator 按分数降序 + 依赖解析执行
 *
 * ── Previous Intent 的角色变化 ──
 * 旧架构: Previous Intent 是硬性规则 —— 除非明确切换话题，否则保持上一轮意图
 * 新架构: Previous Intent 是弱提示 —— LLM 参考但不强制，由分数比较决定
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
 * INTENT_PROMPT — 多标签分类 System Prompt
 *
 * 总是输出 JSON 格式：
 * {
 *   "intent": "order",           // 主意图（最高分标签）
 *   "labels": [                   // 多标签分类结果
 *     {"label": "order", "score": 0.92},
 *     {"label": "coupon", "score": 0.75}
 *   ]
 * }
 *
 * ── 设计原则 ──
 * 1. Previous Intent 作为上下文参考，不是硬性规则
 * 2. 分数体现置信度：高分数 = 明确意图，低分数 = 可能意图
 * 3. 单域场景只有一个标签（score >= 0.7），多域场景多个标签
 * 4. general 标签 score >= 0.7 表示纯粹闲聊，其他标签分数低表示不确定
 *
 * NOTE: This prompt uses f-string style template variables ({varName}).
 * JSON examples in comments are described conceptually to avoid
 * LangChain template parser interpreting escaped curly braces
 * ({{...}}) as variable references — which caused the error
 * "Missing value for input variable 'label, score'" when the
 * parser found comma-separated content inside double braces.
 */
const INTENT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      'You are an e-commerce customer service intent classifier. Always output JSON.',
      '',
      '## Output Format (ALWAYS USE THIS)',
      'Always output a JSON object with these fields:',
      '- "intent": string — the highest-scoring label name. If no label reaches 0.5, use "general".',
      '- "labels": array of objects, each with "label" (string) and "score" (number 0.0 to 1.0)',
      '',
      'Example structure (use parentheses not curly braces in description):',
      '  intent = "order"',
      '  labels = [ (label: "order", score: 0.92), (label: "coupon", score: 0.75) ]',
      '',
      '- Include ALL labels with score >= 0.3 in the labels array.',
      '- Scores are 0.0 (definitely not) to 1.0 (definitely yes).',
      '- CRITICAL: Output ONLY valid JSON. No markdown, no backticks, no extra text.',
      '',
      '## Previous Intent (strong hint for short follow-ups)',
      'previousIntent: {previousIntent}',
      '',
      'CRITICAL RULES for previousIntent + short inputs:',
      '- If user input is 1-3 words AND previousIntent is set to a non-"general" value,',
      '  ALWAYS set previousIntent\'s score >= 0.7 as the primary intent.',
      '- Confirmation keywords like "yes", "yes please proceed", "confirm", "proceed",',
      '  "ok", "do it", "go ahead", "sure", "correct" strongly suggest continuing the',
      '  previous topic — give previousIntent >= 0.8 for these keywords.',
      '- Topic switch requires explicit rejection keywords like "no", "instead",',
      '  "actually", "different", "change" — only then override previousIntent.',
      '- When previousIntent is "none" or "general", use the conversation history below.',
      '',
      '## Conversation History (for context)',
      '{conversationContext}',
      '',
      'Use the conversation to understand follow-ups. The conversation above shows',
      'the recent assistant responses and user messages.',
      '',
      '## Active Flow State',
      'activeFlow: {flowStateActiveFlow}',
      'flowStep: {flowStateStep}',
      '',
      'If activeFlow is set (not empty), this means there is an ongoing multi-step',
      'process like withdrawal or address management. Short confirmation inputs MUST',
      'route to the active flow\'s domain. Only override if user explicitly says "no"',
      'or mentions a completely different topic.',
      '',
      '## Label Categories (score criteria)',
      '',
      '### order (single domain)',
      'Score guide:',
      '- 0.9+: Clear order-related request (e.g. "show my orders", "where is my delivery")',
      '- 0.7-0.89: Likely order-related',
      '- 0.5-0.69: Possibly order-related (ambiguous)',
      '- <0.5: Not order-related',
      '',
      'Keywords: order, orders, delivery, tracking, parcel, purchase, bought, checkout, payment, refund',
      '',
      '### wallet (single domain)',
      'Score guide:',
      '- 0.9+: Clear wallet/balance request (e.g. "check my balance", "withdraw money")',
      '- 0.7-0.89: Likely wallet-related',
      '- <0.7: Weakly related',
      '',
      'Keywords: balance, withdraw, deposit, recharge, wallet, transfer, cash, KYC, identity verification, real-name, verification',
      '',
      '### coupon (single domain)',
      'Score guide:',
      '- 0.9+: Clear coupon request (e.g. "show my coupons", "apply discount code")',
      '- 0.7-0.89: Likely coupon-related',
      '- <0.7: Weakly related',
      '',
      'Keywords: coupon, discount, voucher, promo, code, offer',
      '',
      '### user (single domain)',
      'Score guide:',
      '- 0.9+: Clear user profile/address request (e.g. "update my address", "view profile")',
      '- 0.7-0.89: Likely user-related',
      '- <0.7: Weakly related',
      '',
      'Keywords: address, profile, personal info, membership, password, phone, email, account settings',
      '',
      '### product (single domain)',
      'Score guide:',
      '- 0.9+: Clear product search/browse (e.g. "find me cheap products", "show hot items")',
      '- 0.7-0.89: Likely product-related',
      '- <0.7: Weakly related',
      '',
      '### lucky-draw (single domain)',
      'Score guide:',
      '- 0.9+: Clear lucky draw request (e.g. "my lottery tickets", "winning records")',
      '- 0.7-0.89: Likely lucky-draw-related',
      '- <0.7: Weakly related',
      '',
      '### rag (single domain)',
      'Score guide:',
      '- 0.9+: Clear policy/rule question (e.g. "what is your return policy")',
      '- 0.7-0.89: Likely policy-related',
      '- <0.7: Weakly related',
      '',
      '### general (single domain)',
      'Score guide:',
      '- 0.9+: Pure casual chat (e.g. "hello", "thank you", "hi")',
      '- 0.7-0.89: Likely casual',
      '- 0.5-0.69: Ambiguous — could be casual or a weak request',
      '- Use general as fallback when other labels are all below 0.5',
      '',
      '## CRITICAL RULES',
      '1. ALWAYS output valid JSON. No exceptions.',
      '2. Include ALL labels with score >= 0.3 in the labels array.',
      '3. The "intent" field MUST match the highest-scoring label name.',
      '4. If ALL labels are below 0.5, set intent to "general" with a single label (label="general", score=0.5).',
      '5. For multi-domain requests (user mentions multiple topics), assign scores >= 0.7 to each relevant label.',
      '6. No markdown, no backticks, no extra text — ONLY the JSON object.',
    ].join('\n'),
  ],
  ['human', '{input}'],
]);

/**
 * createIntentRouterNode — 创建多标签意图分类节点
 *
 * ── 做什么？ ──
 * 1. 从 state.messages 取得最后一条消息作为用户输入
 * 2. 构建对话上下文（最近 4 条历史消息）
 * 3. 使用 LLM + INTENT_PROMPT 进行多标签分类
 * 4. 解析 JSON 输出，提取 labels 数组和 intent
 * 5. 写入 state.intent + state.labels
 *
 * @param llmConfig
 */
export const createIntentRouterNode =
  (llmConfig: LlmProviderConfig) =>
  async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    const lastMessage = state.messages[state.messages.length - 1];
    logger.debug('lastMessage', lastMessage);

    const userInput =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content ?? '');

    logger.log(
      `[intentRouter] classify: "${userInput.slice(0, 50)}..."`,
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
        const truncated =
          content.length > 200 ? content.slice(0, 200) + '...' : content;
        return `${role}: ${truncated}`;
      })
      .join('\n');

    const model = createLLM(llmConfig, { temperature: 0 });
    const chain = INTENT_PROMPT.pipe(model).pipe(new StringOutputParser());

    const raw = await chain.invoke({
      input: userInput,
      previousIntent: state.previousIntent || 'none',
      conversationContext: conversationContext || '(no recent history)',
      flowStateActiveFlow: state.flowState?.activeFlow || '',
      flowStateStep: state.flowState?.step || '',
    });

    // 解析 JSON 输出
    const trimmed = raw.trim();
    let parsed: any;

    try {
      // 尝试提取 JSON（LLM 可能输出带 markdown 代码块）
      const jsonStr = trimmed.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      parsed = JSON.parse(jsonStr);
    } catch {
      logger.warn(
        `[intentRouter] failed to parse JSON: "${trimmed.slice(0, 100)}"`,
      );
      // Fallback: 尝试解析为单意图格式（兼容旧格式）
      const singleWord = trimmed.toLowerCase().trim();
      const validIntents = [
        'order', 'wallet', 'coupon', 'user', 'product',
        'lucky-draw', 'rag', 'general',
      ];
      const fallbackIntent = validIntents.includes(singleWord) ? singleWord : 'general';
      return {
        intent: fallbackIntent,
        labels: [{ label: fallbackIntent, score: 0.7 }],
      };
    }

    // 验证解析结果
    const intent: string = parsed?.intent || 'general';
    let labels: { label: string; score: number }[] = parsed?.labels;

    // 验证 labels 数组
    if (!Array.isArray(labels) || labels.length === 0) {
      labels = [{ label: intent, score: 0.7 }];
    }

    // 验证每个 label 的格式
    labels = labels.filter(
      (l: any) =>
        typeof l.label === 'string' &&
        typeof l.score === 'number' &&
        l.score >= 0 &&
        l.score <= 1,
    );

    if (labels.length === 0) {
      labels = [{ label: intent, score: 0.7 }];
    }

    // 确保 intent 在 labels 中（取最高分）
    const sortedByScore = [...labels].sort((a, b) => b.score - a.score);
    const primaryIntent = sortedByScore[0].label;

    logger.log(
      `[intentRouter] primary: ${primaryIntent}, labels: ${labels.map((l) => `${l.label}:${l.score.toFixed(2)}`).join(', ')}`,
    );

    return {
      intent: primaryIntent,
      labels,
    };
  };

/**
 * routerByIntent — Intent Router Node → 路由函数
 *
 * 新架构：所有标签都路由到 orchestrator（流水线执行器）
 * orchestrator 自行决定执行顺序。
 *
 * @param state
 */
export const routerByIntent = (state: typeof AgentState.State): string => {
  return 'orchestrator';
};
