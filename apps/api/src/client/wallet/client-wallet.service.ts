import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { WalletService } from '@api/client/wallet/wallet.service';
import { ApplyWithdrawDto } from '@api/client/wallet/dto/apply-withdraw.dto';
import { Prisma } from '@prisma/client';
import {
  BizPrefix,
  OrderNoHelper,
  RECHARGE_STATUS,
  RelatedType,
  TRANSACTION_STATUS,
  WITHDRAW_STATUS,
} from '@lucky/shared';
import { CreateRechargeDto } from '@api/client/wallet/dto/create-recharge.dto';
import { WithdrawalHistoryQueryDto } from '@api/client/wallet/dto/withdrawal-history-query.dto';
import { PaymentService } from '@api/common/payment/payment.service';
import { GetRechargeHistoryDto } from '@api/client/wallet/dto/recharge.dto';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

type InvoiceWebhookPayload = {
  external_id: string;
  status: string;
  amount: number | string;
  id: string;
};

type PayoutWebhookPayload = {
  reference_id: string;
  status: string;
  failure_code?: string;
};

@Injectable()
export class ClientWalletService {
  private logger = new Logger(ClientWalletService.name);
  constructor(
    private paymentService: PaymentService,
    private prismaService: PrismaService,
    private walletService: WalletService,
  ) {}

  async handleUniversalWebhook(payload: unknown) {
    if (!isRecord(payload)) {
      this.logger.warn(`[Webhook Router] Unknown payload format, ignored.`);
      return { status: 'IGNORED', reason: 'Unknown Format' };
    }

    const event = typeof payload.event === 'string' ? payload.event : null;

    //  判定逻辑 1: 是否为代付/提现 (Payout)
    // 依据：Xendit Payout V2 API 回调一定包含 event 字段，且以 'payout.' 开头
    if (event && event.startsWith('payout.')) {
      this.logger.log(
        `[Webhook Router] Identified as PAYOUT (Event: ${event})`,
      );
      return this.handlePayoutWebhook(payload.data);
    }

    // 判定逻辑 2: 依据 external_id
    if (typeof payload.external_id === 'string') {
      this.logger.log(
        `[Webhook Router] Identified as INVOICE (Order: ${payload.external_id})`,
      );
      return this.handleInvoiceWebhook(payload);
    }

    // 兜底逻辑：无法识别
    this.logger.warn(`[Webhook Router] Unknown payload format, ignored.`);
    return { status: 'IGNORED', reason: 'Unknown Format' };
  }

