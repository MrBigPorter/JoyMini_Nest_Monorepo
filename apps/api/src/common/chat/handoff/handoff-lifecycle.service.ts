import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConversationType, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { MESSAGE_TYPE, ConversationStatus, SocketEvents } from '@lucky/shared';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { EventsGateway } from '@api/common/events/events.gateway';
import { AWAITING_HUMAN } from '@api/common/chat/support-handler.service';
import {
  CHAT_EVENTS,
  MessageCreatedEvent,
  SupportQueueChangedEvent,
} from '@api/common/chat/events/chat.events';
import {
  deriveHandoffState,
  HandoffHistoryEntry,
  HandoffReturnReason,
  HandoffState,
  HANDOFF_REOPEN_MESSAGE,
  HANDOFF_RETURN_MESSAGE,
} from './handoff-state';

/** 排队无人认领默认 10 分钟 */
const DEFAULT_WAIT_TIMEOUT_MINUTES = 10;
/** 坐席不活跃默认 60 分钟 */
const DEFAULT_INACTIVE_TIMEOUT_MINUTES = 60;
/** 单轮 sweep 的候选上限，避免一次事务链过长 */
const SWEEP_BATCH_SIZE = 200;
/** handoffHistory 保留最近 10 条 */
const HANDOFF_HISTORY_LIMIT = 10;
/** 系统消息的展示者名称 */
const SYSTEM_SENDER_NAME = '系统';

interface TransitionOutcome {
  messageId: string;
  seqId: number;
  content: string;
  from: HandoffState;
}

/**
 * AI ↔ 人工交接生命周期的唯一状态写入口。
 *
 * 所有转换都遵循同一模式：
 *   1. 一条 updateMany CAS 把「当前状态仍允许这次转换」下推到 SQL；
 *   2. CAS 抢到后，同事务写 aiMetadata（复位标记 + 审计）和系统消息；
 *   3. 事务提交后再广播，失败只记录日志，不回滚已确定的状态。
 *
 * 这样与客服认领、关闭、另一实例的 sweep 并发时，只有一个转换能成功。
 */
