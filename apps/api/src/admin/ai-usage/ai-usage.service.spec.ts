import { AiUsageService } from './ai-usage.service';

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
    prisma.aiUsageDaily.groupBy.mockResolvedValue([
      {
        userId: 'u1',
        _sum: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          requests: 2,
        },
      },
    ]);

    const result = await service.users({ page: 1, pageSize: 20 });

    expect(result.list[0]).toMatchObject({
      userId: 'u1',
      nickname: 'Alice',
      phoneMasked: '138****8000',
      totalTokens: 150,
      overDailyLimit: false,
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
