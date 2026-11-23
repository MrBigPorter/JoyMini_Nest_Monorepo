/**
 * 注册表读取层测试（M0 回滚开关 / 缓存 / 空表降级）
 */
import type { PrismaService } from '@api/common/prisma/prisma.service';
import {
  INTENT_DOMAIN_SEEDS,
  deriveValidIntents,
  getIntentDomains,
  invalidateIntentDomainCache,
  seedIntentDomains,
} from './intent-domain-registry';

function fakePrisma(rows: Array<Record<string, unknown>>) {
  return {
    intentDomain: {
      findMany: jest.fn().mockResolvedValue(rows),
      createMany: jest.fn().mockResolvedValue({ count: rows.length }),
    },
  } as unknown as PrismaService;
}

describe('intent-domain-registry', () => {
  const originalFlag = process.env.INTENT_REGISTRY_ENABLED;
  const originalTtl = process.env.INTENT_DOMAIN_CACHE_TTL_MS;

  beforeEach(() => {
    invalidateIntentDomainCache();
    delete process.env.INTENT_REGISTRY_ENABLED;
    delete process.env.INTENT_DOMAIN_CACHE_TTL_MS;
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.INTENT_REGISTRY_ENABLED;
    else process.env.INTENT_REGISTRY_ENABLED = originalFlag;

    if (originalTtl === undefined) delete process.env.INTENT_DOMAIN_CACHE_TTL_MS;
    else process.env.INTENT_DOMAIN_CACHE_TTL_MS = originalTtl;

    invalidateIntentDomainCache();
  });

  it('空表回退 TS 种子', async () => {
    const prisma = fakePrisma([]);
    const domains = await getIntentDomains(prisma);

    expect(domains.map((d) => d.label)).toEqual(
      INTENT_DOMAIN_SEEDS.map((s) => s.label),
    );
  });

  it('INTENT_REGISTRY_ENABLED=false 时不查库，直接用种子', async () => {
    process.env.INTENT_REGISTRY_ENABLED = 'false';
    const prisma = fakePrisma([
      {
        label: 'only-db',
        description: 'x',
        type: 'business',
        agentTag: 'only-db',
        catchAll: false,
        enabled: true,
        keywords: [],
        sortOrder: 0,
      },
    ]);

    const domains = await getIntentDomains(prisma);

    expect(prisma.intentDomain.findMany).not.toHaveBeenCalled();
    expect(domains.map((d) => d.label)).toEqual(
      INTENT_DOMAIN_SEEDS.map((s) => s.label),
    );
  });

  it('DB 有数据时以 DB 为准（只返回启用的域）', async () => {
    const prisma = fakePrisma([
      {
        label: 'order',
        description: 'db order',
        type: 'business',
        agentTag: 'order',
        catchAll: false,
        enabled: true,
        keywords: ['order'],
        sortOrder: 0,
      },
    ]);

    const domains = await getIntentDomains(prisma);

    expect(domains).toHaveLength(1);
    expect(domains[0]).toMatchObject({
      label: 'order',
      description: 'db order',
      enabled: true,
    });
    expect(prisma.intentDomain.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
  });

  it('60s 缓存命中；invalidate 后重新查库', async () => {
    const prisma = fakePrisma([]);

    await getIntentDomains(prisma);
    await getIntentDomains(prisma);
    expect(prisma.intentDomain.findMany).toHaveBeenCalledTimes(1);

    invalidateIntentDomainCache();
    await getIntentDomains(prisma);
    expect(prisma.intentDomain.findMany).toHaveBeenCalledTimes(2);
  });

  it('查询失败回退种子，不抛异常', async () => {
    const prisma = {
      intentDomain: {
        findMany: jest.fn().mockRejectedValue(new Error('db down')),
      },
    } as unknown as PrismaService;

    await expect(getIntentDomains(prisma)).resolves.toHaveLength(
      INTENT_DOMAIN_SEEDS.length,
    );
  });

  it('seedIntentDomains 用 skipDuplicates 幂等写入', async () => {
    const prisma = fakePrisma([]);
    await seedIntentDomains(prisma);

    expect(prisma.intentDomain.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('deriveValidIntents 与种子标签一致', async () => {
    const domains = await getIntentDomains(fakePrisma([]));
    expect(deriveValidIntents(domains)).toEqual(
      INTENT_DOMAIN_SEEDS.map((s) => s.label),
    );
  });
});