@Injectable()
export class HandoffLifecycleService {
  private readonly logger = new Logger(HandoffLifecycleService.name);
  private readonly waitTimeoutMs: number;
  private readonly inactiveTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
    private readonly eventsGateway: EventsGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.waitTimeoutMs =
      this.readTimeoutMinutes(
        configService,
        [
          // 规范名：SUPPORT_WAIT_TIMEOUT_MINUTES（默认 10 分钟，0=关闭）
          'SUPPORT_WAIT_TIMEOUT_MINUTES',
          // 兼容旧配置：排队提醒窗口 / 早期设计稿命名
          'SUPPORT_QUEUE_TIMEOUT_MINUTES',
          'HANDOFF_NO_CLAIM_MINUTES',
        ],
        DEFAULT_WAIT_TIMEOUT_MINUTES,
      ) *
      60 *
      1000;
    this.inactiveTimeoutMs =
      this.readTimeoutMinutes(
        configService,
        [
          // 规范名：SUPPORT_IDLE_TIMEOUT_MINUTES（默认 60 分钟，0=关闭）
          'SUPPORT_IDLE_TIMEOUT_MINUTES',
          // 兼容早期设计稿命名
          'HANDOFF_INACTIVE_MINUTES',
        ],
        DEFAULT_INACTIVE_TIMEOUT_MINUTES,
      ) *
      60 *
      1000;
  }

  /**
   * 把会话交回 AI。
   *
   * @returns true = 本次真正完成了转换；false = 状态已被别人改走/超时条件已不满足/功能关闭。
   */
  async returnToAi(
    id: string,
    reason: HandoffReturnReason,
    opts: { actor?: string; now?: Date } = {},
  ): Promise<boolean> {
    // 0 表示关闭该超时项：自动 sweep 不会调用到这里，直接调用也拒绝。
    if (reason === 'waiting_timeout' && this.waitTimeoutMs <= 0) return false;
    if (reason === 'inactive_timeout' && this.inactiveTimeoutMs <= 0)
      return false;

    const now = opts.now ?? new Date();
    const actor = opts.actor ?? 'system';

    const outcome = await this.prisma.$transaction(
      async (tx): Promise<TransitionOutcome | null> => {
        // 先读快照只用于合并 aiMetadata 与计算 from 状态；
        // 真正的判定仍由下面的 CAS 决定。
        const conv = await tx.conversation.findUnique({
          where: { id },
          select: { aiMetadata: true, status: true, handlerId: true },
        });
        if (!conv) return null;

        const cas = await tx.conversation.updateMany({
          where: this.buildCasWhere(id, reason, now),
          data: this.buildCasData(reason),
        });
        if (cas.count !== 1) return null;

        const from = deriveHandoffState(conv);
        const content =
          reason === 'closed_reopen'
            ? HANDOFF_REOPEN_MESSAGE
            : HANDOFF_RETURN_MESSAGE;
        const metadata = this.buildMetadata(
          conv.aiMetadata,
          now,
          reason,
          actor,
          from,
        );
        const messageId = uuidv4();

        const updated = await tx.conversation.update({
          where: { id },
          data: {
            aiMetadata: metadata as Prisma.InputJsonValue,
            lastMsgSeqId: { increment: 1 },
            lastMsgContent: content,
            lastMsgType: MESSAGE_TYPE.SYSTEM,
            lastMsgTime: now,
          },
          select: { lastMsgSeqId: true },
        });

        await tx.chatMessage.create({
          data: {
            id: messageId,
            conversationId: id,
            senderId: null,
            content,
            type: MESSAGE_TYPE.SYSTEM,
            seqId: updated.lastMsgSeqId,
            meta: { handoff: true, reason },
          },
        });

        return {
          messageId,
          seqId: updated.lastMsgSeqId,
          content,
          from,
        };
      },
    );

    if (!outcome) return false;

    await this.publish(id, reason, now, outcome);
    this.logger.log(
      `[Handoff] conversation=${id} returned to AI (reason=${reason}, actor=${actor})`,
    );
    return true;
  }

  /**
   * 扫描并处理两类超时：
   *   - waiting_timeout：排队超过 10 分钟无人认领
   *   - inactive_timeout：坐席超过 60 分钟没有人工侧活动
   *
   * 只负责「找候选 + 逐个走 CAS」，真正的状态判定仍在 returnToAi 里。
   * 阈值 0 表示该项关闭，连查询都不发。
   */
  async sweepTimedOut(now: Date = new Date()): Promise<{
    returned: Array<{ id: string; reason: string }>;
    skipped: number;
  }> {
    const returned: Array<{ id: string; reason: string }> = [];
    let skipped = 0;

    if (this.waitTimeoutMs > 0) {
      const waitCutoff = new Date(now.getTime() - this.waitTimeoutMs);
      const waiting = await this.prisma.conversation.findMany({
        where: {
          status: ConversationStatus.NORMAL,
          handlerId: AWAITING_HUMAN,
          // 旧数据可能没有 transferredAt，用 handlerAssignedAt 兜底
          OR: [
            { transferredAt: { lt: waitCutoff } },
            {
              transferredAt: null,
              handlerAssignedAt: { lt: waitCutoff },
            },
          ],
        },
        select: { id: true },
        take: SWEEP_BATCH_SIZE,
      });

      for (const { id } of waiting) {
        if (await this.returnToAi(id, 'waiting_timeout', { now })) {
          returned.push({ id, reason: 'waiting_timeout' });
        } else {
          skipped += 1;
        }
      }
    }

    if (this.inactiveTimeoutMs > 0) {
      const inactiveCutoff = new Date(now.getTime() - this.inactiveTimeoutMs);
      const inactive = await this.prisma.conversation.findMany({
        where: {
          status: ConversationStatus.NORMAL,
          handlerId: { not: AWAITING_HUMAN },
          handlerAssignedAt: { lt: inactiveCutoff },
        },
        select: { id: true },
        take: SWEEP_BATCH_SIZE,
      });

      for (const { id } of inactive) {
        if (await this.returnToAi(id, 'inactive_timeout', { now })) {
          returned.push({ id, reason: 'inactive_timeout' });
        } else {
          skipped += 1;
        }
      }
    }

    if (returned.length > 0) {
      this.logger.log(
        `[HandoffSweep] returned ${returned.length} conversation(s) to AI`,
      );
    }
    return { returned, skipped };
  }

  /**
   * 关闭后的 SUPPORT 会话收到用户消息时同会话重开。
   * CAS 限定「仍是 ARCHIVED 的 SUPPORT 会话」，避免重开与关闭竞态。
   */
  async reopenForUser(id: string): Promise<boolean> {
    return this.returnToAi(id, 'closed_reopen');
  }

  /**
   * 列表展示用的「预计自动回 AI 时间」。
   *
   * 与 sweepTimedOut 使用同一组阈值，避免后台展示和 cron 实际行为漂移：
   *   - WAITING_HUMAN：排队起点 + wait 超时（旧数据没有 transferredAt 时兜底 handlerAssignedAt）
   *   - HUMAN_ACTIVE：最后人工活动 + inactive 超时
   *   - AI_ACTIVE / CLOSED：没有自动转换，返回 null
   *   - 对应阈值配置为 0：该项关闭，也返回 null
   */
  getAutoReturnAt(conv: {
    status: number;
    handlerId: string | null;
    transferredAt: Date | null;
    handlerAssignedAt: Date | null;
  }): Date | null {
    const state = deriveHandoffState(conv);

    if (state === 'WAITING_HUMAN') {
      if (this.waitTimeoutMs <= 0) return null;
      const base = conv.transferredAt ?? conv.handlerAssignedAt;
      return base ? new Date(base.getTime() + this.waitTimeoutMs) : null;
    }

    if (state === 'HUMAN_ACTIVE') {
      if (this.inactiveTimeoutMs <= 0) return null;
      return conv.handlerAssignedAt
        ? new Date(conv.handlerAssignedAt.getTime() + this.inactiveTimeoutMs)
        : null;
    }

    return null;
  }

  // ------------------------------------------------------------------
  // 内部：CAS 条件与数据
  // ------------------------------------------------------------------

  private buildCasWhere(
    id: string,
    reason: HandoffReturnReason,
    now: Date,
  ): Prisma.ConversationWhereInput {
    const normalBase: Prisma.ConversationWhereInput = {
      id,
      status: ConversationStatus.NORMAL,
    };

    switch (reason) {
      case 'waiting_timeout': {
        const cutoff = new Date(now.getTime() - this.waitTimeoutMs);
        return {
          ...normalBase,
          handlerId: AWAITING_HUMAN,
          OR: [
            { transferredAt: { lt: cutoff } },
            {
              transferredAt: null,
              handlerAssignedAt: { lt: cutoff },
            },
          ],
        };
      }
      case 'inactive_timeout': {
        const cutoff = new Date(now.getTime() - this.inactiveTimeoutMs);
        return {
          ...normalBase,
          // SQL 里 NULL != 'awaiting_human' 不成立，handlerId=null（本就在 AI）自然被排除
          handlerId: { not: AWAITING_HUMAN },
          handlerAssignedAt: { lt: cutoff },
        };
      }
      case 'admin_return':
        // 手动切回不看时间：管理员可以在排队中或人工中随时交回 AI
        return {
          ...normalBase,
          handlerId: { not: null },
        };
      case 'closed_reopen':
        return {
          id,
          status: ConversationStatus.ARCHIVED,
          type: ConversationType.SUPPORT,
        };
    }
  }

  private buildCasData(
    reason: HandoffReturnReason,
  ): Prisma.ConversationUpdateManyMutationInput {
    const data: Prisma.ConversationUpdateManyMutationInput = {
      handlerId: null,
      handlerAssignedAt: null,
      transferredAt: null,
      transferReason: null,
    };
    if (reason === 'closed_reopen') {
      data.status = ConversationStatus.NORMAL;
    }
    return data;
  }

  /** 合并写 aiMetadata，保留 trafficSource 等既有字段 */
  private buildMetadata(
    raw: Prisma.JsonValue | null,
    now: Date,
    reason: HandoffReturnReason,
    actor: string,
    from: HandoffState,
  ): Record<string, unknown> {
    const base =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const previousHistory = Array.isArray(base.handoffHistory)
      ? base.handoffHistory
      : [];
    const entry: HandoffHistoryEntry = {
      from,
      to: 'AI_ACTIVE',
      reason,
      actor,
      at: now.toISOString(),
    };

    return {
      ...base,
      handoffResetPending: { at: now.toISOString(), reason },
      handoffHistory: [...previousHistory, entry].slice(-HANDOFF_HISTORY_LIMIT),
    };
  }

  // ------------------------------------------------------------------
  // 内部：事务提交后的广播
  // ------------------------------------------------------------------

  private async publish(
    id: string,
    reason: HandoffReturnReason,
    now: Date,
    outcome: TransitionOutcome,
  ): Promise<void> {
    try {
      const members = await this.prisma.chatMember.findMany({
        where: { conversationId: id },
        select: { userId: true },
      });
      const memberIds = members.map((member) => member.userId);

      this.eventEmitter.emit(
        CHAT_EVENTS.MESSAGE_CREATED,
        new MessageCreatedEvent(
          outcome.messageId,
          id,
          outcome.content,
          MESSAGE_TYPE.SYSTEM,
          '',
          SYSTEM_SENDER_NAME,
          '',
          now.getTime(),
          memberIds,
          outcome.seqId,
          { handoff: true, reason },
          undefined,
          undefined,
          // 系统消息只做在线广播，不触发 FCM 离线推送
          [],
        ),
      );

      this.eventsGateway.dispatch(id, SocketEvents.AI_HANDOFF_RETURNED, {
        conversationId: id,
        reason,
        from: outcome.from,
        at: now.toISOString(),
      });

      this.eventEmitter.emit(
        CHAT_EVENTS.SUPPORT_QUEUE_CHANGED,
        new SupportQueueChangedEvent(id, 'released', null),
      );
    } catch (err: unknown) {
      // 状态与消息已经落库；广播失败不能把已完成的转换回滚。
      this.logger.warn(
        `[Handoff] post-commit dispatch failed for conversation=${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * 读取分钟配置：
   *   - 未配置 → 默认值
   *   - 0 → 关闭该项（保留 0，不当成「未配置」）
   *   - 非法值 → 默认值
   */
  private readTimeoutMinutes(
    configService: ConfigService,
    keys: string[],
    fallback: number,
  ): number {
    for (const key of keys) {
      const raw = configService.get<string>(key);
      if (raw === undefined || raw === null || String(raw).trim() === '') {
        continue;
      }
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
    return fallback;
  }
}
