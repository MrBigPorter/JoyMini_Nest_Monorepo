import { NotFoundException } from '@nestjs/common';
import { RelatedType, WITHDRAW_STATUS } from '@lucky/shared';
import { WithdrawSettlementService } from './withdraw-settlement.service';

/**
 * 这些用例锁的是 #95 的账目不变式：
 *   冻结毛额 → 成功扣毛额 / 失败退回毛额；同一笔单只结算一次。
 */
const buildOrder = (over: Record<string, unknown> = {}) => ({
  withdrawId: 'w-1',
  userId: 'u-1',
  withdrawAmount: 100,
  actualAmount: 95,
  withdrawStatus: WITHDRAW_STATUS.PROCESSING,
  ...over,
});

const setup = () => {
  const tx = {
    withdrawOrder: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    userWallet: {
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    walletTransaction: { updateMany: jest.fn() },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  const walletService = { unfreezeCash: jest.fn() };

  const service = new WithdrawSettlementService(
    prisma as never,
    walletService as never,
  );
  // 成功但冻结不足的用例会打 CRITICAL 日志，测试里不需要噪声
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

  return { service, tx, walletService, prisma };
};

describe('WithdrawSettlementService', () => {
  it('成功结算：冻结扣毛额 100、累计提现记净额 95、订单置 SUCCESS', async () => {
    const { service, tx } = setup();
    tx.withdrawOrder.findUnique.mockResolvedValue(buildOrder());
    tx.withdrawOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.userWallet.updateMany.mockResolvedValue({ count: 1 });
    tx.withdrawOrder.findUniqueOrThrow.mockResolvedValue(
      buildOrder({ withdrawStatus: WITHDRAW_STATUS.SUCCESS }),
    );

    const result = await service.settleWithdrawal({
      withdrawId: 'w-1',
      outcome: 'SUCCESS',
    });

    expect(result.settled).toBe(true);
    expect(tx.userWallet.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', frozenBalance: { gte: 100 } },
      data: {
        frozenBalance: { decrement: 100 },
        totalWithdraw: { increment: 95 },
      },
    });
    // 兜底强扣不应被触发
    expect(tx.userWallet.update).not.toHaveBeenCalled();
    expect(tx.walletTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          relatedId: 'w-1',
          relatedType: RelatedType.WITHDRAWAL,
        },
      }),
    );
    expect(tx.withdrawOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          withdrawStatus: WITHDRAW_STATUS.SUCCESS,
        }),
      }),
    );
  });

  it('已是终态：返回 settled=false，钱包与流水一分不动', async () => {
    const { service, tx } = setup();
    tx.withdrawOrder.findUnique.mockResolvedValue(
      buildOrder({ withdrawStatus: WITHDRAW_STATUS.SUCCESS }),
    );

    const result = await service.settleWithdrawal({
      withdrawId: 'w-1',
      outcome: 'SUCCESS',
    });

    expect(result.settled).toBe(false);
    expect(tx.userWallet.updateMany).not.toHaveBeenCalled();
    expect(tx.userWallet.update).not.toHaveBeenCalled();
    expect(tx.walletTransaction.updateMany).not.toHaveBeenCalled();
  });

  it('并发抢占失败（count=0）：返回 settled=false，不做任何账务', async () => {
    const { service, tx } = setup();
    tx.withdrawOrder.findUnique.mockResolvedValue(buildOrder());
    tx.withdrawOrder.updateMany.mockResolvedValue({ count: 0 });
    tx.withdrawOrder.findUniqueOrThrow.mockResolvedValue(
      buildOrder({ withdrawStatus: WITHDRAW_STATUS.FAILED }),
    );

    const result = await service.settleWithdrawal({
      withdrawId: 'w-1',
      outcome: 'FAILED',
    });

    expect(result.settled).toBe(false);
    expect(tx.userWallet.updateMany).not.toHaveBeenCalled();
    expect(tx.walletTransaction.updateMany).not.toHaveBeenCalled();
  });

  it('失败结算：按毛额解冻，订单置 FAILED', async () => {
    const { service, tx, walletService } = setup();
    tx.withdrawOrder.findUnique.mockResolvedValue(buildOrder());
    tx.withdrawOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.withdrawOrder.findUniqueOrThrow.mockResolvedValue(
      buildOrder({ withdrawStatus: WITHDRAW_STATUS.FAILED }),
    );

    const result = await service.settleWithdrawal({
      withdrawId: 'w-1',
      outcome: 'FAILED',
      reason: 'insufficient funds',
    });

    expect(result.settled).toBe(true);
    expect(walletService.unfreezeCash).toHaveBeenCalledWith(
      {
        userId: 'u-1',
        amount: 100,
        related: { id: 'w-1', type: RelatedType.WITHDRAWAL },
        desc: 'Withdrawal failed: insufficient funds',
      },
      tx,
    );
    expect(tx.userWallet.updateMany).not.toHaveBeenCalled();
  });

  it('成功但冻结不足：仍置 SUCCESS（钱已出去），并强制扣减 + 记 CRITICAL', async () => {
    const { service, tx } = setup();
    tx.withdrawOrder.findUnique.mockResolvedValue(buildOrder());
    tx.withdrawOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.userWallet.updateMany.mockResolvedValue({ count: 0 });
    tx.withdrawOrder.findUniqueOrThrow.mockResolvedValue(
      buildOrder({ withdrawStatus: WITHDRAW_STATUS.SUCCESS }),
    );

    const result = await service.settleWithdrawal({
      withdrawId: 'w-1',
      outcome: 'SUCCESS',
    });

    expect(result.settled).toBe(true);
    expect(tx.userWallet.update).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      data: {
        frozenBalance: { decrement: 100 },
        totalWithdraw: { increment: 95 },
      },
    });
    expect(service['logger'].error).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL'),
    );
  });

  it('订单不存在：抛 NotFoundException，不落任何状态', async () => {
    const { service, tx } = setup();
    tx.withdrawOrder.findUnique.mockResolvedValue(null);

    await expect(
      service.settleWithdrawal({ withdrawId: 'nope', outcome: 'SUCCESS' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.withdrawOrder.updateMany).not.toHaveBeenCalled();
  });

  it('抢占条件包含终态排除，防止覆盖已落定的单', async () => {
    const { service, tx } = setup();
    tx.withdrawOrder.findUnique.mockResolvedValue(buildOrder());
    tx.withdrawOrder.updateMany.mockResolvedValue({ count: 0 });
    tx.withdrawOrder.findUniqueOrThrow.mockResolvedValue(
      buildOrder({ withdrawStatus: WITHDRAW_STATUS.SUCCESS }),
    );

    await service.settleWithdrawal({ withdrawId: 'w-1', outcome: 'SUCCESS' });

    expect(tx.withdrawOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          withdrawId: 'w-1',
          withdrawStatus: {
            notIn: [WITHDRAW_STATUS.SUCCESS, WITHDRAW_STATUS.FAILED],
          },
        },
      }),
    );
  });

  it('调用方传入 tx 时复用同一事务，不再新开 $transaction', async () => {
    const { service, tx, prisma } = setup();
    tx.withdrawOrder.findUnique.mockResolvedValue(
      buildOrder({ withdrawStatus: WITHDRAW_STATUS.SUCCESS }),
    );

    await service.settleWithdrawal({
      withdrawId: 'w-1',
      outcome: 'SUCCESS',
      tx: tx as never,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
