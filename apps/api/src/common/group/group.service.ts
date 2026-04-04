import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { GroupListForTreasureDto } from '@api/common/group/dto/group-list-for-treasure.dto';
import { WalletService } from '@api/client/wallet/wallet.service';
import {
  ORDER_STATUS,
  PAY_STATUS,
  GROUP_STATUS,
  IS_OWNER,
  REFUND_STATUS,
  TimeHelper,
} from '@lucky/shared';
import { RedisLockService } from '@api/common/redis/redis-lock.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  EventsGateway,
  PushEventType,
} from '@api/common/events/events.gateway';
import dayjs from 'dayjs';
import { NotificationService } from '@api/client/notification/notification.service';
import { AVATAR_QUEUE_NAME } from '@api/common/avatar/avatar.processor';

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class GroupService {
  private readonly logger = new Logger(GroupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    public readonly lockService: RedisLockService,
    private readonly notificationService: NotificationService,
    @InjectQueue(AVATAR_QUEUE_NAME) private readonly avatarQueue: Queue,
    @InjectQueue('group_settlement') private readonly settlementQueue: Queue,
    private readonly eventsGateway: EventsGateway,
  ) {}

  private orm(tx?: Tx) {
    return tx ?? this.prisma;
  }

  // ============================================================
  // 1. 核心业务：加入或创建团 (真人入口)
  // ============================================================

  async joinOrCreateGroup(
    params: {
      userId: string;
      treasureId: string;
      groupId?: string | null;
      orderId: string;
    },
    tx?: Tx,
  ): Promise<{
    finalGroupId: string | null;
    isOwner: number;
    alreadyInGroup: boolean;
  }> {
    const db = this.orm(tx);
    const { userId, treasureId, groupId, orderId } = params;

    if (groupId) {
      // 场景 A: 加入现有的团
      const group = await db.treasureGroup.findUnique({
        where: { groupId },
        select: {
          treasureId: true,
          groupStatus: true,
          maxMembers: true,
          currentMembers: true,
          expireAt: true,
          version: true,
        },
      });

      if (!group || group.treasureId !== treasureId)
        throw new NotFoundException('Group not found');
      if (group.groupStatus !== GROUP_STATUS.ACTIVE)
        throw new BadRequestException('Group is full or ended');
      if (new Date() > group.expireAt)
        throw new BadRequestException('Group expired');
      if (group.currentMembers >= group.maxMembers)
        throw new BadRequestException('Group already full');

      //  核心：乐观锁更新人数，防止瞬间超员
      const updateResult = await db.treasureGroup.updateMany({
        where: {
          groupId: groupId,
          version: group.version,
          currentMembers: { lt: group.maxMembers },
        },
        data: {
          currentMembers: { increment: 1 },
          version: { increment: 1 },
        },
      });

      if (!updateResult || updateResult.count === 0) {
        throw new BadRequestException(
          'System busy, please try again (Concurrency)',
        );
      }

      // 写入成员表
      await db.treasureGroupMember.create({
        data: { groupId, userId, isOwner: IS_OWNER.NO, orderId, memberType: 0 },
      });

      // 判断是否刚刚凑满
      if (group.currentMembers + 1 >= group.maxMembers) {
        await this.handleGroupSuccessInTx(groupId, db);
      }

      // 触发头像更新任务
      this.triggerAvatarUpdate(groupId);

      //  [Socket 触发点 1]：真人加入成功
      // 不要在 await 里面等，让它飘着就行 (Fire and Forget)
      this.notifyGroupChange(groupId);

      return {
        finalGroupId: groupId,
        isOwner: IS_OWNER.NO,
        alreadyInGroup: false,
      };
    } else {
      // 场景 B: 开新团
      const treasure = await db.treasure.findUnique({ where: { treasureId } });
      if (!treasure) throw new BadRequestException('Treasure not found');

      const newGroup = await db.treasureGroup.create({
        data: {
          treasureId,
          creatorId: userId,
          maxMembers: treasure.groupSize || 5,
          currentMembers: 1,
          groupStatus: GROUP_STATUS.ACTIVE,
          version: 1,
          expireAt: new Date(
            Date.now() + (treasure.groupTimeLimit || 86400) * 1000,
          ),
        },
      });

      //  [Socket 触发点 2]：新团创建成功
      // 这里可以直接构造数据推，也可以复用 notifyGroupChange
      this.notifyGroupChange(newGroup.groupId);

      await db.treasureGroupMember.create({
        data: {
          groupId: newGroup.groupId,
          userId,
          isOwner: IS_OWNER.YES,
          orderId,
          memberType: 0,
        },
      });

      this.triggerAvatarUpdate(newGroup.groupId);

      return {
        finalGroupId: newGroup.groupId,
        isOwner: 1,
        alreadyInGroup: false,
      };
    }
  }

  // [新增方法] 核心通知逻辑：通知团内所有成员结果
  private async notifyMembersOfResult(groupId: string, isSuccess: boolean) {
    try {
      // 查询所有成员 + 团信息
      const groupData = await this.prisma.treasureGroup.findUnique({
        where: { groupId },
        include: {
          members: { select: { userId: true } },
          treasure: { select: { treasureName: true } },
        },
      });
      if (!groupData) return;

      const eventType = isSuccess
        ? PushEventType.GROUP_SUCCESS
        : PushEventType.GROUP_FAILED;

      // 遍历成员，发送通知
      for (const member of groupData.members) {
        if (!member.userId) continue;

        // 这里假设 EventsGateway 有一个 sendToUser 方法
        this.eventsGateway.notifyUser(member.userId, eventType, {
          groupId: groupData.groupId,
          title: isSuccess ? 'Group Success!' : 'Group Expired',
          treasureName: groupData.treasure.treasureName,
          message: isSuccess
            ? 'Your group is full! Results calculating...'
            : 'Group failed. Refund processed.',
          timestamp: Date.now(),
        });

        // 2.  [修改 2] FCM 推送通知 (用于唤醒后台/锁屏用户)
        // 这里的 await 可能会轻微拖慢循环，如果群成员很多(比如几百人)，建议去掉 await 让它并行
        // 但对于 5-10 人的小团，await 完全没问题，且更安全
        this.notificationService
          .sendPrivateMessage(
            member.userId,
            // Title: 成功用  庆祝，失败用 ⏳ 提示
            isSuccess ? ' Group Full! Results are in...' : ' Group Expired',
            // Body: 重点突出产品名，失败强调 "Don't worry" 和 "Refund"
            isSuccess
              ? `Hooray! Your group for "${groupData.treasure.treasureName}" is complete. Tap to see if you won!`
              : `The group for "${groupData.treasure.treasureName}" didn't fill up. Don't worry, your refund has been processed instantly.`,
            {
              type: 'group_detail',
              id: groupId,
              isSuccess: String(isSuccess),
            },
          )
          .catch((e) => {
            // 建议加上 catch，防止因为一个人推送失败炸掉整个循环（如果不加 await 这行可以忽略）
            this.logger.error(`FCM failed for ${member.userId}: ${e.message}`);
          });
      }
      this.logger.log(
        `🔔 [Notify] Sent ${eventType} to ${groupData.members.length} members of group ${groupId}`,
      );
    } catch (e: any) {
      this.logger.error(
        `Failed to notify members for group ${groupId}: ${e.message}`,
      );
    }
  }
  // ============================================================
  // 2. 核心通知逻辑：成团信号发射
  // ============================================================

  /**
   * [内部私有] 在事务内更新状态
   */
  private async handleGroupSuccessInTx(groupId: string, db: Tx) {
    this.logger.log(`[Status] Group ${groupId} reached SUCCESS state.`);
    await db.treasureGroup.update({
      where: { groupId },
      data: {
        groupStatus: GROUP_STATUS.SUCCESS,
        successAt: new Date(),
        endedAt: new Date(),
      },
    });

    // 关键优化：使用 setImmediate 确保信号在主数据库事务 COMMIT 之后发出
    // 这样 Worker 去查订单时，状态肯定已经是最新且可见的
    setImmediate(() => {
      this.emitGroupSuccessSignal(groupId);
      //  [Socket 触发点 4]：状态变为 SUCCESS
      // 通知前端这个团满了/结束了
      this.notifyGroupChange(groupId);
      //  2. [新增] 通知参与者 (弹窗报喜)
      this.notifyMembersOfResult(groupId, true);
    });
  }

  /**
   * [信号发射器] 往 BullMQ 丢任务
   */
  private async emitGroupSuccessSignal(groupId: string) {
    try {
      await this.settlementQueue.add(
        'activate_orders',
        { groupId },
        {
          jobId: `settle_${groupId}`, // 幂等性，同一个团绝不重复激活
          delay: 1000, // 给数据库留 1s 缓冲时间
          removeOnComplete: true,
        },
      );
      this.logger.log(`🚀 [BullMQ] Queued activation for group ${groupId}`);
    } catch (err: any) {
      this.logger.error(`[BullMQ ERROR] Failed to add job: ${err.message}`);
    }
  }

  /**
   * [内部方法] 触发群组九宫格头像异步合成
   */
  private triggerAvatarUpdate(groupId: string) {
    this.avatarQueue
      .add(
        'update_treasure_group',
        { groupId },
        {
          // 关键：延迟 500ms 执行，防止数据库主从延迟或事务未提交导致 Worker 查不到新成员
          delay: 500,
          // 自动清理完成的任务，节省 Redis 内存
          removeOnComplete: true,
          // 幂等性：同一个群在极短时间内只排队一个合成任务
          jobId: `avatar_${groupId}`,
        },
      )
      .catch((err) => {
        this.logger.error(
          `[Avatar Queue ERROR] Failed to add job: ${err.message}`,
        );
      });
  }

  // ============================================================
  // 3. 定时任务：机器人阶梯补位 (更真实的模拟用户)
  // ============================================================

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleRobotIntervention() {
    return await this.lockService.runWithLock(
      'group:robot:fill',
      30000, // 30秒分布式锁
      async () => {
        const activeGroups = await this.prisma.treasureGroup.findMany({
          where: {
            groupStatus: GROUP_STATUS.ACTIVE,
            treasure: { enableRobot: true },
          },
          include: { treasure: { select: { robotDelay: true } } },
        });

        const now = Date.now();
        for (const group of activeGroups) {
          const triggerTime =
            group.createdAt.getTime() + group.treasure.robotDelay * 1000;

          const fmt = 'HH:mm:ss'; // 只看时分秒就够了，不用看年月日
          const nowStr = dayjs(now).format(fmt);
          const triggerStr = dayjs(triggerTime).format(fmt);
          const waitSeconds = Math.ceil((triggerTime - now) / 1000); // 算出还要等几秒

          if (now < triggerTime) {
            this.logger.debug(
              `⏳ [等待中] 团ID: ${group.groupId.slice(-6)} | 当前: ${nowStr} | 预定: ${triggerStr} | ⚠️ 还要等: ${waitSeconds}秒`,
            );
            continue;
          }
          if (group.currentMembers >= group.maxMembers) continue;

          //  阶梯式补位：一次 Cron 只进 1 个机器人
          await this.fillSingleRobot(group);
        }
      },
      false,
    );
  }

  private async fillSingleRobot(group: any) {
    const bot = await this.prisma.user.findFirst({
      where: {
        isRobot: true,
        treasureGroupMembers: { none: { groupId: group.groupId } },
      },
    });
    if (!bot) return;

    try {
      let shouldTriggerSuccess = false;
      await this.prisma.$transaction(async (tx) => {
        const currentGroup = await tx.treasureGroup.findUnique({
          where: { groupId: group.groupId },
        });
        if (
          !currentGroup ||
          currentGroup.currentMembers >= currentGroup.maxMembers
        )
          return;

        // 1. 插入机器人成员
        await tx.treasureGroupMember.create({
          data: {
            groupId: group.groupId,
            userId: bot.id,
            isOwner: IS_OWNER.NO,
            orderId: null,
            memberType: 1,
          },
        });

        // 2. 更新团人数 (乐观锁)
        await tx.treasureGroup.updateMany({
          where: { groupId: group.groupId, version: currentGroup.version },
          data: {
            currentMembers: { increment: 1 },
            robotCount: { increment: 1 },
            isSystemFilled: true,
            version: { increment: 1 },
          },
        });

        // 3. 检查是否补满
        if (currentGroup.currentMembers + 1 >= currentGroup.maxMembers) {
          await tx.treasureGroup.update({
            where: { groupId: group.groupId },
            data: {
              groupStatus: GROUP_STATUS.SUCCESS,
              successAt: new Date(),
              endedAt: new Date(),
            },
          });
          shouldTriggerSuccess = true;
        }
      });

      this.triggerAvatarUpdate(group.groupId);

      // 4. 事务外发射信号
      if (shouldTriggerSuccess) {
        await this.emitGroupSuccessSignal(group.groupId);
        //  [新增] 如果机器人补满了，也要通知真人成员“成了”！
        this.notifyMembersOfResult(group.groupId, true);
      }

      //  [Socket 触发点 3]：机器人加入后
      // 无论是否满员，都要通知前端更新进度
      this.notifyGroupChange(group.groupId);
    } catch (e: any) {
      this.logger.error(`[Robot Error] Group ${group.groupId}: ${e.message}`);
    }
  }

  // ============================================================
  // 4. 定时任务：处理过期团 (退款)
  // ============================================================

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredGroups() {
    return await this.lockService.runWithLock(
      'group:expire',
      60000, // 60秒锁，防止大规模处理时锁失效
      async () => {
        const expiredGroups = await this.prisma.treasureGroup.findMany({
          where: {
            groupStatus: GROUP_STATUS.ACTIVE,
            expireAt: { lt: new Date() },
          },
          take: 50,
          select: { groupId: true },
        });

        if (expiredGroups.length === 0) return;
        this.logger.log(
          `[Expired] Found ${expiredGroups.length} groups for refund.`,
        );

        await Promise.allSettled(
          expiredGroups.map((g) => this.processGroupFailure(g.groupId)),
        );
      },
      false,
    );
  }

  private async processGroupFailure(groupId: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const group = await tx.treasureGroup.findUnique({ where: { groupId } });
        if (!group || group.groupStatus !== GROUP_STATUS.ACTIVE) return;

        await tx.treasureGroup.update({
          where: { groupId },
          data: { groupStatus: GROUP_STATUS.FAILED, endedAt: new Date() },
        });

        const orders = await tx.order.findMany({
          where: {
            groupId,
            payStatus: PAY_STATUS.PAID,
            refundStatus: REFUND_STATUS.NO_REFUND,
          },
        });

        for (const order of orders) {
          await this.refundSingleOrder(order, tx);
        }
      });
      //  [Socket 触发点 5]：状态变为 FAILED
      // 事务结束后，通知前端移除该团
      this.notifyGroupChange(groupId);

      //  2. [新增] 通知参与者 (退款到账提醒)
      this.notifyMembersOfResult(groupId, false);
    } catch (e: any) {
      this.logger.error(`[Failure Error] Group ${groupId}: ${e.message}`);
    }
  }

  private async refundSingleOrder(order: any, tx: Tx) {
    const cashRefund = new Prisma.Decimal(order.finalAmount);
    const coinRefund = new Prisma.Decimal(order.coinUsed || 0);

    if (cashRefund.gt(0)) {
      await this.wallet.creditCash(
        {
          userId: order.userId,
          amount: cashRefund,
          related: { id: order.orderId, type: 'REFUND_FAIL' },
          desc: 'Refund',
        },
        tx,
      );
    }
    if (coinRefund.gt(0)) {
      await this.wallet.creditCoin(
        {
          userId: order.userId,
          coins: coinRefund,
          related: { id: order.orderId, type: 'REFUND_FAIL' },
          desc: 'Refund',
        },
        tx,
      );
    }

    // 秒杀订单退款时恢复 flashStock
    if (order.flashSaleProductId) {
      await tx.$executeRaw`
        UPDATE flash_sale_products
           SET flash_stock = flash_stock + ${order.buyQuantity ?? 1}
         WHERE id = ${order.flashSaleProductId}
      `;
    }

    await tx.order.update({
      where: { orderId: order.orderId },
      data: {
        orderStatus: ORDER_STATUS.CANCELED,
        refundStatus: REFUND_STATUS.REFUNDED,
        refundAmount: cashRefund,
        refundedAt: new Date(),
      },
    });
  }

  // ============================================================
  // 5. 其他列表查询接口 (已保留)
  // ============================================================

  async listGroupForTreasure(
    userId: string | null,
    dto: GroupListForTreasureDto,
  ) {
    const { treasureId, page, pageSize, status, includeExpired } = dto;
    const now = new Date();
    const whereConditions: Prisma.TreasureGroupWhereInput = {};

    if (treasureId) {
      whereConditions.treasureId = treasureId;
    }

    if (status === GROUP_STATUS.ACTIVE || (!status && !includeExpired)) {
      whereConditions.groupStatus = GROUP_STATUS.ACTIVE;
      if (!includeExpired) whereConditions.expireAt = { gt: now };
    } else if (status) {
      whereConditions.groupStatus = status;
    }

    const [total, groups] = await this.prisma.$transaction([
      this.prisma.treasureGroup.count({ where: whereConditions }),
      this.prisma.treasureGroup.findMany({
        where: whereConditions,
        orderBy: [{ expireAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          treasure: {
            select: {
              treasureId: true,
              treasureName: true,
              treasureCoverImg: true,
              unitAmount: true,
            },
          },
          creator: { select: { id: true, nickname: true, avatar: true } },
          members: {
            orderBy: [{ isOwner: 'desc' }, { joinedAt: 'asc' }],
            take: 8,
            include: {
              user: { select: { id: true, nickname: true, avatar: true } },
            },
          },
          _count: { select: { members: true } },
        },
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      list: groups.map((g) => ({
        ...g,
        isJoined: userId ? g.members.some((m) => m.user.id === userId) : false,
      })),
    };
  }

  async getGroupDetail(groupId: string) {
    const group = await this.prisma.treasureGroup.findUnique({
      where: { groupId },
      include: {
        treasure: {
          select: {
            treasureId: true,
            treasureName: true,
            treasureCoverImg: true,
          },
        },
        members: {
          orderBy: [{ isOwner: 'desc' }, { joinedAt: 'asc' }],
          include: {
            user: { select: { id: true, nickname: true, avatar: true } },
          },
        },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  /**
   * [Socket] 封装通用推送逻辑
   * 必须重新查库，以获取数据库自动生成的 updatedAt 时间戳 (用于前端防乱序)
   */
  private async notifyGroupChange(groupId: string) {
    this.logger.log(
      `📢 [Socket Debug] Preparing to notify for group ${groupId}`,
    );
    try {
      //  异步执行，不阻塞主流程
      // 这里的查询非常快，只查必要字段
      const group = await this.prisma.treasureGroup.findUnique({
        where: { groupId },
        select: {
          groupId: true,
          currentMembers: true,
          maxMembers: true,
          groupStatus: true,
          updatedAt: true, // 用于前端防乱序
        },
      });
      if (group) {
        this.logger.log(
          `📡 [Socket Emit] Sending 'group_update' to lobby. Status: ${group.groupStatus}`,
        );
        this.eventsGateway.broadcastToLobby({
          groupId: group.groupId,
          currentMembers: group.currentMembers,
          isFull: group.currentMembers >= group.maxMembers,
          status: group.groupStatus,
          updatedAt: group.updatedAt.getTime(), // 时间戳格式
        });
      }
    } catch (error) {
      // 捕获异步错误，防止崩掉 Cron 或主流程
      this.logger.error(`[Socket Error] Notify group ${groupId} failed`, error);
    }
  }
}
