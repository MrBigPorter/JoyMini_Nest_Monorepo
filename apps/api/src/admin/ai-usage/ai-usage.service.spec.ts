import { AiUsageService } from './ai-usage.service';

const ORIGINAL_DAILY_LIMIT = process.env.AI_DAILY_TOKEN_LIMIT;

/** 按 userId 聚合（区间合计）与按 userId+date（每日）区分 groupBy 调用。 */
function mockGroupBy(
  prisma: any,
  rangeGroups: Array<{ userId: string; totalTokens: number }>,
  dailyGroups: Array<{ userId: string; totalTokens: number }>,
) {
  prisma.aiUsageDaily.groupBy.mockImplementation((args: any) => {
    const rows = args.by?.includes('date') ? dailyGroups : rangeGroups;
    return Promise.resolve(
      rows.map((row) => ({
        userId: row.userId,
        _sum: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: row.totalTokens,
          requests: 0,
        },
      })),
    );
  });
}

afterEach(() => {
  if (ORIGINAL_DAILY_LIMIT === undefined) {
    delete process.env.AI_DAILY_TOKEN_LIMIT;
  } else {
    process.env.AI_DAILY_TOKEN_LIMIT = ORIGINAL_DAILY_LIMIT;
  }
});

function makeService() {
  const prisma: any = {
    aiUsageDaily: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          requests: 2,
        },
      }),
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }]),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'u1',
          nickname: 'Alice',
          phone: '13800138000',
          avatar: null,
        },
      ]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        nickname: 'Alice',
        phone: '13800138000',
        avatar: null,
      }),
    },
  };
  return { service: new AiUsageService(prisma), prisma };
}

describe('AiUsageService', () => {
  it('summary 返回汇总、口径与配额', async () => {
    const { service } = makeService();
    const result = await service.summary('2026-11-01', '2026-11-20');

    expect(result.totals).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      requests: 2,
      users: 1,
    });
    expect(result.coverage.scope).toBe('ai-customer-main-path');
    expect(result.coverage.note).toContain('UTC');
    expect(result.quota.dailyTokenLimit).toBeGreaterThan(0);
  });

  it('users 返回脱敏手机号与超限标记', async () => {
    const { service, prisma } = makeService();
    mockGroupBy(
      prisma,
      [{ userId: 'u1', totalTokens: 150 }],
      [{ userId: 'u1', totalTokens: 150 }],
    );

    const result = await service.users({ page: 1, pageSize: 20 });

    expect(result.list[0]).toMatchObject({
      userId: 'u1',
      nickname: 'Alice',
      phoneMasked: '138****8000',
      totalTokens: 150,
      maxDailyTokens: 150,
      overDailyLimit: false,
    });
  });

  it('区间合计超限但单日未超限：overDailyLimit 为 false', async () => {
    process.env.AI_DAILY_TOKEN_LIMIT = '1000';
    const { service, prisma } = makeService();
    mockGroupBy(
      prisma,
      [{ userId: 'u1', totalTokens: 1800 }],
      [
        { userId: 'u1', totalTokens: 600 },
        { userId: 'u1', totalTokens: 600 },
        { userId: 'u1', totalTokens: 600 },
      ],
    );

    const result = await service.users({ page: 1, pageSize: 20 });

    expect(result.list[0]).toMatchObject({
      totalTokens: 1800,
      maxDailyTokens: 600,
      overDailyLimit: false,
    });
  });

  it('存在单日超限：overDailyLimit 为 true', async () => {
    process.env.AI_DAILY_TOKEN_LIMIT = '1000';
    const { service, prisma } = makeService();
    mockGroupBy(
      prisma,
      [{ userId: 'u1', totalTokens: 2200 }],
      [
        { userId: 'u1', totalTokens: 400 },
        { userId: 'u1', totalTokens: 1500 },
        { userId: 'u1', totalTokens: 300 },
      ],
    );

    const result = await service.users({ page: 1, pageSize: 20 });

    expect(result.list[0]).toMatchObject({
      totalTokens: 2200,
      maxDailyTokens: 1500,
      overDailyLimit: true,
    });
  });

  it('用户详情返回按天序列', async () => {
    const { service, prisma } = makeService();
    prisma.aiUsageDaily.findMany.mockResolvedValue([
      {
        date: new Date('2026-11-20T00:00:00Z'),
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        requests: 1,
      },
    ]);

    const result = await service.userDetail('u1');

    expect((result.user as any).phone).toBe('138****8000');
    expect(result.daily[0]).toMatchObject({
      date: '2026-11-20',
      totalTokens: 15,
    });
  });
});
