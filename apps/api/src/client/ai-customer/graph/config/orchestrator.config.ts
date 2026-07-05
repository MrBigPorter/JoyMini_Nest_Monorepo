/**
 * Orchestrator Config — Agent Map & Dependency Map
 *
 * ── 目的 ──
 * 将 AGENT_MAP（哪些 Agent 可用）、DEPENDENCY_MAP（依赖关系）从 orchestrator.node.ts 中抽离，
 * 实现配置与逻辑分离。修改配置（新增 Agent、调整依赖）无需改动流水线执行逻辑。
 *
 * ── 如何新增一个 Agent ──
 * 1. 在 AGENT_MAP 添加新条目
 * 2. 在 DEPENDENCY_MAP 添加依赖规则（可选）
 * 3. 在对应的 module 注册工具（registerMany）
 * 4. 不需要修改 orchestrator.node.ts 的流水线循环
 */

import {
  buildAgentPrompt,
  AgentPromptConfig,
} from '@api/client/ai-customer/graph/agents/prompt-builder';
import { orderPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/order-prompt';
import { walletPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/wallet-prompt';
import { couponPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/coupon-prompt';
import { userPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/user-prompt';
import { productPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/product-prompt';

// ============================================================
// Types
// ============================================================

export interface AgentEntry {
  /** 节点名称（日志用），如 'orderAgent' */
  label: string;
  /** 工具标签，如 'order' */
  tag: string;
  /** Prompt 配置 */
  promptConfig: Omit<AgentPromptConfig, 'userId'>;
  /** Agent 类型 */
  type: 'agent' | 'direct';
}

// ============================================================
// Agent 注册表
// ============================================================
//
// AGENT_MAP 是 orchestrator 的"菜单"。
// 当 intentRouter 分类出 labels: [product:0.86, coupon:0.60, wallet:0.59]，
// orchestrator 遍历 executionOrder（经过依赖排序后得到 [product, coupon, wallet]），
// 对每个 label，用 AGENT_MAP[label] 查到对应的 AgentEntry：
//
//   AGENT_MAP['product'] → { label: 'productAgent', tag: 'product', promptConfig, type: 'agent' }
//   AGENT_MAP['coupon']  → { label: 'couponAgent',  tag: 'coupon',  promptConfig, type: 'agent' }
//   AGENT_MAP['wallet']  → { label: 'walletAgent',  tag: 'wallet',  promptConfig, type: 'agent' }
//
// 然后 orchestrator 用 entry.tag 去 ToolRegistry 查工具：
//   registry.getToolsByTag('product') → [searchProducts, getProductDetail, ...]
//   registry.getToolsByTag('coupon')  → [getUserCoupons, claimCoupon, ...]
//   registry.getToolsByTag('wallet')  → [getWalletBalance, requestWithdrawOtp, ...]
//
// ── 举个实际例子 ──
// 用户问: "我想买Women Crossbody Bag Set，团购价格多少，加上优惠券，我钱包还有多少钱"
// 1. intentRouter 分类: product:0.86, coupon:0.60, wallet:0.59
// 2. resolveExecutionOrder → [product, coupon, wallet]
// 3. orchestrator 循环:
//    a. product → 查 AGENT_MAP['product'] → tag='product' → getToolsByTag('product') → productAgent 运行
//    b. coupon  → 查 AGENT_MAP['coupon']  → tag='coupon'  → getToolsByTag('coupon')  → couponAgent 运行
//    c. wallet  → 查 AGENT_MAP['wallet']  → tag='wallet'  → getToolsByTag('wallet')  → walletAgent 运行
// 4. 合成一条回复 "这款包团购价$XX，您有$YY优惠券可用，钱包余额$ZZ"
//
// ── 修改指引 ──
// - 新增 Agent → 在这里添加条目 + 在 DEPENDENCY_MAP 添加依赖规则
// - 移除 Agent → 从 AGENT_MAP 删除条目（同时检查 DEPENDENCY_MAP）
// - 修改标签 → 改动 tag 字段 + 确保 ToolRegistry 有对应标签的工具
// - 注意: 'general', 'rag', 'lucky-draw' 是 type='direct'（不调 LLM+工具，直接处理）
//
// ============================================================

export const AGENT_MAP: Record<string, AgentEntry> = {
  order: {
    label: 'orderAgent',
    tag: 'order',
    promptConfig: orderPromptConfig,
    type: 'agent',
  },
  wallet: {
    label: 'walletAgent',
    tag: 'wallet',
    promptConfig: walletPromptConfig,
    type: 'agent',
  },
  coupon: {
    label: 'couponAgent',
    tag: 'coupon',
    promptConfig: couponPromptConfig,
    type: 'agent',
  },
  user: {
    label: 'userAgent',
    tag: 'user',
    promptConfig: userPromptConfig,
    type: 'agent',
  },
  product: {
    label: 'productAgent',
    tag: 'product',
    promptConfig: productPromptConfig,
    type: 'agent',
  },
  general: {
    label: 'generalChat',
    tag: 'general',
    promptConfig: null as unknown as Omit<AgentPromptConfig, 'userId'>,
    type: 'direct',
  },
  rag: {
    label: 'ragNode',
    tag: 'rag',
    promptConfig: null as unknown as Omit<AgentPromptConfig, 'userId'>,
    type: 'direct',
  },
  'lucky-draw': {
    label: 'luckyAgent',
    tag: 'lucky-draw',
    promptConfig: null as unknown as Omit<AgentPromptConfig, 'userId'>,
    type: 'direct',
  },
};

// ============================================================
// Dependency Resolution 配置
// ============================================================
//
// DEPENDENCY_MAP 定义 Agent 之间的依赖关系。
// 比如 user 问 "团购包 + 优惠券 + 钱包余额" 时：
//   原始 labels: [product:0.86, wallet:0.59, coupon:0.60]
//   按分数排序: [product, coupon, wallet]
//   依赖解析: product 是 coupon 的前置依赖 → 结果: [product, coupon, wallet]
//             （product 先执行，因为 coupon 需要知道买了什么商品）
//
// 格式: { "前置Agent": ["依赖者1", "依赖者2"] }
// 执行结果: [前置, 依赖者1, 依赖者2, ...其他按分数排序]
//
// ── 规则说明 ──
// product → coupon/wallet: 先知道商品信息，才能问优惠券/钱包
//   - 例: "这个包多少钱？我有优惠券吗？" → product 先执行查出包的价格
//         coupon 后执行，可以基于商品信息算优惠
// order → coupon/wallet: 先知道订单信息，才能问优惠券/钱包
//   - 例: "我的订单#123 多少钱？能用优惠券吗？" → order 先查出订单金额
//         coupon 后执行，知道订单金额才能算优惠
// coupon → product: coupon 依赖 product
//   - 例: "有什么优惠券？我要买包" → product 先查出包的信息
//         coupon 后执行，知道要买什么才能推荐合适的券
//
// ============================================================

export const DEPENDENCY_MAP: Record<string, string[]> = {
  product: ['coupon', 'wallet'],
  order: ['coupon', 'wallet'],
  coupon: ['product'],
};
