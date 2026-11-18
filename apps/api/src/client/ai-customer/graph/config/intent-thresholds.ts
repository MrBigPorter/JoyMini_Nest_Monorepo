/**
 * intent-thresholds.ts — 意图链路阈值的唯一配置源
 *
 * ── 为什么单独抽一个文件？ ──
 * 以前三个阈值散落在三处，各自写死字面量，且都叫 LOW_CONFIDENCE_THRESHOLD
 * 或 MIN_SCORE，看起来像"同一个东西"，实际控制的是链路上三个不同环节：
 *
 *   IntentClassifier（领位员）
 *     └─ INTENT_ACCEPT_SCORE：单条向量/BM25 命中的原始分，够不够进入标签集
 *   IntentRouter（引座员）
 *     └─ INTENT_LLM_FALLBACK_SCORE：embedding 整体结果可不可信，要不要交给 LLM
 *   Orchestrator（大堂经理）
 *     └─ INTENT_EXECUTION_MIN_SCORE：融合后的标签分，够不够真的派 Agent 去执行
 *
 * 三者语义不同，只是当前取值恰好重合（ACCEPT 与 EXECUTION 都是 0.7）。
 * 不做合并，避免把"检索接纳"和"执行授权"绑死成一个概念。
 *
 * ── 数据流与 0.5 ~ 0.7 这个区间 ──
 *   pgvector 原始相似度
 *     --INTENT_ACCEPT_SCORE(0.7)--> 进入 domainMap（标签集）
 *     --BM25 加权融合-------------> 融合分可能被拉低到 0.5 ~ 0.7
 *     --INTENT_LLM_FALLBACK_SCORE(0.5)--> 低于 0.5 整体交给 LLM
 *     --INTENT_EXECUTION_MIN_SCORE(0.7)--> 低于 0.7 不执行，降级闲聊（必须有 warn）
 *
 * 也就是说：原始分落在 0.5 ~ 0.7 时，classifier 不会把它放进标签集（走 LLM fallback）；
 * 融合分落在 0.5 ~ 0.7 时，router 认为足够可信不下沉，但 orchestrator 不会执行。
 * 后者过去是"静默降级"，现在必须记录 score / threshold / destination。
 *
 * ── 修改指引 ──
 * 调整任何阈值只改本文件；三个消费方都从这里 import，不要再写本地字面量。
 */

/**
 * 标签接纳门槛（IntentClassifier）
 *
 * 单条 pgvector 相似度 / 单条 BM25 候选必须达到此分，才允许进入 domainMap。
 * 低于此分的命中直接丢弃，不参与后续融合；若所有候选都低于此分，
 * classifier 返回 `method: 'llm_fallback'`。
 *
 * 注意：这是"融合前"的原始分门槛，不是最终标签分。
 */
export const INTENT_ACCEPT_SCORE = 0.7;

/**
 * LLM fallback 门槛（IntentRouter）
 *
 * classifier 返回 embedding 结果后，若最高标签分仍低于此值，
 * 说明整次向量分类不可信（短句、泛化词、跨域模糊），
 * 丢弃 embedding 结果，改用 LLM + 对话上下文重新判断。
 *
 * 这是"整次分类是否可用的信任下限"，比接纳门槛更宽松（更低），
 * 否则 fallback 永远不会被触发。
 */
export const INTENT_LLM_FALLBACK_SCORE = 0.5;

/**
 * 编排执行门槛（Orchestrator）
 *
 * 经过 BM25/向量融合后的标签分必须达到此值，orchestrator 才会为它
 * 派发 Agent 执行；所有标签都不达标时降级到 generalChat。
 *
 * 与 ACCEPT 的区别：ACCEPT 管"能不能进标签集"（融合前原始分），
 * EXECUTION 管"值不值得花一次 Agent 执行"（融合后最终分）。
 * 当前两者同为 0.7，但保留独立常量，允许后续分别调整。
 */
export const INTENT_EXECUTION_MIN_SCORE = 0.7;

// ============================================================
// 语义化判定函数 —— 避免各消费方重复写裸比较
// ============================================================

/** 原始命中分是否达到标签接纳门槛。 */
export function meetsAcceptThreshold(score: number): boolean {
  return score >= INTENT_ACCEPT_SCORE;
}

/** embedding 最高分是否低到需要走 LLM fallback。 */
export function shouldUseLlmFallback(topScore: number): boolean {
  return topScore < INTENT_LLM_FALLBACK_SCORE;
}

/** 融合后的标签分是否达到编排执行门槛。 */
export function meetsExecutionThreshold(score: number): boolean {
  return score >= INTENT_EXECUTION_MIN_SCORE;
}
