import {
  AiEvalDatasetService,
  EXTERNAL_RUN_STALE_MS,
  INTERNAL_RUN_STALE_MS,
} from './ai-eval-dataset.service';
import { AiEvalRunSweepTask } from './ai-eval-run-sweep.task';

/**
 * 运行存活只由心跳判定：
 * - 心跳还在推进（哪怕 startedAt 很旧）→ 不能杀
 * - 心跳超阈值（worker 被杀，进程内节流表随进程消失）→ FAILED
 * - EXTERNAL run 由 harness 跑几小时，用 24h 阈值单独分支
 * 读接口（listDatasets/getDataset/getRun）不得触发清扫：GET 不应有副作用。
 */

const NOW = new Date('2026-11-25T12:00:00.000Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

type FakeRun = {
  id: string;
  status: string;
  mode: string;
  startedAt: Date;
  heartbeatAt: Date | null;
  finishedAt?: Date | null;
  summary?: Record<string, any> | null;
};

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

/** 只实现本用例用到的 where 语义；其余字段命中即忽略。 */
function matchesWhere(row: FakeRun, where: any): boolean {
  if (where.status && row.status !== where.status) return false;
  if (where.mode?.not && row.mode === where.mode.not) return false;
  if (typeof where.mode === 'string' && row.mode !== where.mode) return false;
  if (where.startedAt?.lt && row.startedAt.getTime() >= where.startedAt.lt.getTime()) {
    return false;
  }
  if (where.heartbeatAt?.lt) {
    if (!row.heartbeatAt) return false;
    if (row.heartbeatAt.getTime() >= where.heartbeatAt.lt.getTime()) return false;
  }
  if (Array.isArray(where.OR)) {
    const hit = where.OR.some((clause: any) => {
      if ('heartbeatAt' in clause && clause.heartbeatAt === null) {
        if (row.heartbeatAt !== null) return false;
        return (
          !clause.startedAt?.lt ||
          row.startedAt.getTime() < clause.startedAt.lt.getTime()
        );
      }
      if (clause.heartbeatAt?.lt) {
        return (
          !!row.heartbeatAt &&
          row.heartbeatAt.getTime() < clause.heartbeatAt.lt.getTime()
        );
      }
      return false;
    });
    if (!hit) return false;
  }
  return true;
}

function makeService(rows: FakeRun[]) {
  const prisma: any = {
    aiEvalRun: {
      updateMany: jest.fn((args: any) => {
        const matched = rows.filter((row) => matchesWhere(row, args.where));
        for (const row of matched) Object.assign(row, args.data);
        return Promise.resolve({ count: matched.length });
      }),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    aiEvalDataset: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    aiEvalResult: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const service = new AiEvalDatasetService(
    prisma,
    { judge: jest.fn() } as any,
    { testChat: jest.fn() } as any,
    { add: jest.fn() } as any,
    { getCurrent: jest.fn() } as any,
  );
  return { service, prisma, rows };
}

function makeRun(overrides: Partial<FakeRun>): FakeRun {
  return {
    id: 'run-1',
    status: 'RUNNING',
    mode: 'STORED',
    startedAt: ago(2 * HOUR),
    heartbeatAt: ago(5 * MINUTE),
    ...overrides,
  };
}

describe('AiEvalDatasetService.sweepStaleRuns', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.AI_EVAL_RUN_STALE_MS;
  });

  it('心跳仍在推进的长跑不会被判死（哪怕 startedAt 已过 2 小时）', async () => {
    const live = makeRun({ id: 'run-live', startedAt: ago(2 * HOUR) });
    const { service } = makeService([live]);

    await service.sweepStaleRuns();

    expect(live.status).toBe('RUNNING');
    expect(live.finishedAt).toBeUndefined();
  });

  it('心跳超阈值转 FAILED；heartbeatAt 为空时回退 startedAt 判定', async () => {
    const dead = makeRun({ id: 'run-dead', heartbeatAt: ago(31 * MINUTE) });
    const neverBeat = makeRun({
      id: 'run-never',
      heartbeatAt: null,
      startedAt: ago(31 * MINUTE),
    });
    const fresh = makeRun({ id: 'run-fresh', startedAt: ago(31 * MINUTE) });
    const { service } = makeService([dead, neverBeat, fresh]);

    await service.sweepStaleRuns();

    expect(dead.status).toBe('FAILED');
    expect(dead.summary).toMatchObject({
      error: expect.stringContaining('stale'),
    });
    expect(neverBeat.status).toBe('FAILED');
    expect(fresh.status).toBe('RUNNING');
  });

  it('EXTERNAL 走 24 小时阈值：2 小时的活跑不杀，25 小时的僵死转 FAILED', async () => {
    const extRecent = makeRun({
      id: 'ext-recent',
      mode: 'EXTERNAL',
      startedAt: ago(2 * HOUR),
      heartbeatAt: ago(2 * HOUR),
    });
    const extDead = makeRun({
      id: 'ext-dead',
      mode: 'EXTERNAL',
      startedAt: ago(25 * HOUR),
      heartbeatAt: ago(25 * HOUR),
    });
    const { service } = makeService([extRecent, extDead]);

    await service.sweepStaleRuns();

    expect(extRecent.status).toBe('RUNNING');
    expect(extDead.status).toBe('FAILED');
  });

  it('AI_EVAL_RUN_STALE_MS 覆盖内部阈值', async () => {
    process.env.AI_EVAL_RUN_STALE_MS = String(5 * MINUTE);
    const stale = makeRun({ heartbeatAt: ago(10 * MINUTE) });
    const { service } = makeService([stale]);

    await service.sweepStaleRuns();

    expect(stale.status).toBe('FAILED');
  });

  it('阈值默认值保持 30 分钟 / 24 小时', () => {
    expect(INTERNAL_RUN_STALE_MS).toBe(30 * MINUTE);
    expect(EXTERNAL_RUN_STALE_MS).toBe(24 * HOUR);
  });
});

