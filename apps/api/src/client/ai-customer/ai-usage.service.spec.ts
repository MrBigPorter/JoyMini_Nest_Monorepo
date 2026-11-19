import { AiUsageService, QuotaExceededError } from './ai-usage.service';

describe('AiUsageService', () => {
  let prisma: {
    aiUsageDaily: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let service: AiUsageService;

  beforeEach(() => {
    prisma = {
      aiUsageDaily: {
        upsert: jest.fn().mockResolvedValue(undefined),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    service = new AiUsageService(prisma as any);
    delete process.env.AI_DAILY_TOKEN_LIMIT;
  });

  afterEach(() => {
    delete process.env.AI_DAILY_TOKEN_LIMIT;
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
});
