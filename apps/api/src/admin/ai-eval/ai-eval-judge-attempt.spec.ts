import { NotFoundException } from '@nestjs/common';
import {
  AiEvalJudgeAttemptService,
  DEFAULT_JUDGE_ATTEMPT_RETENTION_DAYS,
} from './ai-eval-judge-attempt.service';
import { AiEvalJudgeAttemptRetentionTask } from './ai-eval-judge-attempt-retention.task';

/**
 * 判官留痕的读侧与保留期：
 * - 读接口只允许管理员，返回前再脱敏一次（旧行可能是脱敏上线前写的）；
 * - 保留期按天可配，0 表示不清理；
 * - 清理按批删除，抢不到锁静默跳过，单次失败只记日志。
 */

const NOW = new Date('2026-11-26T04:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

type AttemptRow = {
  id: string;
  runId: string;
  caseId: string | null;
  attemptIndex: number;
  outcome: string;
  verdict: string | null;
  score: number | null;
  errorKind: string | null;
  rawOutput: string | null;
  rawTruncated: boolean;
  judgeVersion: string | null;
  judgeInputHash: string | null;
  createdAt: Date;
};

function attempt(overrides: Partial<AttemptRow>): AttemptRow {
  return {
    id: 'attempt-1',
    runId: 'run-1',
    caseId: 'case-1',
    attemptIndex: 0,
    outcome: 'success',
    verdict: 'faithful',
    score: 1,
    errorKind: null,
    rawOutput: null,
    rawTruncated: false,
    judgeVersion: 'strict-v1',
    judgeInputHash: null,
    createdAt: NOW,
    ...overrides,
  };
}

function matchesWhere(row: AttemptRow, where: any): boolean {
  if (!where) return true;
  if (where.runId && row.runId !== where.runId) return false;
  if (where.caseId && row.caseId !== where.caseId) return false;
  if (
    where.createdAt?.lt &&
    row.createdAt.getTime() >= where.createdAt.lt.getTime()
  ) {
    return false;
  }
  return true;
}

function makePrisma(rows: AttemptRow[] = []) {
  const prisma: any = {
    aiEvalRun: { findUnique: jest.fn().mockResolvedValue({ id: 'run-1' }) },
    aiEvalJudgeAttempt: {
      count: jest.fn((args: any) =>
        Promise.resolve(rows.filter((row) => matchesWhere(row, args.where)).length),
      ),
      findMany: jest.fn((args: any) => {
        const matched = rows.filter((row) => matchesWhere(row, args.where));
        const skip = args.skip ?? 0;
        const take = args.take ?? matched.length;
        return Promise.resolve(matched.slice(skip, skip + take));
      }),
      deleteMany: jest.fn((args: any) => {
        const ids: string[] = args?.where?.id?.in ?? [];
        let deleted = 0;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (ids.includes(rows[i].id)) {
            rows.splice(i, 1);
            deleted += 1;
          }
        }
        return Promise.resolve({ count: deleted });
      }),
    },
  };
  return { prisma, rows };
}

describe('AiEvalJudgeAttemptService.list', () => {
  it('按运行分页读取，并在返回前再次脱敏原始输出', async () => {
    const { prisma } = makePrisma([
      attempt({ rawOutput: '联系 13800000000' }),
    ]);
    const service = new AiEvalJudgeAttemptService(prisma);

    const page = await service.list('run-1', {
      page: 1,
      pageSize: 10,
      caseId: 'case-1',
    });

    expect(prisma.aiEvalJudgeAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1', caseId: 'case-1' },
        skip: 0,
        take: 10,
      }),
    );
    expect(page).toMatchObject({
      runId: 'run-1',
      page: 1,
      pageSize: 10,
      total: 1,
    });
    // 旧行可能是在统一脱敏上线前写入的：读侧再抹一次，不能只信落库时。
    expect(page.items[0].rawOutput).toBe('联系 138****0000');
    expect(page.items[0].rawTruncated).toBe(false);
  });

  it('缺省分页参数时用默认页大小，且不带 caseId 过滤', async () => {
    const { prisma } = makePrisma([attempt({}), attempt({ id: 'attempt-2' })]);
    const service = new AiEvalJudgeAttemptService(prisma);

    const page = await service.list('run-1', { page: 3 });

    // 第 3 页、默认页大小 50 → 跳过前 100 条；没有 caseId 时不加过滤。
    expect(prisma.aiEvalJudgeAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1' },
        skip: 100,
        take: 50,
      }),
    );
    expect(page).toMatchObject({ page: 3, pageSize: 50, total: 2 });
  });

  it('运行不存在时 404，不返回空页冒充「没有尝试」', async () => {
    const { prisma } = makePrisma();
    prisma.aiEvalRun.findUnique.mockResolvedValue(null);
    const service = new AiEvalJudgeAttemptService(prisma);

    await expect(service.list('missing', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.aiEvalJudgeAttempt.findMany).not.toHaveBeenCalled();
  });
});