describe('读接口不清扫', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => jest.useRealTimers());

  it('listDatasets / getDataset / getRun 都不触发 updateMany', async () => {
    const { service, prisma } = makeService([]);
    prisma.aiEvalDataset.findUnique.mockResolvedValue({
      id: 'ds-1',
      name: 'ds',
      cases: [],
      runs: [],
      _count: { runs: 0, cases: 0 },
    });
    prisma.aiEvalCase = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.aiEvalRun.findUnique.mockResolvedValue({
      id: 'run-1',
      datasetId: 'ds-1',
      results: [],
    });

    await service.listDatasets();
    await service.getDataset('ds-1');
    await service.getRun('run-1');

    expect(prisma.aiEvalRun.updateMany).not.toHaveBeenCalled();
  });
});

describe('AiEvalRunSweepTask', () => {
  it('用 Redis 锁跑一次清扫，抢不到锁时静默跳过', async () => {
    const lockService = {
      runWithLock: jest.fn(async (_key, _ttl, cb, throwOnFail) => {
        expect(throwOnFail).toBe(false);
        return cb();
      }),
    };
    const datasetService = {
      sweepStaleRuns: jest.fn().mockResolvedValue(undefined),
    };
    const task = new AiEvalRunSweepTask(
      lockService as any,
      datasetService as any,
    );

    await task.sweep();

    expect(lockService.runWithLock).toHaveBeenCalledWith(
      'cron:ai_eval_run_sweep',
      expect.any(Number),
      expect.any(Function),
      false,
    );
    expect(datasetService.sweepStaleRuns).toHaveBeenCalledTimes(1);
  });

  it('清扫异常不外抛（cron 单次失败不能打断后续调度）', async () => {
    const lockService = {
      runWithLock: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const datasetService = { sweepStaleRuns: jest.fn() };
    const task = new AiEvalRunSweepTask(
      lockService as any,
      datasetService as any,
    );

    await expect(task.sweep()).resolves.toBeUndefined();
  });
});
