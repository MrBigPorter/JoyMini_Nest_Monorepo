/**
 * intent-examples/index — 统一入口
 *
 * 收集所有域的示例句子，供 IntentClassifier 初始化时使用。
 * 每个域一个文件，通过本入口统一导出。
 *
 * ── 模式 ──
 * 与 prompts/*-prompt.ts 相同：每个模块一个文件，通过 index.ts 统一集合。
 * 新增域时：创建新文件 + 在本入口添加 import 和 INTENT_EXAMPLE_GROUPS 条目。
 */

import { walletExamples } from './wallet';
import { orderExamples } from './order';
import { couponExamples } from './coupon';
import { userExamples } from './user';
import { productExamples } from './product';
import { luckyDrawExamples } from './lucky-draw';
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
  { name: 'wallet', examples: walletExamples, requiredTags: ['wallet'] },
  { name: 'order', examples: orderExamples, requiredTags: ['order'] },
  { name: 'coupon', examples: couponExamples, requiredTags: ['coupon'] },
  { name: 'user', examples: userExamples, requiredTags: ['user'] },
  { name: 'product', examples: productExamples, requiredTags: ['product'] },
  {
    name: 'lucky-draw',
    examples: luckyDrawExamples,
    requiredTags: ['lucky-draw'],
  },
  { name: 'rag', examples: ragExamples, requiredTags: ['rag'] },
  { name: 'general', examples: generalExamples },
];
