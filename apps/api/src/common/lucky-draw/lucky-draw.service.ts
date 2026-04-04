import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { WalletService } from '@api/client/wallet/wallet.service';
import { randomInt } from 'crypto';
import { EventsGateway } from '@api/common/events/events.gateway';
import { SocketEvents } from '@lucky/shared';

type Tx = Prisma.TransactionClient | PrismaService;

export interface DrawResult {
  prizeType: 1 | 2 | 3 | 4;
  prizeName: string;
  prizeValue?: number;
  isWin: boolean;
  userCouponId?: string;
  /** 抽奖结果记录 ID */
  resultId: string;
  /** 抽奖时间戳（ms） */
  drawnAt: number;
}

@Injectable()
export class LuckyDrawService {
  private readonly logger = new Logger(LuckyDrawService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  // =====================================================================
  // 发券 — 团购成功时（在 GroupProcessor 事务外 fire-and-forget 调用）
  // =====================================================================
  async issueTicketsForGroup(groupId: string): Promise<void> {
    const group = await this.prisma.treasureGroup.findUnique({
      where: { groupId },
      select: {
        treasureId: true,
        members: {
          where: { memberType: 0 },
          select: { userId: true, orderId: true },
        },
      },
    });
    if (!group) return;

    const activity = await this.findActiveActivity(group.treasureId);
    if (!activity) return;

    for (const m of group.members) {
      if (!m.orderId) continue;
      await this.issueOneTicket(m.userId, m.orderId, activity.id)
        .then((ticket) => {
          this.eventsGateway.dispatchToUser(
            m.userId,
            SocketEvents.LUCKY_DRAW_TICKET_ISSUED,
            {
              groupId,
              ticketId: ticket.id,
              activityId: ticket.activityId,
              orderId: ticket.orderId,
              issuedAt: ticket.createdAt.getTime(),
            },
          );
        })
        .catch((e: unknown) => {
          this.logger.warn(
            `LuckyDraw ticket skip (group ${groupId}, user ${m.userId}): ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        });
    }
  }

  // =====================================================================
  // 发券 — 单独购买时（在 OrderService.checkOut 事务外 fire-and-forget 调用）
  // =====================================================================
  async issueTicketForOrder(
    userId: string,
    treasureId: string,
    orderId: string,
  ): Promise<void> {
    const activity = await this.findActiveActivity(treasureId);
    if (!activity) return;
    await this.issueOneTicket(userId, orderId, activity.id).catch(
      (e: unknown) => {
        this.logger.warn(
          `LuckyDraw ticket skip (solo order ${orderId}): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      },
    );
  }

  // =====================================================================
  // 查询 — 用户票列表 / 历史结果
  // =====================================================================

  async listTickets(
    userId: string,
    opts: { page: number; pageSize: number; unusedOnly?: boolean },
  ) {
    const { page, pageSize, unusedOnly } = opts;
    const where = {
      userId,
      ...(unusedOnly ? { used: false } : {}),
    };
    const [total, list] = await Promise.all([
      this.prisma.luckyDrawTicket.count({ where }),
      this.prisma.luckyDrawTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          activity: { select: { title: true, endAt: true } },
          result: {
            select: {
              id: true,
              createdAt: true,
              prizeSnapshot: true,
              prize: {
                select: { prizeName: true, prizeType: true, prizeValue: true },
              },
            },
          },
        },
      }),
    ]);
    return {
      list: list.map((t) => ({
        id: t.id,
        activityId: t.activityId,
        activityTitle: t.activity?.title ?? null,
        activityEndAt: t.activity?.endAt?.getTime() ?? null,
        orderId: t.orderId,
        used: t.used,
        usedAt: t.usedAt?.getTime() ?? null,
        expireAt: t.expireAt?.getTime() ?? null,
        createdAt: t.createdAt.getTime(),
        result: t.result
          ? {
              id: t.result.id,
              createdAt: t.result.createdAt.getTime(),
              prizeType: t.result.prize.prizeType,
              prizeName: t.result.prize.prizeName,
              prizeValue: t.result.prize.prizeValue?.toNumber() ?? null,
              prizeSnapshot: t.result.prizeSnapshot,
            }
          : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async listResults(userId: string, opts: { page: number; pageSize: number }) {
    const { page, pageSize } = opts;
    const [total, list] = await Promise.all([
      this.prisma.luckyDrawResult.count({ where: { userId } }),
      this.prisma.luckyDrawResult.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          prize: {
            select: { prizeName: true, prizeType: true, prizeValue: true },
          },
          ticket: { select: { orderId: true } },
        },
      }),
    ]);
    return {
      list: list.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.getTime(),
        orderId: r.ticket.orderId,
        prizeId: r.prizeId,
        prizeName: r.prize.prizeName,
        prizeType: r.prize.prizeType,
        prizeValue: r.prize.prizeValue?.toNumber() ?? null,
        prizeSnapshot: r.prizeSnapshot,
      })),
      total,
      page,
      pageSize,
    };
  }

  // =====================================================================
  // 抽奖 — 用户点击「抽一下」时
  // =====================================================================
  async draw(userId: string, ticketId: string): Promise<DrawResult> {
    return this.prisma.$transaction(async (tx) => {
      // 1. 原子标记 ticket（防止并发重复抽）
      const updated = await tx.$executeRaw`
        UPDATE lucky_draw_tickets
           SET used = true, used_at = NOW()
         WHERE id = ${ticketId}
           AND user_id = ${userId}
           AND used = false
      `;
      if (updated === 0) {
        const ticket = await tx.luckyDrawTicket.findUnique({
          where: { id: ticketId },
        });
        if (!ticket || ticket.userId !== userId) {
          throw new NotFoundException('Ticket not found');
        }
        throw new ConflictException('Ticket already used');
      }

      const ticket = await tx.luckyDrawTicket.findUniqueOrThrow({
        where: { id: ticketId },
        select: { activityId: true },
      });

      // 2. 读取活动奖品（按 sortOrder，只取有库存的）
      const prizes = await tx.luckyDrawPrize.findMany({
        where: {
          activityId: ticket.activityId,
          OR: [{ stock: -1 }, { stock: { gt: 0 } }],
        },
        orderBy: { sortOrder: 'asc' },
      });

      if (prizes.length === 0) {
        throw new NotFoundException('No prizes configured for this activity');
      }

      // 3. 加权随机抽签（精度 0.01%）
      const PRECISION = 10000;
      const roll = randomInt(0, PRECISION);
      let cumulative = 0;
      let selectedPrize = prizes[prizes.length - 1];
      for (const prize of prizes) {
        // 概率是小数（如0.30表示30%），需要乘以PRECISION来匹配roll的范围
        cumulative += Math.round(prize.probability.toNumber() * PRECISION);
        if (roll < cumulative) {
          selectedPrize = prize;
          break;
        }
      }

      // 4. 若有库存限制，原子扣减；失败则降级到 prizeType=4
      if (selectedPrize.stock !== -1) {
        const deducted = await tx.$executeRaw`
          UPDATE lucky_draw_prizes
             SET stock = stock - 1
           WHERE id = ${selectedPrize.id}
             AND stock > 0
        `;
        if (deducted === 0) {
          selectedPrize =
            prizes.find((p) => p.prizeType === 4) ?? selectedPrize;
        }
      }

      // 5. 奖品快照
      const prizeSnapshot = {
        id: selectedPrize.id,
        prizeType: selectedPrize.prizeType,
        prizeName: selectedPrize.prizeName,
        prizeValue: selectedPrize.prizeValue?.toNumber() ?? null,
        couponId: selectedPrize.couponId ?? null,
      };

      // 6. 奖品下发
      let userCouponId: string | undefined;
      let fallbackReason: string | undefined;

      try {
        if (selectedPrize.prizeType === 1 && selectedPrize.couponId) {
          userCouponId = await this.issueCouponInTx(
            tx,
            userId,
            selectedPrize.couponId,
          );
        } else if (selectedPrize.prizeType === 2 && selectedPrize.prizeValue) {
          await this.wallet.creditCoin(
            {
              userId,
              coins: selectedPrize.prizeValue,
              related: { id: ticketId, type: 'LUCKY_DRAW' },
              desc: `Lucky Draw: ${selectedPrize.prizeName}`,
            },
            tx as unknown as Tx,
          );
        } else if (selectedPrize.prizeType === 3 && selectedPrize.prizeValue) {
          await this.wallet.creditCash(
            {
              userId,
              amount: selectedPrize.prizeValue,
              related: { id: ticketId, type: 'LUCKY_DRAW' },
              desc: `Lucky Draw: ${selectedPrize.prizeName}`,
            },
            tx as unknown as Tx,
          );
        }
        // prizeType === 4：谢谢参与，无操作
      } catch (e: unknown) {
        fallbackReason = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `LuckyDraw prize issue failed, fallback: ${fallbackReason}`,
        );
        selectedPrize = prizes.find((p) => p.prizeType === 4) ?? selectedPrize;
        userCouponId = undefined;
      }

      // 7. 写入抽奖结果
      const drawResult = await tx.luckyDrawResult.create({
        data: {
          ticketId,
          userId,
          prizeId: selectedPrize.id,
          prizeSnapshot: {
            ...(prizeSnapshot as Prisma.JsonObject),
            ...(fallbackReason ? { fallback: true, fallbackReason } : {}),
          },
        },
        select: { id: true, createdAt: true },
      });

      return {
        prizeType: selectedPrize.prizeType as 1 | 2 | 3 | 4,
        prizeName: selectedPrize.prizeName,
        prizeValue: selectedPrize.prizeValue?.toNumber(),
        isWin: selectedPrize.prizeType !== 4,
        userCouponId,
        resultId: drawResult.id,
        drawnAt: drawResult.createdAt.getTime(),
      };
    });
  }

  // =====================================================================
  // 查询 — 按订单查票（订单详情页"抽/已抽/中奖"状态）
  // =====================================================================
  async getTicketByOrder(userId: string, orderId: string) {
    const ticket = await this.prisma.luckyDrawTicket.findFirst({
      where: { userId, orderId },
      include: {
        activity: { select: { title: true, endAt: true } },
        result: {
          select: {
            id: true,
            createdAt: true,
            prizeSnapshot: true,
            prize: {
              select: { prizeName: true, prizeType: true, prizeValue: true },
            },
          },
        },
      },
    });

    if (!ticket) {
      return { hasTicket: false as const };
    }

    return {
      hasTicket: true as const,
      ticket: {
        id: ticket.id,
        activityId: ticket.activityId,
        activityTitle: ticket.activity?.title ?? null,
        activityEndAt: ticket.activity?.endAt?.getTime() ?? null,
        used: ticket.used,
        usedAt: ticket.usedAt?.getTime() ?? null,
        expireAt: ticket.expireAt?.getTime() ?? null,
        createdAt: ticket.createdAt.getTime(),
        result: ticket.result
          ? {
              id: ticket.result.id,
              createdAt: ticket.result.createdAt.getTime(),
              prizeType: ticket.result.prize.prizeType,
              prizeName: ticket.result.prize.prizeName,
              prizeValue: ticket.result.prize.prizeValue?.toNumber() ?? null,
              prizeSnapshot: ticket.result.prizeSnapshot,
            }
          : null,
      },
    };
  }

  // =====================================================================
  // 私有辅助方法
  // =====================================================================

  private async findActiveActivity(treasureId: string | null) {
    const now = new Date();
    return this.prisma.luckyDrawActivity.findFirst({
      where: {
        status: 1,
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
          {
            OR: [{ treasureId: null }, ...(treasureId ? [{ treasureId }] : [])],
          },
        ],
      },
    });
  }

  private async issueOneTicket(
    userId: string,
    orderId: string,
    activityId: string,
  ) {
    return await this.prisma.luckyDrawTicket.create({
      data: { userId, orderId, activityId },
      select: {
        id: true,
        activityId: true,
        orderId: true,
        createdAt: true,
      },
    });
  }

  /** 在外部 $transaction 内直接创建 UserCoupon（避免嵌套 tx） */
  private async issueCouponInTx(
    tx: Prisma.TransactionClient,
    userId: string,
    couponId: string,
  ): Promise<string> {
    const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
    if (!coupon || coupon.status !== 1) {
      throw new Error(`Coupon ${couponId} unavailable`);
    }
    if (
      coupon.totalQuantity !== -1 &&
      coupon.issuedQuantity >= coupon.totalQuantity
    ) {
      throw new Error(`Coupon ${couponId} fully claimed`);
    }

    const now = new Date();
    const validStart =
      coupon.validType === 1 ? (coupon.validStartAt ?? now) : now;
    const validEnd =
      coupon.validType === 1
        ? (coupon.validEndAt ?? new Date(now.getTime() + 365 * 86400_000))
        : new Date(now.getTime() + (coupon.validDays ?? 30) * 86400_000);

    await tx.coupon.update({
      where: { id: couponId },
      data: { issuedQuantity: { increment: 1 } },
    });

    const uc = await tx.userCoupon.create({
      data: {
        userId,
        couponId,
        receiveType: 1,
        status: 0,
        validStartAt: validStart,
        validEndAt: validEnd,
      },
      select: { id: true },
    });

    return uc.id;
  }
}
