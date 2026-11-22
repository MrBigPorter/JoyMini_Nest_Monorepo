import { BadRequestException } from '@nestjs/common';
import { ClientCouponService, isCouponClaimableNow } from './coupon.service';

// ==================================================================
//  #85 P0-5 / T1-5：领券超卖
//
//  修复前：findUnique 读库存 → if 判断 → update 无条件 +1。
//          两个请求同时读到 9，都通过判断，最终发出 11 张（库存 10）。
//  修复后：条件 updateMany 把「库存够不够」下推到 SQL，
//          改 0 行 = 没抢到，必须抛错回滚。
// ==================================================================

function createService() {
  const tx = {
    coupon: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    userCoupon: {
      count: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const service = new ClientCouponService(prisma as any);
  return { service, tx, prisma };
}

const activeCoupon = {
  id: 'coupon-1',
  status: 1,
  issueType: 1,
  totalQuantity: 10,
  issuedQuantity: 9,
  perUserLimit: 1,
  validType: 2, // 领券后 N 天
  validDays: 7,
  validStartAt: null,
  validEndAt: null,
};

describe('ClientCouponService.claimCoupon 原子扣减（T1-5）', () => {
  it('库存扣减改到 1 行 → 发券成功', async () => {
    const { service, tx } = createService();
    tx.coupon.findUnique.mockResolvedValue(activeCoupon);
    tx.userCoupon.count.mockResolvedValue(0);
    tx.coupon.updateMany.mockResolvedValue({ count: 1 });
    tx.userCoupon.create.mockResolvedValue({ id: 'uc-1' });

    const result = await service.claimCoupon('u-1', 'coupon-1');

    expect(result).toEqual({ id: 'uc-1' });
    expect(tx.userCoupon.create).toHaveBeenCalledTimes(1);
  });

  it('并发下被别人抢先扣完（改到 0 行）→ 抛错，且不创建券', async () => {
    const { service, tx } = createService();
    tx.coupon.findUnique.mockResolvedValue(activeCoupon);
    tx.userCoupon.count.mockResolvedValue(0);
    // 关键：条件不成立，数据库改了 0 行
    tx.coupon.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.claimCoupon('u-1', 'coupon-1')).rejects.toThrow(
      BadRequestException,
    );

    // 没抢到就绝不能发券
    expect(tx.userCoupon.create).not.toHaveBeenCalled();
  });

  it('库存条件必须写进 WHERE（issuedQuantity < totalQuantity）', async () => {
    const { service, tx } = createService();
    tx.coupon.findUnique.mockResolvedValue(activeCoupon);
    tx.userCoupon.count.mockResolvedValue(0);
    tx.coupon.updateMany.mockResolvedValue({ count: 1 });
    tx.userCoupon.create.mockResolvedValue({ id: 'uc-1' });

    await service.claimCoupon('u-1', 'coupon-1');

    expect(tx.coupon.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'coupon-1',
          issuedQuantity: { lt: 10 },
        }),
        data: { issuedQuantity: { increment: 1 } },
      }),
    );
  });

  it('不限量（totalQuantity = -1）→ WHERE 里不加库存上限', async () => {
    const { service, tx } = createService();
    tx.coupon.findUnique.mockResolvedValue({
      ...activeCoupon,
      totalQuantity: -1,
    });
    tx.userCoupon.count.mockResolvedValue(0);
    tx.coupon.updateMany.mockResolvedValue({ count: 1 });
    tx.userCoupon.create.mockResolvedValue({ id: 'uc-1' });

    await service.claimCoupon('u-1', 'coupon-1');

    const call = tx.coupon.updateMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty('issuedQuantity');
  });

  // ── T1-6：每人限领的并发洞 ──
  //
  //  修复前：count（查已领）在 updateMany（扣库存）【之前】。
  //          同一用户并发 N 个请求，在扣库存排队之前就都通过了限领判断，
  //          最终一个人领走 N 张（只受库存限制）。
  //  修复后：count 挪到 updateMany 之后。updateMany 会锁住券模板那一行，
  //          并发请求被迫排队；排队结束后再 count，才能看到别人刚提交的券。

  it('已达每人限领上限（扣完库存才查到 1 张）→ 抛错，不发券', async () => {
    const { service, tx } = createService();
    tx.coupon.findUnique.mockResolvedValue(activeCoupon);
    // 关键：库存扣减成功了，但查到用户已经有 1 张（perUserLimit = 1）
    tx.coupon.updateMany.mockResolvedValue({ count: 1 });
    tx.userCoupon.count.mockResolvedValue(1);

    await expect(service.claimCoupon('u-1', 'coupon-1')).rejects.toThrow(
      BadRequestException,
    );

    // 库存虽然扣了，但抛错会回滚整个事务；券绝对不能发出去
    expect(tx.userCoupon.create).not.toHaveBeenCalled();
  });

  it('必须先扣库存、后查已领（锁的顺序不能被调回去）', async () => {
    const { service, tx } = createService();
    tx.coupon.findUnique.mockResolvedValue(activeCoupon);
    tx.coupon.updateMany.mockResolvedValue({ count: 1 });
    tx.userCoupon.count.mockResolvedValue(0);
    tx.userCoupon.create.mockResolvedValue({ id: 'uc-1' });

    await service.claimCoupon('u-1', 'coupon-1');

    // invocationCallOrder 是 jest 记录的全局调用序号，比大小即知先后
    const updateOrder = tx.coupon.updateMany.mock.invocationCallOrder[0];
    const countOrder = tx.userCoupon.count.mock.invocationCallOrder[0];

    expect(updateOrder).toBeLessThan(countOrder);
  });
});

