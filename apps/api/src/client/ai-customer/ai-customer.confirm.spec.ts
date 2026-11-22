import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SocketEvents } from '@lucky/shared';
import { AiCustomerService } from './ai-customer.service';
import { SessionQuotaExceededError } from './ai-usage.service';

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-token') }));
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

/**
 * 确认卡片协议：目录驱动执行、结果事件、取消端点、令牌重放/过期。
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
    aiActionRequest: {
      findFirst: jest.fn(),
      updateMany: jest.fn(async (_args: any = {}) => ({ count: 1 })),
    },
    paymentChannel: {
      findUnique: jest.fn(),
      findMany: jest.fn(async () => [{ id: 5, name: 'GCash Withdraw' }]),
    },
    user: { findUnique: jest.fn(async () => ({ phone: '09990000000' })) },
    $transaction: jest.fn(),
  };
  const confirm = {
    consume: jest.fn(),
    generate: jest.fn(async () => ({
      token: 'token-1',
      expiresAt: Date.now() + 60_000,
    })),
    stagePendingExecution: jest.fn(async () => true),
    clearPendingExecution: jest.fn(async () => undefined),
    peekPendingExecution: jest.fn(async (): Promise<any> => null),
    popPendingExecution: jest.fn(async (): Promise<any> => null),
  };
  const lifecycle = {
    createConfirm: jest.fn(async () => ({
      id: 'act-1',
      expiresAt: new Date(Date.now() + 60_000),
    })),
    markConfirmed: jest.fn(async () => undefined),
    markExecuted: jest.fn(async () => undefined),
    attachResult: jest.fn(async () => undefined),
    markFailed: jest.fn(async () => undefined),
    markCancelled: jest.fn(async () => undefined),
    markTransferred: jest.fn(async () => undefined),
    expireForConversation: jest.fn(async () => 0),
  };
  const gateway = {
    dispatchToUser: jest.fn(),
    dispatchToConversation: jest.fn(),
  };
  const coupon = {
    claimCoupon: jest.fn(async () => ({ id: 'uc-1', status: 0 })),
    redeemCode: jest.fn(async () => ({ success: true })),
    getClaimableCoupons: jest.fn(async () => [
      { couponId: 'coupon-1', couponName: 'Big Spender ₱200 Off' },
      { couponId: 'c1', couponName: 'C1 Coupon' },
    ]),
  };
  const luckyDraw = { draw: jest.fn(async () => ({ isWin: true })) };
  const address = {
    create: jest.fn(async () => ({ addressId: 'addr-new' })),
    update: jest.fn(async () => ({ addressId: 'addr-1' })),
    delete: jest.fn(async () => true),
    detail: jest.fn(async () => ({
      addressId: 'addr-1',
      provinceId: 1,
      cityId: 2,
      barangayId: 3,
    })),
    resolveGeoIds: jest.fn(async () => ({
      provinceId: 1,
      cityId: 2,
      barangayId: 3,
    })),
  };
  const otp = {
    request: jest.fn(async () => undefined),
    verify: jest.fn(async () => true),
  };
  const wallet = {
    applyWithdrawVerified: jest.fn(async () => ({ withdrawId: 'w-1' })),
  };
  const actionContext = {
    loadLatest: jest.fn(async (): Promise<any> => null),
  };

  const service = new AiCustomerService(
    unused(), // ConfigService
    unused(), // ToolRegistryService
    unused(), // AiService
    prisma as any, // PrismaService
    unused(), // RagRetrievalService
    unused(), // PromptResolverService
    unused(), // MeilisearchService
    unused(), // AiMemoryService
    gateway as any, // EventsGateway
    confirm as any, // AiActionConfirmService
    unused(), // AiUsageService
    wallet as any, // ClientWalletService
    coupon as any, // ClientCouponService
    luckyDraw as any, // LuckyDrawService
    address as any, // AddressService
    otp as any, // OtpService
    unused(), // RedisService
    unused(), // EventEmitter2
    unused(), // AiFeedbackService
    unused(), // FlowStateVersioningService
    unused(), // AiConversationDebugService
    undefined, // TraceService
    lifecycle as any,
    undefined, // HandoffPresenceService
    actionContext as any, // AiActionContextService
  );
  return {
    service,
    prisma,
    confirm,
    lifecycle,
    gateway,
    coupon,
    luckyDraw,
    address,
    otp,
    wallet,
    actionContext,
  };
}

function payload(
  action: string,
  params: Record<string, any>,
  extra: Record<string, any> = {},
) {
  return {
    action,
    params,
    summary: {},
    userId: 'u1',
    requestId: 'act-1',
    conversationId: 'c1',
    ...extra,
  };
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
      expect.objectContaining({
        action: 'claim_coupon',
        couponId: 'coupon-1',
        couponName: expect.any(String),
      }),
      'act-1',
      'c1',
    );

    expect(gateway.dispatchToUser).toHaveBeenCalledWith(
      'u1',
      SocketEvents.AI_CONFIRM,
      expect.objectContaining({
        conversationId: 'c1',
        requestId: 'act-1',
        // 新协议字段
        title: expect.any(String),
        fields: expect.any(Array),
        needsOtp: false,
        // 旧客户端字段仍在
        summary: expect.any(Object),
        confirmToken: 'token-1',
        expiresAt: expect.any(Number),
      }),
    );
  });

  it('couponId 是列表序号时：不弹卡，提示重新选择', async () => {
    const { service, gateway, lifecycle } = makeService();
    const finalState = {
      values: {
        pendingConfirm: {
          action: 'claim_coupon',
          params: { couponId: '2' },
          summary: {},
        },
      },
    };

    await (service as any).routeConfirm('u1', 'c1', finalState, 'm1');

    expect(lifecycle.createConfirm).not.toHaveBeenCalled();
    expect(gateway.dispatchToUser).not.toHaveBeenCalledWith(
      'u1',
      SocketEvents.AI_CONFIRM,
      expect.anything(),
    );
  });

  it('领券卡片展示券名而不是内部 ID，但执行参数不变', async () => {
    const { service, gateway, confirm } = makeService();
    const finalState = {
      values: {
        pendingConfirm: {
          action: 'claim_coupon',
          params: { couponId: 'coupon-1' },
          summary: {},
        },
      },
    };

    await (service as any).routeConfirm('u1', 'c1', finalState, 'm1');

    const payload = (gateway.dispatchToUser as jest.Mock).mock.calls[0][2];
    expect(payload.fields).toEqual([
      { label: '优惠券', value: 'Big Spender ₱200 Off' },
    ]);
    // 展示字段只影响卡片，不进入服务端令牌参数。
    expect(confirm.generate).toHaveBeenCalledWith(
      'u1',
      'claim_coupon',
      { couponId: 'coupon-1' },
      expect.any(Object),
      'act-1',
      'c1',
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
    ).resolves.toEqual({ requestId: null, created: true });

    expect(gateway.dispatchToUser).toHaveBeenCalled();
  });
});

describe('confirmAction · 目录驱动执行', () => {
  it('确认领券后写 EXECUTED 并投递 AI_ACTION_RESULT', async () => {
    const { service, confirm, lifecycle, coupon, gateway } = makeService();
    confirm.consume.mockResolvedValue(
      payload('claim_coupon', { couponId: 'coupon-1' }),
    );

    const result = await (service as any).confirmAction('token-1', 'u1');

    expect(coupon.claimCoupon).toHaveBeenCalledWith('u1', 'coupon-1', 2);
    expect(lifecycle.markExecuted).toHaveBeenCalledWith('act-1', {
      id: 'uc-1',
      status: 0,
    });
    expect(gateway.dispatchToUser).toHaveBeenCalledWith(
      'u1',
      SocketEvents.AI_ACTION_RESULT,
      expect.objectContaining({
        conversationId: 'c1',
        action: 'claim_coupon',
        success: true,
        message: expect.any(String),
      }),
    );
    expect(result).toEqual({ id: 'uc-1', status: 0 });
  });

  it('兑换码 / 抽奖 / 删除地址走目录分支', async () => {
    const { service, confirm, coupon, luckyDraw, address } = makeService();
    confirm.consume
      .mockResolvedValueOnce(payload('redeem_code', { code: 'JOY10' }))
      .mockResolvedValueOnce(payload('draw', { ticketId: 't-1' }))
      .mockResolvedValueOnce(payload('delete_address', { addressId: 'a-1' }));

    await (service as any).confirmAction('t1', 'u1');
    await (service as any).confirmAction('t2', 'u1');
    await (service as any).confirmAction('t3', 'u1');

    expect(coupon.redeemCode).toHaveBeenCalledWith('u1', 'JOY10');
    expect(luckyDraw.draw).toHaveBeenCalledWith('u1', 't-1');
    expect(address.delete).toHaveBeenCalledWith('u1', 'a-1');
  });

  it('新增地址：确认时解析省市区并用完整参数执行', async () => {
    const { service, confirm, address } = makeService();
    confirm.consume.mockResolvedValue(
      payload('create_address', {
        contactName: 'Ann',
        phone: '09991234567',
        province: 'Metro Manila',
        city: 'Makati',
        barangay: 'Bel-Air',
        fullAddress: '1 Ayala Ave',
        label: 'Home',
        isDefault: true,
      }),
    );

    await (service as any).confirmAction('t1', 'u1');

    expect(address.resolveGeoIds).toHaveBeenCalledWith(
      'Metro Manila',
      'Makati',
      'Bel-Air',
    );
    expect(address.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        contactName: 'Ann',
        phone: '09991234567',
        provinceId: 1,
        cityId: 2,
        barangayId: 3,
        fullAddress: '1 Ayala Ave',
        label: 'Home',
        isDefault: 1,
      }),
    );
  });

  it('修改地址：无省市区时用当前地址 ID 补齐', async () => {
    const { service, confirm, address } = makeService();
    confirm.consume.mockResolvedValue(
      payload('update_address', {
        addressId: 'addr-1',
        phone: '09990001111',
        fullAddress: '2 New Street',
      }),
    );

    await (service as any).confirmAction('t1', 'u1');

    expect(address.detail).toHaveBeenCalledWith('u1', 'addr-1');
    expect(address.update).toHaveBeenCalledWith(
      'u1',
      'addr-1',
      expect.objectContaining({
        phone: '09990001111',
        fullAddress: '2 New Street',
        provinceId: 1,
        cityId: 2,
        barangayId: 3,
      }),
    );
  });

  it('提现：确认后只发 OTP 并暂存，不执行提现', async () => {
    const { service, confirm, prisma, otp, wallet } = makeService();
    confirm.consume.mockResolvedValue(
      payload('withdraw', {
        amount: 500,
        channelId: 2,
        account: '09170000000',
        accountName: 'Ann',
      }),
    );

    const result = await (service as any).confirmAction('t1', 'u1');

    expect(otp.request).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '09990000000' }),
    );
    expect(confirm.stagePendingExecution).toHaveBeenCalled();
    expect(prisma.aiActionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'act-1',
          status: 'CONFIRM_CREATED',
        }),
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    );
    expect(wallet.applyWithdrawVerified).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ needOtp: true }));
  });

  it('未知 action：400、置失败、投递失败结果，不执行任何写操作', async () => {
    const { service, confirm, lifecycle, coupon, gateway } = makeService();
    confirm.consume.mockResolvedValue(payload('unknown_action', {}));

    await expect((service as any).confirmAction('t1', 'u1')).rejects.toThrow(
      BadRequestException,
    );

    expect(coupon.claimCoupon).not.toHaveBeenCalled();
    expect(lifecycle.markFailed).toHaveBeenCalledWith(
      'act-1',
      expect.stringContaining('Unknown confirm action'),
    );
    expect(gateway.dispatchToUser).toHaveBeenCalledWith(
      'u1',
      SocketEvents.AI_ACTION_RESULT,
      expect.objectContaining({ success: false }),
    );
  });

  it('令牌过期/重放：consume 返回 null → 400，不执行', async () => {
    const { service, confirm, coupon } = makeService();
    confirm.consume.mockResolvedValue(null);

    await expect(
      (service as any).confirmAction('used-token', 'u1'),
    ).rejects.toThrow('Confirm token invalid or expired');
    expect(coupon.claimCoupon).not.toHaveBeenCalled();
  });

  it('令牌只能消费一次：第二次确认被拒绝', async () => {
    const { service, confirm, coupon } = makeService();
    confirm.consume
      .mockResolvedValueOnce(payload('claim_coupon', { couponId: 'c1' }))
      .mockResolvedValueOnce(null);

    await (service as any).confirmAction('token-1', 'u1');
    await expect(
      (service as any).confirmAction('token-1', 'u1'),
    ).rejects.toThrow('Confirm token invalid or expired');

    expect(coupon.claimCoupon).toHaveBeenCalledTimes(1);
  });

  it('执行失败：置 FAILED 并投递失败结果', async () => {
    const { service, confirm, lifecycle, coupon, gateway } = makeService();
    confirm.consume.mockResolvedValue(
      payload('claim_coupon', { couponId: 'sold-out' }),
    );
    coupon.claimCoupon.mockRejectedValueOnce(new Error('coupon sold out'));

    await expect((service as any).confirmAction('t1', 'u1')).rejects.toThrow(
      'coupon sold out',
    );

    expect(lifecycle.markFailed).toHaveBeenCalledWith(
      'act-1',
      'coupon sold out',
    );
    expect(gateway.dispatchToUser).toHaveBeenCalledWith(
      'u1',
      SocketEvents.AI_ACTION_RESULT,
      expect.objectContaining({ success: false, message: 'coupon sold out' }),
    );
  });
});

describe('cancelAction · 取消终态', () => {
  it('正常取消：消费令牌并置 CANCELLED', async () => {
    const { service, confirm, lifecycle } = makeService();
    confirm.consume.mockResolvedValue(
      payload('claim_coupon', { couponId: 'coupon-1' }),
    );

    await expect(
      (service as any).cancelAction('token-1', 'u1'),
    ).resolves.toEqual({ cancelled: true });

    expect(confirm.consume).toHaveBeenCalledWith('token-1', 'u1');
    expect(lifecycle.markCancelled).toHaveBeenCalledWith('act-1');
  });

  it('重复取消：令牌已被消费 → 400', async () => {
    const { service, confirm, lifecycle } = makeService();
    confirm.consume.mockResolvedValueOnce(
      payload('claim_coupon', { couponId: 'coupon-1' }),
    );
    confirm.consume.mockResolvedValueOnce(null);

    await (service as any).cancelAction('token-1', 'u1');
    await expect(
      (service as any).cancelAction('token-1', 'u1'),
    ).rejects.toThrow('Confirm token invalid or expired');

    expect(lifecycle.markCancelled).toHaveBeenCalledTimes(1);
  });

  it('提现已确认、等验证码时取消：撤销待执行任务并置 CANCELLED', async () => {
    const { service, confirm, lifecycle } = makeService();
    confirm.consume.mockResolvedValue(null);
    const pending = payload('withdraw', { amount: 100 }, {
      requestId: 'act-2',
    });
    confirm.peekPendingExecution.mockResolvedValue(pending);
    confirm.popPendingExecution.mockResolvedValue(pending);

    await expect(
      (service as any).cancelAction('consumed-token', 'u1'),
    ).resolves.toEqual({ cancelled: true });

    expect(confirm.popPendingExecution).toHaveBeenCalledWith('u1');
    expect(lifecycle.markCancelled).toHaveBeenCalledWith('act-2');
  });

  it('跨用户取消：owner 不匹配时 consume 返回 null → 400', async () => {
    const { service, confirm, lifecycle } = makeService();
    confirm.consume.mockResolvedValue(null);

    await expect(
      (service as any).cancelAction('token-1', 'other-user'),
    ).rejects.toThrow('Confirm token invalid or expired');

    expect(confirm.consume).toHaveBeenCalledWith('token-1', 'other-user');
    expect(lifecycle.markCancelled).not.toHaveBeenCalled();
  });
});


describe('resendWithdrawOtp · 重新发送验证码', () => {
  it('没有待执行任务：400，不发短信', async () => {
    const { service, confirm, otp } = makeService();
    confirm.peekPendingExecution.mockResolvedValue(null);

    await expect(service.resendWithdrawOtp('u1')).rejects.toThrow(
      'No pending withdraw action found',
    );
    expect(otp.request).not.toHaveBeenCalled();
  });

  it('有待执行任务：重新发送并返回新的过期时间', async () => {
    const { service, confirm, otp } = makeService();
    confirm.peekPendingExecution.mockResolvedValue(
      payload('withdraw', { amount: 100 }),
    );

    const result = await service.resendWithdrawOtp('u1');

    expect(otp.request).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '09990000000' }),
    );
    expect(result.sent).toBe(true);
    expect(result.otpExpiresAt).toBeGreaterThan(Date.now());
    expect(confirm.peekPendingExecution).toHaveBeenCalledWith('u1');
  });
});

describe('handlePendingActionConfirmation · 文字确认', () => {
  it('活卡片 + “确认”：重发卡片，不执行写操作', async () => {
    const { service, confirm, lifecycle, actionContext } = makeService();
    actionContext.loadLatest.mockResolvedValue({
      requestId: 'act-1',
      action: 'withdraw',
      status: 'CONFIRM_CREATED',
      summary: { amount: 100 },
      params: { amount: 100, channelId: 5, account: '0917', accountName: 'P' },
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      expired: false,
    });
    const publish = jest
      .spyOn(service as any, 'publishDeterministicReply')
      .mockResolvedValue(undefined);
    const issue = jest
      .spyOn(service as any, 'issueConfirmCard')
      .mockResolvedValue({ requestId: 'act-2', created: true });

    const handled = await (service as any).handlePendingActionConfirmation({
      userId: 'u1',
      conversationId: 'c1',
      message: '确认',
      startedAt: Date.now(),
      triggerMessageId: 'm2',
    });

    expect(handled).toBe(true);
    expect(lifecycle.createConfirm).not.toHaveBeenCalled();
    expect(confirm.generate).not.toHaveBeenCalled();
    expect(issue).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'withdraw' }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('请点击上方卡片'),
    );
    expect(lifecycle.markExecuted).not.toHaveBeenCalled();
  });

  it('过期卡片 + “确认”：确定性回复已过期，不发卡', async () => {
    const { service, actionContext } = makeService();
    actionContext.loadLatest.mockResolvedValue({
      requestId: 'act-1',
      action: 'withdraw',
      status: 'EXPIRED',
      summary: {},
      params: { amount: 100, channelId: 5, account: '0917', accountName: 'P' },
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      expired: true,
    });
    const publish = jest
      .spyOn(service as any, 'publishDeterministicReply')
      .mockResolvedValue(undefined);
    const issue = jest.spyOn(service as any, 'issueConfirmCard');

    const handled = await (service as any).handlePendingActionConfirmation({
      userId: 'u1',
      conversationId: 'c1',
      message: '确认',
      startedAt: Date.now(),
    });

    expect(handled).toBe(true);
    expect(issue).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('已过期'),
    );
  });

  it('没有最近动作：不接管，继续走 graph', async () => {
    const { service, actionContext } = makeService();
    actionContext.loadLatest.mockResolvedValue(null);

    const handled = await (service as any).handlePendingActionConfirmation({
      userId: 'u1',
      conversationId: 'c1',
      message: '确认',
      startedAt: Date.now(),
    });

    expect(handled).toBe(false);
  });

  it('非确认语不读取动作上下文', async () => {
    const { service, actionContext } = makeService();

    const handled = await (service as any).handlePendingActionConfirmation({
      userId: 'u1',
      conversationId: 'c1',
      message: '帮我看看优惠券',
      startedAt: Date.now(),
    });

    expect(handled).toBe(false);
    expect(actionContext.loadLatest).not.toHaveBeenCalled();
  });
});

describe('guardCompletionClaims · 发布事实闸门', () => {
  it('无 EXECUTED 动作时把完成语改写成未完成', async () => {
    const { service, prisma } = makeService();
    prisma.aiActionRequest.findFirst.mockResolvedValue(null);

    const out = await (service as any).guardCompletionClaims(
      'c1',
      Date.now(),
      [{ type: 'ai', content: '提现申请已提交' }],
    );

    expect(out[0].content).toContain('还没有真正完成');
  });

  it('有 EXECUTED 动作时保留原文', async () => {
    const { service, prisma } = makeService();
    prisma.aiActionRequest.findFirst.mockResolvedValue({ id: 'a1' });

    const out = await (service as any).guardCompletionClaims(
      'c1',
      Date.now(),
      [{ type: 'ai', content: '优惠券已领取' }],
    );

    expect(out[0].content).toBe('优惠券已领取');
  });

  it('普通信息与确认提示不被改写', async () => {
    const { service } = makeService();

    const out = await (service as any).guardCompletionClaims(
      'c1',
      Date.now(),
      [{ type: 'ai', content: '提现需要 1-3 个工作日' }],
    );

    expect(out[0].content).toBe('提现需要 1-3 个工作日');
  });

  it('证据查询失败时 fail-open 保留原文', async () => {
    const { service, prisma } = makeService();
    prisma.aiActionRequest.findFirst.mockRejectedValue(new Error('db down'));

    const out = await (service as any).guardCompletionClaims(
      'c1',
      Date.now(),
      [{ type: 'ai', content: '提现申请已提交' }],
    );

    expect(out[0].content).toBe('提现申请已提交');
  });
});

describe('confirmAction · DB 权威 CAS', () => {
  it('DB 已 EXPIRED 时即使令牌有效也拒绝执行', async () => {
    const { service, confirm, prisma, lifecycle } = makeService();
    confirm.consume.mockResolvedValue(
      payload('claim_coupon', { couponId: 'coupon-1' }),
    );
    prisma.aiActionRequest.updateMany.mockResolvedValue({ count: 0 });
    const execute = jest.spyOn(
      (service as any).buildActionServices(),
      'claimCoupon',
    );

    await expect(service.confirmAction('tok', 'u1')).rejects.toThrow(
      'Confirm request expired or already handled',
    );
    expect(execute).not.toHaveBeenCalled();
    expect(lifecycle.markFailed).toHaveBeenCalled();
  });

  it('两个并发确认只有一个拿到 CAS', async () => {
    const { service, confirm, prisma } = makeService();
    confirm.consume.mockResolvedValue(
      payload('claim_coupon', { couponId: 'coupon-1' }),
    );
    prisma.aiActionRequest.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const results = await Promise.allSettled([
      service.confirmAction('tok', 'u1'),
      service.confirmAction('tok', 'u1'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('没有 requestId 的令牌 fail-closed', async () => {
    const { service, confirm } = makeService();
    confirm.consume.mockResolvedValue(
      payload('claim_coupon', { couponId: 'coupon-1' }, { requestId: undefined }),
    );

    await expect(service.confirmAction('tok', 'u1')).rejects.toThrow(
      'Confirm request expired or already handled',
    );
  });
});

describe('startWithdrawOtp · 待执行任务完整性', () => {
  it('同一用户已有待验证提现：第二次确认被拒绝', async () => {
    const { service, confirm, otp } = makeService();
    confirm.stagePendingExecution.mockResolvedValue(false);

    await expect(
      (service as any).startWithdrawOtp('u1', { amount: 100 }, {}, 'a2', 'c1'),
    ).rejects.toThrow('已有待验证的提现');

    expect(otp.request).not.toHaveBeenCalled();
    expect(confirm.clearPendingExecution).not.toHaveBeenCalled();
  });

  it('发码失败时回滚暂存，避免用户卡在等验证码', async () => {
    const { service, confirm, otp } = makeService();
    otp.request.mockRejectedValueOnce(new Error('sms down'));

    await expect(
      (service as any).startWithdrawOtp('u1', { amount: 100 }, {}, 'a2', 'c1'),
    ).rejects.toThrow('sms down');

    expect(confirm.clearPendingExecution).toHaveBeenCalledWith('u1');
  });

  it('暂存 payload 带 conversationId（OTP 成功后结果能回投）', async () => {
    const { service, confirm } = makeService();

    await (service as any).startWithdrawOtp(
      'u1',
      { amount: 100, channelId: 5 },
      { amount: 100 },
      'a2',
      'c1',
    );

    expect(confirm.stagePendingExecution).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        action: 'withdraw',
        requestId: 'a2',
        conversationId: 'c1',
      }),
    );
  });
});

describe('confirmWithdrawOtp · 结果回投', () => {
  it('OTP 验证成功后投递 AI_ACTION_RESULT 到原会话', async () => {
    const { service, confirm, gateway } = makeService();
    const pendingPayload = {
      ...payload('withdraw', {
        amount: 100,
        channelId: 5,
        account: '09171234567',
        accountName: 'Porter',
      }),
      conversationId: 'c1',
    };
    confirm.peekPendingExecution.mockResolvedValue(pendingPayload);
    confirm.popPendingExecution.mockResolvedValue(pendingPayload);

    await service.confirmWithdrawOtp('999999', 'u1');

    expect(gateway.dispatchToUser).toHaveBeenCalledWith(
      'u1',
      'ai_action_result',
      expect.objectContaining({
        conversationId: 'c1',
        action: 'withdraw',
        success: true,
      }),
    );
  });
});

describe('cancelAction · requestId 绑定', () => {
  it('令牌已消费后取消，requestId 不匹配则拒绝', async () => {
    const { service, confirm } = makeService();
    confirm.consume.mockResolvedValue(null);
    confirm.peekPendingExecution.mockResolvedValue({
      action: 'withdraw',
      params: {},
      summary: {},
      userId: 'u1',
      requestId: 'a1',
      conversationId: 'c1',
    });

    await expect(service.cancelAction('tok', 'u1', 'a2')).rejects.toThrow(
      'Confirm token invalid or expired',
    );
    expect(confirm.popPendingExecution).not.toHaveBeenCalled();
  });
});

describe('executeUpdateAddress · 局部更新', () => {
  it('只改电话不会清空姓名', async () => {
    const { service, address } = makeService();
    address.detail.mockResolvedValue({
      addressId: 'addr-1',
      firstName: 'Porter',
      lastName: 'Q',
      contactName: 'Porter Q',
      phone: '09170000000',
      provinceId: 1,
      cityId: 2,
      barangayId: 3,
      fullAddress: '1 Ayala Ave',
      label: 'Home',
    } as any);

    await (service as any).executeUpdateAddress('u1', 'addr-1', {
      phone: '09180000000',
    });

    expect(address.update).toHaveBeenCalledWith(
      'u1',
      'addr-1',
      expect.objectContaining({
        firstName: 'Porter',
        lastName: 'Q',
        contactName: 'Porter Q',
        phone: '09180000000',
        fullAddress: '1 Ayala Ave',
        label: 'Home',
      }),
    );
  });
});

describe('issueConfirmCard · 白名单与展示', () => {
  it('执行参数只保留目录白名单，注入字段进不了令牌', async () => {
    const { service, confirm } = makeService();

    await (service as any).issueConfirmCard({
      userId: 'u1',
      conversationId: 'c1',
      action: 'claim_coupon',
      params: { couponId: 'coupon-1', injected: 'x' },
      summary: {},
    });

    expect(confirm.generate).toHaveBeenCalledWith(
      'u1',
      'claim_coupon',
      { couponId: 'coupon-1' },
      expect.anything(),
      expect.anything(),
      'c1',
    );
  });

  it('提现卡片展示渠道名、手续费与到账', async () => {
    const { service, prisma, gateway } = makeService();
    prisma.paymentChannel.findUnique.mockResolvedValue({
      id: 5,
      name: 'GCash Withdraw',
      type: 2,
      status: 1,
      feeRate: new Prisma.Decimal('0.008'),
      feeFixed: new Prisma.Decimal('5'),
    });

    await (service as any).issueConfirmCard({
      userId: 'u1',
      conversationId: 'c1',
      action: 'withdraw',
      params: {
        amount: 100,
        channelId: 5,
        account: '09171234567',
        accountName: 'Porter',
      },
      summary: {},
    });

    const confirmEvent = gateway.dispatchToUser.mock.calls.find(
      (call) => call[1] === SocketEvents.AI_CONFIRM,
    );
    expect(confirmEvent?.[2]?.fields).toEqual(
      expect.arrayContaining([
        { label: '渠道', value: 'GCash Withdraw' },
        { label: '手续费', value: '₱5.8' },
        { label: '实际到账', value: '₱94.2' },
      ]),
    );
  });

  it('充值渠道不发卡', async () => {
    const { service, prisma, confirm } = makeService();
    prisma.paymentChannel.findUnique.mockResolvedValue({
      id: 1,
      name: 'GCash',
      type: 1,
      status: 1,
      feeRate: new Prisma.Decimal('0'),
      feeFixed: new Prisma.Decimal('0'),
    });

    const result = await (service as any).issueConfirmCard({
      userId: 'u1',
      conversationId: 'c1',
      action: 'withdraw',
      params: { amount: 100, channelId: 1, account: '0917', accountName: 'P' },
      summary: {},
    });

    expect(result).toEqual({ requestId: null, created: false });
    expect(confirm.generate).not.toHaveBeenCalled();
  });

  it('目录外动作不发卡', async () => {
    const { service, confirm } = makeService();

    const result = await (service as any).issueConfirmCard({
      userId: 'u1',
      conversationId: 'c1',
      action: 'unknown_action',
      params: {},
      summary: {},
    });

    expect(result).toEqual({ requestId: null, created: false });
    expect(confirm.generate).not.toHaveBeenCalled();
  });
});

describe('handleStreamError · 配额', () => {
  it('配额耗尽给出专门话术，不转人工、不通知 onError', async () => {
    const { service, gateway } = makeService();
    const routeNormal = jest
      .spyOn(service as any, 'routeNormalCompletion')
      .mockResolvedValue(undefined);
    const onError = jest.fn();
    const onDone = jest.fn();

    await (service as any).handleStreamError(
      new SessionQuotaExceededError(1000, 1200),
      'hi',
      'u1',
      'c1',
      { onError, onDone },
      [],
      'm1',
    );

    expect(onDone).toHaveBeenCalled();
    expect(gateway.dispatchToUser).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      expect.objectContaining({ conversationId: 'c1' }),
    );

    expect(routeNormal).toHaveBeenCalledWith(
      [{ type: 'ai', content: expect.stringContaining('已达到 AI 使用上限') }],
      'u1',
      'c1',
      [],
      [],
      'm1',
    );
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('routeTransfer · 撤销待确认动作', () => {
  it('转人工时把同会话待确认动作置 TRANSFERRED', async () => {
    const { service, lifecycle } = makeService();

    await (service as any)
      .routeTransfer('u1', 'c1', 'explicit_request', { onTransfer: jest.fn() }, [], [], 'm1')
      .catch(() => undefined);

    expect(lifecycle.markTransferred).toHaveBeenCalledWith('c1');
  });

  it('转人工同时清掉待 OTP 任务', async () => {
    const { service, confirm } = makeService();

    await (service as any)
      .routeTransfer('u1', 'c1', 'explicit_request', { onTransfer: jest.fn() }, [], [], 'm1')
      .catch(() => undefined);

    expect(confirm.clearPendingExecution).toHaveBeenCalledWith('u1');
  });
});

describe('confirmAction · OTP 窗口', () => {
  it('提现确认时把 expiresAt 延长到 OTP 有效期，而不是卡片 60s', async () => {
    const { service, confirm, prisma } = makeService();
    confirm.consume.mockResolvedValue(
      payload('withdraw', {
        amount: 100,
        channelId: 5,
        account: '0917',
        accountName: 'P',
      }),
    );
    const before = Date.now();

    await (service as any).confirmAction('tok', 'u1');

    const updateArgs = prisma.aiActionRequest.updateMany.mock.calls[0][0];
    expect(updateArgs.data.expiresAt).toBeInstanceOf(Date);
    expect(updateArgs.data.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 300_000,
    );
  });

  it('非 OTP 动作不延长 expiresAt', async () => {
    const { service, confirm, prisma } = makeService();
    confirm.consume.mockResolvedValue(
      payload('claim_coupon', { couponId: 'coupon-1' }),
    );

    await (service as any).confirmAction('tok', 'u1');

    const updateArgs = prisma.aiActionRequest.updateMany.mock.calls[0][0];
    expect(updateArgs.data.expiresAt).toBeUndefined();
  });
});

describe('confirmWithdrawOtp · DB 终态', () => {
  it('转人工后（DB 已非 CONFIRMED）输码也不执行', async () => {
    const { service, confirm, prisma, wallet } = makeService();
    const pendingPayload = {
      ...payload('withdraw', {
        amount: 100,
        channelId: 5,
        account: '09171234567',
        accountName: 'Porter',
      }),
      conversationId: 'c1',
    };
    confirm.peekPendingExecution.mockResolvedValue(pendingPayload);
    confirm.popPendingExecution.mockResolvedValue(pendingPayload);
    prisma.aiActionRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.confirmWithdrawOtp('999999', 'u1')).rejects.toThrow(
      'Confirm request expired or already handled',
    );
    expect(wallet.applyWithdrawVerified).not.toHaveBeenCalled();
  });
});

describe('handlePendingActionConfirmation · 旧动作不劫持', () => {
  it('很久以前的终态动作不拦截本次「确认」', async () => {
    const { service, actionContext } = makeService();
    actionContext.loadLatest.mockResolvedValue({
      requestId: 'old-1',
      action: 'withdraw',
      status: 'EXPIRED',
      summary: {},
      params: { amount: 100, channelId: 5, account: '0917', accountName: 'P' },
      expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      expired: true,
    });
    const publish = jest.spyOn(service as any, 'publishDeterministicReply');

    const handled = await (service as any).handlePendingActionConfirmation({
      userId: 'u1',
      conversationId: 'c1',
      message: '确认',
      startedAt: Date.now(),
    });

    expect(handled).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it('刚刚过期的动作仍然确定性回复已过期', async () => {
    const { service, actionContext } = makeService();
    actionContext.loadLatest.mockResolvedValue({
      requestId: 'recent-1',
      action: 'withdraw',
      status: 'EXPIRED',
      summary: {},
      params: {},
      expiresAt: new Date(Date.now() - 5_000).toISOString(),
      expired: true,
    });
    const publish = jest
      .spyOn(service as any, 'publishDeterministicReply')
      .mockResolvedValue(undefined);

    const handled = await (service as any).handlePendingActionConfirmation({
      userId: 'u1',
      conversationId: 'c1',
      message: '确认',
      startedAt: Date.now(),
    });

    expect(handled).toBe(true);
    expect(publish).toHaveBeenCalled();
  });
});

describe('handleOtpInChat · 聊天框输验证码', () => {
  it('有 CONFIRMED 动作时，6 位数字直接走 OTP 校验', async () => {
    const { service, actionContext } = makeService();
    actionContext.loadLatest.mockResolvedValue({
      requestId: 'act-1',
      action: 'withdraw',
      status: 'CONFIRMED',
      summary: {},
      params: { amount: 100, channelId: 5, account: '0917', accountName: 'P' },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      expired: false,
    });
    const verify = jest
      .spyOn(service as any, 'confirmWithdrawOtp')
      .mockResolvedValue({ withdrawId: 'w-1' });

    const handled = await (service as any).handleOtpInChat({
      userId: 'u1',
      conversationId: 'c1',
      message: '123456',
      startedAt: Date.now(),
    });

    expect(handled).toBe(true);
    expect(verify).toHaveBeenCalledWith('123456', 'u1');
  });

  it('没有 CONFIRMED 动作时，6 位数字不拦截', async () => {
    const { service, actionContext } = makeService();
    actionContext.loadLatest.mockResolvedValue(null);

    const handled = await (service as any).handleOtpInChat({
      userId: 'u1',
      conversationId: 'c1',
      message: '123456',
      startedAt: Date.now(),
    });

    expect(handled).toBe(false);
  });

  it('验证码错误时给出可读提示，不进入 graph', async () => {
    const { service, actionContext } = makeService();
    actionContext.loadLatest.mockResolvedValue({
      requestId: 'act-1',
      action: 'withdraw',
      status: 'CONFIRMED',
      summary: {},
      params: {},
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      expired: false,
    });
    jest
      .spyOn(service as any, 'confirmWithdrawOtp')
      .mockRejectedValue(new Error('Invalid OTP code'));
    const publish = jest
      .spyOn(service as any, 'publishDeterministicReply')
      .mockResolvedValue(undefined);

    const handled = await (service as any).handleOtpInChat({
      userId: 'u1',
      conversationId: 'c1',
      message: '000000',
      startedAt: Date.now(),
    });

    expect(handled).toBe(true);
    expect(publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('验证码'),
    );
  });
});
