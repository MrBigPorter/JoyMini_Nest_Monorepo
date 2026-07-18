/**
 * Intent Router — 嵌入向量意图分类节点（带 LLM Fallback）
 *
 * ── 架构 ──
 * Phase 1: 内存 Embedding + LLM Fallback
 *   - 主流程: IntentClassifier（余弦相似度）
 *   - 降级: LLM（短输入 / 置信度不足 / 服务不可用）
 *
 * Phase 2: 迁移到 pgvector
 *   - 域向量持久化存储
 *   - SQL `<=>` 运算符替代手动余弦相似度
 *   - 接口不变
 *
 * ── 为什么保留 LLM Fallback？ ──
 * 1. 短输入（1-3 词）如 "yes", "proceed" 语义泛化能力弱，需要 previousIntent 上下文
 * 2. Embedding 服务可能不可用（Ollama 未本地运行）
 * 3. 低置信度场景（所有域 < 0.5）需要 LLM 结合对话历史判断
 */
import { StringOutputParser } from '@langchain/core/output_parsers';
import { AgentState } from '@api/client/ai-customer/graph/state';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';
import { INTENT_PROMPT } from '@api/client/ai-customer/graph/agents/prompts/intent-prompt';
import { VALID_INTENTS } from '@api/client/ai-customer/graph/agents/prompts/intent-label-categories';
import { IntentClassifier } from '@api/client/ai-customer/graph/utils/intent-classifier';
import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import { Logger } from '@nestjs/common';
import { extractUserInput } from '@api/client/ai-customer/graph/utils/extract-user-input';
import { formatMessagePreview } from '@api/client/ai-customer/graph/utils/format-message-preview';

const logger = new Logger('IntentRouter');
/**
 * 低置信度阈值：最高余弦相似度低于此值时使用 LLM fallback
 */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * 解析 LLM JSON 输出，提取 labels 数组和主 intent
 */
function parseLLMOutput(
  raw: string,
): { intent: string; labels: { label: string; score: number }[] } | null {
  const trimmed = raw.trim();

  try {
    const jsonStr = trimmed.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const parsed = JSON.parse(jsonStr);
    const intent: string = parsed?.intent || 'general';
    let labels: { label: string; score: number }[] = parsed?.labels;

    if (!Array.isArray(labels) || labels.length === 0) {
      labels = [{ label: intent, score: 0.7 }];
    }

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

    const sortedByScore = [...labels].sort((a, b) => b.score - a.score);
    return { intent: sortedByScore[0].label, labels };
  } catch {
    return null;
  }
}

/**
 * 回退解析：尝试将 LLM 原始输出解析为单意图格式
 */
