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
import { buildIntentPrompt } from '@api/client/ai-customer/graph/agents/prompts/intent-prompt-builder';
import { VALID_INTENTS } from '@api/client/ai-customer/graph/agents/prompts/intent-label-categories';
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
 *
 * Label Categories 已提取到 intent-label-categories.ts + intent-prompt-builder.ts。
 * 添加新域时只需在 INTENT_LABEL_CATEGORIES 数组中新增一个配置对象。
 */
const INTENT_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', buildIntentPrompt()],
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

    logger.log(`[intentRouter] classify: "${userInput.slice(0, 50)}..."`);

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
      const validIntents = VALID_INTENTS;
      const fallbackIntent = validIntents.includes(singleWord)
        ? singleWord
        : 'general';
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
