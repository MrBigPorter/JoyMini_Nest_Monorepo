import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { QueryMyCouponsDto } from '@api/client/coupon/dto/query-my-coupons-dto';

@Injectable()
export class ClientCouponService {
  constructor(private prisma: PrismaService) {}

  /**
   * 1. 查询我的优惠券 (带自动过期清洗机制)
   */
  async getMyCoupons(userId: string, dto: QueryMyCouponsDto) {
    const { page, pageSize, status, orderAmount } = dto;
    const skip = (page - 1) * pageSize;

    //  实时状态清洗：如果未使用且已过期的券，顺手把它标为“已过期 (2)”
    await this.prisma.userCoupon.updateMany({
      where: {
        userId,
        status: 0, // 未使用
        validEndAt: { lt: new Date() }, // 当前时间大于结束时间
      },
      data: { status: 2 }, // 2-已过期
    });

    const whereParams: Prisma.UserCouponWhereInput = { userId };

    // 按状态过滤
    if (status !== undefined) {
      whereParams.status = status;
    }

    //  支付页动态过滤：只查询门槛 <= 订单金额 的券
    if (orderAmount !== undefined && orderAmount > 0) {
      whereParams.coupon = {
        minPurchase: { lte: orderAmount },
      };
    }

    const [total, userCoupons] = await this.prisma.$transaction([
      this.prisma.userCoupon.count({ where: whereParams }),
      this.prisma.userCoupon.findMany({
        where: whereParams,
        skip,
        take: pageSize,
        include: { coupon: true }, // 连表查询
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const list = userCoupons.map((uc) => ({
      userCouponId: uc.id,
      status: uc.status,
      validStartAt: uc.validStartAt,
      validEndAt: uc.validEndAt,
      couponName: uc.coupon.couponName,
      couponType: uc.coupon.couponType,
      discountValue: uc.coupon.discountValue,
      minPurchase: uc.coupon.minPurchase,
      ruleDesc: uc.coupon.ruleDesc,
    }));

    return { total, list, page, pageSize };
  }

  /**
   * 2. 核心：发券/领券事务引擎
   * 包含防超卖、防超领、有效期计算
   */
  async claimCoupon(
    userId: string,
    couponId: string,
    expectedIssueType?: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. 悲观锁锁定券模板 (防止高并发超卖)
      const coupon = await tx.coupon.findUnique({
        where: { id: couponId },
      });

      if (!coupon || coupon.status !== 1) {
        // 1 = Active
        throw new BadRequestException('Coupon is not available or inactive');
      }

      // 校验发放途径是否匹配 (防止抓包绕过：把兑换码的券当普通领取调接口)
      if (expectedIssueType && coupon.issueType !== expectedIssueType) {
        throw new BadRequestException('Invalid claiming method');
      }

      // 3. 校验用户个人限领数量
      const userClaimedCount = await tx.userCoupon.count({
        where: { userId, couponId },
      });
      if (userClaimedCount >= coupon.perUserLimit) {
        throw new BadRequestException(
          'You have reached the maximum claim limit',
        );
      }

      // 4. 动态计算实例有效期
      const now = new Date();
      let validStartAt = now;
      let validEndAt = now;

      if (coupon.validType === 1) {
        // 固定日期
        validStartAt = coupon.validStartAt ?? now;
        validEndAt = coupon.validEndAt ?? now;
        if (now > validEndAt) {
          throw new BadRequestException('This coupon has expired');
        }
      } else {
        // 领券后 N 天
        validEndAt = new Date(
          now.getTime() + (coupon.validDays || 0) * 24 * 60 * 60 * 1000,
        );
      }

      // 5. 条件扣减库存：把「检查」和「修改」焊成同一条 SQL
      //    totalQuantity === -1 表示不限量，此时不加库存上限条件
      const claimed = await tx.coupon.updateMany({
        where: {
          id: couponId,
          ...(coupon.totalQuantity === -1
            ? {}
            : { issuedQuantity: { lt: coupon.totalQuantity } }),
        },
        data: { issuedQuantity: { increment: 1 } },
      });

      // 改了 0 行 = 在这一瞬间被别人抢光了
      if (claimed.count !== 1) {
        throw new BadRequestException('This coupon has been fully claimed');
      }

      return tx.userCoupon.create({
        data: {
          userId,
          couponId,
          receiveType: coupon.issueType, // 继承发放类型 (手动/兑换码等)
          status: 0, // 0-未使用
          validStartAt,
          validEndAt,
        },
      });
    });
  }

  /**
   * 3. 兑换码兑换
   */
  async redeemCode(userId: string, code: string) {
    // 找出大写的 code 对应的、类型为 3 (Redeem Code) 的券
    const coupon = await this.prisma.coupon.findFirst({
      where: {
        couponCode: code.trim().toUpperCase(),
        issueType: 3,
        status: 1,
      },
    });

    if (!coupon) {
      throw new BadRequestException('Invalid or expired redeem code');
    }

    // 复用核心领券事务
    await this.claimCoupon(userId, coupon.id, 3);
    return { success: true, message: 'Successfully redeemed' };
  }

  /**
   * 4. 获取领券中心大厅可领取的券 (Level 3)
   */
  async getClaimableCoupons(userId: string) {
    // 1. 查出所有允许手动领取的有效券模板
    const claimableCoupons = await this.prisma.coupon.findMany({
      where: {
        issueType: 2, // 2-用户手动领取
        status: 1, // 1-进行中
      },
      orderBy: { createdAt: 'desc' },
    });

    if (claimableCoupons.length === 0) return [];

    // 2. 查出当前用户已经领过这些券的数量
    const userCoupons = await this.prisma.userCoupon.findMany({
      where: {
        userId,
        couponId: { in: claimableCoupons.map((c) => c.id) },
      },
      select: { couponId: true },
    });

    // 统计当前用户每种券领了多少张
    const claimedCountMap = userCoupons.reduce(
      (acc, curr) => {
        acc[curr.couponId] = (acc[curr.couponId] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // 3. 组装并计算进度返回给前端
    return claimableCoupons.map((coupon) => {
      const myClaimedCount = claimedCountMap[coupon.id] || 0;

      let progressVal = 0;
      if (coupon.totalQuantity !== -1 && coupon.totalQuantity > 0) {
        const ratio = (coupon.issuedQuantity / coupon.totalQuantity) * 100;

        if (coupon.issuedQuantity >= coupon.totalQuantity) {
          progressVal = 100; // 只有真正抢光了，才给 100%
        } else if (coupon.issuedQuantity > 0 && ratio < 1) {
          progressVal = 1; // 只要发出去过，哪怕只有 0.1%，保底给 1%（制造热销感）
        } else {
          progressVal = Math.floor(ratio); // 强行向下取整，99.9% 也只显示 99%
        }
      }

      // 核心逻辑计算
      const isStockAvailable =
        coupon.totalQuantity === -1 ||
        coupon.issuedQuantity < coupon.totalQuantity;

      const hasReachedLimit = myClaimedCount >= coupon.perUserLimit;
      const canClaim = isStockAvailable && !hasReachedLimit;

      const isClaimed = hasReachedLimit;
      const isSoldOut = !isStockAvailable;

      return {
        couponId: coupon.id,
        couponName: coupon.couponName,
        couponType: coupon.couponType,
        discountValue: coupon.discountValue,
        minPurchase: coupon.minPurchase,
        totalQuantity: coupon.totalQuantity,
        issuedQuantity: coupon.issuedQuantity,

        progress: progressVal.toString(),

        canClaim,
        hasReachedLimit,
        isClaimed,
        isSoldOut,
      };
    });
  }
}