function parseFallback(trimmed: string): {
  intent: string;
  labels: { label: string; score: number }[];
} {
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

/**
 * createIntentRouterNode — 创建嵌入向量意图分类节点
 *
 * ── 流程 ──
 * 1. 优先使用 IntentClassifier（embedding 余弦相似度）
 * 2. 如果 embedding 返回 llm_fallback（服务不可用），降级到 LLM
 * 3. 如果 embedding 最高置信度 < 0.5，降级到 LLM（短输入 / 模糊意图）
 * 4. LLM 使用简化 prompt（无 Label Categories 章节）
 *
 * ════════════════════════════════════════════════════════════════
 * 【运行示例 — "那我要买Women Crossbody Bag Set，团购价格多少，加上优惠券，我还有多少钱"]
 * ════════════════════════════════════════════════════════════════
 *
 * 第1步: 从 state.messages 提取用户输入
 *   state = {
 *     messages: [HumanMessage("那我要买Women Crossbody Bag Set，团购价格多少，加上优惠券，我还有多少钱")],
 *     userId: '123',
 *     debug: true,
 *     labels: [],
 *     intent: '',
 *     ...
 *   }
 *   userInput = "那我要买Women Crossbody Bag Set，团购价格多少，加上优惠券，我还有多少钱"
 *
 * 第2步: 调用 IntentClassifier.classify(userInput)
 *   → 生成 embedding → pgvector TOP-5 → 域去重 → 阈值过滤
 *   → 返回 ClassificationResult:
 *     {
 *       intent: 'product',             ← 最高分域
 *       labels: [                      ← 多标签（全部 >= 0.5）
 *         {label:'product', score:0.86},
 *         {label:'coupon',  score:0.60},
 *         {label:'wallet',  score:0.59}
 *       ],
 *       method: 'embedding',
 *       rawTop5: [{domain:'product',similarity:0.86}, ...]  ← debug 用
 *     }
 *
 * 第3步: 构造 stateUpdate
 *   stateUpdate = {
 *     intent: 'product',              ← 主意图
 *     labels: [{product:0.86}, {coupon:0.60}, {wallet:0.59}],  ← 全部高于阈值
 *     debugInfo: {                     ← debug=true 时写入
 *       embedding: {
 *         method: 'embedding',
 *         rawTop5: [{domain:'product',similarity:0.86}, ...],
 *         dedupedLabels: [{label:'product',score:0.86}, ...]
 *       },
 *       execution: { executionOrder: [], agents: [] }  ← 占位，orchestrator 填充
 *     }
 *   }
 *
 * 第4步: orchestrator 收到 stateUpdate 后读取 labels
 *   → 排序: product(0.86) > coupon(0.60) > wallet(0.59)
 *   → 依赖解析: product → [coupon, wallet]
 *   → executionOrder = [product, coupon, wallet]
 *   → 依次执行 productAgent → couponAgent → walletAgent
 * ════════════════════════════════════════════════════════════════
 *
 * @param llmConfig          LLM 配置
 * @param aiService          AiService（用于 embedding）
 * @param prismaService      PrismaService（用于 pgvector）
 * @param meilisearchService MeilisearchService（用于 BM25 关键词搜索）
 */
export const createIntentRouterNode = (
  llmConfig: LlmProviderConfig,
  aiService: AiService,
  prismaService: PrismaService,
  meilisearchService: MeilisearchService,
) => {
  // 单例：classifier 在 graph 构建时创建，避免每次请求重复 new
  const classifier = new IntentClassifier(
    aiService,
    prismaService,
    meilisearchService,
    llmConfig,
  );

  return async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    const userInput = extractUserInput(state);
    logger.debug('lastMessage', state.messages[state.messages.length - 1]);

    logger.log(`[intentRouter] classify: "${userInput.slice(0, 50)}..."`);

    // ============================================================
    // Phase 1: Try Embedding-based Classification
    // ============================================================
    const embeddingResult = await classifier.classify(userInput);

    // 🔍 日志：embedding 完整结果
    logger.log(
      `[intentRouter] embeddingResult: method="${embeddingResult.method}", intent="${embeddingResult.intent}", labels=${JSON.stringify(embeddingResult.labels)}`,
    );

    // embedding 服务不可用时直接降级到 LLM
    if (embeddingResult.method === 'llm_fallback') {
      logger.log('[intentRouter] Embedding unavailable, falling back to LLM');
      return await llmFallback(llmConfig, state, userInput);
    }

    // 低置信度时降级到 LLM
    const topScore = embeddingResult.labels[0]?.score ?? 0;
    if (topScore < LOW_CONFIDENCE_THRESHOLD) {
      logger.log(
        `[intentRouter] Low confidence (${topScore.toFixed(2)} < ${LOW_CONFIDENCE_THRESHOLD}), falling back to LLM`,
      );
      return await llmFallback(llmConfig, state, userInput);
    }

    // Embedding 结果可用，直接返回
    logger.log(
      `[intentRouter] embedding result: intent="${embeddingResult.intent}" (${topScore.toFixed(2)}), labels=[${embeddingResult.labels.map((l) => `${l.label}:${l.score.toFixed(2)}`).join(', ')}]`,
    );

    // 构造 state update
    const stateUpdate: Partial<typeof AgentState.State> = {
      intent: embeddingResult.intent,
      labels: embeddingResult.labels,
    };

    // debug=true 时写入 embedding 流水线追踪数据
    if (state.debug) {
      stateUpdate.debugInfo = {
        embedding: {
          method: embeddingResult.method,
          rawTop5:
            embeddingResult.rawTop5?.map((r) => ({
              domain: r.domain,
              similarity: r.similarity,
            })) ?? [],
          dedupedLabels: embeddingResult.labels.map((l) => ({
            label: l.label,
            score: l.score,
          })),
        },
        execution: {
          executionOrder: [],
          agents: [],
        },
      };
    }

    logger.log(
      `[intentRouter] state update: ${JSON.stringify({ intent: stateUpdate.intent, labels: stateUpdate.labels })}`,
    );

    return stateUpdate;
  };
};

/**
 * LLM Fallback: 使用 LLM + 简化 prompt 进行意图分类
 */
async function llmFallback(
  llmConfig: LlmProviderConfig,
  state: typeof AgentState.State,
  userInput: string,
): Promise<Partial<typeof AgentState.State>> {
  // 构建对话上下文（使用 formatMessagePreview 统一格式化）
  const contextMessages = state.messages.slice(-5, -1);
  const conversationContext = contextMessages
    .map((msg) => formatMessagePreview(msg, 200))
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

  // 解析 LLM 输出
  const parsed = parseLLMOutput(raw);
  if (parsed) {
    logger.log(
      `[intentRouter] LLM fallback: ${parsed.intent}, labels: ${parsed.labels.map((l) => `${l.label}:${l.score.toFixed(2)}`).join(', ')}`,
    );
    return parsed;
  }

  // JSON 解析失败，使用回退
  logger.warn(
    `[intentRouter] LLM fallback JSON parse failed: "${raw.slice(0, 100)}"`,
  );
  return parseFallback(raw.trim());
}

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
