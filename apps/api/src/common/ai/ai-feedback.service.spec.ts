import { AiFeedbackService } from './ai-feedback.service';

function createService() {
  const prisma = {
    aiScore: { create: jest.fn().mockResolvedValue({ id: 'score-1' }) },
    aiAnswerFeedback: {
      create: jest.fn().mockResolvedValue({ id: 'fb-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({
        id: 'fb-1',
        verdict: null,
        failureKind: null,
        resolution: null,
        reviewStatus: 'PENDING',
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
      groupBy: jest.fn().mockResolvedValue([]),
    },
    conversation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    chatMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma, service: new AiFeedbackService(prisma as any) };
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
    prisma.chatMessage.findUnique.mockResolvedValue({
      content: '你的余额是 ₱0.00',
      source: 'ai',
      seqId: 2,
    });

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
    prisma.chatMessage.findFirst
      .mockResolvedValueOnce({ content: '帮我查订单' })
      .mockResolvedValueOnce({ content: '你还没有订单' });

    const result = await service.list({ page: 1, pageSize: 20 });

    expect(result.list[0]).toEqual(
      expect.objectContaining({
        input: '帮我查订单',
        answer: '你还没有订单',
      }),
    );
  });

  it('summary 返回待处理与归因分布', async () => {
    const { service, prisma } = createService();
    prisma.aiAnswerFeedback.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4);
    prisma.aiAnswerFeedback.groupBy
      .mockResolvedValueOnce([{ failureKind: 'MODEL_ERROR', _count: { id: 2 } }])
      .mockResolvedValueOnce([{ resolution: 'OPEN', _count: { id: 4 } }]);

    const result = await service.summary();

    expect(result.total).toBe(10);
    expect(result.pending).toBe(4);
    expect(result.byFailureKind[0]).toEqual({
      failureKind: 'MODEL_ERROR',
      count: 2,
    });
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
    });

    await service.updateTriage('fb-1', { verdict: 'correct' }, 'admin-1');

    expect(prisma.aiAnswerFeedback.update).toHaveBeenCalledWith(
      expect.objectContaining({
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

    const data = prisma.aiAnswerFeedback.update.mock.calls[0][0].data;
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
    });

    await service.updateTriage('fb-1', { reviewStatus: 'IGNORED' }, 'admin-1');

    expect(prisma.aiAnswerFeedback.update).toHaveBeenCalledWith(
      expect.objectContaining({
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

    expect(prisma.aiAnswerFeedback.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fb-1' },
        data: expect.objectContaining({
          reviewStatus: 'REVIEWED',
          resolution: 'CONFIRMED',
          failureKind: 'MODEL_ERROR',
          reviewedBy: 'admin-1',
        }),
      }),
    );
  });
});
