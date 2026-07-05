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
 * | 标签名      | 对应业务        | 示例用户输入               |
 * |-------------|----------------|---------------------------|
 * | order       | 订单查询        | "我的订单到哪了"           |
 * | wallet      | 钱包/KYC       | "我钱包多少钱"             |
 * | coupon      | 优惠券          | "有什么券可以领"          |
 * | user        | 用户资料/地址   | "帮我改地址"               |
 * | product     | 商品搜索/浏览   | "有什么包包推荐"           |
 * | lucky-draw  | 抽奖活动        | "抽奖怎么玩"               |
 * | rag         | 知识库问答      | "你们发货用哪个快递"       |
 * | general     | 闲聊/通用       | "你好"、"今天天气"         |
 */

// ============================================================
// Types
// ============================================================

export interface LabelCategory {
  /** Label 名称，如 'order', 'wallet' */
  name: string;
  /** 是否为有效 intent（影响 VALID_INTENTS 列表） */
  validLabel: boolean;
}

// ============================================================
// Label Categories 配置
// ============================================================

export const INTENT_LABEL_CATEGORIES: LabelCategory[] = [
  { name: 'order', validLabel: true },
  { name: 'wallet', validLabel: true },
  { name: 'coupon', validLabel: true },
  { name: 'user', validLabel: true },
  { name: 'product', validLabel: true },
  { name: 'lucky-draw', validLabel: true },
  { name: 'rag', validLabel: true },
  { name: 'general', validLabel: true },
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
