/**
 * intent-examples/index — 代码定义的默认示例句子（Seed Data）
 *
 * 这些是各 domain 的默认示例句子，在首次部署或清空数据库时作为初始数据。
 * 用户可以通过 Admin 面板（PUT /admin/intent-examples/:domain）覆盖或追加示例。
 *
 * ── 新增 domain 的最佳实践 ──
 * 1. 在 intent-label-categories.ts 的 INTENT_LABEL_CATEGORIES 中注册（必需）
 * 2. 代码定义默认示例可选（仅当需要 seed 数据时在此文件添加）
 * 3. Admin 面板可直接创建任意 domain 并添加示例，无需改代码
 *
 * ── 与 INTENT_LABEL_CATEGORIES 的关系 ──
 * INTENT_EXAMPLE_GROUPS = 有代码默认示例的 domain（子集）
 * INTENT_LABEL_CATEGORIES = 所有有效 domain（含 human_support 等无默认示例的）
 * Admin service 使用 INTENT_LABEL_CATEGORIES 作为 domain 列表源。
 *
 * ── 与 agent-tags.ts 的关系 ──
 * requiredTags 从 INTENT_REQUIRED_TAGS 自动推导。
 * 新增 Agent 只需在 agent-tags.ts 加 1 行，无需手动更新 requiredTags。
 */

import { INTENT_REQUIRED_TAGS } from '../../../config/agent-tags';
import { walletExamples } from './wallet';
import { orderExamples } from './order';
import { couponExamples } from './coupon';
import { userExamples } from './user';
import { productExamples } from './product';
import { luckyDrawExamples } from './lucky-draw';
import { kycExamples } from './kyc';
import { ragExamples } from './rag';
import { generalExamples } from './general';

export interface IntentExampleGroup {
  /** 域名称，需与 INTENT_LABEL_CATEGORIES 中的 name 一致 */
  name: string;
  /** 该域的示例句子列表 */
  examples: string[];
  requiredTags?: string[];
}

/**
 * 所有域的示例句子分组。
 * IntentClassifier 初始化时读取此数组，为每个域生成平均向量并缓存。
 */
export const INTENT_EXAMPLE_GROUPS: IntentExampleGroup[] = [
  {
    name: 'wallet',
    examples: walletExamples,
    requiredTags: INTENT_REQUIRED_TAGS['wallet'],
  },
  {
    name: 'order',
    examples: orderExamples,
    requiredTags: INTENT_REQUIRED_TAGS['order'],
  },
  {
    name: 'coupon',
    examples: couponExamples,
    requiredTags: INTENT_REQUIRED_TAGS['coupon'],
  },
  {
    name: 'user',
    examples: userExamples,
    requiredTags: INTENT_REQUIRED_TAGS['user'],
  },
  {
    name: 'product',
    examples: productExamples,
    requiredTags: INTENT_REQUIRED_TAGS['product'],
  },
  {
    name: 'lucky-draw',
    examples: luckyDrawExamples,
    requiredTags: INTENT_REQUIRED_TAGS['lucky-draw'],
  },
  {
    name: 'kyc',
    examples: kycExamples,
    requiredTags: INTENT_REQUIRED_TAGS['kyc'],
  },
  {
    name: 'rag',
    examples: ragExamples,
    requiredTags: INTENT_REQUIRED_TAGS['rag'],
  },
  { name: 'general', examples: generalExamples },
];