describe('AiEvalJudgeAttemptService.purgeExpired', () => {
  const originalRetention = process.env.AI_EVAL_JUDGE_ATTEMPT_RETENTION_DAYS;

  afterEach(() => {
    if (originalRetention === undefined) {
      delete process.env.AI_EVAL_JUDGE_ATTEMPT_RETENTION_DAYS;
    } else {
      process.env.AI_EVAL_JUDGE_ATTEMPT_RETENTION_DAYS = originalRetention;
    }
  });

  it('只删保留期之前的行，未过期的保留', async () => {
    const expired = attempt({
      id: 'old',
      createdAt: new Date(NOW.getTime() - 31 * DAY),
    });
    const fresh = attempt({
      id: 'new',
      createdAt: new Date(NOW.getTime() - 29 * DAY),
    });
    const { prisma, rows } = makePrisma([expired, fresh]);
    const service = new AiEvalJudgeAttemptService(prisma);

    const result = await service.purgeExpired({ now: NOW });

    expect(result.deleted).toBe(1);
    expect(rows.map((row) => row.id)).toEqual(['new']);
    expect(result.cutoff).toEqual(
      new Date(NOW.getTime() - DEFAULT_JUDGE_ATTEMPT_RETENTION_DAYS * DAY),
    );
  });

  it('按批删除：一次取不完就继续下一批', async () => {
    const rows = [0, 1, 2].map((i) =>
      attempt({
        id: `old-${i}`,
        createdAt: new Date(NOW.getTime() - 40 * DAY),
      }),
    );
    const { prisma, rows: table } = makePrisma(rows);
    const service = new AiEvalJudgeAttemptService(prisma);

    const result = await service.purgeExpired({ now: NOW, batchSize: 2 });

    expect(result.deleted).toBe(3);
    expect(table).toHaveLength(0);
    // 2 条 → 1 条 → 0 条：分批而不是一次删全表。
    expect(prisma.aiEvalJudgeAttempt.deleteMany).toHaveBeenCalledTimes(2);
    for (const [args] of prisma.aiEvalJudgeAttempt.deleteMany.mock.calls) {
      expect(args.where.id.in.length).toBeLessThanOrEqual(2);
    }
  });

  it('保留期可配：环境变量收紧到 7 天后更早的行被清掉', async () => {
    process.env.AI_EVAL_JUDGE_ATTEMPT_RETENTION_DAYS = '7';
    const eightDays = attempt({
      id: 'eight',
      createdAt: new Date(NOW.getTime() - 8 * DAY),
    });
    const twoDays = attempt({
      id: 'two',
      createdAt: new Date(NOW.getTime() - 2 * DAY),
    });
    const { prisma, rows } = makePrisma([eightDays, twoDays]);
    const service = new AiEvalJudgeAttemptService(prisma);

    await service.purgeExpired({ now: NOW });

    expect(rows.map((row) => row.id)).toEqual(['two']);
  });

  it('保留期配 0 表示不清理：不查也不删', async () => {
    process.env.AI_EVAL_JUDGE_ATTEMPT_RETENTION_DAYS = '0';
    const { prisma } = makePrisma([
      attempt({ id: 'old', createdAt: new Date(NOW.getTime() - 400 * DAY) }),
    ]);
    const service = new AiEvalJudgeAttemptService(prisma);

    const result = await service.purgeExpired({ now: NOW });

    expect(result).toEqual({ deleted: 0, cutoff: null });
    expect(prisma.aiEvalJudgeAttempt.deleteMany).not.toHaveBeenCalled();
  });
});

describe('AiEvalJudgeAttemptRetentionTask', () => {
  it('用 Redis 锁跑一次清理，抢不到锁时不执行也不报错', async () => {
    const lockService = {
      // runWithLock 抢锁失败时返回 null，且不调用回调（与真实实现一致）。
      runWithLock: jest.fn().mockResolvedValue(null),
    };
    const attemptService = {
      purgeExpired: jest.fn().mockResolvedValue({ deleted: 2, cutoff: NOW }),
    };
    const task = new AiEvalJudgeAttemptRetentionTask(
      lockService as any,
      attemptService as any,
    );

    await expect(task.purge()).resolves.toBeUndefined();

    expect(lockService.runWithLock).toHaveBeenCalledWith(
      'cron:ai_eval_judge_attempt_purge',
      expect.any(Number),
      expect.any(Function),
      false,
    );
    expect(attemptService.purgeExpired).not.toHaveBeenCalled();
  });

  it('抢到锁时执行清理', async () => {
    const lockService = {
      runWithLock: jest.fn(async (_key, _ttl, cb, throwOnFail) => {
        expect(throwOnFail).toBe(false);
        return cb();
      }),
    };
    const attemptService = {
      purgeExpired: jest.fn().mockResolvedValue({ deleted: 2, cutoff: NOW }),
    };
    const task = new AiEvalJudgeAttemptRetentionTask(
      lockService as any,
      attemptService as any,
    );

    await task.purge();

    expect(attemptService.purgeExpired).toHaveBeenCalledTimes(1);
  });

  it('清理异常不外抛（单次失败不能打断后续调度）', async () => {
    const lockService = {
      runWithLock: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const attemptService = { purgeExpired: jest.fn() };
    const task = new AiEvalJudgeAttemptRetentionTask(
      lockService as any,
      attemptService as any,
    );

    await expect(task.purge()).resolves.toBeUndefined();
  });
});