// ==================================================================
//  A-12：可领取列表必须校验有效期
// ==================================================================
describe('isCouponClaimableNow · 有效期谓词', () => {
  const now = new Date('2026-11-22T18:00:00Z');

  it('固定窗口且未过期 → true', () => {
    expect(
      isCouponClaimableNow(
        {
          validType: 1,
          validStartAt: new Date('2026-11-01T00:00:00Z'),
          validEndAt: new Date('2026-12-01T00:00:00Z'),
        },
        now,
      ),
    ).toBe(true);
  });

  it('固定窗口已过期 → false', () => {
    expect(
      isCouponClaimableNow(
        {
          validType: 1,
          validStartAt: new Date('2026-07-01T00:00:00Z'),
          validEndAt: new Date('2026-08-10T00:00:00Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it('固定窗口尚未开始 → false', () => {
    expect(
      isCouponClaimableNow(
        {
          validType: 1,
          validStartAt: new Date('2026-12-01T00:00:00Z'),
          validEndAt: new Date('2026-12-31T00:00:00Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it('固定窗口缺少结束时间 → false', () => {
    expect(
      isCouponClaimableNow(
        { validType: 1, validStartAt: null, validEndAt: null },
        now,
      ),
    ).toBe(false);
  });

  it('固定窗口开始时间为空视为已开始 → true', () => {
    expect(
      isCouponClaimableNow(
        {
          validType: 1,
          validStartAt: null,
          validEndAt: new Date('2026-12-01T00:00:00Z'),
        },
        now,
      ),
    ).toBe(true);
  });

  it('领取后 N 天且天数 > 0 → true', () => {
    expect(
      isCouponClaimableNow(
        { validType: 2, validStartAt: null, validEndAt: null, validDays: 7 },
        now,
      ),
    ).toBe(true);
  });

  it('领取后 N 天但天数为 0/null → false', () => {
    expect(
      isCouponClaimableNow(
        { validType: 2, validStartAt: null, validEndAt: null, validDays: 0 },
        now,
      ),
    ).toBe(false);
    expect(
      isCouponClaimableNow(
        { validType: 2, validStartAt: null, validEndAt: null, validDays: null },
        now,
      ),
    ).toBe(false);
  });
});

describe('ClientCouponService.getClaimableCoupons · 过期券过滤', () => {
  function createListService() {
    const prisma = {
      coupon: { findMany: jest.fn() },
      userCoupon: { findMany: jest.fn(async () => []) },
    };
    return { service: new ClientCouponService(prisma as any), prisma };
  }

  it('已过期券从列表结果中移除', async () => {
    const { service, prisma } = createListService();
    prisma.coupon.findMany.mockResolvedValue([
      {
        id: 'expired',
        couponName: 'Big Spender',
        couponType: 1,
        discountValue: '200.00',
        minPurchase: '1000.00',
        totalQuantity: 100,
        issuedQuantity: 1,
        perUserLimit: 10,
        validType: 1,
        validStartAt: new Date('2026-07-01T00:00:00Z'),
        validEndAt: new Date('2026-08-10T00:00:00Z'),
      },
      {
        id: 'active',
        couponName: 'Fixture',
        couponType: 1,
        discountValue: '10.00',
        minPurchase: '100.00',
        totalQuantity: 100,
        issuedQuantity: 3,
        perUserLimit: 1,
        validType: 2,
        validDays: 7,
        validStartAt: null,
        validEndAt: null,
      },
    ]);

    const result = await service.getClaimableCoupons('u1');

    expect(result.map((item) => item.couponId)).toEqual(['active']);
  });
});

// ==================================================================
//  A-12：领取执行必须与可领取列表的有效期口径一致
// ==================================================================
describe('ClientCouponService.claimCoupon 有效期', () => {
  it('固定窗口已过期 → 拒绝，不扣库存', async () => {
    const { service, tx } = createService();
    tx.coupon.findUnique.mockResolvedValue({
      ...activeCoupon,
      validType: 1,
      validStartAt: new Date('2026-07-01T00:00:00Z'),
      validEndAt: new Date('2026-08-10T00:00:00Z'),
      validDays: null,
    });

    await expect(service.claimCoupon('u-1', 'coupon-1')).rejects.toThrow(
      'This coupon has expired',
    );
    expect(tx.coupon.updateMany).not.toHaveBeenCalled();
    expect(tx.userCoupon.create).not.toHaveBeenCalled();
  });

  it('固定窗口尚未开始 → 拒绝，不扣库存', async () => {
    const { service, tx } = createService();
    tx.coupon.findUnique.mockResolvedValue({
      ...activeCoupon,
      validType: 1,
      validStartAt: new Date('2099-01-01T00:00:00Z'),
      validEndAt: new Date('2099-12-31T00:00:00Z'),
      validDays: null,
    });

    await expect(service.claimCoupon('u-1', 'coupon-1')).rejects.toThrow(
      'This coupon is not yet valid',
    );
    expect(tx.coupon.updateMany).not.toHaveBeenCalled();
  });

  it('固定窗口缺少结束时间 → 拒绝', async () => {
    const { service, tx } = createService();
    tx.coupon.findUnique.mockResolvedValue({
      ...activeCoupon,
      validType: 1,
      validStartAt: null,
      validEndAt: null,
      validDays: null,
    });

    await expect(service.claimCoupon('u-1', 'coupon-1')).rejects.toThrow(
      'Coupon has no valid period',
    );
    expect(tx.coupon.updateMany).not.toHaveBeenCalled();
  });

  it('领取后 N 天但没有有效天数 → 拒绝', async () => {
    const { service, tx } = createService();
    tx.coupon.findUnique.mockResolvedValue({
      ...activeCoupon,
      validType: 2,
      validDays: 0,
    });

    await expect(service.claimCoupon('u-1', 'coupon-1')).rejects.toThrow(
      'Coupon has no valid period',
    );
    expect(tx.coupon.updateMany).not.toHaveBeenCalled();
  });
});
