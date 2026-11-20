import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiQueueService } from '@api/common/queue/ai-queue.module';

/** 入队连续失败次数上限，超过后转 FAILED，等待人工重放。 */
export const AI_OUTBOX_MAX_ATTEMPTS = 8;

/**
 * SENDING 状态的租约。
 *
 * relay 领取后进程崩溃，行会停在 SENDING；超过租约后允许再次领取。
 * queue.add 的 jobId 去重保证重复领取不会产生第二条任务。
 */
export const AI_OUTBOX_LEASE_MS = 60_000;

/** relay 单轮最多领取条数：顺序处理，避免同一会话并发投递。 */
const RELAY_BATCH_SIZE = 20;

interface ClaimedRow {
  id: string;
  messageId: string;
  conversationId: string;
  userId: string;
  attempts: number;
}

/**
 * AI 任务 Outbox relay。
 *
 * 只包「业务消息提交 → BullMQ 入队」这一小段：
 *   1. 消息事务内写一行 ai_task_outbox（与 ChatMessage 同提交）；
 *   2. 事务后立即尝试 relay 一次，正常路径不增加可感知延迟；
 *   3. 失败或进程崩溃时，cron 按 next_attempt_at 补投。
 *
 * 消费侧幂等（jobId、ai:msg:done、triggerMessageId 唯一键）保持不变，
 * 所以 relay 是 at-least-once，不需要更强语义。
 */
@Injectable()
export class AiTaskOutboxService {
  private readonly logger = new Logger(AiTaskOutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiQueueService: AiQueueService,
  ) {}

  /**
   * 事务提交后的立即投递。
   * 绝不向调用方抛错：投递失败留在 PENDING，cron 会继续补。
   */
  async relayByMessageId(messageId: string): Promise<void> {
    try {
      const rows = await this.claim(AI_OUTBOX_LEASE_MS, messageId);
      if (rows.length === 0) return;
      await this.processRow(rows[0]);
    } catch (err: unknown) {
      this.logger.warn(
        `[AiOutbox] immediate relay failed, left for cron: messageId=${messageId}, reason=${this.errText(err)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async relayDue(): Promise<{ claimed: number; sent: number; failed: number }> {
    let rows: ClaimedRow[] = [];
    try {
      rows = await this.claim(AI_OUTBOX_LEASE_MS);
    } catch (err: unknown) {
      this.logger.error(`[AiOutbox] claim failed: ${this.errText(err)}`);
      return { claimed: 0, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      const ok = await this.processRow(row);
      if (ok) sent += 1;
      else failed += 1;
    }
    return { claimed: rows.length, sent, failed };
  }

  /** 管理端查询入队失败（FAILED）的 Outbox 行。 */
  async listFailed(limit = 50) {
    return this.list('FAILED', limit);
  }

  /** 运营页：按状态查看 Outbox（PENDING/SENDING/SENT/FAILED）。 */
  async list(status?: string, limit = 50) {
    const normalized = (status ?? '').toUpperCase();
    const allowed = ['PENDING', 'SENDING', 'SENT', 'FAILED'];
    return this.prisma.aiTaskOutbox.findMany({
      where: allowed.includes(normalized) ? { status: normalized } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        messageId: true,
        conversationId: true,
        userId: true,
        status: true,
        attempts: true,
        lastError: true,
        nextAttemptAt: true,
        sentAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * 重放入队失败的任务。
   *
   * 这类任务从未成功写入 BullMQ，不存在可 retry 的 Job，重新置为 PENDING
   * 交给 relay 是正确语义；若 jobId 已存在，queue.add 会按 jobId 去重。
   */
  async replayFailed(messageId: string): Promise<boolean> {
    const updated = await this.prisma.aiTaskOutbox.updateMany({
      where: { messageId, status: 'FAILED' },
      data: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
    if (updated.count === 0) return false;
    await this.relayByMessageId(messageId);
    return true;
  }

  /**
   * 原子领取：条件 UPDATE + FOR UPDATE SKIP LOCKED。
   *
   * 两个实例同时扫描时，只有一个能把行改成 SENDING；另一个拿到空集合。
   * 领取即 attempts+1，并把 next_attempt_at 推到租约到期，供崩溃恢复。
   */
  private claim(leaseMs: number, messageId?: string): Promise<ClaimedRow[]> {
    const leaseSeconds = leaseMs / 1000;
    // 用 Prisma.sql 片段组合参数，绝不要把它拼成普通字符串。
    const messageFilter = messageId
      ? Prisma.sql`AND t."message_id" = ${messageId}`
      : Prisma.empty;

    return this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "ai_task_outbox" AS o
      SET
        "status" = 'SENDING',
        "attempts" = o."attempts" + 1,
        "next_attempt_at" = NOW() + make_interval(secs => ${leaseSeconds})
      WHERE o."id" IN (
        SELECT t."id"
        FROM "ai_task_outbox" AS t
        WHERE (t."status" = 'PENDING' OR t."status" = 'SENDING')
          AND t."next_attempt_at" <= NOW()
          ${messageFilter}
        ORDER BY t."created_at" ASC
        LIMIT ${RELAY_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        o."id",
        o."message_id" AS "messageId",
        o."conversation_id" AS "conversationId",
        o."user_id" AS "userId",
        o."attempts"
    `;
  }

  /** 返回 true 表示已投递（含“已转人工，主动跳过”）。 */
  private async processRow(row: ClaimedRow): Promise<boolean> {
    try {
      // 不存 content 的第二份副本：以 ChatMessage 为准回查。
      const message = await this.prisma.chatMessage.findUnique({
        where: { id: row.messageId },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          content: true,
        },
      });
      if (!message) {
        await this.markFailed(row, 'message_not_found');
        return false;
      }

      // relay 可能滞后：执行前复查会话是否仍由 AI 处理。
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: message.conversationId },
        select: { type: true, handlerId: true },
      });
      const stillAi =
        conversation != null &&
        (conversation.type === 'SUPPORT' || conversation.type === 'AI') &&
        conversation.handlerId == null;
      if (!stillAi) {
        await this.markSent(row.id);
        this.logger.log(
          `[AiOutbox] skipped: conversation no longer AI-handled, messageId=${row.messageId}`,
        );
        return true;
      }

