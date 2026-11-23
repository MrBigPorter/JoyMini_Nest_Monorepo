/**
 * 知识文档域的一次性归一映射（迁移期用，不建别名表）
 *
 * 文档域是「文档归属」的命名空间，合法值固定为：
 *   order | wallet | coupon | product | user | kyc | lucky-draw | common
 *
 * 历史数据里出现过下划线/驼峰拼写，以及把意图域 `general` 当成
 * 文档域的写法。这里集中归一，避免同一业务区在检索过滤里裂成
 * 两个 domain。
 *
 * 为什么不做别名表？别名会把「文档归属」和「业务动作」再次混在
 * 一起；一次性归并到规范键即可，新数据由 KnowledgeDomainService
 * 在写入时校验。
 */
export const KNOWLEDGE_DOMAIN_KEYS = [
  'order',
  'wallet',
  'coupon',
  'product',
  'user',
  'kyc',
  'lucky-draw',
  'common',
] as const;

export type KnowledgeDomainKey = (typeof KNOWLEDGE_DOMAIN_KEYS)[number];

const ALIASES: Record<string, KnowledgeDomainKey> = {
  // 旧拼写
  lucky_draw: 'lucky-draw',
  luckydraw: 'lucky-draw',
  'lucky draw': 'lucky-draw',
  kyc_verification: 'kyc',
  identity: 'kyc',
  // `general` 是意图域，不是合法文档域；归到 common
  general: 'common',
  '': 'common',
};

/**
 * 归一文档域：trim + lowercase + 别名映射。
 * 未知拼写原样返回（再由 KnowledgeDomainService 校验并报错），
 * 不做静默兜底，否则拼写错误永远发现不了。
 */
export function normalizeKnowledgeDomain(raw?: string | null): string {
  const key = (raw ?? '').trim().toLowerCase();
  if (key === '') return 'common';
  return ALIASES[key] ?? key;
}
