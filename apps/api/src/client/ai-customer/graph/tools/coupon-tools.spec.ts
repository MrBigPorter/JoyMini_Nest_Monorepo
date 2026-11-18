import { createCouponTools } from './coupon-tools';
import { runWithContext } from '@api/common/logger/trace-context';

/**
 * 锁住优惠券工具的身份边界：
 *   - 模型传入的 userId 一律忽略
 *   - 实际使用的身份只来自请求上下文
 *   - 没有上下文时 fail-closed，不碰业务服务
 */
describe('coupon-tools 身份边界', () => {
  let couponService: {
    getMyCoupons: jest.Mock;
    claimCoupon: jest.Mock;
    redeemCode: jest.Mock;
    getClaimableCoupons: jest.Mock;
  };
  let tools: ReturnType<typeof createCouponTools>;

  const getTool = (name: string) => {
    const found = tools.find((t) => t.tool.name === name);
    if (!found) throw new Error(`tool ${name} not found`);
    return found.tool;
  };

  beforeEach(() => {
    couponService = {
      getMyCoupons: jest.fn().mockResolvedValue({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
      }),
      claimCoupon: jest.fn().mockResolvedValue({ id: 'uc-1', status: 0 }),
      redeemCode: jest.fn().mockResolvedValue({ success: true }),
      getClaimableCoupons: jest.fn().mockResolvedValue([]),
    };
    tools = createCouponTools(couponService as any);
  });

  it('查券使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getUserCoupons').invoke({
        status: 0,
        userId: 'user-B',
      } as any),
    );

    expect(couponService.getMyCoupons).toHaveBeenCalledWith(
      'user-A',
      expect.objectContaining({ status: 0, page: 1, pageSize: 10 }),
    );
  });

  it('领券使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('claimCoupon').invoke({
        couponId: 'coupon-1',
        userId: 'user-B',
      } as any),
    );

    expect(couponService.claimCoupon).toHaveBeenCalledWith(
      'user-A',
      'coupon-1',
      2,
    );
  });

  it('兑换码使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('redeemCouponCode').invoke({
        code: 'ABC123',
        userId: 'user-B',
      } as any),
    );

    expect(couponService.redeemCode).toHaveBeenCalledWith('user-A', 'ABC123');
  });

  it('领券中心使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getClaimableCoupons').invoke({ userId: 'user-B' } as any),
    );

    expect(couponService.getClaimableCoupons).toHaveBeenCalledWith('user-A');
  });

  it('没有请求上下文时 fail-closed，不调用业务服务', async () => {
    const raw = await getTool('getUserCoupons').invoke({ status: 0 } as any);

    expect(JSON.parse(raw as string)).toEqual({
      ok: false,
      error: 'Missing request user context',
    });
    expect(couponService.getMyCoupons).not.toHaveBeenCalled();
  });
});
