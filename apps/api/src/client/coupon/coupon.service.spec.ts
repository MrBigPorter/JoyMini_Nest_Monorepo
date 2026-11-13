import { BadRequestException } from '@nestjs/common';
import { ClientCouponService } from './coupon.service';

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
