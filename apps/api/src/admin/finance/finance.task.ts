import { Injectable, Logger } from '@nestjs/common';
import { FinanceService } from '@api/admin/finance/finance.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RECHARGE_STATUS, TimeHelper, WITHDRAW_STATUS } from '@lucky/shared';
import dayjs from 'dayjs';
import { RedisLockService } from '@api/common/redis/redis-lock.service';
import { PaymentService } from '@api/common/payment/payment.service';

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
              // 1. 去 Xendit 查这笔单到底什么情况
              // 使用 withdrawId 作为 external_id (根据我们之前定的幂等键规则)
              let xenditData;
              try {
                xenditData =
                  await this.paymentService.getDisbursementByExternalId(
                    order.withdrawNo,
                  );
              } catch (err: any) {
                this.logger.warn(
                  `[Withdraw-Fix] Connect error for ${order.withdrawNo}: ${err.message}`,
                );
              }

              // 2. 根据查到的结果更新数据库
              if (!xenditData) {
                // A. Xendit 查无此单 -> 说明代码断电在“改库为Processing”之后，“发请求”之前
                // 结果：钱没出去。
                // 动作：标记为 FAILED (或者回滚为 PENDING_AUDIT)
                await this.prismaService.withdrawOrder.update({
                  where: { withdrawId: order.withdrawId },
                  data: {
                    withdrawStatus: WITHDRAW_STATUS.FAILED,
                    updatedAt: new Date(),
                    auditResult: 'Auto-Fix: Not found on Xendit (Ghost Order)',
                  },
                });

                // 注意：这里可能需要人工介入退还冻结金额，或者自动退还。
                // 为安全起见，先标记为 FAILED，让财务手动处理“退款”按钮更稳妥。
                this.logger.log(
                  `[Withdraw-Fix] ${order.withdrawNo} marked FAILED (Not found in Xendit)`,
                );
              } else if (xenditData.status === 'SUCCEEDED') {
                // B. Xendit 状态是 COMPLETED -> 说明代码断电在“改库为Processing”之后，“发请求”之后
                // 结果：钱已经出去。
                // 动作：标记为 SUCCESS
                await this.prismaService.withdrawOrder.update({
                  where: { withdrawId: order.withdrawId },
                  data: {
                    withdrawStatus: WITHDRAW_STATUS.SUCCESS,
                    thirdPartyOrderNo: xenditData.id,
                    updatedAt: new Date(),
                    auditResult:
                      'Auto-Fix: Marked SUCCESS (Completed on Xendit)',
                  },
                });
                this.logger.log(
                  `[Withdraw-Fix] ${order.withdrawNo} marked SUCCESS (Completed on Xendit)`,
                );
              } else if (xenditData.status === 'FAILED') {
                // C. Xendit 状态是 FAILED
                // 结果：钱没出去。
                // 动作：标记为 FAILED
                await this.prismaService.withdrawOrder.update({
                  where: { withdrawId: order.withdrawId },
                  data: {
                    withdrawStatus: WITHDRAW_STATUS.FAILED,
                    thirdPartyOrderNo: xenditData.id,
                    updatedAt: new Date(),
                    auditResult: `Auto-Fix: Xendit status is ${xenditData.status}`,
                  },
                });
                this.logger.log(
                  `[Withdraw-Fix] ${order.withdrawNo} marked FAILED (Xendit status: ${xenditData.status})`,
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
