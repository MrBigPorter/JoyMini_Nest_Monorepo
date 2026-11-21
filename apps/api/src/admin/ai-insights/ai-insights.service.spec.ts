import { AiInsightsService } from './ai-insights.service';

/**
 * #118 P1-4 回归：
 *  ① 人工消息来自 ChatMessage.source='human_agent'
 *  ② 转人工率分子/分母都按窗口内 transferredAt + SUPPORT/AI 类型
 *  ③ 114 §8 三个率基于 failureKind，分母为 0 时返回 0
 */
function makeService() {
  const prisma: any = {
    conversation: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    chatMessage: { groupBy: jest.fn().mockResolvedValue([]) },
    aiAnswerFeedback: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    aiUsageDaily: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { totalTokens: 0, requests: 0 } }),
    },
  };
  const service = new AiInsightsService(prisma);
  return { service, prisma };
}

/** 按 groupBy 的 by 字段返回不同结果（signal / reviewStatus / failureKind）。 */
function mockFeedbackGroupBy(
  prisma: any,
  rows: {
    signal?: Array<{ signal: string; count: number }>;
    failureKind?: Array<{ failureKind: string; count: number }>;
  },
) {
  prisma.aiAnswerFeedback.groupBy.mockImplementation(async ({ by }: any) => {
    if (by[0] === 'signal') {
      return (rows.signal ?? []).map((r) => ({
        signal: r.signal,
        _count: { id: r.count },
      }));
    }
    if (by[0] === 'failureKind') {
      return (rows.failureKind ?? []).map((r) => ({
        failureKind: r.failureKind,
        _count: { id: r.count },
      }));
    }
    return [];
  });
}

const RANGE = { from: '2026-11-01', to: '2026-11-07' };

describe('AiInsightsService 转人工窗口与人群（#118 P1-4）', () => {
  it('分子用 transferredAt，不用 createdAt，且按 SUPPORT/AI 过滤', async () => {
    const { service, prisma } = makeService();

    await service.overview(RANGE);

    const where = prisma.conversation.groupBy.mock.calls[0][0].where;
    expect(where.transferredAt).toEqual({
      gte: expect.any(Date),
      lte: expect.any(Date),
    });
    expect(where).not.toHaveProperty('createdAt');
    expect(where.type).toEqual({ in: ['SUPPORT', 'AI'] });
    expect(where.transferReason).toEqual({ not: null });
  });

  it('分母是“窗口内创建或窗口内转人工”的 SUPPORT/AI 会话', async () => {
    const { service, prisma } = makeService();

    await service.overview(RANGE);

    // conversation.count 第一次是旧字段 conversations，第二次是转人工分母
    expect(prisma.conversation.count).toHaveBeenCalledTimes(2);
    const populationWhere = prisma.conversation.count.mock.calls[1][0].where;
    expect(populationWhere.type).toEqual({ in: ['SUPPORT', 'AI'] });
    expect(populationWhere.OR).toEqual([
      { createdAt: { gte: expect.any(Date), lte: expect.any(Date) } },
      { transferredAt: { gte: expect.any(Date), lte: expect.any(Date) } },
    ]);
  });

  it('转人工率 = 窗口内真实转人工 / 人群，sticky reason 不单独计数', async () => {
    const { service, prisma } = makeService();
    prisma.conversation.count
      .mockResolvedValueOnce(10) // conversations（兼容字段）
      .mockResolvedValueOnce(5); // 转人工分母
    prisma.conversation.groupBy.mockResolvedValue([
      { transferReason: 'explicit_request', _count: { id: 2 } },
      { transferReason: 'negative_sentiment', _count: { id: 1 } },
    ]);

    const res = await service.overview(RANGE);

    expect(res.transfers.total).toBe(3);
    expect(res.transfers.numerator).toBe(3);
    expect(res.transfers.denominator).toBe(5);
    expect(res.transfers.rate).toBe(0.6);
    expect(res.transfers.byReason).toEqual([
      { reason: 'explicit_request', count: 2 },
      { reason: 'negative_sentiment', count: 1 },
    ]);
  });
});

describe('AiInsightsService 114 §8 核心率（failureKind）', () => {
  it('模型/服务/误转率用 failureKind，不把 implicit transferred 当误转', async () => {
    const { service, prisma } = makeService();
    mockFeedbackGroupBy(prisma, {
      signal: [{ signal: 'transferred', count: 9 }],
      failureKind: [
        { failureKind: 'MODEL_ERROR', count: 4 },
        { failureKind: 'UNEXPECTED_TRANSFER', count: 1 },
        { failureKind: 'EXPECTED_TRANSFER', count: 2 },
        { failureKind: 'SERVICE_ERROR', count: 1 },
      ],
    });
    prisma.aiAnswerFeedback.count.mockResolvedValue(5); // 显式负反馈 ∪ SERVICE_ERROR

    const res = await service.overview(RANGE);

    // 模型错误率 = 4 / (4 + 1)
    expect(res.rates.modelError).toEqual({
      numerator: 4,
      denominator: 5,
      rate: 0.8,
    });
    // 服务故障率 = 1 / 可行动反馈 5
    expect(res.rates.serviceError).toEqual({
      numerator: 1,
      denominator: 5,
      rate: 0.2,
    });
    // 误转率 = 1 / (2 + 1 + 1)
    expect(res.rates.misTransfer).toEqual({
      numerator: 1,
      denominator: 4,
      rate: 0.25,
    });
    // 信号区疑似误转单独计数，不混入误转率
    expect(res.feedback.suspectedMisTransfer).toBe(9);
    expect(res.rates.misTransfer.numerator).toBe(1);
  });

  it('可行动反馈分母按显式负反馈 ∪ SERVICE_ERROR 查询', async () => {
    const { service, prisma } = makeService();

    await service.overview(RANGE);

    expect(prisma.aiAnswerFeedback.count).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
        OR: [
          { source: 'explicit', verdict: 'incorrect' },
          { failureKind: 'SERVICE_ERROR' },
        ],
      },
    });
  });

  it('分母为 0 时所有率返回 0（不是 NaN）', async () => {
    const { service } = makeService();

    const res = await service.overview(RANGE);

    expect(res.transfers.rate).toBe(0);
    expect(res.rates.modelError.rate).toBe(0);
    expect(res.rates.serviceError.rate).toBe(0);
    expect(res.rates.misTransfer.rate).toBe(0);
    expect(res.rates.modelError.denominator).toBe(0);
    expect(res.rates.serviceError.denominator).toBe(0);
    expect(res.rates.misTransfer.denominator).toBe(0);
  });
});

describe('AiInsightsService 消息来源', () => {
  it('human_agent 不再恒为 0', async () => {
    const { service, prisma } = makeService();
    prisma.chatMessage.groupBy.mockResolvedValue([
      { source: 'user', _count: { id: 10 } },
      { source: 'ai', _count: { id: 8 } },
      { source: 'human_agent', _count: { id: 3 } },
    ]);

    const res = await service.overview(RANGE);

    expect(res.messages).toEqual({ ai: 8, user: 10, human: 3 });
  });
});
