import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RECHARGE_STATUS, WITHDRAW_STATUS } from '@lucky/shared';

/** 提现待审核状态 = 1 */
const WITHDRAW_PENDING = WITHDRAW_STATUS.PENDING_AUDIT;
/** 充值成功状态 = 3 */
const RECHARGE_SUCCESS = RECHARGE_STATUS.SUCCESS;
/** 订单已支付状态 = 2 */
const ORDER_PAID = 2;

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 总览统计：用户数、订单数、收入、财务
   */
  async getOverview() {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      newUsersToday,
      newUsersThisMonth,
      totalOrders,
      ordersToday,
      paidOrders,
      revenueResult,
      revenueTodayResult,
      pendingWithdrawCount,
      pendingWithdrawAmountResult,
      totalDepositResult,
    ] = await Promise.all([
      this.prisma.user.count({ where: { status: 1 } }),
      this.prisma.user.count({
        where: { status: 1, createdAt: { gte: todayStart } },
      }),
      this.prisma.user.count({
        where: { status: 1, createdAt: { gte: monthStart } },
      }),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.order.count({ where: { orderStatus: ORDER_PAID } }),
      this.prisma.order.aggregate({
        _sum: { finalAmount: true },
        where: { orderStatus: ORDER_PAID },
      }),
      this.prisma.order.aggregate({
        _sum: { finalAmount: true },
        where: { orderStatus: ORDER_PAID, paidAt: { gte: todayStart } },
      }),
      this.prisma.withdrawOrder.count({
        where: { withdrawStatus: WITHDRAW_PENDING },
      }),
      this.prisma.withdrawOrder.aggregate({
        _sum: { withdrawAmount: true },
        where: { withdrawStatus: WITHDRAW_PENDING },
      }),
      this.prisma.rechargeOrder.aggregate({
        _sum: { actualAmount: true },
        where: { rechargeStatus: RECHARGE_SUCCESS },
      }),
    ]);

    return {
      users: {
        total: totalUsers,
        today: newUsersToday,
        thisMonth: newUsersThisMonth,
      },
      orders: {
        total: totalOrders,
        today: ordersToday,
        paid: paidOrders,
      },
      revenue: {
        total: revenueResult._sum.finalAmount?.toString() ?? '0',
        today: revenueTodayResult._sum.finalAmount?.toString() ?? '0',
      },
      finance: {
        totalDeposit: totalDepositResult._sum.actualAmount?.toString() ?? '0',
        pendingWithdrawCount,
        pendingWithdrawAmount:
          pendingWithdrawAmountResult._sum.withdrawAmount?.toString() ?? '0',
      },
    };
  }

  /**
   * 趋势数据（默认最近 30 天）
   * 使用 PostgreSQL 原生 SQL 按日期聚合
   */
  async getTrend(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days + 1);
    cutoff.setHours(0, 0, 0, 0);

    const [orderTrend, userTrend] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ date: string; count: bigint; revenue: string }>
      >`
        SELECT
          TO_CHAR(created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date,
          COUNT(*)::text AS count,
          COALESCE(
            SUM(CASE WHEN order_status = 2 THEN final_amount ELSE 0 END), 0
          )::text AS revenue
        FROM orders
        WHERE created_at >= ${cutoff}
        GROUP BY date
        ORDER BY date ASC
      `,
      this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
        SELECT
          TO_CHAR(created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date,
          COUNT(*)::text AS count
        FROM users
        WHERE created_at >= ${cutoff}
          AND status = 1
        GROUP BY date
        ORDER BY date ASC
      `,
    ]);

    return {
      orders: orderTrend.map((r) => ({
        date: r.date,
        count: Number(r.count),
        revenue: r.revenue,
      })),
      users: userTrend.map((r) => ({
        date: r.date,
        count: Number(r.count),
      })),
    };
  }
}
