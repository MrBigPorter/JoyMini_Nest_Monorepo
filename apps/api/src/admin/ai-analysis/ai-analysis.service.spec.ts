import { BadRequestException, ConflictException } from '@nestjs/common';
import { AiAnalysisService } from './ai-analysis.service';

function makeService() {
  const prisma = {
    aiAnalysisRun: {
      upsert: jest.fn().mockResolvedValue({ id: 'run-1' }),
      update: jest
        .fn()
        .mockResolvedValue({ id: 'run-1', status: 'COMPLETED' }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    aiAnswerFeedback: { findMany: jest.fn().mockResolvedValue([]) },
    aiTrace: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    aiSecurityEvent: { findMany: jest.fn().mockResolvedValue([]) },
    aiEvalResult: { findMany: jest.fn().mockResolvedValue([]) },
    conversation: { count: jest.fn().mockResolvedValue(0) },
    aiMetricWindow: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aiProblemEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aiProblemCluster: {
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    aiProblemClusterDay: {
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aiAnalysisAlert: {
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    ),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  };
  const locks = {
    runWithLock: jest.fn(
      async (
        _key: string,
        _ttl: number,
        callback: () => Promise<unknown>,
      ) => callback(),
    ),
  };
  const ai = { generateEmbedding: jest.fn().mockResolvedValue(null) };
  return {
    prisma,
    locks,
    ai,
    evalDatasets: { addCases: jest.fn() },
    service: new AiAnalysisService(
      prisma as any,
      locks as any,
      { addCases: jest.fn() } as any,
      ai as any,
    ),
  };
}

const DAY = new Date('2026-11-20T00:00:00.000Z');

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    type: 'ZERO_HIT',
    intent: null,
    domain: null,
    severity: 1,
    occurredAt: new Date('2026-11-20T01:00:00.000Z'),
    metadata: { questionPreview: 'Where is my order?' },
    clusterId: null,
    ...overrides,
  };
}

describe('AiAnalysisService', () => {
  it('runWindow 通过 Redis 锁执行并写指标', async () => {
    const { service, prisma, locks } = makeService();

    const result = await service.runWindow('2026-11-20', 'admin-1');

    expect(locks.runWithLock).toHaveBeenCalledWith(
      expect.stringContaining('2026-11-20'),
      30 * 60 * 1000,
      expect.any(Function),
      true,
    );
    expect(prisma.aiAnalysisRun.upsert).toHaveBeenCalled();
    expect(prisma.aiMetricWindow.createMany).toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'COMPLETED' });
  });

  it('锁被占用时返回 409', async () => {
    const { service, locks } = makeService();
    locks.runWithLock.mockRejectedValueOnce(new Error('Lock busy: key'));

    await expect(service.runWindow('2026-11-20')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('非法日期直接 400', async () => {
    const { service, locks } = makeService();

    await expect(service.runWindow('2026-13-99')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(locks.runWithLock).not.toHaveBeenCalled();
  });

  it('embedding 为 null 时回退到 signature 精确聚类', async () => {
    const { service, prisma, ai } = makeService();
    prisma.aiProblemEvent.findMany.mockResolvedValue([eventRow()]);
    prisma.aiProblemCluster.upsert.mockResolvedValue({ id: 'cluster-1' });
    prisma.aiProblemEvent.count.mockResolvedValue(1);
    ai.generateEmbedding.mockResolvedValue(null);

    const created = await (service as any).clusterWindow(DAY);

    expect(created).toBe(1);
    expect(ai.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.aiProblemCluster.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { signature: expect.any(String) } }),
    );
    expect(prisma.aiProblemEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-1'] } },
      data: { clusterId: 'cluster-1' },
    });
  });

  it('最近簇距离低于阈值时合并并保留目标簇代表问题', async () => {
    const { service, prisma, ai } = makeService();
    prisma.aiProblemEvent.findMany.mockResolvedValue([eventRow()]);
    prisma.aiProblemEvent.count.mockResolvedValue(2);
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        id: 'cluster-existing',
        distance: 0.05,
        severity: 3,
        last_seen_at: new Date('2026-11-19T00:00:00.000Z'),
      },
    ]);
    ai.generateEmbedding.mockResolvedValue(Array(1024).fill(0.01));

    await (service as any).clusterWindow(DAY);

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('<=> $1::vector'),
      expect.stringMatching(/^\[/),
    );
    expect(prisma.aiProblemCluster.upsert).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    const mergeCall = prisma.aiProblemCluster.update.mock.calls.find(
      ([arg]: any[]) => arg.where.id === 'cluster-existing',
    );
    expect(mergeCall?.[0].data).not.toHaveProperty('representativeText');
    expect(prisma.aiProblemEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-1'] } },
      data: { clusterId: 'cluster-existing' },
    });
    expect(prisma.aiProblemClusterDay.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clusterId_day: { clusterId: 'cluster-existing', day: DAY },
        },
        update: { count: 2 },
      }),
    );
  });

  it('重跑同一窗口时计数从事件重算，不累加', async () => {
    const { service, prisma, ai } = makeService();
    prisma.aiProblemEvent.findMany.mockResolvedValue([eventRow()]);
    prisma.aiProblemCluster.upsert.mockResolvedValue({ id: 'cluster-1' });
    prisma.aiProblemEvent.count.mockResolvedValue(2);
    ai.generateEmbedding.mockResolvedValue(null);

    await (service as any).clusterWindow(DAY);
    await (service as any).clusterWindow(DAY);

    const counts = prisma.aiProblemCluster.update.mock.calls
      .map(([arg]: any[]) => arg?.data?.count)
      .filter((value: unknown) => value !== undefined);
    expect(counts).toEqual([2, 2]);
  });
});
