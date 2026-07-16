/**
 * intent-label-categories — 意图标签的"字典"说明书
 *
 * ═══════════════════════════════════════════════════════════════
 * 📖 一句话解释
 * ═══════════════════════════════════════════════════════════════
 *
 * 这个文件只是"定义有哪些业务类型"。
 * 相当于一本小字典，列出 AI 客服能处理的 8 种业务：
 *   order（订单）、wallet（钱包）、coupon（优惠券）、
 *   user（用户）、product（商品）、lucky-draw（抽奖）、
 *   rag（知识库）、general（通用/闲聊）
 *
 * 它是纯配置，不含任何逻辑。
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🎯 它有什么用？
 * ═══════════════════════════════════════════════════════════════
 *
 * 1. 给意图分类系统（IntentClassifier）提供"可选标签列表"
 * 2. 自动生成 VALID_INTENTS 列表，其他地方导入使用
 * 3. 统一管理标签名称，改名字只改这一个地方
 *
 * 比如 intent-router.node.ts 会这样用：
 *   import { VALID_INTENTS } from './intent-label-categories';
 *   然后检查 LLM 返回的标签名是否在 VALID_INTENTS 里。
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 📝 为什么这么简单？
 * ═══════════════════════════════════════════════════════════════
 *
 * 旧版本还有 keywords（关键词）和 scoreGuide（评分指引）。
 * 但自从换了 Embedding 方案后，域识别由向量相似度决定，
 * 不再需要人工关键词和评分阈值。
 *
 * 所以简化成只剩下标签名称列表。
 * 真正的"示例句子"放在 intent-examples/ 目录的各业务文件里。
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔄 标签列表详解
 * ═══════════════════════════════════════════════════════════════
 *
 * | 标签名      | 对应业务        | 类型       | 示例用户输入               |
 * |-------------|----------------|-----------|---------------------------|
 * | order       | 订单查询        | business  | "我的订单到哪了"           |
 * | wallet      | 钱包/KYC       | business  | "我钱包多少钱"             |
 * | coupon      | 优惠券          | business  | "有什么券可以领"          |
 * | user        | 用户资料/地址   | business  | "帮我改地址"               |
 * | product     | 商品搜索/浏览   | business  | "有什么包包推荐"           |
 * | lucky-draw  | 抽奖活动        | business  | "抽奖怎么玩"               |
 * | rag         | 知识库问答      | business  | "你们发货用哪个快递"       |
 * | general     | 闲聊/通用       | general   | "你好"、"今天天气"         |
 */

import { Logger } from '@nestjs/common';

// ============================================================
// Types
// ============================================================

export interface LabelCategory {
  /** Label 名称，如 'order', 'wallet' */
  name: string;
  /** 是否为有效 intent（影响 VALID_INTENTS 列表） */
  validLabel: boolean;
  /**
   * 标签类型
   * - 'business': 业务标签，对应具体的 Agent（order/wallet/coupon/...）
   * - 'general': 通用/闲聊标签，仅当一个业务标签都不匹配时使用
   */
  type: 'business' | 'general';
}

/**
 * 去重规则：纯函数，输入 labels → 输出去重后的 labels
 *
 * 每条规则负责一种去重策略，规则之间通过 reduce 管道串联。
 * 规则按注册顺序依次执行，前一条的输出作为下一条的输入。
 *
 * @example
 * // 规则1：业务 > general
 * // 规则2：分数差值过大时移除低分标签
 * // 规则3：业务互斥（如 order 和 coupon 不同时保留）
 */
export type DedupRule = (
  labels: { label: string; score: number }[],
) => { label: string; score: number }[];

// ============================================================
// Label Categories 配置
// ============================================================

