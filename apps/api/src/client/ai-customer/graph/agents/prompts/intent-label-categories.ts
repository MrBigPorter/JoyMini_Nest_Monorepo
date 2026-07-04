/**
 * intent-label-categories — Intent Router 标签分类配置
 *
 * ── 是什么？ ──
 * 纯配置，不含逻辑。定义 INTENT_PROMPT 中 Label Categories 章节的 8 个域。
 * 通过 builder 自动生成该章节内容，无需手动修改模板字符串。
 *
 * ── 为什么提取？ ──
 * 之前 INTENT_PROMPT 是 130 行内联字符串，Label Categories 占 70%。
 * 每次新增域或修改评分标准都需要在模板中间查找位置。
 * 现在只需在数组中增删改一个配置对象。
 *
 * ── 使用方式 ──
 * import { INTENT_LABEL_CATEGORIES, VALID_INTENTS } from './intent-label-categories';
 */

// ============================================================
// Types
// ============================================================

export interface LabelCategory {
  /** Label 名称，如 'order', 'wallet' */
  name: string;
  /** 域类型描述，如 'single domain' */
  domainType: string;
  /** 评分指南（每行一个，生成时自动加 - 前缀） */
  scoreGuide: string[];
  /** 关键词列表（可选，生成 Keywords 行） */
  keywords?: string[];
  /** 是否为有效 intent（影响 VALID_INTENTS 列表） */
  validLabel: boolean;
}

// ============================================================
// Label Categories 配置
// ============================================================

export const INTENT_LABEL_CATEGORIES: LabelCategory[] = [
  {
    name: 'order',
    domainType: 'single domain',
    scoreGuide: [
      '0.9+: Clear order-related request (e.g. "show my orders", "where is my delivery")',
      '0.7-0.89: Likely order-related',
      '0.5-0.69: Possibly order-related (ambiguous)',
      '<0.5: Not order-related',
    ],
    keywords: [
      'order',
      'orders',
      'delivery',
      'tracking',
      'parcel',
      'purchase',
      'bought',
      'checkout',
      'payment',
      'refund',
    ],
    validLabel: true,
  },
  {
    name: 'wallet',
    domainType: 'single domain',
    scoreGuide: [
      '0.9+: Clear wallet/balance request (e.g. "check my balance", "withdraw money")',
      '0.7-0.89: Likely wallet-related',
      '<0.7: Weakly related',
    ],
    keywords: [
      'balance',
      'withdraw',
      'deposit',
      'recharge',
      'wallet',
      'transfer',
      'cash',
      'KYC',
      'identity verification',
      'real-name',
      'verification',
    ],
    validLabel: true,
  },
  {
    name: 'coupon',
    domainType: 'single domain',
    scoreGuide: [
      '0.9+: Clear coupon request (e.g. "show my coupons", "apply discount code")',
      '0.7-0.89: Likely coupon-related',
      '<0.7: Weakly related',
    ],
    keywords: [
      'coupon',
      'discount',
      'voucher',
      'promo',
      'code',
      'offer',
    ],
    validLabel: true,
  },
  {
    name: 'user',
    domainType: 'single domain',
    scoreGuide: [
      '0.9+: Clear user profile/address request (e.g. "update my address", "view profile")',
      '0.7-0.89: Likely user-related',
      '<0.7: Weakly related',
    ],
    keywords: [
      'address',
      'profile',
      'personal info',
      'membership',
      'password',
      'phone',
      'email',
      'account settings',
    ],
    validLabel: true,
  },
  {
    name: 'product',
    domainType: 'single domain',
    scoreGuide: [
      '0.9+: Clear product search/browse (e.g. "find me cheap products", "show hot items")',
      '0.7-0.89: Likely product-related',
      '<0.7: Weakly related',
    ],
    validLabel: true,
  },
  {
    name: 'lucky-draw',
    domainType: 'single domain',
    scoreGuide: [
      '0.9+: Clear lucky draw request (e.g. "my lottery tickets", "winning records")',
      '0.7-0.89: Likely lucky-draw-related',
      '<0.7: Weakly related',
    ],
    validLabel: true,
  },
  {
    name: 'rag',
    domainType: 'single domain',
    scoreGuide: [
      '0.9+: Clear policy/rule question (e.g. "what is your return policy")',
      '0.7-0.89: Likely policy-related',
      '<0.7: Weakly related',
    ],
    validLabel: true,
  },
  {
    name: 'general',
    domainType: 'single domain',
    scoreGuide: [
      '0.9+: Pure casual chat (e.g. "hello", "thank you", "hi")',
      '0.7-0.89: Likely casual',
      '0.5-0.69: Ambiguous — could be casual or a weak request',
      'Use general as fallback when other labels are all below 0.5',
    ],
    validLabel: true,
  },
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
