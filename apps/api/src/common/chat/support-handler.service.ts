import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';

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
}
