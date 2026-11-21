import { AiCustomerService } from './ai-customer.service';

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-token') }));
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

/**
 * routeConfirm 是确认卡片的唯一入口：
 * 现在必须同时写生命周期记录，否则“领券没回复”仍然无法审计。
 */
function makeService() {
  const unused = () => ({}) as any;
  const prisma = {
    chatMember: {
      findFirst: jest.fn(async () => ({ userId: 'bot' })),
      findMany: jest.fn(async () => []),
    },
    chatMessage: { create: jest.fn(), findFirst: jest.fn() },
    conversation: { update: jest.fn() },
    paymentChannel: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const confirm = {
    consume: jest.fn(),
    generate: jest.fn(async () => ({
      token: 'token-1',
      expiresAt: Date.now() + 60_000,
    })),
  };
  const lifecycle = {
    createConfirm: jest.fn(async () => ({
      id: 'act-1',
      expiresAt: new Date(Date.now() + 60_000),
    })),
    markConfirmed: jest.fn(async () => undefined),
    markExecuted: jest.fn(async () => undefined),
    markFailed: jest.fn(async () => undefined),
  };
  const gateway = { dispatchToUser: jest.fn() };
  const coupon = {
    claimCoupon: jest.fn(async () => ({ id: 'uc-1', status: 0 })),
    redeemCode: jest.fn(),
  };

  const service = new AiCustomerService(
    unused(),
    unused(),
    unused(),
    prisma as any,
    unused(),
    unused(),
    unused(),
    unused(),
    gateway as any,
    confirm as any,
    unused(),
    unused(),
    coupon as any,
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    unused(),
    undefined,
    lifecycle as any,
  );
  return { service, confirm, lifecycle, gateway, coupon };
}

describe('AiCustomerService · routeConfirm lifecycle', () => {
  it('写生命周期记录并把 requestId 带进 token 与 socket', async () => {
    const { service, lifecycle, gateway } = makeService();
    const finalState = {
      values: {
        pendingConfirm: {
          action: 'claim_coupon',
          params: { couponId: 'coupon-1' },
          summary: { name: 'Big Spender' },
        },
      },
    };

    await (service as any).routeConfirm('u1', 'c1', finalState, 'm1');

    expect(lifecycle.createConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c1',
        userId: 'u1',
        messageId: 'm1',
        action: 'claim_coupon',
      }),
    );

    const generate = (service as any).aiActionConfirmService
      .generate as jest.Mock;
    expect(generate).toHaveBeenCalledWith(
      'u1',
      'claim_coupon',
      { couponId: 'coupon-1' },
      { name: 'Big Spender' },
      'act-1',
    );

    expect(gateway.dispatchToUser).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      expect.objectContaining({
        conversationId: 'c1',
        requestId: 'act-1',
      }),
    );
  });

  it('生命周期写入失败不阻断卡片', async () => {
    const { service, lifecycle, gateway } = makeService();
    lifecycle.createConfirm.mockRejectedValueOnce(new Error('db down'));

    await expect(
      (service as any).routeConfirm(
        'u1',
        'c1',
        {
          values: {
            pendingConfirm: {
              action: 'claim_coupon',
              params: { couponId: 'c1' },
              summary: {},
            },
          },
        },
        'm1',
      ),
    ).resolves.toBeUndefined();

    expect(gateway.dispatchToUser).toHaveBeenCalled();
  });

  it('确认领券后写 EXECUTED 与结果', async () => {
    const { service, confirm, lifecycle, coupon } = makeService();
    confirm.consume.mockResolvedValue({
      action: 'claim_coupon',
      params: { couponId: 'coupon-1' },
      requestId: 'act-1',
      userId: 'u1',
      summary: {},
    });

    const result = await (service as any).confirmAction('token-1', 'u1');

    expect(coupon.claimCoupon).toHaveBeenCalledWith('u1', 'coupon-1', 2);
    expect(lifecycle.markExecuted).toHaveBeenCalledWith('act-1', {
      id: 'uc-1',
      status: 0,
    });
    expect(result).toEqual({ id: 'uc-1', status: 0 });
  });
});
