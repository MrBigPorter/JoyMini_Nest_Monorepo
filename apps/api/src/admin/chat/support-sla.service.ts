import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConversationType } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AWAITING_HUMAN } from '@api/common/chat/support-handler.service';
import { setGauge } from '@api/common/metrics/metrics';

export interface SupportQueueItem {
  id: string;
  transferredAt: Date | null;
}

export interface SupportQueueSnapshot {
  waiting: number;
  breached: number;
  oldestWaitMs: number;
  breachedIds: string[];
}

/** 纯函数：便于单测，不依赖 DB/时间。 */
export function evaluateSupportQueue(
  items: SupportQueueItem[],
  now: number,
  thresholdMs: number,
): SupportQueueSnapshot {
  let oldestWaitMs = 0;
  const breachedIds: string[] = [];

  for (const item of items) {
    if (!item.transferredAt) continue;
    const waitMs = Math.max(0, now - item.transferredAt.getTime());
    if (waitMs > oldestWaitMs) oldestWaitMs = waitMs;
    if (waitMs >= thresholdMs) breachedIds.push(item.id);
  }

  return {
    waiting: items.length,
    breached: breachedIds.length,
    oldestWaitMs,
    breachedIds,
  };
}

const CONV_STATUS_NORMAL = 1;

/**
 * 转人工排队 SLA 监控。
 *
 * 每分钟统计「待接入」会话：
 *   - 总排队数（support_queue_waiting）
 *   - 超过 SUPPORT_SLA_MINUTES（默认 5 分钟）仍未接入的数量（support_sla_breaches）
 * 超阈值只记 warn + 指标，不自动改状态，避免和人工认领/关闭竞态。
 */
@Injectable()
export class SupportSlaService {
  private readonly logger = new Logger(SupportSlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkQueue(): Promise<void> {
    const configured = Number(
      this.configService.get<string>('SUPPORT_SLA_MINUTES') ?? 5,
    );
    const thresholdMinutes =
      Number.isFinite(configured) && configured > 0 ? configured : 5;
    const thresholdMs = thresholdMinutes * 60_000;

    try {
      const items = await this.prisma.conversation.findMany({
        where: {
          type: ConversationType.SUPPORT,
          handlerId: AWAITING_HUMAN,
          status: CONV_STATUS_NORMAL,
        },
        select: { id: true, transferredAt: true },
      });

      const now = new Date();
      const snapshot = evaluateSupportQueue(items, now.getTime(), thresholdMs);
      setGauge('support_queue_waiting', {}, snapshot.waiting);
      setGauge('support_sla_breaches', {}, snapshot.breached);

      // 历史快照：只存聚合值，便于按天看趋势，不保存会话/用户信息。
      // 用 UTC 分钟桶 upsert：多实例同一分钟只留一行，后写覆盖前写。
      const bucket = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
      const data = {
        waiting: snapshot.waiting,
        breached: snapshot.breached,
        longestWait: Math.round(snapshot.oldestWaitMs / 1000),
      };
      await this.prisma.supportSlaSnapshot
        .upsert({
          where: { bucket },
          create: { bucket, ...data },
          update: data,
        })
        .catch((err: any) =>
          this.logger.warn(
            `[SupportSLA] snapshot write failed: ${err?.message ?? err}`,
          ),
        );

      if (snapshot.breached > 0) {
        this.logger.warn(
          `[SupportSLA] ${snapshot.breached}/${snapshot.waiting} waiting > ` +
            `${thresholdMinutes}m; oldest=${Math.round(
              snapshot.oldestWaitMs / 1000,
            )}s; ids=${snapshot.breachedIds.slice(0, 5).join(',')}`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `[SupportSLA] queue check failed: ${err?.message ?? err}`,
      );
    }
  }

  private getThresholdMinutes(): number {
    const configured = Number(
      this.configService.get<string>('SUPPORT_SLA_MINUTES') ?? 5,
    );
    return Number.isFinite(configured) && configured > 0 ? configured : 5;
  }

  /** 当前等待人工接入的会话队列（只返回会话级信息，不返回用户隐私）。 */
  async waitingQueue() {
    const thresholdMinutes = this.getThresholdMinutes();
    const rows = await this.prisma.conversation.findMany({
      where: {
        type: ConversationType.SUPPORT,
        handlerId: AWAITING_HUMAN,
        status: CONV_STATUS_NORMAL,
      },
      orderBy: { transferredAt: 'asc' },
      take: 100,
      select: {
        id: true,
        transferredAt: true,
        transferReason: true,
        lastMsgContent: true,
        lastMsgTime: true,
      },
    });
    const now = Date.now();
    return {
      thresholdMinutes,
      items: rows.map((row) => ({
        conversationId: row.id,
        transferredAt: row.transferredAt,
        transferReason: row.transferReason,
        lastMessage: row.lastMsgContent,
        lastMessageAt: row.lastMsgTime,
        waitingSeconds: row.transferredAt
          ? Math.max(0, Math.round((now - row.transferredAt.getTime()) / 1000))
          : 0,
        breached: row.transferredAt
          ? now - row.transferredAt.getTime() >= thresholdMinutes * 60_000
          : false,
      })),
    };
  }

  async getHistory(hours = 24) {
    const safeHours = Math.min(Math.max(hours, 1), 168);
    const thresholdMinutes = this.getThresholdMinutes();
    const since = new Date(Date.now() - safeHours * 60 * 60 * 1000);
    const [recentSnapshots, latest] = await Promise.all([
      // 先取窗口内最新的 2000 条（desc），再反转为升序返回给图表/表格。
      // 若先 asc + take，窗口内超过 2000 条时只会拿到最旧的，图表看不到近期数据。
      this.prisma.supportSlaSnapshot.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      }),
      this.prisma.supportSlaSnapshot.findFirst({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      windowHours: safeHours,
      thresholdMinutes,
      latest,
      snapshots: recentSnapshots.slice().reverse(),
    };
  }
}
