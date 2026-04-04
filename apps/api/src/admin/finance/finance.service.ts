import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { QueryTransactionDto } from '@api/admin/finance/dto/query-transaction.dto';
import { Prisma } from '@prisma/client';
import {
  BALANCE_TYPE,
  BizPrefix,
  DIRECTION,
  OpAction,
  OpModule,
  OrderNoHelper,
  RECHARGE_STATUS,
  RelatedType,
  TimeHelper,
  TRANSACTION_STATUS,
  WITHDRAW_STATUS,
} from '@lucky/shared';
import { ManualAdjustmentDto } from '@api/admin/finance/dto/manual-adjustment.dto';
import { TRANSACTION_TYPE } from '@lucky/shared';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/edge';
import { QueryWithdrawalsDto } from '@api/admin/finance/dto/query-withdrawals.dto';
import { AuditWithdrawDto } from '@api/admin/finance/dto/audit-withdraw.dto';
import { PaymentService } from '@api/common/payment/payment.service';
import { GetPayouts200ResponseDataInner } from 'xendit-node/payout/models/GetPayouts200ResponseDataInner';
import { QueryRechargeOrdersDto } from '@api/admin/finance/dto/query-recharge-orders.dto';
import { WalletService } from '@api/client/wallet/wallet.service';
import { DistributedLock } from '@api/common/decorators/distributed-lock.decorator';
import { RedisLockService } from '@api/common/redis/redis-lock.service';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);
  constructor(
    private prismaService: PrismaService,
    private paymentService: PaymentService,
    private walletService: WalletService,
    //必须注入这个服务，且必须是 public readonly lockService
    public readonly lockService: RedisLockService,
  ) {}

  /**
   * Get a paginated list of wallet transactions with optional filters
   * @param dto
   * @returns Paginated list of wallet transactions
   */
  async getTransactions(dto: QueryTransactionDto) {
    const { page, pageSize, userId, type, transactionNo, startDate, endDate } =
      dto;
    const skip = (page - 1) * pageSize;

    // Build dynamic where conditions based on provided filters
    const whereConditions: Prisma.WalletTransactionScalarWhereInput = {};

    if (type) {
      whereConditions.transactionType = type;
    }
    if (transactionNo) {
      whereConditions.transactionNo = { contains: transactionNo };
    }
    if (userId) {
      whereConditions.userId = userId;
    }
    if (startDate || endDate) {
      whereConditions.createdAt = {
        ...(startDate ? { gte: TimeHelper.getStartOfDay(startDate) } : {}),
        ...(endDate ? { lte: TimeHelper.getEndOfDay(endDate) } : {}),
      };
    }
    const [list, total] = await this.prismaService.$transaction([
      this.prismaService.walletTransaction.findMany({
        where: whereConditions,
        skip: skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        // Include user details
        include: {
          user: {
            select: {
              nickname: true,
              phone: true,
            },
          },
        },
      }),
      this.prismaService.walletTransaction.count({
        where: whereConditions,
      }),
    ]);

    return { list, total, page, pageSize };
  }

  /**
   * Manually adjust user wallet balance
   * 人工调账 (Manual Adjust) - 金融级安全
   * @param dto
   * @param query
   *
   */
  @DistributedLock('manual_adjust_lock:{0.userId}', 5000)
  async manualAdjust(
    dto: ManualAdjustmentDto,
    query: {
      adminId: string;
      ip: string;
    },
  ) {
    const { userId, amount: amountNum, actionType, balanceType, remark } = dto;

    // ：精度安全 - 入口处立刻转为 Decimal
    const amount = new Prisma.Decimal(amountNum);

    // 强一致性事务
    return this.prismaService.$transaction(async (ctx) => {
      const adminUser = await ctx.adminUser.findUnique({
        where: { id: query.adminId },
      });

      if (!adminUser) {
        throw new NotFoundException('Admin user not found');
      }

      const user = await ctx.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // 如果 3秒内 有一笔刚才生成的调账流水，直接拦截
      const lastTx = await ctx.walletTransaction.findFirst({
        where: {
          userId,
          relatedType: RelatedType.ADMIN_ADJUST,
          createdAt: { gte: TimeHelper.getTimeAgo(3, 'second') },
        },
      });

      if (lastTx) {
        throw new BadRequestException(
          'A recent adjustment was made. Please wait a moment before trying again.',
        );
      }

      // 获取钱包ID
      const wallet = await ctx.userWallet.findUnique({ where: { userId } });
      if (!wallet) {
        throw new NotFoundException('User wallet not found');
      }
      let updatedWallet;
      const isRealBalance = balanceType === BALANCE_TYPE.CASH;

      // 2. 执行原子更新 + 并发防御
      try {
        if (actionType === DIRECTION.INCOME) {
          // 📈 加币 (Increase) - 直接原子增加
          updatedWallet = await ctx.userWallet.update({
            where: { userId },
            data: {
              realBalance: isRealBalance ? { increment: amount } : undefined,
              coinBalance: !isRealBalance ? { increment: amount } : undefined,
            },
          });
        } else {
          // debit
          updatedWallet = await ctx.userWallet.update({
            where: {
              userId,
              // 只有当余额 >= 扣款金额时，才允许执行 decrement
              // 这利用了数据库行级锁，防止并发扣成负数
              [isRealBalance ? 'realBalance' : 'coinBalance']: { gte: amount },
            },
            data: {
              realBalance: isRealBalance ? { decrement: amount } : undefined,
              coinBalance: !isRealBalance ? { decrement: amount } : undefined,
            },
          });
        }
      } catch (error) {
        // 异常捕获 P2025
        if (
          error instanceof PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new NotFoundException(
            'User wallet not found or insufficient balance',
          );
        }
        throw error;
      }

      //计算变动前后的余额 (用于审计记录)
      const currentBalance = isRealBalance
        ? updatedWallet.realBalance
        : updatedWallet.coinBalance;

      // 倒推：如果是加币，变动前 = 当前 - amount；如果是扣币，变动前 = 当前 + amount
      const beforeBalance =
        actionType === DIRECTION.INCOME
          ? currentBalance.minus(amount)
          : currentBalance.plus(amount);

      const transType =
        actionType === DIRECTION.INCOME
          ? TRANSACTION_TYPE.REWARD
          : TRANSACTION_TYPE.SYSTEM_DEDUCT;

      //  双向记账 (写入流水)
      // 收入记正数，支出记负数
      const logAmount =
        actionType === DIRECTION.INCOME ? amount : amount.negated();
      await ctx.walletTransaction.create({
        data: {
          transactionNo: OrderNoHelper.generate(BizPrefix.ADJUST),
          userId,
          walletId: wallet.id,
          transactionType: transType,
          balanceType,
          amount: logAmount,
          beforeBalance,
          afterBalance: currentBalance,
          description: remark,
          status: TRANSACTION_STATUS.SUCCESS,
          relatedType: RelatedType.ADMIN_ADJUST,
        },
      });

      // 5. 记录管理员操作日志
      await ctx.adminOperationLog.create({
        data: {
          adminId: query.adminId,
          adminName: adminUser.username,
          module: OpModule.FINANCE,
          action: OpAction.FINANCE.MANUAL_ADJUST,
          details: `User: ${userId}, Amount: ${logAmount.toString()}, Type: ${balanceType}`,
          requestIp: query.ip,
        },
      });
      return updatedWallet;
    });
  }

  /**
   * Get a paginated list of withdrawal orders with optional filters
   * @param dto
   * @returns Paginated list of withdrawal orders
   */
  async getWithdrawals(dto: QueryWithdrawalsDto) {
    const { page, pageSize, status, keyword, startDate, endDate } = dto;
    const skip = (page - 1) * pageSize;
    const whereConditions: Prisma.WithdrawOrderWhereInput = {};

    if (status) {
      whereConditions.withdrawStatus = status;
    }

    if (startDate || endDate) {
      whereConditions.createdAt = {
        ...(startDate ? { gte: TimeHelper.getStartOfDay(startDate) } : {}),
        ...(endDate ? { lte: TimeHelper.getEndOfDay(endDate) } : {}),
      };
    }

    if (keyword) {
      whereConditions.OR = [
        { withdrawNo: { contains: keyword } },
        { user: { nickname: { contains: keyword } } },
        { user: { phone: { contains: keyword } } },
        { userId: keyword },
      ];
    }

    const [list, total] = await this.prismaService.$transaction([
      this.prismaService.withdrawOrder.findMany({
        where: whereConditions,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              nickname: true,
              phone: true,
            },
          },
        },
      }),
      this.prismaService.withdrawOrder.count({
        where: whereConditions,
      }),
    ]);
    return { list, total, page, pageSize };
  }

  /**
   * Audit a withdrawal order
   * 提现审核：通过则打款，拒绝则退回冻结金额
   * 'withdraw:{0.withdrawId}' 意思是取第0个参数(dto)的 withdrawId 属性作为锁的 Key
   * @param dto
   * @param adminId
   */
  @DistributedLock('withdraw_audit_lock:{0.withdrawId}', 10000)
  async auditWithdraw(dto: AuditWithdrawDto, adminId: string) {
    const { withdrawId, remark, status } = dto;

    // 1. 获取提现订单
    const order = await this.prismaService.withdrawOrder.findUnique({
      where: { withdrawId },
    });
    if (!order) {
      throw new NotFoundException('Withdrawal order not found');
    }

    // 审核通过 (APPROVE) -> 触发打款（审核人员已经检查，这笔款可以打款了，转入1表示可以）
    if (status === WITHDRAW_STATUS.SUCCESS) {
      // 比如柜台先将单子盖章，但是没有给回单，突然断电了，你没有拿到钱，但是银行告诉你到时候来电了拿着单子来要钱，然后再给你底单
      //先把状态变成PROCESSING，避免重复打款
      const updateResult = await this.prismaService.withdrawOrder.updateMany({
        where: {
          withdrawId,
          withdrawStatus: WITHDRAW_STATUS.PENDING_AUDIT,
        },
        data: {
          withdrawStatus: WITHDRAW_STATUS.PROCESSING,
          auditorId: adminId,
          auditedAt: new Date(),
          auditResult: remark || 'Approved, processing payout',
        },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException('Withdrawal order already processed');
      }

      // 1. 调用 Xendit 代付接口 (网络请求)
      // 注意：这里不要包裹在 prisma.$transaction 里，避免长时间锁表
      const amount = new Prisma.Decimal(order.withdrawAmount);

      let xenditResp: GetPayouts200ResponseDataInner | undefined;
      try {
        const bankCode = order.withdrawMethod === 1 ? 'PH_GCASH' : 'PH_PAYMAYA';

        xenditResp = await this.paymentService.createDisbursement({
          orderNo: order.withdrawNo,
          amount: amount.toNumber(),
          bankCode: bankCode,
          accountName: order?.accountName || '',
          accountNumber: order?.withdrawAccount || '',
          description: `Withdrawal for ${order.withdrawNo}`,
        });
      } catch (error: any) {
        // 打款失败，更新订单状态为失败
        // 比如你的账户余额不足，Xendit拒绝打款
        await this.prismaService.withdrawOrder.update({
          where: { withdrawId },
          data: {
            withdrawStatus: WITHDRAW_STATUS.FAILED,
            auditResult: `Payout failed: ${error.message}`,
          },
        });
        throw new BadRequestException(`Xendit API Failed: ${error.message}`);
      }

      // 2. 更新提现订单状态为处理中
      return this.prismaService.withdrawOrder.update({
        where: { withdrawId },
        data: {
          withdrawStatus: WITHDRAW_STATUS.SUCCESS,
          thirdPartyOrderNo: xenditResp?.id,
          auditorId: adminId,
          auditedAt: new Date(),
          auditResult: remark
            ? `${remark} | Xendit: ${xenditResp?.status}`
            : `Xendit: ${xenditResp?.status}`,
        },
      });
    } else {
      return this.prismaService.$transaction(async (ctx) => {
        //先把状态变为拒绝，避免重复操作
        const res = await ctx.withdrawOrder.updateMany({
          where: {
            withdrawId,
            withdrawStatus: WITHDRAW_STATUS.PENDING_AUDIT, // 只能审核待审核的订单
          },
          data: {
            withdrawStatus: WITHDRAW_STATUS.REJECTED,
            auditorId: adminId,
            auditedAt: new Date(),
            auditResult: remark || 'Rejected',
            rejectReason: remark,
          },
        });

        if (res.count === 0) {
          throw new BadRequestException('Order status has changed');
        }

        // 只有审核拒绝的订单，才退回冻结金额
        // get wallet again in this transaction context
        const wallet = await ctx.userWallet.findUnique({
          where: { userId: order.userId },
        });

        if (!wallet) {
          throw new NotFoundException('User wallet not found');
        }

        const amount = new Prisma.Decimal(order.withdrawAmount);

        // 审核拒绝 (REJECT) -> 退回冻结金额到可用余额
        await ctx.userWallet.update({
          where: { userId: order.userId, frozenBalance: { gte: amount } },
          data: {
            realBalance: { increment: amount }, // 返还可用余额
            frozenBalance: { decrement: amount }, // 减少冻结余额
          },
        });

        // 更新流水记录
        await ctx.walletTransaction.create({
          data: {
            transactionNo: OrderNoHelper.generate(BizPrefix.REFUND),
            userId: order.userId,
            walletId: wallet.id,
            transactionType: TRANSACTION_TYPE.REFUND, // 提现拒绝
            balanceType: BALANCE_TYPE.CASH, // 现金余额
            amount: amount, // 返还记正数
            beforeBalance: wallet.realBalance, // 变动前余额
            afterBalance: wallet.realBalance.plus(amount), // 变动后余额
            description: `Withdraw rejected: ${remark}`,
            status: TRANSACTION_STATUS.SUCCESS,
            relatedId: order.withdrawId,
            relatedType: RelatedType.WITHDRAWAL,
            remark: `Audit Rejected by ${adminId}`,
          },
        });

        // 更新提现订单状态为拒绝
        return ctx.withdrawOrder.update({
          where: { withdrawId },
          data: {
            withdrawStatus: WITHDRAW_STATUS.REJECTED,
            auditResult: remark,
            auditorId: adminId,
            auditedAt: new Date(),
            rejectReason: remark,
          },
        });
      });
    }
  }

  /**
   * Get a paginated list of recharge orders with optional filters
   * @param dto
   */
  async recharges(dto: QueryRechargeOrdersDto) {
    const { page, pageSize, status, keyword, startDate, endDate, channel } =
      dto;

    const skip = (page - 1) * pageSize;
    const whereConditions: Prisma.RechargeOrderWhereInput = {};

    if (status) {
      whereConditions.rechargeStatus = status;
    }
    if (startDate || endDate) {
      whereConditions.createdAt = {
        ...(startDate ? { gte: TimeHelper.getStartOfDay(startDate) } : {}),
        ...(endDate ? { lte: TimeHelper.getEndOfDay(endDate) } : {}),
      };
    }

    if (channel) {
      whereConditions.paymentChannel = channel;
    }

    if (keyword) {
      whereConditions.OR = [
        {
          rechargeNo: { contains: keyword },
        },
        {
          user: {
            nickname: { contains: keyword },
            phone: { contains: keyword },
          },
        },
      ];
    }

    const [list, total] = await this.prismaService.$transaction([
      this.prismaService.rechargeOrder.findMany({
        where: whereConditions,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              nickname: true,
              phone: true,
            },
          },
        },
      }),
      this.prismaService.rechargeOrder.count({
        where: whereConditions,
      }),
    ]);

    return { list, total, page, pageSize };
  }

  /**
   * Sync recharge order status with Xendit
   * @param rechargeId
   * @param adminId
   */
  async syncRechargeStatus(rechargeId: string, adminId: string) {
    // check recharge order
    const order = await this.prismaService.rechargeOrder.findUnique({
      where: {
        rechargeId,
      },
    });

    if (!order) {
      throw new NotFoundException('Recharge order not found');
    }

    // only pending orders can be synced
    if (order.rechargeStatus === RECHARGE_STATUS.SUCCESS) {
      return { status: 'NO_CHANGE', message: 'Order already successful' };
    }

    //dluble check (Invoice + E-Wallet)
    let xenditInvoice;
    const syncType = 'INVOICE';

    // first try to get invoice by thirdPartyOrderNo
    if (order.thirdPartyOrderNo) {
      xenditInvoice = await this.paymentService.getInvoiceById(
        order.thirdPartyOrderNo,
      );
    }

    // if not found, try by externalId (rechargeNo)
    if (!xenditInvoice) {
      xenditInvoice = await this.paymentService.getInvoiceByExternalId(
        order.rechargeNo,
      );
    }

    // clean the data
    if (!xenditInvoice) {
      // too old, mark as failed,more than 1 hour
      if (TimeHelper.isOlderThan(order.createdAt, 1, 'hour')) {
        this.logger.warn(
          `Cleaning ghost order ${order.rechargeNo} (Not found on Xendit)`,
        );

        await this.prismaService.rechargeOrder.update({
          where: { rechargeId },
          data: {
            rechargeStatus: RECHARGE_STATUS.FAILED,
            callbackData: {
              error: 'Transaction not found on Xendit',
              syncBy: adminId,
              syncAt: new Date(),
              note: 'Auto-marked as FAILED because it does not exist in Xendit (Ghost Order)',
            },
          },
        });
        return {
          status: 'SYNCED_FAILED',
          message: 'Order not found on Xendit, marked as FAILED.',
        };
      }

      // too new, cannot find
      throw new NotFoundException(
        'Transaction not found in Xendit (Too new to clean)',
      );
    }

    const isSuccess = ['PAID', 'SETTLED', 'SUCCEEDED'].includes(
      xenditInvoice.status,
    );

    if (isSuccess && order.rechargeStatus !== RECHARGE_STATUS.SUCCESS) {
      const amount = new Prisma.Decimal(order.rechargeAmount);

      return this.prismaService.$transaction(async (ctx) => {
        // give user cash balance
        await this.walletService.creditCash(
          {
            userId: order.userId,
            amount: amount,
            related: {
              id: order.rechargeId,
              type: RelatedType.RECHARGE,
            },
            desc: `Manual Sync by Admin: ${adminId}`,
          },
          ctx,
        );

        const paidTime = xenditInvoice.paid_at
          ? new Date(xenditInvoice.paid_at)
          : xenditInvoice.paidAt
            ? new Date(xenditInvoice.paidAt)
            : new Date();

        // update recharge order status
        await ctx.rechargeOrder.update({
          where: { rechargeId },
          data: {
            rechargeStatus: RECHARGE_STATUS.SUCCESS,
            paidAt: paidTime,
            thirdPartyOrderNo: xenditInvoice.id,
            callbackData: {
              ...xenditInvoice,
              syncBy: adminId,
              syncAt: new Date(),
              syncType: 'MANUAL',
            },
          },
        });
        this.logger.log(
          `Synced success for ${order.rechargeNo}: ${xenditInvoice.status}`,
        );
        return {
          status: 'SYNCED_SUCCESS',
          message: 'Order fixed and user credited.',
        };
      });
    }

    // handle expired or failed orders
    if (xenditInvoice.status === 'EXPIRED') {
      await this.prismaService.rechargeOrder.update({
        where: { rechargeId },
        data: { rechargeStatus: RECHARGE_STATUS.FAILED },
      });
      return { status: 'SYNCED_EXPIRED', message: 'Order expired' };
    }
    return { status: 'NO_CHANGE', xenditStatus: xenditInvoice.status };
  }

  /**
   * Get financial statistics: pending withdrawals, total deposits, total withdrawals
   * @return Statistics object
   */
  async getStatistics() {
    const thisWeekRange = TimeHelper.getRange('week');
    const lastWeekRange = TimeHelper.getRange('lastWeek');

    const [
      pendingWithdrawAgg,
      totalDepositAgg,
      totalWithdrawAgg,
      depositThisWeekAgg,
      depositLastWeekAgg,
      withdrawThisWeekAgg,
      withdrawLastWeekAgg,
    ] = await Promise.all([
      // 获取待处理提现总额(审核中 + 处理中)
      this.prismaService.withdrawOrder.aggregate({
        _sum: { actualAmount: true },
        where: {
          withdrawStatus: {
            in: [WITHDRAW_STATUS.PENDING_AUDIT, WITHDRAW_STATUS.PROCESSING],
          },
        },
      }),
      // 获取总充值金额
      this.prismaService.rechargeOrder.aggregate({
        _sum: { rechargeAmount: true },
        where: {
          rechargeStatus: RECHARGE_STATUS.SUCCESS,
        },
      }),
      // 获取总提现金额
      this.prismaService.withdrawOrder.aggregate({
        _sum: { actualAmount: true },
        where: {
          withdrawStatus: WITHDRAW_STATUS.SUCCESS,
        },
      }),
      // 本周充值总额
      this.prismaService.rechargeOrder.aggregate({
        _sum: { rechargeAmount: true },
        where: {
          rechargeStatus: RECHARGE_STATUS.SUCCESS,
          createdAt: thisWeekRange,
        },
      }),
      // 上周充值总额
      this.prismaService.rechargeOrder.aggregate({
        _sum: { rechargeAmount: true },
        where: {
          rechargeStatus: RECHARGE_STATUS.SUCCESS,
          createdAt: lastWeekRange,
        },
      }),
      // 本周提现总额
      this.prismaService.withdrawOrder.aggregate({
        _sum: { actualAmount: true },
        where: {
          withdrawStatus: WITHDRAW_STATUS.SUCCESS,
          createdAt: thisWeekRange,
        },
      }),
      // 上周提现总额
      this.prismaService.withdrawOrder.aggregate({
        _sum: { actualAmount: true },
        where: {
          withdrawStatus: WITHDRAW_STATUS.SUCCESS,
          createdAt: lastWeekRange,
        },
      }),
    ]);

    const calcTrend = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    const depositThisWeek =
      depositThisWeekAgg._sum.rechargeAmount?.toNumber() || 0;

    const depositLastWeek =
      depositLastWeekAgg._sum.rechargeAmount?.toNumber() || 0;

    const withdrawThisWeek =
      withdrawThisWeekAgg._sum.actualAmount?.toNumber() || 0;

    const withdrawLastWeek =
      withdrawLastWeekAgg._sum.actualAmount?.toNumber() || 0;

    const pendingWithdraw =
      pendingWithdrawAgg._sum.actualAmount?.toString() || '0';
    const totalDeposit = totalDepositAgg._sum.rechargeAmount?.toString() || '0';
    const totalWithdraw = totalWithdrawAgg._sum.actualAmount?.toString() || '0';

    return {
      pendingWithdraw,
      totalWithdraw,
      totalDeposit,
      depositTrend: calcTrend(depositThisWeek, depositLastWeek).toFixed(2),
      withdrawTrend: calcTrend(withdrawThisWeek, withdrawLastWeek).toFixed(2),
    };
  }
}
