import { SocketEvents } from '@lucky/shared';
import { emitStage } from '@api/common/logger/structured-logger';
import { publishAiReply } from './ai-reply-publisher';
import type { PrismaService } from '@api/common/prisma/prisma.service';
import type { EventsGateway } from '@api/common/events/events.gateway';

/**
 * AI 链路故障降级 —— #87 N-15
 *
 * ── 问题 ──
 * 修复前，模型超时 / provider 报错只是"记一条日志 + 发一个 AI_ERROR"。
 * 用户屏幕上什么也没有；会话还停在 AI 处理态（handlerId 仍是 null），
 * 于是用户再发一条，同样的故障原样重放一次。
 *
 * ── 原则：模型不可用 ≠ 用户收不到回复 ──
 * 它是"这一轮改由人工接"。所以降级要同时完成四件事：
 *   ① 落一条静态兜底话术（落库 + 双通道，和正常回复走同一条链路）
 *   ② 置 awaiting_human（阻断下一轮，避免故障被无限重放）
 *   ③ 发 AI_TRANSFER（端上切人工态）
 *   ④ 记 transfer{source:'fallback'}（否则按 reason 统计时这条出口是黑洞）
 *
 * ── 为什么话术是静态的 ──
 * 这句话出现的时刻，前提恰恰是"LLM 不可用"。
 * 让已故障的组件去生成道歉语，是最常见的反模式。
 */

/** 兜底话术：不依赖任何外部服务 */
export const AI_FAILURE_REPLY =
  '抱歉，我这边暂时处理不了你的问题，已经帮你转接人工客服，请稍等。';

export interface DegradeDeps {
  prisma: PrismaService;
  gateway: EventsGateway;
  /** 只用到 warn；失败不该中断降级流程 */
  logger: { warn: (msg: string) => void };
}

export interface DegradeParams {
  conversationId: string;
  /** 提问者，用于选推送对象与兜底消息归属 */
  userId: string;
  memberIds?: string[];
}

export async function degradeToHuman(
  deps: DegradeDeps,
  params: DegradeParams,
): Promise<void> {
  const { conversationId, userId, memberIds = [] } = params;

  emitStage('transfer', { source: 'fallback', reason: 'ai_error' }, 'warn');

  // ① 落库 + 广播兜底话术。失败只 warn —— 它属于"装饰"
  try {
    await publishAiReply(
      deps.prisma,
      deps.gateway,
      conversationId,
      [{ type: 'ai', content: AI_FAILURE_REPLY }],
      userId,
      memberIds,
    );
  } catch (e: any) {
    deps.logger.warn(`[fallback] persist failure reply failed: ${e?.message}`);
  }

  // ② 阻断下一轮。同样只 warn —— 但如果这步失败，故障可能重放，所以记清楚
  try {
    await deps.prisma.conversation.update({
      where: { id: conversationId },
      data: { handlerId: 'awaiting_human', handlerAssignedAt: new Date() },
    });
  } catch (e: any) {
    deps.logger.warn(`[fallback] mark awaiting_human failed: ${e?.message}`);
  }

  // ③ 这一步是"承诺"：必须发出去，前面两步失败也不影响它
  deps.gateway.dispatchToConversation(
    conversationId,
    memberIds.length > 0 ? memberIds : [userId],
    SocketEvents.AI_TRANSFER,
    { conversationId, reason: 'ai_error' },
  );
}
