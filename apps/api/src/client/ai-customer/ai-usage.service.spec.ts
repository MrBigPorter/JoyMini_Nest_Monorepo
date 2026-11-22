import {
  AiUsageService,
  QuotaExceededError,
  SessionQuotaExceededError,
  sessionDayKey,
} from './ai-usage.service';

describe('AiUsageService', () => {
  let prisma: {
    aiUsageDaily: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let redis: {
    get: jest.Mock;
    incrBy: jest.Mock;
    expire: jest.Mock;
  };
  let service: AiUsageService;

  beforeEach(() => {
    prisma = {
      aiUsageDaily: {
        upsert: jest.fn().mockResolvedValue(undefined),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      incrBy: jest.fn().mockResolvedValue(0),
      expire: jest.fn().mockResolvedValue(true),
    };
    service = new AiUsageService(prisma as any, redis as any);
    delete process.env.AI_DAILY_TOKEN_LIMIT;
    delete process.env.AI_SESSION_TOKEN_LIMIT;
  });

  afterEach(() => {
    delete process.env.AI_DAILY_TOKEN_LIMIT;
    delete process.env.AI_SESSION_TOKEN_LIMIT;
  });

  it('按用户+UTC 日期累加 token 与请求数', async () => {
    await service.recordUsage('user-1', 10, 20, 1);

    expect(prisma.aiUsageDaily.upsert).toHaveBeenCalledWith({
      where: {
        userId_date: { userId: 'user-1', date: expect.any(Date) },
      },
      create: expect.objectContaining({
        userId: 'user-1',
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        requests: 1,
      }),
      update: {
        promptTokens: { increment: 10 },
        completionTokens: { increment: 20 },
        totalTokens: { increment: 30 },
        requests: { increment: 1 },
      },
    });
  });

  it('全 0 用量不写库', async () => {
    await service.recordUsage('user-1', 0, 0, 0);
    expect(prisma.aiUsageDaily.upsert).not.toHaveBeenCalled();
  });

  it('未超配额时通过', async () => {
    process.env.AI_DAILY_TOKEN_LIMIT = '100';
    prisma.aiUsageDaily.findUnique.mockResolvedValue({ totalTokens: 99 });

    await expect(service.assertWithinQuota('user-1')).resolves.toBeUndefined();
  });

  it('达到日配额时抛 QuotaExceededError', async () => {
    process.env.AI_DAILY_TOKEN_LIMIT = '100';
    prisma.aiUsageDaily.findUnique.mockResolvedValue({ totalTokens: 100 });

    await expect(service.assertWithinQuota('user-1')).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
  });

  it('limit <= 0 时关闭配额，不查库', async () => {
    process.env.AI_DAILY_TOKEN_LIMIT = '0';

    await expect(service.assertWithinQuota('user-1')).resolves.toBeUndefined();
    expect(prisma.aiUsageDaily.findUnique).not.toHaveBeenCalled();
  });

  // ── 会话级配额 ──
  it('会话累计达到阈值 → SessionQuotaExceededError', async () => {
    process.env.AI_SESSION_TOKEN_LIMIT = '1000';
    redis.get.mockResolvedValue('1000');

    await expect(
      service.assertWithinSessionQuota('conv-1'),
    ).rejects.toBeInstanceOf(SessionQuotaExceededError);
    expect(redis.get).toHaveBeenCalledWith(
      `ai:session:tokens:conv-1:${sessionDayKey()}`,
    );
  });

  it('会话级超限不影响日配额判断口径（读的是不同 key）', async () => {
    process.env.AI_SESSION_TOKEN_LIMIT = '1000';
    redis.get.mockResolvedValue('10');

    await expect(
      service.assertWithinSessionQuota('conv-1'),
    ).resolves.toBeUndefined();
    expect(prisma.aiUsageDaily.findUnique).not.toHaveBeenCalled();
  });

  it('没有 conversationId 时跳过会话配额（例如测试对话）', async () => {
    await expect(
      service.assertWithinSessionQuota(undefined),
    ).resolves.toBeUndefined();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('recordSessionUsage 原子累加并按 48h 清理旧日期桶', async () => {
    await service.recordSessionUsage('conv-1', 42);

    expect(redis.incrBy).toHaveBeenCalledWith(
      `ai:session:tokens:conv-1:${sessionDayKey()}`,
      42,
    );
    expect(redis.expire).toHaveBeenCalledWith(
      `ai:session:tokens:conv-1:${sessionDayKey()}`,
      48 * 60 * 60,
    );
  });

  it('跨天使用独立日期桶，不再永久累积', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-11-22T15:00:00Z'));
      const day1 = sessionDayKey();
      jest.setSystemTime(new Date('2026-11-23T15:00:00Z'));
      const day2 = sessionDayKey();
      expect(day1).not.toBe(day2);
      expect(day1).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day2).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      jest.useRealTimers();
    }
  });

  it('Redis 故障不打断对话（recordSessionUsage 吞掉异常）', async () => {
    redis.incrBy.mockRejectedValue(new Error('redis down'));

    await expect(
      service.recordSessionUsage('conv-1', 42),
    ).resolves.toBeUndefined();
  });
});
