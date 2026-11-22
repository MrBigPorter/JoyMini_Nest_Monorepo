import {
  describeClaimRejection,
  localizeClaimError,
} from './coupon-claim-errors';

const now = new Date('2026-11-22T18:00:00Z');
const active = {
  status: 1,
  validType: 1,
  validStartAt: new Date('2026-11-01T00:00:00Z'),
  validEndAt: new Date('2026-12-01T00:00:00Z'),
  validDays: null,
  totalQuantity: 100,
  issuedQuantity: 10,
  perUserLimit: 1,
};

describe('localizeClaimError', () => {
  it.each([
    ['This coupon has expired', '已过期'],
    ['This coupon is not yet valid', '还没有开始'],
    ['Coupon has no valid period', '没有有效期限'],
    ['You have reached the maximum claim limit', '领取上限'],
    ['This coupon has been fully claimed', '领完'],
    ['Coupon is not available or inactive', '下架'],
  ])('%s → 中文提示包含「%s」', (raw, expected) => {
    expect(localizeClaimError(raw)).toContain(expected);
  });

  it('未知错误原样返回', () => {
    expect(localizeClaimError('db down')).toBe('db down');
  });
});

describe('describeClaimRejection', () => {
  it('已过期', () => {
    expect(
      describeClaimRejection({
        coupon: { ...active, validEndAt: new Date('2026-08-10T00:00:00Z') },
        claimedCount: 0,
        now,
      }),
    ).toContain('已过期');
  });

  it('尚未开始', () => {
    expect(
      describeClaimRejection({
        coupon: { ...active, validStartAt: new Date('2099-01-01T00:00:00Z'), validEndAt: new Date('2099-12-31T00:00:00Z') },
        claimedCount: 0,
        now,
      }),
    ).toContain('还没有开始');
  });

  it('没有有效期限', () => {
    expect(
      describeClaimRejection({
        coupon: { ...active, validType: 2, validDays: 0 },
        claimedCount: 0,
        now,
      }),
    ).toContain('没有有效期限');
  });

  it('已抢光', () => {
    expect(
      describeClaimRejection({
        coupon: { ...active, totalQuantity: 10, issuedQuantity: 10 },
        claimedCount: 0,
        now,
      }),
    ).toContain('领完');
  });

  it('已达每人限领', () => {
    expect(
      describeClaimRejection({ coupon: active, claimedCount: 1, now }),
    ).toContain('领取上限');
  });

  it('已下架/不存在', () => {
    expect(describeClaimRejection({ coupon: null, claimedCount: 0, now })).toContain('下架');
    expect(
      describeClaimRejection({ coupon: { ...active, status: 0 }, claimedCount: 0, now }),
    ).toContain('下架');
  });

  it('其余情况给通用提示', () => {
    expect(
      describeClaimRejection({ coupon: active, claimedCount: 0, now }),
    ).toContain('不可领取');
  });
});
