import { Injectable, Logger } from '@nestjs/common';
import { FinanceService } from '@api/admin/finance/finance.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RECHARGE_STATUS, TimeHelper, WITHDRAW_STATUS } from '@lucky/shared';
import dayjs from 'dayjs';
import { RedisLockService } from '@api/common/redis/redis-lock.service';
import { PaymentService } from '@api/common/payment/payment.service';
import { WithdrawSettlementService } from '@api/client/wallet/withdraw-settlement.service';

@Injectable()
export class FinanceTask {
  private readonly logger = new Logger(FinanceTask.name);

  // 简单的内存锁，防止任务重叠执行
  private isRunning = false;

  constructor(
    private financeService: FinanceService,
    private prismaService: PrismaService,
    private paymentService: PaymentService,
    private lockService: RedisLockService,
    private withdrawSettlementService: WithdrawSettlementService,
  ) {}

  /**
   * 每 10 分钟检查一次充值订单状态，对于超过 30 分钟未完成的充值订单，尝试自动同步状态
   *
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleStuckOrders() {
    // 使用 Redis 锁，锁 5秒即可（只是为了抢占执行权，抢不到的就放弃）
    // 这里的 ttl 设短一点没关系，只要能互斥就行
    await this.lockService.runWithLock(
      'cron:stuck_recharges',
      60000,
      async () => {
        try {
          // 30 分钟前的时间点
          const timeThreshold = TimeHelper.toDate(
            dayjs().subtract(30, 'minute'),
          );

          const stuckOrders = await this.prismaService.rechargeOrder.findMany({
            where: {
              rechargeStatus: RECHARGE_STATUS.PENDING,
              createdAt: { lt: timeThreshold }, // get orders created before the threshold,30 minutes ago
            },
            take: 20, // limit to 20 orders per run
            orderBy: {
              createdAt: 'asc', // oldest first
            },
          });

          if (stuckOrders.length === 0) return;

          this.logger.log(
            ` Auto-Sync found ${stuckOrders.length} stuck orders...`,
          );

          for (const order of stuckOrders) {
            try {
              const result = await this.financeService.syncRechargeStatus(
                order.rechargeId,
                'SYSTEM_BOT',
              );
              if (result.status !== 'NO_CHANGE') {
                this.logger.log(
                  `[Auto-Fix] ${order.rechargeNo}: ${result.status}`,
                );
              }

              // 500ms delay to be polite to Xendit API
              await new Promise((resolve) => setTimeout(resolve, 500)); // 1 second delay between requests
            } catch (error: any) {
              this.logger.error(
                `[Auto-Fix Failed] ${order.rechargeNo}: ${error.message}`,
              );
            }
          }
        } catch (e) {
          // 锁被占用，跳过本次执行，静默处理
        }
      },
    );
  }

  /**
   * 任务 2: 提现补单
   * 每 5 分钟检查一次卡在 PROCESSING 的提现单
   * 这是防止 "钱出去了，数据库没变" 的救命稻草
   */

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleStuckWithdrawals() {
    await this.lockService.runWithLock(
      'cron:stuck_withdrawals',
      300000,
      async () => {
        try {
          // 找出 10 分钟前更新，但状态依然是 PROCESSING 的订单
          // 正常 Xendit 打款也就几秒钟，10分钟没变肯定是出事了

          const timeThreshold = TimeHelper.toDate(
            dayjs().subtract(10, 'minute'),
          );

          const stuckOrders = await this.prismaService.withdrawOrder.findMany({
            where: {
              withdrawStatus: WITHDRAW_STATUS.PROCESSING,
              updatedAt: { lt: timeThreshold },
            },
            take: 20,
          });

          if (stuckOrders.length === 0) return;

          this.logger.log(
            `[Withdraw-Fix] Found ${stuckOrders.length} potential ghost orders...`,
          );

          for (const order of stuckOrders) {
            try {
              // 1. 去 Xendit 查这笔单的真实状态（referenceId = withdrawNo）
              let xenditData;
              try {
                xenditData =
                  await this.paymentService.getDisbursementByExternalId(
                    order.withdrawNo,
                  );
              } catch (err: any) {
                // 查询失败 ≠ 查无此单。拿不到结果就不能落定，
                // 否则会在钱其实已打出的情况下错误退款。留到下一轮再查。
                this.logger.warn(
                  `[Withdraw-Fix] Query failed for ${order.withdrawNo}: ${err.message}, skip this round`,
                );
                continue;
              }

              // 2. 按 Xendit 的真实状态落终态，并结算钱包
              if (!xenditData) {
                // A. 查无此单：确认真金没出去 → 置失败 + 解冻
                await this.withdrawSettlementService.settleWithdrawal({
                  withdrawId: order.withdrawId,
                  outcome: 'FAILED',
                  reason: 'Auto-Fix: Not found on Xendit (ghost order)',
                });
                this.logger.log(
                  `[Withdraw-Fix] ${order.withdrawNo} settled FAILED (not found on Xendit), frozen amount released`,
                );
              } else if (xenditData.status === 'SUCCEEDED') {
                // B. 钱已经出去 → 置成功 + 扣冻结
                await this.withdrawSettlementService.settleWithdrawal({
                  withdrawId: order.withdrawId,
                  outcome: 'SUCCESS',
                  thirdPartyOrderNo: xenditData.id,
                });
                this.logger.log(
                  `[Withdraw-Fix] ${order.withdrawNo} settled SUCCESS (Xendit: ${xenditData.status})`,
                );
              } else if (xenditData.status === 'FAILED') {
                // C. 钱没出去 → 置失败 + 解冻
                await this.withdrawSettlementService.settleWithdrawal({
                  withdrawId: order.withdrawId,
                  outcome: 'FAILED',
                  thirdPartyOrderNo: xenditData.id,
                  reason: `Auto-Fix: Xendit status is ${xenditData.status}`,
                });
                this.logger.log(
                  `[Withdraw-Fix] ${order.withdrawNo} settled FAILED (Xendit: ${xenditData.status}), frozen amount released`,
                );
              } else {
                // D. PENDING / ACCEPTED 等中间态：还看不出结果，继续等下一轮
                this.logger.log(
                  `[Withdraw-Fix] ${order.withdrawNo} still ${xenditData.status}, skip`,
                );
              }

              await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms delay between requests
            } catch (error: any) {
              this.logger.error(
                `[Withdraw-Fix Error] ${order.withdrawNo}: ${error.message}`,
              );
            }
          }
        } catch (e) {
          // 静默忽略，不中断批量处理
          void e;
        }
      },
      false,
    );
  }
}
