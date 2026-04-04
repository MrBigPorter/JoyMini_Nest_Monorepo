import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { throwBiz } from '@api/common/exceptions/biz.exception';
import { ERROR_KEYS } from '@api/common/error-codes.gen';

const D = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
type Tx = Prisma.TransactionClient | PrismaService;

const TRANSACTION_TYPE = {
  RECHARGE: 1,
  CONSUMPTION: 2,
  REFUND: 3,
  REWARD: 4,
  WITHDRAWAL: 5,
  COIN_EXCHANGE: 6,
} as const;

const BALANCE_TYPE = {
  CASH: 1,
  COIN: 2,
} as const;

const TRANSACTION_STATUS = {
  SUCCESS: 1,
} as const;

const generateTransactionNo = (): string => {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(
    now.getMinutes(),
  ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}${String(
    now.getMilliseconds(),
  ).padStart(3, '0')}`;
  const randomPart = `${Math.floor(Math.random() * 1_000_000)}`.padStart(
    6,
    '0',
  );

  return `TRF${datePart}${randomPart}`;
};

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  // Get ORM instance, either transaction or main prisma
  private orm(tx?: Tx): Tx {
    return tx ?? this.prisma;
  }

  // Ensure a wallet exists for the given userId
  async ensureWallet(userId: string, tx?: Tx) {
    const db = this.orm(tx);

    return await db.userWallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: {
        id: true,
        userId: true,
        realBalance: true,
        coinBalance: true,
        totalRecharge: true,
        frozenBalance: true,
        totalWithdraw: true,
      },
    });
  }

  // balance inquiry for the given userId
  async balance(userId: string, tx?: Tx) {
    const db = this.orm(tx);

    return db.userWallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: {
        id: true,
        userId: true,
        realBalance: true,
        totalRecharge: true,
        coinBalance: true,
        frozenBalance: true,
        totalWithdraw: true,
      },
    });
  }

  // recharge the wallet of the given userId by the specified amount
  async creditCash(
    params: {
      userId: string;
      amount: number | string | Prisma.Decimal;
      related?: { id: string; type: string };
      desc?: string;
      type?: number;
    },
    tx?: Tx,
  ) {
    const db = this.orm(tx);
    const { userId, amount, related, desc, type } = params;
    const amt = D(amount);

    if (amt.lte(0)) throw new BadRequestException('amount must be positive');

    await this.ensureWallet(userId, db);

    // 2.核心修复：直接原子更新，并返回更新后的记录
    const updateWallet = await db.userWallet.update({
      where: { userId },
      data: {
        realBalance: { increment: amt },
        // 注意：如果是退款，通常不应该增加 totalRecharge (累计充值额)
        // 只有当 type 是 RECHARGE 时才加，
        totalRecharge:
          type === TRANSACTION_TYPE.RECHARGE || !type
            ? { increment: amt }
            : undefined,
      },
      select: {
        realBalance: true,
        id: true,
      },
    });

    const after = updateWallet.realBalance;
    const before = after.sub(amt); // 计算更新前的余额

    // 3.记录交易流水
    const txn = await db.walletTransaction.create({
      data: {
        transactionNo: generateTransactionNo(),
        userId,
        walletId: updateWallet.id,
        transactionType: type ?? TRANSACTION_TYPE.RECHARGE,
        balanceType: BALANCE_TYPE.CASH,
        amount: amt,
        beforeBalance: before,
        afterBalance: after,
        relatedId: related?.id,
        relatedType: related?.type,
        description: desc,
        status: TRANSACTION_STATUS.SUCCESS,
      },
      select: {
        id: true,
      },
    });

    return { realBalance: after, transactionId: txn.id };
  }

  // deduct amount from the wallet of the given userId
  async debitCash(
    params: {
      userId: string;
      amount: number | string | Prisma.Decimal;
      related?: { id: string; type: string };
      desc?: string;
    },
    tx?: Tx,
  ): Promise<{ realBalance: Prisma.Decimal; transactionId: string }> {
    const db = this.orm(tx);
    const { userId, amount, related, desc } = params;
    const amt = D(amount);

    if (amt.lte(0)) throw new BadRequestException('amount must be positive');

    await this.ensureWallet(userId, db);

    // 2. 利用 update 的 where 条件做乐观锁，同时获取更新后的值
    // Prisma 的 update 如果条件不满足(如余额不足导致记录找不到)，会抛出 P2025 错误
    let updatedWallet: { id: string; realBalance: Prisma.Decimal } | null =
      null;
    try {
      updatedWallet = await db.userWallet.update({
        where: { userId, realBalance: { gte: amt } }, // 数据库层面的余额检查
        data: {
          realBalance: { decrement: amt },
        },
        select: {
          id: true,
          realBalance: true,
        },
      });
    } catch {
      throwBiz(ERROR_KEYS.INSUFFICIENT_BALANCE);
      throw new BadRequestException('insufficient balance');
    }

    if (!updatedWallet) {
      throwBiz(ERROR_KEYS.INSUFFICIENT_BALANCE);
      throw new BadRequestException('insufficient balance');
    }

    const after = updatedWallet.realBalance;
    const before = after.add(amt); // 反推

    // 3.记录交易流水
    const txn = await db.walletTransaction.create({
      data: {
        transactionNo: generateTransactionNo(),
        userId,
        walletId: updatedWallet.id,
        transactionType: TRANSACTION_TYPE.CONSUMPTION,
        balanceType: BALANCE_TYPE.CASH,
        amount: amt.neg(), // negative amount for debit
        beforeBalance: before,
        afterBalance: after,
        relatedId: related?.id ?? null,
        relatedType: related?.type ?? 'order',
        description: desc ?? 'spend',
        status: TRANSACTION_STATUS.SUCCESS,
      },
      select: {
        id: true,
      },
    });

    return { realBalance: after, transactionId: txn.id };
  }

  // coin credit
  async creditCoin(
    params: {
      userId: string;
      coins: number | string | Prisma.Decimal;
      related?: { id: string; type: string };
      desc?: string;
      type?: number;
    },
    tx?: Tx,
  ): Promise<{ coinBalance: Prisma.Decimal; transactionId: string }> {
    const db = this.orm(tx);
    const { userId, coins, related, desc, type } = params;
    const amt = D(coins);

    if (amt.lte(0)) throw new BadRequestException('coins must be positive');

    await this.ensureWallet(userId, db);

    const updateWallet = await db.userWallet.update({
      where: { userId },
      data: {
        coinBalance: { increment: amt },
      },
      select: {
        coinBalance: true,
        id: true,
      },
    });

    const after = updateWallet.coinBalance;
    const before = after.sub(amt);

    const txn = await db.walletTransaction.create({
      data: {
        transactionNo: generateTransactionNo(),
        userId,
        walletId: updateWallet.id,
        transactionType: type ?? TRANSACTION_TYPE.REWARD,
        balanceType: BALANCE_TYPE.COIN,
        amount: amt,
        beforeBalance: before,
        afterBalance: after,
        relatedId: related?.id ?? null,
        relatedType: related?.type ?? null,
        description: desc ?? 'coin credit',
        status: TRANSACTION_STATUS.SUCCESS,
      },
      select: {
        id: true,
      },
    });
    return { coinBalance: after, transactionId: txn.id };
  }

  // coin debit
  async debitCoin(
    params: {
      userId: string;
      coins: number | string | Prisma.Decimal;
      related?: { id: string; type: string };
      desc?: string;
    },
    tx?: Tx,
  ): Promise<{ coinBalance: Prisma.Decimal; transactionId: string }> {
    const db = this.orm(tx);
    const { userId, coins, related, desc } = params;
    const amt = D(coins);

    if (amt.lte(0)) throw new BadRequestException('coins must be positive');

    await this.ensureWallet(userId, db);

    // 使用 update 而不是 updateMany，直接获取更新后的值（与 debitCash 保持一致）
    let updatedWallet: { id: string; coinBalance: Prisma.Decimal } | null =
      null;
    try {
      updatedWallet = await db.userWallet.update({
        where: { userId, coinBalance: { gte: amt } },
        data: {
          coinBalance: { decrement: amt },
        },
        select: {
          id: true,
          coinBalance: true,
        },
      });
    } catch {
      throw new BadRequestException('insufficient coin balance');
    }

    if (!updatedWallet) {
      throw new BadRequestException('insufficient coin balance');
    }

    const after = updatedWallet.coinBalance;
    const before = after.add(amt);

    const txn = await db.walletTransaction.create({
      data: {
        transactionNo: generateTransactionNo(),
        userId,
        walletId: updatedWallet.id,
        transactionType: TRANSACTION_TYPE.COIN_EXCHANGE,
        balanceType: BALANCE_TYPE.COIN,
        amount: amt.neg(), // negative amount for debit
        beforeBalance: before,
        afterBalance: after,
        relatedId: related?.id ?? null,
        relatedType: related?.type ?? 'order',
        description: desc ?? 'coin debit',
        status: TRANSACTION_STATUS.SUCCESS,
      },
      select: {
        id: true,
      },
    });
    return { coinBalance: after, transactionId: txn.id };
  }

  /**
   * Freeze cash amount for withdrawal
   * @param params
   * @param tx
   */
  async freezeCash(
    params: {
      userId: string;
      amount: number | string | Prisma.Decimal;
      related?: { id: string; type: string };
      desc?: string;
    },
    tx?: Tx,
  ) {
    const db = this.orm(tx);
    const { userId, amount, related, desc } = params;
    const amt = D(amount);

    if (amt.lte(0)) throw new BadRequestException('amount must be positive');

    await this.ensureWallet(userId, db);

    //  Atomic Update (Optimistic Lock)
    const res = await db.userWallet.updateMany({
      where: { userId, realBalance: { gte: amt } },
      data: {
        realBalance: { decrement: amt },
        frozenBalance: { increment: amt },
      },
    });

    if (res.count !== 1) {
      throwBiz(ERROR_KEYS.INSUFFICIENT_BALANCE);
    }

    // Fetch current wallet state
    const currentWallet = await db.userWallet.findUniqueOrThrow({
      where: { userId },
      select: {
        id: true,
        realBalance: true,
      },
    });

    const afterReal = currentWallet.realBalance;
    const beforeReal = afterReal.add(amt);

    const txn = await db.walletTransaction.create({
      data: {
        transactionNo: generateTransactionNo(),
        userId,
        walletId: currentWallet.id,
        transactionType: TRANSACTION_TYPE.WITHDRAWAL,
        balanceType: BALANCE_TYPE.CASH,
        amount: amt.neg(),
        beforeBalance: beforeReal,
        afterBalance: afterReal,
        relatedId: related?.id,
        relatedType: related?.type,
        description: desc ?? 'Frozen for withdrawal',
        status: TRANSACTION_STATUS.SUCCESS,
      },
      select: {
        id: true,
      },
    });

    return { realBalance: afterReal, transactionId: txn.id };
  }

  async unfreezeCash(
    params: {
      userId: string;
      amount: number | string | Prisma.Decimal;
      related?: { id: string; type: string };
      desc?: string;
    },
    tx?: Tx,
  ) {
    const db = this.orm(tx);
    const { userId, amount, related, desc } = params;
    const amt = D(amount);

    if (amt.lte(0)) throw new BadRequestException('amount must be positive');

    await this.ensureWallet(userId, db);

    const res = await db.userWallet.updateMany({
      where: { userId, frozenBalance: { gte: amt } },
      data: {
        frozenBalance: { decrement: amt },
        realBalance: { increment: amt },
      },
    });

    if (res.count !== 1) {
      throwBiz(ERROR_KEYS.INSUFFICIENT_BALANCE);
    }

    // 2. ：立即获取最新的真实冻结余额
    const currentWallet = await db.userWallet.findUniqueOrThrow({
      where: { userId },
      select: { id: true, frozenBalance: true },
    });

    const afterFrozen = currentWallet.frozenBalance;
    const beforeFrozen = afterFrozen.add(amt);

    const txn = await db.walletTransaction.create({
      data: {
        transactionNo: generateTransactionNo(),
        userId,
        walletId: currentWallet.id,
        transactionType: TRANSACTION_TYPE.REFUND,
        balanceType: BALANCE_TYPE.CASH,
        amount: amt,
        beforeBalance: beforeFrozen,
        afterBalance: afterFrozen,
        relatedId: related?.id,
        relatedType: related?.type,
        description: desc ?? 'Unfrozen from withdrawal',
        status: TRANSACTION_STATUS.SUCCESS,
      },
      select: {
        id: true,
      },
    });

    return { frozenBalance: afterFrozen, transactionId: txn.id };
  }
}
