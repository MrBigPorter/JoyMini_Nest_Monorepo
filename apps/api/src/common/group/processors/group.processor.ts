import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Job } from 'bullmq';
import { LotteryService } from '@api/common/lottery/lottery.service';
import { LuckyDrawService } from '@api/common/lucky-draw/lucky-draw.service';

@Processor('group_settlement', {
  concurrency: 5, // 企业级限流：同时只允许 5 个任务并行处理，保护数据库
})
export class GroupProcessor extends WorkerHost {
  private readonly logger = new Logger(GroupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lotteryService: LotteryService,
    private readonly luckyDrawService: LuckyDrawService,
  ) {
    super();
  }

  async process(job: Job<{ groupId: string }>): Promise<void> {
    const { groupId } = job.data;
    switch (job.name) {
      case 'activate_orders':
        return this.handleOrderActivation(groupId);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  /**
   * 团成功后处理：
   * 1. 开奖（事务内）— 选出 winner → WAIT_DELIVERY，其余 → COMPLETED
   * 2. 发福利抽奖券（事务外，fire-and-forget）— 所有真人成员各得 1 张
   */
  private async handleOrderActivation(groupId: string): Promise<void> {
    this.logger.log(`[GroupProcessor] Activating orders for group ${groupId}`);

    try {
      // Step 1：开奖（事务内，幂等：uk_lottery_group 唯一索引防重入）
      await this.prisma.$transaction(async (tx) => {
        await this.lotteryService.drawWinner(groupId, tx);
      });

      // Step 2：发福利抽奖券（事务外，fire-and-forget，失败不影响主流程）
      setImmediate(() => {
        this.luckyDrawService
          .issueTicketsForGroup(groupId)
          .catch((e: unknown) => {
            this.logger.error(
              `[LuckyDraw] issueTicketsForGroup failed for group ${groupId}: ${
                e instanceof Error ? e.message : String(e)
              }`,
            );
          });
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `[GroupProcessor] Failed to activate orders for group ${groupId}: ${msg}`,
      );
      throw e; // 让 BullMQ 触发重试
    }
  }
}
