import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { incCounter } from '@api/common/metrics/metrics';
import { CONFIRM_TOKEN_TTL_SEC } from './ai-action.constants';

export type AiActionStatus =
  | 'REQUESTED'
  | 'CONFIRM_CREATED'
  | 'CONFIRMED'
  | 'EXECUTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'TRANSFERRED'
  | 'FAILED';

export interface CreateActionInput {
  conversationId: string;
  userId: string;
  messageId?: string | null;
  action: string;
  params: Record<string, unknown>;
  summary: Record<string, unknown>;
}

/**
 * AI 写操作生命周期。
 *
 * 为什么不放在 Redis：确认卡片要能被运营页、评测和审计按会话查到，
 * Redis 60 秒后就没了。这里只存状态与参数摘要，不存用户原文。
 */
@Injectable()
export class AiActionLifecycleService {
  private readonly logger = new Logger(AiActionLifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createConfirm(
    input: CreateActionInput,
  ): Promise<{ id: string; expiresAt: Date } | null> {
    if (!input.conversationId) return null;
    const expiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_SEC * 1000);
    try {
      // 同一条用户消息重复触发时复用同一张卡片，避免签出两个都能执行的令牌。
      if (input.messageId) {
        const existing = await this.prisma.aiActionRequest.findFirst({
          where: {
            conversationId: input.conversationId,
            action: input.action,
            messageId: input.messageId,
            status: 'CONFIRM_CREATED',
          },
          select: { id: true, expiresAt: true },
        });
        if (existing) {
          return {
            id: existing.id,
            expiresAt: existing.expiresAt ?? expiresAt,
          };
        }
      }

      const row = await this.prisma.aiActionRequest.create({
        data: {
          conversationId: input.conversationId,
          userId: input.userId,
          messageId: input.messageId ?? null,
          action: input.action,
          params: input.params as Prisma.InputJsonValue,
          summary: input.summary as Prisma.InputJsonValue,
          status: 'CONFIRM_CREATED',
          expiresAt,
        },
        select: { id: true, expiresAt: true },
      });
      return { id: row.id, expiresAt: row.expiresAt ?? expiresAt };
    } catch (err: any) {
      // 状态记录失败不能阻断确认卡片本身；只记日志，由 trace/指标兜底。
      this.logger.warn(
        `[action-lifecycle] create failed: conv=${input.conversationId}, reason=${err?.message ?? err}`,
      );
      return null;
    }
  }

  async markConfirmed(id?: string | null): Promise<void> {
    if (!id) return;
    await this.updateStatus(
      id,
      'CONFIRMED',
      { confirmedAt: new Date() },
      ['CONFIRM_CREATED'],
    );
  }

  async markExecuted(id?: string | null, result?: unknown): Promise<void> {
    if (!id) return;
    await this.updateStatus(
      id,
      'EXECUTED',
      {
        executedAt: new Date(),
        ...(result === undefined
          ? {}
          : { result: result as Prisma.InputJsonValue }),
      },
      ['CONFIRMED'],
    );
  }

  /** 两段式提现：执行前已 CAS 到 EXECUTED，结果只补 result，不再迁移状态。 */
  async attachResult(id?: string | null, result?: unknown): Promise<void> {
    if (!id || result === undefined) return;
    await this.updateStatus(
      id,
      'EXECUTED',
      { result: result as Prisma.InputJsonValue },
      ['EXECUTED'],
    );
  }

  async markFailed(id?: string | null, error?: string): Promise<void> {
    if (!id) return;
    await this.updateStatus(
      id,
      'FAILED',
      { error: error?.slice(0, 500) ?? 'unknown error' },
      ['CONFIRM_CREATED', 'CONFIRMED', 'EXECUTED'],
    );
  }

  /** 用户主动取消：与 EXPIRED 区分，保留「谁在什么时候取消」的终态。 */
  async markCancelled(id?: string | null): Promise<void> {
    if (!id) return;
    await this.updateStatus(id, 'CANCELLED', {}, [
      'CONFIRM_CREATED',
      'CONFIRMED',
    ]);
  }

  async markTransferred(conversationId: string): Promise<void> {
    await this.prisma.aiActionRequest.updateMany({
      where: {
        conversationId,
        status: { in: ['REQUESTED', 'CONFIRM_CREATED'] },
      },
      data: { status: 'TRANSFERRED' },
    });
  }

  /**
   * 同一会话来了新消息：上一张确认卡片已经不可能再被确认，写明确终态。
   * 不删除记录，保留审计链路。
   */
  async expireForConversation(
    conversationId: string,
    reason: 'superseded' | 'transferred' = 'superseded',
  ): Promise<number> {
    const result = await this.prisma.aiActionRequest.updateMany({
      where: {
        conversationId,
        status: { in: ['REQUESTED', 'CONFIRM_CREATED'] },
      },
      data: {
        status: 'EXPIRED',
        error: reason === 'superseded' ? 'superseded by new message' : reason,
      },
    });
    if (result.count > 0) {
      // 过期是批量迁移，单条 action 已不可区分；用 '*' 汇总，避免伪造 action 维度。
      incCounter(
        'ai_action_total',
        { action: '*', result: 'expired' },
        result.count,
      );
    }
    return result.count;
  }

  /** 每分钟兜底：token 已过期的卡片标记 EXPIRED。 */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireDue(): Promise<void> {
    try {
      const result = await this.prisma.aiActionRequest.updateMany({
        where: {
          status: 'CONFIRM_CREATED',
          expiresAt: { lt: new Date() },
        },
        data: { status: 'EXPIRED', error: 'confirm token expired' },
      });
      if (result.count > 0) {
        incCounter(
          'ai_action_total',
          { action: '*', result: 'expired' },
          result.count,
        );
        this.logger.log(`[action-lifecycle] expired ${result.count} card(s)`);
      }
    } catch (err: any) {
      this.logger.warn(
        `[action-lifecycle] expireDue failed: ${err?.message ?? err}`,
      );
    }
  }

  async listByConversation(conversationId: string) {
    return this.prisma.aiActionRequest.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async updateStatus(
    id: string,
    status: AiActionStatus,
    extra: Prisma.AiActionRequestUpdateManyMutationInput = {},
    from: AiActionStatus[] = [],
  ): Promise<void> {
    try {
      const result = await this.prisma.aiActionRequest.updateMany({
        // 允许迁移列表把非法状态迁移挡在 SQL 层：EXPIRED 不会被迟到的
        // EXECUTED 覆盖，审计终态可依赖。
        where: from.length > 0 ? { id, status: { in: from } } : { id },
        data: { status, ...extra },
      });
      if (from.length > 0 && result.count === 0) {
        this.logger.warn(
          `[action-lifecycle] transition skipped: ${id} -> ${status} (not in ${from.join('|')})`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `[action-lifecycle] update ${id} -> ${status} failed: ${err?.message ?? err}`,
      );
    }
  }
}
