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
  return {
    prisma,
    locks,
    evalDatasets: { addCases: jest.fn() },
    service: new AiAnalysisService(
      prisma as any,
      locks as any,
      { addCases: jest.fn() } as any,
    ),
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
});
