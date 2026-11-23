/**
 * intent-domain-registry — 意图域注册表的运行时读取层
 *
 * ═══════════════════════════════════════════════════════════════
 * 📖 一句话解释
 * ═══════════════════════════════════════════════════════════════
 *
 * 以前「有哪些意图域」只写在 `INTENT_LABEL_CATEGORIES` 里，
 * 改描述、加关键词、停用某个域都得改代码并重新发版。
 *
 * 现在 DB 的 `intent_domains` 表是运行时事实来源；
 * 本文件负责：
 *   1. 把 TS 常量当成 bootstrap seed（首次启动/空表时灌入）
 *   2. 带 60s 缓存的读取，分类器不需要每个请求查库
 *   3. 派生出分类允许列表、LLM prompt 段落
 *
 * ═══════════════════════════════════════════════════════════════
 * 🎚️ 回退开关
 * ═══════════════════════════════════════════════════════════════
 *
 * `INTENT_REGISTRY_ENABLED=false` 时完全退回 TS 种子，
 * 用于上线出问题时一键回滚，不需要回滚代码。
 *
 * DB 空表、查询报错（比如迁移还没跑）也回退种子，
 * 保证分类器永远不会因为注册表不可用而挂掉。
 */
import { Logger } from '@nestjs/common';
import type { PrismaService } from '@api/common/prisma/prisma.service';
import { INTENT_LABEL_CATEGORIES } from '@api/client/ai-customer/graph/agents/prompts/intent-label-categories';

const logger = new Logger('IntentDomainRegistry');

export type IntentDomainType = 'business' | 'general' | 'transfer';

/** TS 种子的一条域定义（DB 不可用时的兜底） */
export interface IntentDomainSeed {
  label: string;
  description: string;
  type: IntentDomainType;
  agentTag: string | null;
  catchAll: boolean;
  keywords: string[];
  sortOrder: number;
}

/** 运行时快照：分类器 / prompt 只需要这些字段 */
export interface IntentDomainSnapshot {
  label: string;
  description: string;
  type: IntentDomainType;
  agentTag: string | null;
  catchAll: boolean;
  enabled: boolean;
  keywords: string[];
  sortOrder: number;
}

/**
 * 域描述。描述会进入 LLM 兜底 prompt，比裸标签名更能约束分类，
 * 所以这里写的是「这个域负责什么动作」，不是营销文案。
 */
const DOMAIN_DESCRIPTIONS: Record<string, string> = {
  order:
    'Order actions: check order status, track shipment, cancel or return an order, request a refund, fix delivery problems.',
  wallet:
    'Wallet and balance: balance inquiry, top-up, withdrawal, transaction history, payment methods.',
  coupon:
    'Coupons and promotions: available vouchers, claiming, applying at checkout, expiry, and discount rules.',
  user: 'User account: profile, address book, phone or email changes, account settings and login issues.',
  product:
    'Product catalog: item details, price, stock, variants, sizing and product recommendations.',
  'lucky-draw':
    'Lucky draw: how to join, draw schedule, prizes, winner announcement and prize claiming.',
  kyc: 'Identity verification (KYC): requirements, document upload, review status and rejection reasons.',
  rag: 'Knowledge questions: policies, rules, fees, shipping, FAQs and other informational questions answered from the knowledge base.',
  general:
    'Small talk, greetings, questions about the assistant itself, or anything unrelated to the business.',
};

/** 域级建议关键词，供后续生成候选与 prompt 使用 */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  order: ['order', 'tracking', 'delivery', 'return', 'refund', 'cancel'],
  wallet: ['wallet', 'balance', 'top up', 'withdraw', 'transaction'],
  coupon: ['coupon', 'voucher', 'promo', 'discount'],
  user: ['profile', 'address', 'account', 'phone', 'email'],
  product: ['product', 'price', 'stock', 'size', 'recommend'],
  'lucky-draw': ['lucky draw', 'prize', 'winner', 'draw'],
  kyc: ['kyc', 'verify', 'identity', 'document'],
  rag: ['policy', 'rule', 'fee', 'shipping', 'faq'],
  general: [],
};

/**
 * TS 种子 = `INTENT_LABEL_CATEGORIES` 加上描述/关键词/排序。
 *
 * 从标签表派生（而不是再抄一份标签名），保证 seed 与现有标签定义
 * 始终一一对应；parity 测试会再和 `AGENT_BASE_MAP` 对一遍。
 */
export const INTENT_DOMAIN_SEEDS: IntentDomainSeed[] =
  INTENT_LABEL_CATEGORIES.map((category, index) => ({
    label: category.name,
    description: DOMAIN_DESCRIPTIONS[category.name] ?? category.name,
    type: category.type,
    // business/general 都有对应的 Agent/base 节点；transfer 暂无
    agentTag: category.type === 'transfer' ? null : category.name,
    catchAll: category.type === 'general',
    keywords: DOMAIN_KEYWORDS[category.name] ?? [],
    sortOrder: index,
  }));

function seedSnapshot(): IntentDomainSnapshot[] {
  return INTENT_DOMAIN_SEEDS.map((seed) => ({
    ...seed,
    enabled: true,
    keywords: [...seed.keywords],
  }));
}

