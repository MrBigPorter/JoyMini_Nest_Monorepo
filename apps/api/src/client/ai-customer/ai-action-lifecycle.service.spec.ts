import { AiActionLifecycleService } from './ai-action-lifecycle.service';

function makeService() {
  const prisma = {
    aiActionRequest: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'act-1',
        expiresAt: data.expiresAt,
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => null),
    },
  };
  return { service: new AiActionLifecycleService(prisma as any), prisma };
}

describe('AiActionLifecycleService', () => {
  it('创建确认卡片记录并写入过期时间', async () => {
    const { service, prisma } = makeService();
    const result = await service.createConfirm({
      conversationId: 'c1',
      userId: 'u1',
      messageId: 'm1',
      action: 'claim_coupon',
      params: { couponId: 'coupon-1' },
      summary: { name: 'Big Spender' },
    });

    expect(result?.id).toBe('act-1');
    expect(prisma.aiActionRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'c1',
          messageId: 'm1',
          status: 'CONFIRM_CREATED',
          action: 'claim_coupon',
        }),
      }),
    );
  });

  it('执行成功写 EXECUTED 与结果', async () => {
    const { service, prisma } = makeService();
    await service.markExecuted('act-1', { ok: true });

    expect(prisma.aiActionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'act-1', status: { in: ['CONFIRMED'] } },
        data: expect.objectContaining({
          status: 'EXECUTED',
          executedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('失败写 FAILED 与错误摘要', async () => {
    const { service, prisma } = makeService();
    await service.markFailed('act-1', 'coupon sold out');

    expect(prisma.aiActionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: 'coupon sold out',
        }),
      }),
    );
  });

  it('用户取消写 CANCELLED 终态（与 EXPIRED 区分）', async () => {
    const { service, prisma } = makeService();
    await service.markCancelled('act-1');

    expect(prisma.aiActionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'act-1',
          status: { in: ['CONFIRM_CREATED', 'CONFIRMED'] },
        },
        data: { status: 'CANCELLED' },
      }),
    );
  });

  it('新消息让未完成的卡片过期', async () => {
    const { service, prisma } = makeService();
    await service.expireForConversation('c1');

    expect(prisma.aiActionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId: 'c1',
          status: { in: ['REQUESTED', 'CONFIRM_CREATED'] },
        },
        data: expect.objectContaining({ status: 'EXPIRED' }),
      }),
    );
  });

  it('定时任务只过期已到期的卡片', async () => {
    const { service, prisma } = makeService();
    await service.expireDue();

    expect(prisma.aiActionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'CONFIRM_CREATED',
          expiresAt: { lt: expect.any(Date) },
        }),
      }),
    );
  });
});

describe('AiActionLifecycleService · 转人工撤销', () => {
  it('markTransferred 同时作废 CONFIRMED（待 OTP 提现）', async () => {
    const { service, prisma } = makeService();
    await service.markTransferred('c1');

    expect(prisma.aiActionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId: 'c1',
          status: { in: ['REQUESTED', 'CONFIRM_CREATED', 'CONFIRMED'] },
        },
        data: { status: 'TRANSFERRED' },
      }),
    );
  });

  it('transferred 过期包含 CONFIRMED', async () => {
    const { service, prisma } = makeService();
    await service.expireForConversation('c1', 'transferred');

    expect(prisma.aiActionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId: 'c1',
          status: { in: ['REQUESTED', 'CONFIRM_CREATED', 'CONFIRMED'] },
        },
      }),
    );
  });

  it('superseded（新消息）不误伤 CONFIRMED 等待中的提现', async () => {
    const { service, prisma } = makeService();
    await service.expireForConversation('c1');

    expect(prisma.aiActionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId: 'c1',
          status: { in: ['REQUESTED', 'CONFIRM_CREATED'] },
        },
      }),
    );
  });
});