  /**
   * Handle recharge webhook from payment gateway
   * @param payload
   */
  private async handleInvoiceWebhook(payload: unknown) {
    if (!isRecord(payload)) {
      return { status: 'IGNORED', message: 'Invalid Payload' };
    }

    const orderNo =
      typeof payload.external_id === 'string' ? payload.external_id : null;
    const status = typeof payload.status === 'string' ? payload.status : null;
    const amount = payload.amount;
    const transactionId = typeof payload.id === 'string' ? payload.id : null;

    if (!orderNo || !status || !transactionId) {
      return { status: 'IGNORED', message: 'Missing Required Fields' };
    }

    if (typeof amount !== 'number' && typeof amount !== 'string') {
      return { status: 'IGNORED', message: 'Invalid Amount' };
    }

    const invoicePayload: InvoiceWebhookPayload = {
      external_id: orderNo,
      status,
      amount,
      id: transactionId,
    };

    // double check prefix
    if (!orderNo || !orderNo.startsWith(BizPrefix.DEPOSIT)) {
      this.logger.warn(`[Invoice] Invalid OrderNo prefix: ${orderNo}`);
      return { status: 'IGNORED', message: 'Invalid Prefix' };
    }

    this.logger.log(`[Invoice Logic] Processing ${orderNo}, Status: ${status}`);

    // Ignore non-successful statuses
    if (status !== 'PAID' && status !== 'SETTLED' && status !== 'SUCCESS') {
      return { status: 'IGNORED', message: `Status is ${status}` };
    }

    const amountDecimal = new Prisma.Decimal(invoicePayload.amount);

    return this.prismaService.$transaction(async (ctx) => {
      //状态抢先更新，防止并发问题
      const updateResult = await ctx.rechargeOrder.updateMany({
        where: {
          rechargeNo: orderNo,
          rechargeStatus: RECHARGE_STATUS.PENDING, // only update if still pending
          rechargeAmount: amountDecimal, // double check amount
        },
        data: {
          rechargeStatus: RECHARGE_STATUS.SUCCESS,
          thirdPartyOrderNo: invoicePayload.id,
          paidAt: new Date(),
          callbackData: invoicePayload,
        },
      });

      // 如果 count 为 0，说明被抢占了，或者订单有问题
      if (updateResult.count === 0) {
        // 做个简单的查库，返回具体原因，方便日志排查
        const order = await ctx.rechargeOrder.findUnique({
          where: { rechargeNo: orderNo },
        });
        if (!order) {
          throw new InternalServerErrorException(
            `Recharge order not found during update: ${orderNo}`,
          );
        }
        if (order.rechargeStatus === RECHARGE_STATUS.SUCCESS) {
          return {
            status: 'SUCCESS',
            message: 'Idempotent: Already Processed',
          };
        }
        throw new InternalServerErrorException(
          'Failed to update recharge order status, possible concurrency issue',
        );
      }

      // check if order exists
      const order = await ctx.rechargeOrder.findUnique({
        where: { rechargeNo: orderNo },
        select: {
          rechargeId: true,
          userId: true,
        },
      });

      if (!order) {
        throw new InternalServerErrorException(
          `Recharge order not found after update: ${orderNo}`,
        );
      }

      // Credit user's wallet
      await this.walletService.creditCash(
        {
          userId: order.userId,
          amount: amountDecimal,
          related: {
            id: order.rechargeId,
            type: RelatedType.RECHARGE,
          },
          desc: `Recharge via Xendit. Txn: ${invoicePayload.id}`,
        },
        ctx,
      );

      return { status: 'SUCCESS', message: 'Recharge processed successfully' };
    });
  }

