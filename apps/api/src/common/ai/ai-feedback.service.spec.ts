import { ConflictException } from '@nestjs/common';
import { AiFeedbackService } from './ai-feedback.service';

function createService() {
  const prisma: any = {
    aiScore: { create: jest.fn().mockResolvedValue({ id: 'score-1' }) },
    aiAnswerFeedback: {
      create: jest.fn().mockResolvedValue({ id: 'fb-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({
        id: 'fb-1',
        conversationId: 'c1',
        messageId: 'ai-1',
        traceId: null,
        verdict: null,
        failureKind: null,
        resolution: null,
        reviewStatus: 'PENDING',
        ownerAdminId: null,
        claimedBy: null,
        claimedAt: null,
        note: null,
        version: 0,
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({
        id: 'fb-1',
        conversationId: 'c1',
        messageId: 'ai-1',
        traceId: null,
        verdict: null,
        failureKind: null,
        resolution: null,
        note: null,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    aiTrace: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    conversation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    chatMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  // 交互式事务：测试里 tx 就是同一个 mock，断言仍落在 prisma 上。
  prisma.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  );
  return { prisma, service: new AiFeedbackService(prisma as any) };
}

/** 统计所有 Prisma mock 方法被调用的总次数（含 $transaction/$queryRaw）。 */
function prismaCallCount(prisma: any): number {
  let total = 0;
  for (const value of Object.values(prisma)) {
    if (typeof value === 'function') {
      total += (value as jest.Mock).mock?.calls.length ?? 0;
      continue;
    }
    if (value && typeof value === 'object') {
      for (const inner of Object.values(value as Record<string, unknown>)) {
        if (typeof inner === 'function') {
          total += (inner as jest.Mock).mock?.calls.length ?? 0;
        }
      }
    }
  }
  return total;
}

describe('AiFeedbackService（ai-quality-loop 4.x）', () => {
  it('显式反馈：verdict=correct 时不写 errorType', async () => {
    const { service, prisma } = createService();

    await service.recordExplicit({
      conversationId: 'c1',
      verdict: 'correct',
      errorType: 'irrelevant',
      adminId: 'admin-1',
    });

    expect(prisma.aiAnswerFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'c1',
          source: 'explicit',
          verdict: 'correct',
          errorType: null,
          adminId: 'admin-1',
        }),
      }),
    );
  });

  it('显式反馈：incorrect 保留错误类型', async () => {
    const { service, prisma } = createService();

    await service.recordExplicit({
      conversationId: 'c1',
      verdict: 'incorrect',
      errorType: 'outdated',
    });

    expect(prisma.aiAnswerFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorType: 'outdated' }),
      }),
    );
  });

  it('隐式反馈：10 分钟窗口内同 signal 去重', async () => {
    const { service, prisma } = createService();
    prisma.aiAnswerFeedback.findFirst.mockResolvedValue({ id: 'existing' });

    await service.recordImplicit({
      conversationId: 'c1',
      signal: 'transferred',
    });

    expect(prisma.aiAnswerFeedback.create).not.toHaveBeenCalled();
  });

  it('隐式反馈：无重复时写入 source=implicit', async () => {
    const { service, prisma } = createService();

    await service.recordImplicit({
      conversationId: 'c1',
      signal: 'transferred',
      metadata: { reason: 'explicit_request' },
    });

    expect(prisma.aiAnswerFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'implicit',
          signal: 'transferred',
        }),
      }),
    );
  });

  it('重复追问：相似度高时写入 repeated_question', async () => {
    const { service, prisma } = createService();
    prisma.chatMessage.findMany.mockResolvedValue([
      { id: 'm-prev', content: '我的订单到哪了' },
    ]);

    await service.recordRepeatedQuestionIfAny(
      'c1',
      'u1',
      'm-current',
      '我的订单到哪里了',
    );

    expect(prisma.aiAnswerFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ signal: 'repeated_question' }),
      }),
    );
  });

  it('重复追问：正常换话题不写信号', async () => {
    const { service, prisma } = createService();
    prisma.chatMessage.findMany.mockResolvedValue([
      { id: 'm-prev', content: '我的订单到哪了' },
    ]);

    await service.recordRepeatedQuestionIfAny(
      'c1',
      'u1',
      'm-current',
      '帮我查一下优惠券',
    );

    expect(prisma.aiAnswerFeedback.create).not.toHaveBeenCalled();
  });

  it('列表：显式反馈回查用户问题与被评价的 AI 回答', async () => {
    const { service, prisma } = createService();
    prisma.aiAnswerFeedback.findMany.mockResolvedValue([
      {
        id: 'fb-1',
        conversationId: 'c1',
        messageId: 'ai-1',
        input: '我的钱包余额是多少？',
        source: 'explicit',
        createdAt: new Date('2026-11-20T12:00:00Z'),
      },
    ]);
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        feedbackId: 'fb-1',
        linkedContent: '你的余额是 ₱0.00',
        linkedSource: 'ai',
        linkedSeqId: 2,
        explicitUserContent: null,
        implicitUserContent: null,
        implicitAiContent: null,
      },
    ]);

    const result = await service.list({ page: 1, pageSize: 20 });

    expect(result.list[0]).toEqual(
      expect.objectContaining({
        input: '我的钱包余额是多少？',
        answer: '你的余额是 ₱0.00',
      }),
    );
  });

  it('列表：隐式反馈补最近一条用户问题和 AI 回答', async () => {
    const { service, prisma } = createService();
    prisma.aiAnswerFeedback.findMany.mockResolvedValue([
      {
        id: 'fb-2',
        conversationId: 'c1',
        messageId: null,
        input: null,
        source: 'implicit',
        createdAt: new Date('2026-11-20T12:00:00Z'),
      },
    ]);
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        feedbackId: 'fb-2',
        linkedContent: null,
        linkedSource: null,
        linkedSeqId: null,
        explicitUserContent: null,
        implicitUserContent: '帮我查订单',
        implicitAiContent: '你还没有订单',
      },
    ]);

    const result = await service.list({ page: 1, pageSize: 20 });

    expect(result.list[0]).toEqual(
      expect.objectContaining({
        input: '帮我查订单',
        answer: '你还没有订单',
      }),
    );
  });

  it('列表上下文：Prisma 调用次数与页大小无关且 ≤5', async () => {
    const { service, prisma } = createService();
    const rowsFor = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `fb-${index}`,
        conversationId: `c-${index}`,
        messageId: null,
        input: null,
        source: 'implicit',
        createdAt: new Date('2026-11-20T12:00:00Z'),
      }));

    prisma.aiAnswerFeedback.findMany.mockResolvedValueOnce(rowsFor(10));
    let before = prismaCallCount(prisma);
    await service.list({ page: 1, pageSize: 10 });
    const tenRowsCalls = prismaCallCount(prisma) - before;

    prisma.aiAnswerFeedback.findMany.mockResolvedValueOnce(rowsFor(100));
    before = prismaCallCount(prisma);
    await service.list({ page: 1, pageSize: 100 });
    const hundredRowsCalls = prismaCallCount(prisma) - before;

    expect(tenRowsCalls).toBeLessThanOrEqual(5);
    expect(hundredRowsCalls).toBe(tenRowsCalls);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('summary 返回待处理与归因分布', async () => {
    const { service, prisma } = createService();
    prisma.aiAnswerFeedback.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4);
    prisma.aiAnswerFeedback.groupBy
      .mockResolvedValueOnce([{ failureKind: 'MODEL_ERROR', _count: { id: 2 } }])
      .mockResolvedValueOnce([{ resolution: 'OPEN', _count: { id: 4 } }])
      .mockResolvedValueOnce([{ reviewStatus: 'PENDING', _count: { id: 4 } }]);

    const result = await service.summary();

    expect(result.total).toBe(10);
    expect(result.pending).toBe(4);
    expect(result.byFailureKind[0]).toEqual({
      failureKind: 'MODEL_ERROR',
      count: 2,
    });
    expect(result.byReviewStatus[0]).toEqual({
      status: 'PENDING',
      count: 4,
    });
  });

  it('反馈写入时回链最近一条 trace', async () => {
    const { service, prisma } = createService();
    prisma.aiTrace.findFirst.mockResolvedValueOnce({ id: 'trace-1' });

    await service.recordExplicit({ conversationId: 'c1', verdict: 'incorrect' });

    expect(prisma.aiAnswerFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ traceId: 'trace-1' }),
      }),
    );
  });

  it('显式反馈 correct：自动 NO_ISSUE + REVIEWED', async () => {
    const { service, prisma } = createService();

    await service.recordExplicit({ conversationId: 'c1', verdict: 'correct' });

    expect(prisma.aiAnswerFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureKind: null,
          resolution: 'NO_ISSUE',
          reviewStatus: 'REVIEWED',
        }),
      }),
    );
  });

  it('显式反馈 incorrect：自动 MODEL_ERROR + OPEN', async () => {
    const { service, prisma } = createService();

    await service.recordExplicit({ conversationId: 'c1', verdict: 'incorrect' });

    expect(prisma.aiAnswerFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureKind: 'MODEL_ERROR',
          resolution: 'OPEN',
          reviewStatus: 'PENDING',
        }),
      }),
    );
  });

  it('隐式反馈 ai_error：自动 SERVICE_ERROR', async () => {
    const { service, prisma } = createService();

    await service.recordImplicit({
      conversationId: 'c1',
      signal: 'transferred',
      metadata: { reason: 'ai_error' },
    });

    expect(prisma.aiAnswerFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureKind: 'SERVICE_ERROR',
          resolution: 'OPEN',
        }),
      }),
    );
  });

  it('隐式反馈 explicit_request：自动排除，不打扰运营', async () => {
    const { service, prisma } = createService();

    await service.recordImplicit({
      conversationId: 'c1',
      signal: 'transferred',
      metadata: { reason: 'explicit_request' },
    });

    expect(prisma.aiAnswerFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureKind: 'EXPECTED_TRANSFER',
          resolution: 'EXCLUDED',
          reviewStatus: 'IGNORED',
        }),
      }),
    );
  });

  it('summary 支持 UTC 日期窗与 actionable pending', async () => {
    const { service, prisma } = createService();
    prisma.aiAnswerFeedback.count.mockResolvedValue(1);
    prisma.aiAnswerFeedback.groupBy.mockResolvedValue([]);

    await service.summary({ from: '2026-11-21', to: '2026-11-21' });

    const firstWhere = prisma.aiAnswerFeedback.count.mock.calls[0][0].where;
    expect(firstWhere.createdAt.gte).toEqual(
      new Date('2026-11-21T00:00:00.000Z'),
    );
    expect(firstWhere.createdAt.lte).toEqual(
      new Date('2026-11-21T23:59:59.999Z'),
    );

    const pendingWhere = prisma.aiAnswerFeedback.count.mock.calls[1][0].where;
    expect(pendingWhere.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resolution: 'OPEN' }),
      ]),
    );
  });

  it('updateTriage correct：写 NO_ISSUE 并清空 failureKind', async () => {
    const { service, prisma } = createService();
    prisma.aiAnswerFeedback.findUnique.mockResolvedValueOnce({
      verdict: null,
      failureKind: 'MODEL_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
      version: 0,
    });

    await service.updateTriage('fb-1', { verdict: 'correct' }, 'admin-1');

    expect(prisma.aiAnswerFeedback.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fb-1', version: 0 },
        data: expect.objectContaining({
          resolution: 'NO_ISSUE',
          reviewStatus: 'REVIEWED',
          failureKind: null,
          verdict: 'correct',
          reviewedBy: 'admin-1',
        }),
      }),
    );
    expect(prisma.aiScore.create).toHaveBeenCalledTimes(1);
  });

  it('updateTriage 只改备注：不重复写 score、不写 reviewedBy', async () => {
    const { service, prisma } = createService();

    await service.updateTriage('fb-1', { note: '补充说明' }, 'admin-1');

    const data = prisma.aiAnswerFeedback.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('reviewedBy');
    expect(data).not.toHaveProperty('reviewStatus');
    expect(prisma.aiScore.create).not.toHaveBeenCalled();
  });

  it('updateTriage 只给 reviewStatus：同时派生 resolution', async () => {
    const { service, prisma } = createService();
    prisma.aiAnswerFeedback.findUnique.mockResolvedValueOnce({
      verdict: null,
      failureKind: null,
      resolution: null,
      reviewStatus: 'PENDING',
      version: 0,
    });

    await service.updateTriage('fb-1', { reviewStatus: 'IGNORED' }, 'admin-1');

    expect(prisma.aiAnswerFeedback.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fb-1', version: 0 },
        data: expect.objectContaining({
          reviewStatus: 'IGNORED',
          resolution: 'EXCLUDED',
        }),
      }),
    );
  });

  it('updateTriage 用 resolution 双写 reviewStatus', async () => {
    const { service, prisma } = createService();

    await service.updateTriage('fb-1', {
      resolution: 'CONFIRMED',
      failureKind: 'MODEL_ERROR',
      note: '答非所问',
    }, 'admin-1');

    expect(prisma.aiAnswerFeedback.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fb-1', version: 0 },
        data: expect.objectContaining({
          reviewStatus: 'REVIEWED',
          resolution: 'CONFIRMED',
          failureKind: 'MODEL_ERROR',
          reviewedBy: 'admin-1',
        }),
      }),
    );
  });

  describe('updateTriage 并发、回滚与认领', () => {
    it('expectedVersion 过期：返回 409 且不写库', async () => {
      const { service, prisma } = createService();
      prisma.aiAnswerFeedback.findUnique.mockResolvedValueOnce({
        id: 'fb-1',
        verdict: null,
        failureKind: null,
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        version: 3,
      });

      await expect(
        service.updateTriage(
          'fb-1',
          { verdict: 'correct', expectedVersion: 2 },
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.aiAnswerFeedback.updateMany).not.toHaveBeenCalled();
    });

    it('并发提交：版本条件更新 count=0 时返回 409', async () => {
      const { service, prisma } = createService();
      prisma.aiAnswerFeedback.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.updateTriage('fb-1', { verdict: 'correct' }, 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.aiScore.create).not.toHaveBeenCalled();
    });

    it('评分写入失败：整个分诊回滚并抛出，不吞错', async () => {
      // 用内存行 + 快照模拟交互式事务：throw 时恢复行。
      let row: Record<string, any> = {
        id: 'fb-1',
        conversationId: 'c1',
        messageId: 'ai-1',
        traceId: null,
        verdict: null,
        failureKind: 'MODEL_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        ownerAdminId: null,
        claimedBy: null,
        claimedAt: null,
        note: null,
        version: 0,
      };
      const tx = {
        aiAnswerFeedback: {
          findUnique: jest.fn(async () => ({ ...row })),
          updateMany: jest.fn(async ({ where, data }: any) => {
            if (where.version !== row.version) return { count: 0 };
            const next = { ...row, ...data };
            if (data.version?.increment) {
              next.version = row.version + data.version.increment;
            }
            row = next;
            return { count: 1 };
          }),
        },
        aiScore: {
          create: jest.fn(async () => {
            throw new Error('score store down');
          }),
        },
      };
      const prisma = {
        ...tx,
        $transaction: jest.fn(async (fn: any) => {
          const snapshot = { ...row };
          try {
            return await fn(tx);
          } catch (err) {
            row = snapshot;
            throw err;
          }
        }),
      };
      const service = new AiFeedbackService(prisma as any);

      await expect(
        service.updateTriage('fb-1', { verdict: 'correct' }, 'admin-1'),
      ).rejects.toThrow('score store down');
      expect(row.verdict).toBeNull();
      expect(row.reviewStatus).toBe('PENDING');
      expect(row.version).toBe(0);
    });

    it('认领：写 claimedBy/claimedAt，不写 reviewedBy，也不改处理状态', async () => {
      const { service, prisma } = createService();

      await service.updateTriage(
        'fb-1',
        { ownerAdminId: 'admin-1' },
        'admin-1',
      );

      const call = prisma.aiAnswerFeedback.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'fb-1', version: 0 });
      expect(call.data).toMatchObject({
        ownerAdminId: 'admin-1',
        claimedBy: 'admin-1',
        version: { increment: 1 },
      });
      expect(call.data.claimedAt).toBeInstanceOf(Date);
      expect(call.data).not.toHaveProperty('reviewedBy');
      expect(call.data).not.toHaveProperty('reviewStatus');
      expect(prisma.aiScore.create).not.toHaveBeenCalled();
    });

    it('两人同时认领：只有一个成功，另一个 409', async () => {
      // 内存行 + CAS：模拟两个事务同时读同一版本，只有一个条件更新能命中。
      let row: Record<string, any> = {
        id: 'fb-1',
        conversationId: 'c1',
        messageId: 'ai-1',
        traceId: null,
        verdict: null,
        failureKind: null,
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        ownerAdminId: null,
        claimedBy: null,
        claimedAt: null,
        note: null,
        version: 0,
      };
      const tx = {
        aiAnswerFeedback: {
          findUnique: jest.fn(async () => ({ ...row })),
          updateMany: jest.fn(async ({ where, data }: any) => {
            if (where.version !== row.version) return { count: 0 };
            const next = { ...row, ...data };
            if (data.version?.increment) {
              next.version = row.version + data.version.increment;
            }
            row = next;
            return { count: 1 };
          }),
        },
        aiScore: { create: jest.fn() },
      };
      const prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) };
      const service = new AiFeedbackService(prisma as any);

      const results = await Promise.allSettled([
        service.updateTriage('fb-1', { ownerAdminId: 'admin-1' }, 'admin-1'),
        service.updateTriage('fb-1', { ownerAdminId: 'admin-2' }, 'admin-2'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictException,
      );
      expect(row.version).toBe(1);
      expect(['admin-1', 'admin-2']).toContain(row.claimedBy);
    });

    it('已被他人认领：无 takeOver 返回 409，takeOver=true 才覆盖', async () => {
      const { service, prisma } = createService();
      prisma.aiAnswerFeedback.findUnique.mockResolvedValue({
        id: 'fb-1',
        verdict: null,
        failureKind: null,
        resolution: null,
        reviewStatus: 'PENDING',
        ownerAdminId: 'admin-1',
        claimedBy: 'admin-1',
        version: 1,
      });

      await expect(
        service.updateTriage(
          'fb-1',
          { ownerAdminId: 'admin-2' },
          'admin-2',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.aiAnswerFeedback.updateMany).not.toHaveBeenCalled();

      await service.updateTriage(
        'fb-1',
        { ownerAdminId: 'admin-2', takeOver: true },
        'admin-2',
      );
      expect(prisma.aiAnswerFeedback.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ claimedBy: 'admin-2' }),
        }),
      );
    });
  });
});