/** 上线开关：默认开启；仅在显式 `false` 时回退 TS 常量 */
export function isIntentRegistryEnabled(): boolean {
  return process.env.INTENT_REGISTRY_ENABLED !== 'false';
}

function cacheTtlMs(): number {
  const raw = Number(process.env.INTENT_DOMAIN_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
}

let cache: { loadedAt: number; domains: IntentDomainSnapshot[] } | null = null;

/** 写入/审核域描述后调用，让下一次分类立刻看到新值 */
export function invalidateIntentDomainCache(): void {
  cache = null;
}

function toDomainType(value: unknown): IntentDomainType {
  return value === 'general' || value === 'transfer' ? value : 'business';
}

/**
 * 直接从 DB 读（不碰缓存）。空表 / 查询失败 / 开关关闭都回退种子。
 */
async function readIntentDomains(
  prisma: PrismaService,
): Promise<IntentDomainSnapshot[]> {
  if (!isIntentRegistryEnabled()) {
    return seedSnapshot();
  }

  try {
    const rows = await prisma.intentDomain.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });

    if (rows.length === 0) {
      logger.warn(
        'intent_domains is empty; using TS seed. Run the domain seed script to edit domains at runtime.',
      );
      return seedSnapshot();
    }

    return rows.map((row) => ({
      label: row.label,
      description: row.description,
      type: toDomainType(row.type),
      agentTag: row.agentTag,
      catchAll: row.catchAll,
      enabled: row.enabled,
      keywords: row.keywords ?? [],
      sortOrder: row.sortOrder,
    }));
  } catch (error) {
    logger.warn(
      `Failed to read intent_domains (${(error as Error).message}); falling back to TS seed`,
    );
    return seedSnapshot();
  }
}

/**
 * 带进程内 TTL 缓存的读取入口。
 * 分类器每个请求都会调用，不能每次打库。
 */
export async function getIntentDomains(
  prisma: PrismaService,
): Promise<IntentDomainSnapshot[]> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < cacheTtlMs()) {
    return cache.domains;
  }

  const domains = await readIntentDomains(prisma);
  cache = { loadedAt: now, domains };
  return domains;
}

/** 幂等灌种子：已存在的 label 不覆盖，避免冲掉运营改过的描述 */
export async function seedIntentDomains(
  prisma: PrismaService,
): Promise<number> {
  const result = await prisma.intentDomain.createMany({
    data: INTENT_DOMAIN_SEEDS.map((seed) => ({
      label: seed.label,
      description: seed.description,
      type: seed.type,
      agentTag: seed.agentTag,
      catchAll: seed.catchAll,
      keywords: seed.keywords,
      sortOrder: seed.sortOrder,
    })),
    skipDuplicates: true,
  });
  invalidateIntentDomainCache();
  return result.count;
}

/**
 * 取每域少量已启用示例，供 LLM 兜底 prompt 使用。
 *
 * 只查 sentence（不碰 embedding，避免把大向量拉进 Node 内存）。
 * 任何失败都返回空表，prompt 退化为「标签 + 描述」。
 */
export async function loadIntentExampleHints(
  prisma: PrismaService,
  maxPerDomain = 3,
): Promise<Record<string, string[]>> {
  try {
    const rows = await prisma.$queryRawUnsafe<
      { domain: string; sentence: string }[]
    >(
      `SELECT domain, sentence FROM (
         SELECT domain, sentence,
                ROW_NUMBER() OVER (
                  PARTITION BY domain
                  ORDER BY length(sentence), sentence
                ) AS rn
         FROM intent_examples
         WHERE enabled = true
       ) ranked
       WHERE rn <= $1::int`,
      maxPerDomain,
    );

    const hints: Record<string, string[]> = {};
    for (const row of rows) {
      (hints[row.domain] ??= []).push(row.sentence);
    }
    return hints;
  } catch (error) {
    logger.warn(
      `Failed to load intent example hints (${(error as Error).message}); prompt will omit examples`,
    );
    return {};
  }
}

/** 分类器允许列表：启用且不是 transfer 的标签 */
export function deriveValidIntents(domains: IntentDomainSnapshot[]): string[] {
  return domains
    .filter((domain) => domain.enabled && domain.type !== 'transfer')
    .map((domain) => domain.label);
}

/**
 * 拼 LLM 兜底 prompt 的标签章节。
 *
 * 与旧的裸标签列表相比，多了「一句话职责」和每域少量示例，
 * 让 LLM 在归零时也能区分「退款政策」（rag）和「我要退款」（order）。
 */
export function buildIntentDomainPromptSection(
  domains: IntentDomainSnapshot[],
  examplesByDomain: Record<string, string[]> = {},
  maxExamplesPerDomain = 3,
): string {
  const lines = [
    'Supported labels (use only these exact names; never invent a label):',
  ];

  for (const domain of domains) {
    if (!domain.enabled) continue;
    lines.push(`- ${domain.label}: ${domain.description}`);

    const examples = (examplesByDomain[domain.label] ?? [])
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter((text) => text.length > 0)
      .slice(0, maxExamplesPerDomain);

    if (examples.length > 0) {
      lines.push(
        `  examples: ${examples.map((text) => `"${text}"`).join(' | ')}`,
      );
    }
  }

  return lines.join('\n');
}
