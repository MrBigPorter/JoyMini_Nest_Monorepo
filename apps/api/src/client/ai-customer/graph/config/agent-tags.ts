/**
 * agent-tags.ts — Agent 标签基础配置
 *
 * ── 设计意图 ──
 * 单一定义所有 Agent 的标签、名称、类型。
 * 其他文件从此推导，消除字符串重复。
 * 新增 Agent 只需在此加 1 行。
 * as const + satisfies 保证类型安全。
 *
 * ── 生活类比 ──
 * 就像公司组织架构表（AGENT_BASE_MAP）：
 * - 每个部门（Agent）有唯一编号（tag）和名称（label）
 * - 部门类型（type）：业务部门（agent）、职能部门（tool-only）、虚拟团队（direct）
 * - 其他系统（门禁卡、工牌、座位表）从这个表自动生成
 * - 新部门成立 → 只在组织架构表加 1 行
 *
 * ── 使用方法 ──
 * import { AGENT_BASE_MAP, AGENT_TAGS_FOR_TOOLS } from './agent-tags';
 *
 * // 需要工具注册的 tag
 * const EXPECTED_AGENT_TAGS = AGENT_TAGS_FOR_TOOLS;
 * // 结果: ['order', 'wallet', 'coupon', 'user', 'product', 'lucky-draw', 'kyc', 'flow']
 *
 * // 需要意图分类的 tag
 * const INTENT_TAGS = AGENT_TAGS_FOR_INTENT;
 * // 结果: ['order', 'wallet', 'coupon', 'user', 'product', 'lucky-draw', 'kyc']
 *
 * // 类型安全：AGENT_BASE_MAP['order'].label 自动推导为 'orderAgent'
 */

// ============================================================
// Types
// ============================================================

/**
 * 单个 Agent 的元数据类型
 * @property label — 节点名称（日志用），如 'orderAgent'
 * @property type  — Agent 类型:
 *   'agent'     : 标准 ReAct Agent，需要 promptConfig + 工具注册 + 意图分类
 *   'tool-only' : 仅为其他 Agent 提供工具（如 flow-tools），无需 prompt/intent
 *   'direct'    : 直接处理（如 general/rag），不经过 LLM+Tools 流水线
 */
export interface AgentBaseEntry {
  label: string;
  type: 'agent' | 'tool-only' | 'direct';
}

// ============================================================
// Base Config — 单一定义
// ============================================================
//
// ── 修改指引 ──
// 新增 Agent：
//   1. 在此加 1 行（tag + label + type）
//   2. 创建 *-tools.ts（领域工具）
//   3. 创建 *-prompt.ts（领域提示词）
//   4. ai-customer.module.ts 注册工具
//   5. orchestrator.config.ts 加 agentEntry(tag, promptConfig)
//
// 删除 Agent：
//   1. 删除此行
//   2. 检查其他文件无残留引用（TypeScript 编译会报错）
//
// ============================================================

export const AGENT_BASE_MAP = {
  order: { label: 'orderAgent', type: 'agent' },
  wallet: { label: 'walletAgent', type: 'agent' },
  coupon: { label: 'couponAgent', type: 'agent' },
  user: { label: 'userAgent', type: 'agent' },
  product: { label: 'productAgent', type: 'agent' },
  'lucky-draw': { label: 'luckyAgent', type: 'agent' },
  kyc: { label: 'kycAgent', type: 'agent' },
  flow: { label: 'flowTools', type: 'tool-only' },
  general: { label: 'generalChat', type: 'direct' },
  rag: { label: 'ragNode', type: 'direct' },
} as const satisfies Record<string, AgentBaseEntry>;

// ============================================================
// 自动推导类型
// ============================================================

/**
 * 所有 Agent tag 的联合类型
 * 输出: 'order' | 'wallet' | 'coupon' | 'user' | 'product' | 'lucky-draw' | 'kyc' | 'flow' | 'general' | 'rag'
 *
 * 用法:
 *   function doSomething(tag: AgentTag) { ... }
 *   doSomething('order')   // ✅
 *   doSomething('invalid') // ❌ TypeScript 编译报错
 */
export type AgentTag = keyof typeof AGENT_BASE_MAP;

// ============================================================
// 自动推导数组
// ============================================================

/**
 * 所有 tag（含 flow/general/rag 等非 agent 标签）
 * 输出: ['order', 'wallet', 'coupon', 'user', 'product', 'lucky-draw', 'kyc', 'flow', 'general', 'rag']
 *
 * 适用于需要遍历所有配置的场景
 */
export const ALL_AGENT_TAGS = Object.keys(AGENT_BASE_MAP) as AgentTag[];

/**
 * 需要工具注册的 tag（不含 general/rag 等 type='direct' 的标签）
 * 输出: ['order', 'wallet', 'coupon', 'user', 'product', 'lucky-draw', 'kyc', 'flow']
 *                                                                    ↑ flow 是 tool-only，需要注册
 *
 * 用于 EXPECTED_AGENT_TAGS，验证所有 agent 的工具都已注册
 */
export const AGENT_TAGS_FOR_TOOLS = ALL_AGENT_TAGS.filter(
  (t) => AGENT_BASE_MAP[t].type !== 'direct',
);

/**
 * 需要意图分类的 tag（仅 type='agent'）
 * 输出: ['order', 'wallet', 'coupon', 'user', 'product', 'lucky-draw', 'kyc']
 *                                                                    ↑ flow/tool-only 不参与分类
 *
 * 用于 IntentClassifier 的种子数据生成
 */
export const AGENT_TAGS_FOR_INTENT = ALL_AGENT_TAGS.filter(
  (t) => AGENT_BASE_MAP[t].type === 'agent',
);

/**
 * 自动生成 requiredTags 映射
 * 每个 intent-example group 需要哪些工具 tag
 * 格式: { [groupName]: string[] }
 *
 * 输出:
 * {
 *   order:       ['order'],
 *   wallet:      ['wallet'],
 *   coupon:      ['coupon'],
 *   user:        ['user'],
 *   product:     ['product'],
 *   'lucky-draw': ['lucky-draw'],
 *   kyc:         ['kyc'],
 *   rag:         ['rag'],      ← 手动补充
 *   general:     [],           ← 手动补充（纯对话，不需要工具）
 * }
 *
 * 自动推导规则：
 * - 标准 agent（order/wallet/coupon/...）→ requiredTags: [tag]
 * - rag → requiredTags: ['rag']
 * - general → requiredTags: []（不需要工具）
 */
export const INTENT_REQUIRED_TAGS: Record<string, string[]> = {
  ...Object.fromEntries(AGENT_TAGS_FOR_INTENT.map((t) => [t, [t]])),
  rag: ['rag'],
  general: [],
};
