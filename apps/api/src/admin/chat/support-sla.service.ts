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

      const snapshot = evaluateSupportQueue(items, Date.now(), thresholdMs);
      setGauge('support_queue_waiting', {}, snapshot.waiting);
      setGauge('support_sla_breaches', {}, snapshot.breached);

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
}
