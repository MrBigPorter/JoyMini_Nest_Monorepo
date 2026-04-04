import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { ORDER_STATUS } from '@lucky/shared';
import { randomInt } from 'crypto';

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class LotteryService {
  private readonly logger = new Logger(LotteryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 开奖核心逻辑（必须在外部 $transaction 内调用）
   * 从该团所有真人成员中随机选出 1 位 winner（按购买份数加权）
   * winner → WAIT_DELIVERY，其余真人 → COMPLETED
   */
  async drawWinner(
    groupId: string,
    tx: Tx,
  ): Promise<{ winnerId: string; winnerOrderId: string }> {
    const db = tx as Prisma.TransactionClient;

    // 1. 取出该团所有真人成员（排除机器人 memberType=1）
    const members = await db.treasureGroupMember.findMany({
      where: { groupId, memberType: 0 },
      select: { userId: true, orderId: true },
    });

    const group = await db.treasureGroup.findUniqueOrThrow({
      where: { groupId },
      select: { treasureId: true },
    });

    // 2. 按购买份数加权（买 3 份 = 3 张签）
    const tickets: Array<{ userId: string; orderId: string }> = [];
    for (const m of members) {
      if (!m.orderId) continue;
      const order = await db.order.findUnique({
        where: { orderId: m.orderId },
        select: { buyQuantity: true },
      });
      const qty = order?.buyQuantity ?? 1;
      for (let i = 0; i < qty; i++) {
        tickets.push({ userId: m.userId, orderId: m.orderId });
      }
    }

    if (tickets.length === 0) {
      throw new Error(`No eligible participants for group ${groupId}`);
    }

    // 3. 密码学安全随机（比 Math.random 更难被预测）
    const idx = randomInt(0, tickets.length);
    const winner = tickets[idx];

    // 4. 写入开奖结果（uk_lottery_group 唯一索引保证幂等）
    await db.lotteryResult.create({
      data: {
        groupId,
        treasureId: group.treasureId,
        winnerId: winner.userId,
        winnerOrderId: winner.orderId,
      },
    });

    // 5. 更新 TreasureGroup 开奖时间
    await db.treasureGroup.update({
      where: { groupId },
      data: { drawnAt: new Date(), luckyWinnersCount: 1 },
    });

    // 6. 所有真人订单 ID（去重）
    const allOrderIds = [...new Set(tickets.map((t) => t.orderId))];

    // 7. 非 winner 的真人订单 → COMPLETED（参与奖）
    const loserOrderIds = allOrderIds.filter((id) => id !== winner.orderId);
    if (loserOrderIds.length > 0) {
      await db.order.updateMany({
        where: { orderId: { in: loserOrderIds } },
        data: { orderStatus: ORDER_STATUS.COMPLETED },
      });
    }

    // 8. winner 订单 → WAIT_DELIVERY
    await db.order.update({
      where: { orderId: winner.orderId },
      data: { orderStatus: ORDER_STATUS.WAIT_DELIVERY },
    });

    this.logger.log(
      `[Lottery] Group ${groupId} winner: ${winner.userId} (order: ${winner.orderId})`,
    );
    return { winnerId: winner.userId, winnerOrderId: winner.orderId };
  }
}
