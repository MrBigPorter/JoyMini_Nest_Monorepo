import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, WithdrawOrder } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { WalletService } from '@api/client/wallet/wallet.service';
import {
  RelatedType,
  TRANSACTION_STATUS,
  WITHDRAW_STATUS,
} from '@lucky/shared';

export type WithdrawOutcome = 'SUCCESS' | 'FAILED';

export type SettleWithdrawalParams = {
  withdrawId: string;
  outcome: WithdrawOutcome;
  thirdPartyOrderNo?: string;
  reason?: string;
  /** 传了就在调用方的事务里执行，避免嵌套事务 */
  tx?: Prisma.TransactionClient;
};

/**
 * 提现结算的唯一入口。
 *
 * 背景（见 docs/AI-joymini/95-提现冻结状态机-SDD.md）：
 * 申请提现时冻结的是毛额（withdrawAmount），此后只有这里能把冻结金额释放掉。
 * 审核、Xendit 回调、补单任务都不能自己改终态，必须调本服务，否则账目必然不平。
 */
@Injectable()
export class WithdrawSettlementService {
  private readonly logger = new Logger(WithdrawSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * 落终态 + 动钱包，同一事务，成功或失败二选一。
   * - 已是终态 / 并发被别人抢先 → { settled: false }，账不变
   * - 抢到 → { settled: true }，钱包已按 outcome 处理
   */
  async settleWithdrawal(
    params: SettleWithdrawalParams,
  ): Promise<{ settled: boolean; order: WithdrawOrder }> {
    if (params.tx) {
      return this.run(params, params.tx);
    }
    return this.prisma.$transaction((tx) => this.run(params, tx));
  }

  private async run(
    params: SettleWithdrawalParams,
    tx: Prisma.TransactionClient,
  ): Promise<{ settled: boolean; order: WithdrawOrder }> {
    const { withdrawId, outcome, thirdPartyOrderNo, reason } = params;

    const order = await tx.withdrawOrder.findUnique({ where: { withdrawId } });
    if (!order) {
      throw new NotFoundException(`Withdrawal order not found: ${withdrawId}`);
    }

    // 幂等出口：已是终态，说明结算过了，账一分不动
    if (
      order.withdrawStatus === WITHDRAW_STATUS.SUCCESS ||
      order.withdrawStatus === WITHDRAW_STATUS.FAILED
    ) {
      return { settled: false, order };
    }

    // 原子抢占：只有一条 SQL 能把订单推到终态，抢到的才动钱包
    const claimed = await tx.withdrawOrder.updateMany({
      where: {
        withdrawId,
        withdrawStatus: {
          notIn: [WITHDRAW_STATUS.SUCCESS, WITHDRAW_STATUS.FAILED],
        },
      },
      data: {
        withdrawStatus:
          outcome === 'SUCCESS'
            ? WITHDRAW_STATUS.SUCCESS
            : WITHDRAW_STATUS.FAILED,
        completedAt: new Date(),
        ...(thirdPartyOrderNo ? { thirdPartyOrderNo } : {}),
        ...(outcome === 'FAILED' && reason ? { rejectReason: reason } : {}),
      },
    });

    if (claimed.count !== 1) {
      // 并发下被别人抢先落定，重新读一次返回，不改账
      const latest = await tx.withdrawOrder.findUniqueOrThrow({
        where: { withdrawId },
      });
      return { settled: false, order: latest };
    }

    // 冻结时用的是毛额，所有动冻结余额的地方都必须用毛额
    const freezeAmount = order.withdrawAmount;
    // 累计提现记净额（用户实际到账），差额是平台手续费
    const receivedAmount = order.actualAmount;

    if (outcome === 'SUCCESS') {
      const deducted = await tx.userWallet.updateMany({
        where: { userId: order.userId, frozenBalance: { gte: freezeAmount } },
        data: {
          frozenBalance: { decrement: freezeAmount },
          totalWithdraw: { increment: receivedAmount },
        },
      });

      if (deducted.count !== 1) {
        // 钱已经出去了，不能回滚：记账必须完成，否则账永远对不平
        this.logger.error(
          `CRITICAL: frozen balance insufficient on success settle. userId=${order.userId} withdrawId=${withdrawId}`,
        );
        await tx.userWallet.update({
          where: { userId: order.userId },
          data: {
            frozenBalance: { decrement: freezeAmount },
            totalWithdraw: { increment: receivedAmount },
          },
        });
      }

      // 冻结时写的那条流水标记为已完成
      await tx.walletTransaction.updateMany({
        where: {
          relatedId: order.withdrawId,
          relatedType: RelatedType.WITHDRAWAL,
        },
        data: {
          status: TRANSACTION_STATUS.SUCCESS,
          description: 'Withdrawal completed successfully',
        },
      });
    } else {
      // 失败：解冻回可用余额 + 写退款流水（复用既有实现，账目口径只有一份）
      await this.walletService.unfreezeCash(
        {
          userId: order.userId,
          amount: freezeAmount,
          related: { id: order.withdrawId, type: RelatedType.WITHDRAWAL },
          desc: `Withdrawal failed: ${reason ?? 'UNKNOWN'}`,
        },
        tx,
      );
    }

    const settledOrder = await tx.withdrawOrder.findUniqueOrThrow({
      where: { withdrawId },
    });
    return { settled: true, order: settledOrder };
  }
}
