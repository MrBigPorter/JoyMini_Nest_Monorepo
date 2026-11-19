import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { ConversationStatus } from '@lucky/shared';

/** 待接入哨兵值：handlerId 等于它 = 在排队，等客服认领 */
export const AWAITING_HUMAN = 'awaiting_human';

export type ClaimResult =
  | { status: 'claimed'; handlerId: string }
  | { status: 'conflict' }
  | { status: 'not_found' };

@Injectable()
export class SupportHandlerService {
  private readonly logger = new Logger(SupportHandlerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 客服认领会话
   *
   * 判定和修改在同一条 UPDATE 里完成（CAS）：
   * WHERE handlerId = 'awaiting_human' —— 只有还在排队的人才抢得到
   * 改到 0 行 = 这一瞬间被别的客服接走了（或会话根本不存在）
   */

  async claim(conversationId: string, adminId: string): Promise<ClaimResult> {
    const result = await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        handlerId: AWAITING_HUMAN,
        // 已关闭的会话不能被认领：历史数据里存在 handlerId 没清干净的关闭会话
        status: ConversationStatus.NORMAL,
      },
      data: {
        handlerId: adminId,
        handlerAssignedAt: new Date(),
      },
    });

    if (result.count === 1) {
      this.logger.log(
        `[Claim] conversation=${conversationId} claimed by admin=${adminId}`,
      );
      return { status: 'claimed', handlerId: adminId };
    }

    // 改到 0 行：区分「不存在」和「被抢了」，只为给前端正确的错误码。
    // 注意：这一次查询不参与判定 —— 结论已经由上面的 CAS 定死了。
    const exists = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    return exists ? { status: 'conflict' } : { status: 'not_found' };
  }

  /**
   * 空闲回收：人工处理中超过 idleMs 没有新消息，交回 AI。
   *
   * 为什么不是「查一次再更新」：
   * cron 扫描到的是旧快照，执行时客服可能刚回了一条消息（handlerAssignedAt
   * 被刷新）。条件 updateMany 把「仍然超时」写进 WHERE，刷新过的行改不到，
   * 不会把正在干活的客服踢掉。
   *
   * 只回收真实 admin 名下的会话：
   *   - `awaiting_human` 是排队状态，归队列超时逻辑管；
   *   - `handlerId: null` 本来就在 AI 手里。
   * 对可空列用 `not` 时 SQL 的 NULL 比较不会命中，所以 null 也自然排除。
   */
  async releaseIfIdle(
    conversationId: string,
    idleMs: number,
    now: Date = new Date(),
  ): Promise<boolean> {
    const cutoff = new Date(now.getTime() - idleMs);
    const result = await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        status: ConversationStatus.NORMAL,
        // 排队中（awaiting_human）不算「人工处理中」，不能被空闲回收吞掉
        handlerId: { not: AWAITING_HUMAN },
        handlerAssignedAt: { lt: cutoff },
      },
      data: {
        handlerId: null,
        handlerAssignedAt: null,
        // transferredAt 是「本轮排队起点」；释放后本轮结束，留着会让
        // 下一次转人工的 waitingSeconds 从上一轮开始算。
        transferredAt: null,
      },
    });

    if (result.count === 1) {
      this.logger.log(
        `[IdleRelease] conversation=${conversationId} released back to AI`,
      );
      return true;
    }
    return false;
  }

  /**
   * 扫描所有空闲的人工会话并逐个回收。
   * 返回真正被回收的会话 ID（供调用方广播队列变化）。
   */
  async sweepIdle(
    idleMs: number,
    limit = 200,
    now: Date = new Date(),
  ): Promise<string[]> {
    const cutoff = new Date(now.getTime() - idleMs);
    const candidates = await this.prisma.conversation.findMany({
      where: {
        status: ConversationStatus.NORMAL,
        handlerId: { not: AWAITING_HUMAN },
        handlerAssignedAt: { lt: cutoff },
      },
      select: { id: true },
      take: limit,
    });

    const released: string[] = [];
    for (const { id } of candidates) {
      if (await this.releaseIfIdle(id, idleMs, now)) {
        released.push(id);
      }
    }

    if (released.length > 0) {
      this.logger.log(
        `[IdleSweep] released ${released.length}/${candidates.length} conversation(s)`,
      );
    }
    return released;
  }

  /** 找出排队超过 thresholdMs 仍无人认领的会话（用于提醒广播） */
  async findStaleQueue(
    thresholdMs: number,
    limit = 100,
    now: Date = new Date(),
  ): Promise<Array<{ id: string }>> {
    const cutoff = new Date(now.getTime() - thresholdMs);
    return this.prisma.conversation.findMany({
      where: {
        status: ConversationStatus.NORMAL,
        handlerId: AWAITING_HUMAN,
        transferredAt: { lt: cutoff },
      },
      select: { id: true },
      orderBy: { transferredAt: 'asc' },
      take: limit,
    });
  }
}