export const INTENT_LABEL_CATEGORIES: LabelCategory[] = [
  { name: 'order', validLabel: true, type: 'business' },
  { name: 'wallet', validLabel: true, type: 'business' },
  { name: 'coupon', validLabel: true, type: 'business' },
  { name: 'user', validLabel: true, type: 'business' },
  { name: 'product', validLabel: true, type: 'business' },
  { name: 'lucky-draw', validLabel: true, type: 'business' },
  { name: 'kyc', validLabel: true, type: 'business' },
  { name: 'rag', validLabel: true, type: 'business' },
  { name: 'general', validLabel: true, type: 'general' },
];

// ============================================================
// Derived Constants
// ============================================================

/**
 * 所有有效 intent 名称列表。
 * 用于 intent-router.node.ts 中的 JSON 解析回退逻辑。
 * 由 config 自动派生，无需手动维护两份列表。
 */
export const VALID_INTENTS: string[] = INTENT_LABEL_CATEGORIES.filter(
  (c) => c.validLabel,
).map((c) => c.name);

/**
 * 业务标签列表：需要 Agent 处理的标签（order/wallet/coupon/...）。
 * 由 config.type === 'business' 自动派生，无需手动维护。
 */
export const BUSINESS_LABELS: string[] = INTENT_LABEL_CATEGORIES.filter(
  (c) => c.type === 'business',
).map((c) => c.name);

/**
 * 通用标签列表：不需要 Agent 的闲聊/回退标签（general/...）。
 * 由 config.type === 'general' 自动派生。
 */
export const GENERAL_LABELS: string[] = INTENT_LABEL_CATEGORIES.filter(
  (c) => c.type === 'general',
).map((c) => c.name);

// ============================================================
// Dedup Rules — 去重规则注册表
// ============================================================

const logger = new Logger('DedupRules');

/**
 * 规则1: 业务优先（businessOverGeneral）
 *
 * 当 business 类型标签和 general 类型标签同时出现时，移除 general 标签。
 * 因为 general 的语义是"没有匹配到任何业务"，但既然有业务标签匹配了，
 * general 就是多余的。
 *
 * 场景示例：
 *   - [order:0.85, general:0.72] → [order:0.85]       ✅ 业务优先
 *   - [general:0.92] → [general:0.92]                   ✅ 只有 general，保留
 *   - [coupon:0.82, order:0.71] → [coupon:0.82, order:0.71]  ✅ 两个业务标签，不变
 */
const businessOverGeneral: DedupRule = (labels) => {
  const businessLabels = labels.filter(
    (l) => !GENERAL_LABELS.includes(l.label),
  );
  if (businessLabels.length > 0) {
    logger.log(
      `[businessOverGeneral] removed general labels: ${labels
        .filter((l) => GENERAL_LABELS.includes(l.label))
        .map((l) => `${l.label}:${l.score}`)
        .join(', ')}`,
    );
    return businessLabels;
  }
  return labels;
};

/**
 * 规则注册表：按顺序执行，每条规则负责一种去重策略。
 * 前一条规则的输出作为下一条规则的输入（reduce 管道）。
 *
 * 添加新规则只需在 DEDUP_RULES 末尾 push 一条 DedupRule 函数，
 * classify() 方法无需任何改动。
 *
 * @example
 * // 添加"分数差距过大时移除低分标签"规则：
 * const scoreGapFilter: DedupRule = (labels) => {
 *   if (labels.length < 2) return labels;
 *   if (labels[0].score - labels[1].score > 0.3) {
 *     return [labels[0]];
 *   }
 *   return labels;
 * };
 * const DEDUP_RULES: DedupRule[] = [businessOverGeneral, scoreGapFilter];
 */
const DEDUP_RULES: DedupRule[] = [businessOverGeneral];

/**
 * 执行所有去重规则（纯函数，不修改原数组）
 *
 * 输入已排序的 labels，依次应用每条 DedupRule。
 *
 * @param labels - 已按 score 降序排列的标签列表
 * @returns 去重后的标签列表
 */
export function deduplicateLabels(
  labels: { label: string; score: number }[],
): { label: string; score: number }[] {
  return DEDUP_RULES.reduce((acc, rule) => rule(acc), labels);
}
