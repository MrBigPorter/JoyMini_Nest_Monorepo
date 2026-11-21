import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventsGateway } from '@api/common/events/events.gateway';
import { incCounter, registerMetric } from '@api/common/metrics/metrics';

/**
 * 在线客服状态。
 *
 * - online：是否至少有一个客服连接在线
 * - degraded：本次判断是否降级（adapter/Redis 故障，或 Socket.IO 未就绪）
 * - count：admin_online 房间里的连接数；降级时为 0
 */
export interface AgentPresence {
  online: boolean;
  degraded: boolean;
  count: number;
}

/** fail-open 未配置时的默认值：宁可按有客服处理，也不把用户卡在离线分支 */
const DEFAULT_FAIL_OPEN = true;

registerMetric(
  'handoff_presence_check_failed_total',
  'Handoff presence checks that failed because the Socket.IO adapter was unavailable',
  'counter',
);

/**
 * 转人工前的在线客服探测。
 *
 * 只回答一个问题：「现在有没有客服在线」。不落表、不缓存：
 * 转人工是低频操作，直接问 Socket.IO adapter 拿到最真实的连接数。
 *
 * 失败语义：
 *   - HANDOFF_PRESENCE_FAIL_OPEN=true（默认）→ 视为在线，照常进排队，
 *     避免 presence 通道故障时用户完全无法转人工；
 *   - HANDOFF_PRESENCE_FAIL_OPEN=false → 视为离线，走留言分支。
 * 两种情况下都递增 handoff_presence_check_failed_total，便于告警。
 */
@Injectable()
export class HandoffPresenceService {
  private readonly logger = new Logger(HandoffPresenceService.name);
  private readonly failOpen: boolean;

  constructor(
    private readonly eventsGateway: EventsGateway,
    configService: ConfigService,
  ) {
    this.failOpen = this.readFailOpen(configService);
  }

  async isAnyAgentOnline(): Promise<AgentPresence> {
    try {
      const count = await this.eventsGateway.countOnlineAgents();
      return { online: count > 0, degraded: false, count };
    } catch (err: unknown) {
      incCounter('handoff_presence_check_failed_total');
      this.logger.warn(
        `[HandoffPresence] online check failed, falling back to fail-open=${this.failOpen}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { online: this.failOpen, degraded: true, count: 0 };
    }
  }

  /**
   * 读取 fail-open 开关。只把明确的否定值当作 false，
   * 空值/非法值一律回落到默认 true（故障时不误伤用户）。
   */
  private readFailOpen(configService: ConfigService): boolean {
    const raw = configService.get<unknown>('HANDOFF_PRESENCE_FAIL_OPEN');
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return DEFAULT_FAIL_OPEN;
    }
    const normalized = String(raw).trim().toLowerCase();
    return !['false', '0', 'no', 'off'].includes(normalized);
  }
}
