/**
 * intent-thresholds.ts — 意图链路阈值的唯一配置源
 *
 * ── 为什么单独抽一个文件？ ──
 * 以前三个阈值散落在三处，各自写死字面量，且都叫 LOW_CONFIDENCE_THRESHOLD
 * 或 MIN_SCORE，看起来像"同一个东西"，实际控制的是链路上三个不同环节：
 *
 *   IntentClassifier（领位员）
 *     └─ INTENT_EXECUTION_MIN_SCORE：融合后的标签分，够不够进入候选集
 *   IntentRouter（引座员）
 *     └─ INTENT_LLM_FALLBACK_SCORE：embedding 整体结果可不可信，要不要交给 LLM
 *   Orchestrator（大堂经理）
 *     └─ INTENT_EXECUTION_MIN_SCORE：候选集里的标签分，够不够真的派 Agent 去执行
 *
 * 分类器与编排层当前共用同一个执行门槛（融合之后只判一次）；
 * 保留与 router 回落线的区分，避免把"检索接纳"和"整轮回落"绑死成一个概念。
 *
 * ── 数据流与 0.5 ~ 0.7 这个区间 ──
 *   pgvector 原始相似度 + BM25 原始分
 *     --各自取域内最高分----------> 不做阈值判断
 *     --加权融合-----------------> 融合分可能被拉低到 0.5 ~ 0.7
 *     --INTENT_EXECUTION_MIN_SCORE(0.7)--> 低于 0.7 全部丢弃，classifier 走 LLM fallback
 *     --INTENT_LLM_FALLBACK_SCORE(0.5)--> router 侧低于 0.5 再整体交给 LLM
 *
 * 注意：门禁只施加一次，且在融合、去重之后（见 design.md D2）。
 * 融合分落在 0.5 ~ 0.7 时，router 认为足够可信不下沉，但 orchestrator 不会执行；
 * 后者过去是"静默降级"，现在必须记录 score / threshold / destination。
 *
 * ── 修改指引 ──
 * 调整任何阈值只改本文件；消费方都从这里 import，不要再写本地字面量。
 */

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

/** embedding 最高分是否低到需要走 LLM fallback。 */
export function shouldUseLlmFallback(topScore: number): boolean {
  return topScore < INTENT_LLM_FALLBACK_SCORE;
}

/** 融合后的标签分是否达到编排执行门槛。 */
export function meetsExecutionThreshold(score: number): boolean {
  return score >= INTENT_EXECUTION_MIN_SCORE;
}

/** 向量路 / 关键词路的融合权重 */
export const VECTOR_FUSION_WEIGHT = 0.7;
export const BM25_FUSION_WEIGHT = 0.3;

/** 两个意图分差小于此值时视为模糊，保留近距离竞争者（orchestrator） */
export const INTENT_SCORE_MARGIN = 0.05;

/** 两个意图分差小于此值时触发 catch-all 让位（classifier） */
export const INTENT_TIE_EPSILON = 0.02;

/**
 * human_support 的 BM25 缺失惩罚系数（作用在融合前的向量分上）
 *
 * pgvector 命中转人工、但 BM25 没命中任何转人工关键词时，大概率是语义误匹配，
 * 向量分先乘以该系数再参与融合。
 */
export const HUMAN_SUPPORT_MISSING_BM25_PENALTY = 0.7;