  /**
   * Handle disbursement (withdrawal) webhook from payment gateway
   * @param payload
   */
  private async handlePayoutWebhook(payload: unknown) {
    if (!isRecord(payload)) {
      return { status: 'IGNORED', message: 'Invalid Payload' };
    }

    const orderNo =
      typeof payload.reference_id === 'string' ? payload.reference_id : null;
    const status = typeof payload.status === 'string' ? payload.status : null;
    const failureCode =
      typeof payload.failure_code === 'string'
        ? payload.failure_code
        : undefined;

    if (!orderNo || !status) {
      return { status: 'IGNORED', message: 'Missing Required Fields' };
    }

    const payoutPayload: PayoutWebhookPayload = {
      reference_id: orderNo,
      status,
      failure_code: failureCode,
    };

    // double check prefix
    if (!orderNo.startsWith(BizPrefix.WITHDRAW)) {
      this.logger.warn(`[Payout] Invalid OrderNo prefix: ${orderNo}`);
      return { status: 'IGNORED', message: 'Invalid Prefix' };
    }

    this.logger.log(`[Payout Logic] Processing ${orderNo}, Status: ${status}`);

    return this.prismaService.$transaction(async (ctx) => {
      // Find the withdrawal order
      const order = await ctx.withdrawOrder.findUnique({
        where: { withdrawNo: orderNo },
      });
      if (!order) {
        throw new NotFoundException(`Withdrawal order not found: ${orderNo}`);
      }

      // Idempotency check: return if already processed
      if (
        order.withdrawStatus === WITHDRAW_STATUS.SUCCESS ||
        order.withdrawStatus === WITHDRAW_STATUS.FAILED
      ) {
        return {
          message: 'Withdrawal order already processed',
          order,
        };
      }

      const amount = order.actualAmount;

      if (status === 'SUCCEEDED' || status === 'COMPLETED') {
        // ：使用 updateMany 但允许"强制扣减"
        // 这里的逻辑是：钱已经没了，我们要扣减冻结金额并增加总提现额
        // 即使 frozenBalance 不足，理论上也应该扣，但为了数据健康，我们还是加 gte 校验
        // 如果 gte 校验失败，说明系统有严重 Bug (冻结金额丢了)，但不能让回调死循环
        const r = await ctx.userWallet.updateMany({
          where: { userId: order.userId, frozenBalance: { gte: amount } },
          data: {
            frozenBalance: { decrement: amount }, // Unfreeze the amount
            totalWithdraw: { increment: amount }, // Increment total withdrawn
          },
        });

        if (r.count !== 1) {
          //  严重警报：钱转出去了，但冻结金额不够扣！
          // 策略：记录严重日志，强制把订单标为完成，防止死循环。
          // 也可以选择强制扣减 frozenBalance 到负数
          this.logger.error(
            `CRITICAL: User ${order.userId} withdraw success but insufficient frozen balance! Order: ${orderNo}`,
          );

          // 兜底操作：强制扣减 (移除 gte 条件)，或者手动修数据
          await ctx.userWallet.update({
            where: { userId: order.userId },
            data: {
              frozenBalance: { decrement: amount }, // Unfreeze the amount
              totalWithdraw: { increment: amount }, // Increment total withdrawn
            },
          });
        }

        // Update withdrawal order status to SUCCESS
        await ctx.walletTransaction.updateMany({
          where: {
            relatedId: order.withdrawId,
            relatedType: RelatedType.WITHDRAWAL,
          },
          data: {
            status: TRANSACTION_STATUS.SUCCESS,
            description: 'Withdrawal completed successfully',
          },
        });

        // Update withdrawal order status
        await ctx.withdrawOrder.update({
          where: { withdrawId: order.withdrawId },
          data: {
            withdrawStatus: WITHDRAW_STATUS.SUCCESS,
            completedAt: new Date(),
          },
        });
      } else if (status === 'FAILED') {
        this.logger.warn(
          `Disbursement Failed for ${orderNo}: ${payoutPayload.failure_code ?? 'UNKNOWN'}`,
        );
        // Unfreeze the amount back to available balance
        await this.walletService.unfreezeCash(
          {
            userId: order.userId,
            amount: amount,
            related: {
              id: order.withdrawId,
              type: RelatedType.WITHDRAWAL,
            },
            desc: `Withdrawal failed: ${payoutPayload.failure_code ?? 'UNKNOWN'}`,
          },
          ctx,
        );
        // Update withdrawal order status to FAILED
        await ctx.withdrawOrder.update({
          where: { withdrawId: order.withdrawId },
          data: {
            withdrawStatus: WITHDRAW_STATUS.FAILED,
            completedAt: new Date(),
            rejectReason: `Disbursement failed: ${payoutPayload.failure_code ?? 'UNKNOWN'}`,
          },
        });

        return { status: 'PROCESSED', xendit_status: status };
      }
    });
  }

