import { AiFeedbackService } from './ai-feedback.service';

function createService() {
  const prisma = {
    aiAnswerFeedback: {
      create: jest.fn().mockResolvedValue({ id: 'fb-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    chatMessage: {
      findMany: jest.fn().mockResolvedValue([]),
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
});
