import { collectToolFacts, ToolCallInfo } from './tool-facts';

function call(name: string, result: unknown): ToolCallInfo {
  return { name, args: {}, result: JSON.stringify(result) };
}

describe('collectToolFacts', () => {
  it('getClaimableCoupons 留下 couponId 与 couponName', () => {
    const facts = collectToolFacts([
      call('getClaimableCoupons', {
        ok: true,
        data: {
          coupons: [
            { couponId: 'c1', couponName: 'Big Spender' },
            { couponId: 'c2', couponName: 'Free 30' },
          ],
        },
      }),
    ]);

    expect(facts).toEqual({
      claimableCoupons: [
        { couponId: 'c1', couponName: 'Big Spender' },
        { couponId: 'c2', couponName: 'Free 30' },
      ],
    });
  });

  it('getPaymentChannels 留下渠道 ID、名称与费率', () => {
    const facts = collectToolFacts([
      call('getPaymentChannels', {
        ok: true,
        data: [
          { id: 5, name: 'GCash Withdraw', feeRate: '0.008', feeFixed: '5.00' },
          { id: 4, name: 'Bank Transfer', feeRate: '0.01', feeFixed: '10.00' },
        ],
      }),
    ]);

    expect(facts).toEqual({
      withdrawChannels: [
        {
          channelId: 5,
          channelName: 'GCash Withdraw',
          feeRate: '0.008',
          feeFixed: '5.00',
        },
        {
          channelId: 4,
          channelName: 'Bank Transfer',
          feeRate: '0.01',
          feeFixed: '10.00',
        },
      ],
    });
  });

  it('兼容 stripToolResult 之后的裸 data', () => {
    const facts = collectToolFacts([
      {
        name: 'getUserCoupons',
        args: {},
        result: JSON.stringify({
          coupons: [{ couponId: 'c9', couponName: 'Mine' }],
        }),
      },
    ]);

    expect(facts).toEqual({
      userCoupons: [{ couponId: 'c9', couponName: 'Mine' }],
    });
  });

  it('失败结果不产生事实', () => {
    expect(
      collectToolFacts([call('getClaimableCoupons', { ok: false, error: 'x' })]),
    ).toBeNull();
  });

  it('未知工具与不可解析结果不产生事实', () => {
    expect(collectToolFacts([call('searchProducts', { ok: true, data: [] })]))
      .toBeNull();
    expect(collectToolFacts([{ name: 'getPaymentChannels', args: {}, result: 'not-json' }]))
      .toBeNull();
  });

  it('多工具调用合并，并限制列表长度', () => {
    const coupons = Array.from({ length: 8 }, (_, index) => ({
      couponId: `c${index}`,
      couponName: `Coupon ${index}`,
    }));
    const facts = collectToolFacts([
      call('getClaimableCoupons', { ok: true, data: { coupons } }),
      call('getWalletBalance', { ok: true, data: { realBalance: '1000.00' } }),
    ]);

    expect((facts?.claimableCoupons as unknown[]).length).toBe(5);
    expect(facts?.walletBalance).toEqual({ realBalance: '1000.00' });
  });
});

describe('collectToolFacts · toLLM 本地化标签', () => {
  it('渠道列表使用中文标签时也能提取', () => {
    const facts = collectToolFacts([
      call('getPaymentChannels', {
        ok: true,
        data: [
          {
            '渠道ID': 5,
            '渠道名称': 'GCash Withdraw',
            '手续费率': '0.008',
            '手续费': '₱5.00',
            '最小金额': '₱100.00',
            '最大金额': '₱50000.00',
          },
        ],
      }),
    ]);

    expect(facts).toEqual({
      withdrawChannels: [
        {
          channelId: 5,
          channelName: 'GCash Withdraw',
          feeRate: '0.008',
          feeFixed: '₱5.00',
        },
      ],
    });
  });

  it('券列表使用中文标签时也能提取', () => {
    const facts = collectToolFacts([
      call('getClaimableCoupons', {
        ok: true,
        data: {
          coupons: [
            { '优惠券模板 ID': 'c1', '优惠券名称': 'Big Spender' },
          ],
        },
      }),
    ]);

    expect(facts).toEqual({
      claimableCoupons: [{ couponId: 'c1', couponName: 'Big Spender' }],
    });
  });

  it('英文标签（Channel ID / Coupon ID）同样兼容', () => {
    const facts = collectToolFacts([
      call('getPaymentChannels', {
        ok: true,
        data: [{ 'Channel ID': 4, 'Channel Name': 'Bank Transfer' }],
      }),
      call('getUserCoupons', {
        ok: true,
        data: { coupons: [{ 'Coupon ID': 'c9', 'Coupon Name': 'Mine' }] },
      }),
    ]);

    expect(facts).toEqual({
      withdrawChannels: [
        { channelId: 4, channelName: 'Bank Transfer', feeRate: undefined, feeFixed: undefined },
      ],
      userCoupons: [{ couponId: 'c9', couponName: 'Mine' }],
    });
  });
});
