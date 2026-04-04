import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { NotificationService } from '@api/client/notification/notification.service';
import { OperationLogService } from '@api/admin/operation-log/operation-log.service';
import { OpModule, OpAction } from '@lucky/shared';
import { QueryPushLogDto } from './dto/query-push-log.dto';
import { AdminSendBroadcastDto } from './dto/send-broadcast.dto';
import { AdminSendTargetedDto } from './dto/send-targeted.dto';

@Injectable()
export class AdminNotificationService {
  private readonly logger = new Logger(AdminNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly operationLogService: OperationLogService,
  ) {}

  // ─── Push Logs ────────────────────────────────────────────────────────────

  async getLogs(query: QueryPushLogDto) {
    const {
      page = 1,
      pageSize = 10,
      type,
      keyword,
      startDate,
      endDate,
    } = query;

    const where: Prisma.AdminPushLogWhereInput = {};

    if (type && type !== 'ALL') {
      where.type = type;
    }

    if (keyword) {
      where.OR = [
        { title: { contains: keyword } },
        { body: { contains: keyword } },
        { adminName: { contains: keyword } },
        { targetUserId: { contains: keyword } },
      ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [list, total] = await Promise.all([
      this.prisma.adminPushLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.adminPushLog.count({ where }),
    ]);

    return { list, total, page, pageSize };
  }

  // ─── Device Stats ─────────────────────────────────────────────────────────

  async getDeviceStats() {
    const [total, android, ios, web, activeInLast7Days] = await Promise.all([
      this.prisma.device.count(),
      this.prisma.device.count({ where: { platform: 'android' } }),
      this.prisma.device.count({ where: { platform: 'ios' } }),
      this.prisma.device.count({ where: { platform: 'web' } }),
      this.prisma.device.count({
        where: {
          lastActive: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return { total, android, ios, web, activeInLast7Days };
  }

  // ─── Helper ───────────────────────────────────────────────────────────────

  private async resolveAdminName(adminId: string): Promise<string> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { username: true, realName: true },
    });
    return admin?.realName ?? admin?.username ?? adminId;
  }

  // ─── Broadcast ────────────────────────────────────────────────────────────

  async sendBroadcast(dto: AdminSendBroadcastDto, adminId: string) {
    const adminName = await this.resolveAdminName(adminId);
    this.logger.log(`Admin ${adminName} sending broadcast: ${dto.title}`);

    let status = 'sent';
    let successCount = 0;
    let failureCount = 0;

    try {
      await this.notificationService.sendBroadcast(
        dto.title,
        dto.body,
        dto.extraData,
      );
      successCount = 1; // Topic push counts as 1 dispatch
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Broadcast failed: ${msg}`);
      status = 'failed';
      failureCount = 1;
    }

    const log = await this.prisma.adminPushLog.create({
      data: {
        adminId,
        adminName,
        type: 'broadcast',
        title: dto.title,
        body: dto.body,
        ...(dto.extraData !== undefined && {
          extraData: dto.extraData as Prisma.InputJsonObject,
        }),
        status,
        successCount,
        failureCount,
      },
    });

    if (status === 'failed') {
      throw new ForbiddenException(
        'Firebase broadcast failed, see server logs',
      );
    }

    // 写操作审计日志
    await this.operationLogService.log({
      adminId,
      adminName,
      module: OpModule.SYSTEM,
      action: OpAction.SYSTEM.SEND_NOTIF,
      details: `Broadcast: "${dto.title}" — ${successCount} dispatched`,
    });

    return log;
  }

  // ─── Targeted ─────────────────────────────────────────────────────────────

  async sendTargeted(dto: AdminSendTargetedDto, adminId: string) {
    const adminName = await this.resolveAdminName(adminId);
    this.logger.log(
      `Admin ${adminName} sending targeted push to user ${dto.targetUserId}`,
    );

    const deviceCount = await this.prisma.device.count({
      where: { userId: dto.targetUserId },
    });

    let status = 'sent';
    let successCount = 0;
    let failureCount = 0;

    if (deviceCount === 0) {
      status = 'failed';
      failureCount = 1;
    } else {
      try {
        await this.notificationService.sendPrivateMessage(
          dto.targetUserId,
          dto.title,
          dto.body,
          dto.extraData,
        );
        successCount = deviceCount;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Targeted push failed: ${msg}`);
        status = 'failed';
        failureCount = deviceCount;
      }
    }

    const pushLog = await this.prisma.adminPushLog.create({
      data: {
        adminId,
        adminName,
        type: 'targeted',
        targetUserId: dto.targetUserId,
        title: dto.title,
        body: dto.body,
        ...(dto.extraData !== undefined && {
          extraData: dto.extraData as Prisma.InputJsonObject,
        }),
        status,
        successCount,
        failureCount,
      },
    });

    // 写操作审计日志
    await this.operationLogService.log({
      adminId,
      adminName,
      module: OpModule.SYSTEM,
      action: OpAction.SYSTEM.SEND_NOTIF,
      details: `Targeted: "${dto.title}" → user ${dto.targetUserId} (${status}, ${successCount} devices)`,
    });

    return pushLog;
  }
}