  /**
   * Get recharge order details
   * @param userId
   * @param rechargeNo
   */
  async getRechargeDetail(userId: string, rechargeNo: string) {
    if (!rechargeNo) throw new BadRequestException('rechargeNo is required');

    const order = await this.prismaService.rechargeOrder.findUnique({
      where: { rechargeNo },
      select: {
        userId: true,
        rechargeNo: true,
        rechargeAmount: true,
        rechargeStatus: true,
        createdAt: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Recharge order not found: ${rechargeNo}`);
    }

    // 越权校验：只能查自己的订单
    if (order.userId !== userId) {
      throw new ForbiddenException('Invalid order permission');
    }

    // 转换状态给前端 (前端期望 'SUCCESS', 'FAILED', 'PROCESSING')
    let statusStr = 'PROCESSING';
    if (order.rechargeStatus === RECHARGE_STATUS.SUCCESS) {
      statusStr = 'SUCCESS';
    } else if (order.rechargeStatus !== RECHARGE_STATUS.PENDING) {
      // 只要不是 PENDING 和 SUCCESS，统统认为是 FAILED
      // (兼容未来可能增加的 CANCELLED / REFUNDED 等状态)
      statusStr = 'FAILED';
    }

    return {
      orderNo: order.rechargeNo,
      amount: order.rechargeAmount,
      status: statusStr,
      createdAt: order.createdAt,
    };
  }

  /** Apply for a withdrawal
   *
   * @param userId
   * @param dto
   */
  async applyWithdraw(userId: string, dto: ApplyWithdrawDto) {
    const { amount: amountNum, account, accountName } = dto;

    // check channel existence
    const channel = await this.prismaService.paymentChannel.findUnique({
      where: { id: dto.channelId, status: 1 },
    });

    if (!channel) {
      throw new NotFoundException('Payment channel not found or inactive');
    }

    //检验提现金额是否在允许范围内
    if (channel.minAmount && amountNum < channel.minAmount.toNumber()) {
      throw new NotFoundException(
        `Withdrawal amount is below the minimum of ${channel.minAmount.toString()}`,
      );
    }

    if (channel.maxAmount && amountNum > channel.maxAmount.toNumber()) {
      throw new NotFoundException(
        `Withdrawal amount exceeds the maximum of ${channel.maxAmount.toString()}`,
      );
    }

    const withdrawAmount = new Prisma.Decimal(amountNum);

    // 4. 核心修改：计算手续费
    // 逻辑：提现金额 100，手续费 5块，实际到账 95块。冻结用户 100块。
    const feeRate = channel.feeRate || new Prisma.Decimal(0);
    const feeFixed = channel.feeFixed || new Prisma.Decimal(0);

    // Fee = (Amount * Rate) + Fixed
    const calcFee = withdrawAmount.mul(feeRate).add(feeFixed);

    // Actual = Amount - Fee
    // 兜底逻辑：如果算出来实际到账小于0，这笔单不能提
    const actualAmount = withdrawAmount.sub(calcFee);

    if (actualAmount.lessThanOrEqualTo(0)) {
      throw new InternalServerErrorException(
        'Calculated actual amount is zero or negative due to fees',
      );
    }

    return this.prismaService.$transaction(async (ctx) => {
      const order = await ctx.withdrawOrder.create({
        data: {
          withdrawNo: OrderNoHelper.generate(BizPrefix.WITHDRAW),
          userId,
          withdrawAmount: withdrawAmount,
          actualAmount: actualAmount,
          feeAmount: calcFee,
          withdrawStatus: WITHDRAW_STATUS.PENDING_AUDIT,
          accountName,
          withdrawAccount: account,
          channelCode: channel.code, // 'PH_GCASH'
          // 1. 复用 withdrawMethod 存类型 (假设 channel.type 也是 Int)
          withdrawMethod: channel.type,
          // 2. 复用 bankName 存 "GCash" / "BDO" 这种名字
          // 这样前端历史记录直接读 bankName 显示即可
          bankName: channel.name,
        },
      });

      await this.walletService.freezeCash(
        {
          userId,
          amount: withdrawAmount,
          related: {
            id: order.withdrawId,
            type: RelatedType.WITHDRAWAL,
          },
          desc: ` Apply for withdrawal, freeze amount `,
        },
        ctx,
      );

      return order;
    });
  }

  /** Create a recharge order
   *
   * @param userId
   * @param dto
   */
  async createRecharge(userId: string, dto: CreateRechargeDto) {
    const amount = new Prisma.Decimal(dto.amount);
    const { redirectUrl } = dto;

    //  1. 核心逻辑：先校验渠道是否存在、是否可用
    const channel = await this.prismaService.paymentChannel.findUnique({
      where: { id: dto.channelId, status: 1 },
    });
    if (!channel) {
      throw new NotFoundException('Payment channel not found or inactive');
    }

    //检验充值金额是否在允许范围内
    if (channel.minAmount && amount.lessThan(channel.minAmount)) {
      throw new NotFoundException(
        `Recharge amount is below the minimum of ${channel.minAmount.toString()}`,
      );
    }

    if (channel.maxAmount && amount.greaterThan(channel.maxAmount)) {
      throw new NotFoundException(
        `Recharge amount exceeds the maximum of ${channel.maxAmount.toString()}`,
      );
    }

    // Generate a unique recharge order number
    const rechargeNo = OrderNoHelper.generate(BizPrefix.DEPOSIT);

    // Create the recharge pending order in the database
    const order = await this.prismaService.rechargeOrder.create({
      data: {
        rechargeNo,
        userId,
        rechargeAmount: amount,
        actualAmount: amount,
        rechargeStatus: RECHARGE_STATUS.PENDING,
        //  2. 记录渠道信息
        // RechargeOrder 表里最好加一个 channelId 字段来关联
        // 如果没有，暂时可以用 paymentMethod 存 channel.type
        // 建议：在 rechargeOrder 表加 channelId Int
        paymentMethod: channel.type, // EWallet online
        channelCode: channel.code,
        channelId: channel.id,
        paymentChannel: channel.name,
      },
    });

    // Create payment link via payment gateway ,get xendit invoice url
    const paymentUrl = await this.paymentService.createRechargeLink(
      order.rechargeNo,
      amount.toNumber(),
      redirectUrl,
      channel.code,
    );

    return {
      rechargeNo: order.rechargeNo,
      rechargeAmount: order.rechargeAmount.toString(),
      payUrl: paymentUrl,
      rechargeStatus: order.rechargeStatus,
      channelId: channel.id,
    };
  }

  /**
   * Get recharge history
   * @param userId
   * @param dto
   */
  async getRechargeHistory(userId: string, dto: GetRechargeHistoryDto) {
    const { page = 1, pageSize = 10, status } = dto;
    const skip = (page - 1) * pageSize;

    const whereConditions: Prisma.RechargeOrderWhereInput = {
      userId,
    };

    if (status) {
      whereConditions.rechargeStatus = status;
    }

    const [list, total] = await this.prismaService.$transaction([
      this.prismaService.rechargeOrder.findMany({
        where: whereConditions,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          rechargeNo: true,
          rechargeAmount: true,
          actualAmount: true,
          rechargeStatus: true,
          paymentMethod: true,
          createdAt: true,
          paidAt: true,
          channelCode: true,
          paymentChannel: true,
        },
      }),
      this.prismaService.rechargeOrder.count({
        where: whereConditions,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      list,
    };
  }

  /** Get withdrawal history
   *
   * @param userId
   * @param dto
   */
  async getWithdrawalHistory(userId: string, dto: WithdrawalHistoryQueryDto) {
    const { page = 1, pageSize = 10, status } = dto;
    const skip = (page - 1) * pageSize;

    const whereConditions: Prisma.WithdrawOrderWhereInput = {};

    if (status) {
      whereConditions.withdrawStatus = status;
    }

    const [list, total] = await this.prismaService.$transaction([
      this.prismaService.withdrawOrder.findMany({
        where: { userId, ...whereConditions },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          withdrawNo: true,
          withdrawAmount: true, // 申请金额
          actualAmount: true, // 实际到账
          feeAmount: true, // 手续费
          withdrawStatus: true,
          accountName: true,
          withdrawAccount: true,
          createdAt: true,
          completedAt: true,
          rejectReason: true,
          bankName: true,
          channelCode: true,
        },
      }),
      this.prismaService.withdrawOrder.count({
        where: { userId, ...whereConditions },
      }),
    ]);

    const formattedList = list.map((item) => ({
      ...item,
      channelName: item.bankName, // 把存进去的 "GCash" 拿出来
    }));

    return {
      total,
      page,
      pageSize,
      list: formattedList,
    };
  }
}