      await this.aiQueueService.enqueue({
        conversationId: message.conversationId,
        content: message.content,
        userId: message.senderId ?? row.userId,
        messageId: message.id,
      });
      await this.markSent(row.id);
      return true;
    } catch (err: unknown) {
      await this.markRetryOrFail(row, err);
      return false;
    }
  }

  private async markSent(id: string): Promise<void> {
    await this.prisma.aiTaskOutbox.updateMany({
      where: { id },
      data: { status: 'SENT', sentAt: new Date(), lastError: null },
    });
  }

  private async markFailed(row: ClaimedRow, reason: string): Promise<void> {
    await this.prisma.aiTaskOutbox.updateMany({
      where: { id: row.id },
      data: { status: 'FAILED', lastError: reason.slice(0, 500) },
    });
    this.logger.error(
      `[AiOutbox] task failed: messageId=${row.messageId}, attempts=${row.attempts}, reason=${reason}`,
    );
  }

  private async markRetryOrFail(row: ClaimedRow, err: unknown): Promise<void> {
    const reason = this.errText(err).slice(0, 500);
    if (row.attempts >= AI_OUTBOX_MAX_ATTEMPTS) {
      await this.markFailed(row, reason);
      return;
    }

    // 入队失败通常是 Redis/Bull 瞬时不可用，短退避即可。
    const delayMs = Math.min(2_000 * 2 ** (row.attempts - 1), 300_000);
    await this.prisma.aiTaskOutbox.updateMany({
      where: { id: row.id },
      data: {
        status: 'PENDING',
        nextAttemptAt: new Date(Date.now() + delayMs),
        lastError: reason,
      },
    });
    this.logger.warn(
      `[AiOutbox] enqueue failed, retry in ${delayMs}ms: messageId=${row.messageId}, attempts=${row.attempts}, reason=${reason}`,
    );
  }

  private errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
