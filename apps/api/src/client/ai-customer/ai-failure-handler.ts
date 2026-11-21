import type { Prisma } from '@prisma/client';
import { SocketEvents } from '@lucky/shared';
import { emitStage } from '@api/common/logger/structured-logger';
import { publishAiReply } from './ai-reply-publisher';
import type { PrismaService } from '@api/common/prisma/prisma.service';
import type { EventsGateway } from '@api/common/events/events.gateway';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { AgentPresence } from '@api/common/chat/handoff/handoff-presence.service';
import type { AiFeedbackService } from '@api/common/ai/ai-feedback.service';

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

/** 无客服在线时的留言提示（不承诺转接，避免用户空等） */
export const OFFLINE_HANDOFF_REPLY =
  '人工客服暂时不在线，您可以先留言，我们会尽快联系您';

/**
 * 合并写 aiMetadata.handoffCallback，保留 trafficSource 等既有字段。
 * 无 schema 变更：callback 只是会话元数据，管理端按 status='pending' 过滤。
 */
export function mergeHandoffCallback(
  raw: unknown,
  reason: string,
  requestedAt: Date,
): Record<string, unknown> {
  const base =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    ...base,
    handoffCallback: {
      status: 'pending',
      requestedAt: requestedAt.toISOString(),
      reason,
    },
  };
}

export interface DegradeDeps {
  prisma: PrismaService;
  gateway: EventsGateway;
  eventEmitter: EventEmitter2;
  /** 只用到 warn；失败不该中断降级流程 */
  logger: { warn: (msg: string) => void };
  /**
   * 在线客服探测（可选）。缺省视为在线，保持旧行为；
   * 传 null 依赖 = 不注入 Nest 服务，由调用方决定是否检查。
   */
  presence?: { isAnyAgentOnline(): Promise<AgentPresence> };
  /** HANDOFF_PRESENCE_CHECK_ENABLED；false 时跳过检查，按在线处理 */
  presenceCheckEnabled?: boolean;
  /** 隐式反馈（可选）：转人工是“AI 没解决”的线索，能记就记 */
  aiFeedback?: Pick<AiFeedbackService, 'recordImplicit'>;
}

export interface DegradeParams {
  conversationId: string;
  /** 提问者，用于选推送对象与兜底消息归属 */
  userId: string;
  memberIds?: string[];
  /** 触发本轮回复的用户消息 id；作为 AI 回复幂等唯一键 */
  triggerMessageId?: string;
}

/**
 * 判断本次降级是否应走离线留言分支。
 *
 * 检查关闭 / 未注入探测器 / 探测抛错时一律按在线处理（fail-open），
 * 与 HandoffPresenceService 的默认语义一致：宁可排队，也别把用户卡在留言。
 */
async function isOfflineHandoff(deps: DegradeDeps): Promise<boolean> {
  if (deps.presenceCheckEnabled === false) return false;
  if (!deps.presence) return false;
  try {
    const presence = await deps.presence.isAnyAgentOnline();
    return !presence.online;
  } catch {
    return false;
  }
}

export async function degradeToHuman(
  deps: DegradeDeps,
  params: DegradeParams,
): Promise<void> {
  const { conversationId, userId, memberIds = [], triggerMessageId } = params;

  emitStage('transfer', { source: 'fallback', reason: 'ai_error' }, 'warn');

  const offline = await isOfflineHandoff(deps);
  const mode = offline ? 'offline' : 'online';
  const reply = offline ? OFFLINE_HANDOFF_REPLY : AI_FAILURE_REPLY;

  // ① 落库 + 广播话术。失败只 warn —— 它属于"装饰"
  try {
    await publishAiReply(
      deps.prisma,
      deps.gateway,
      deps.eventEmitter,
      conversationId,
      [{ type: 'ai', content: reply }],
      userId,
      memberIds,
      undefined,
      triggerMessageId,
    );
  } catch (e: any) {
    deps.logger.warn(`[fallback] persist failure reply failed: ${e?.message}`);
  }

  // ② 状态处理：在线才阻断下一轮；离线保持 handlerId=null，只登记留言
  if (offline) {
    try {
      const conv = await deps.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { aiMetadata: true },
      });
      const metadata = mergeHandoffCallback(
        conv?.aiMetadata,
        'ai_error',
        new Date(),
      );
      await deps.prisma.conversation.update({
        where: { id: conversationId },
        data: { aiMetadata: metadata as Prisma.InputJsonValue },
      });
    } catch (e: any) {
      deps.logger.warn(
        `[fallback] persist handoff callback failed: ${e?.message}`,
      );
    }
  } else {
    try {
      await deps.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          handlerId: 'awaiting_human',
          handlerAssignedAt: new Date(),
          // 与 routeTransfer 对齐：排队起点/原因在这里同样落库
          transferredAt: new Date(),
          transferReason: 'ai_error',
        },
      });
    } catch (e: any) {
      deps.logger.warn(`[fallback] mark awaiting_human failed: ${e?.message}`);
    }
  }

  // ③ 这一步是"承诺"：必须发出去，前面两步失败也不影响它
  deps.gateway.dispatchToConversation(
    conversationId,
    memberIds.length > 0 ? memberIds : [userId],
    SocketEvents.AI_TRANSFER,
    { conversationId, reason: 'ai_error', mode },
  );

  // ④ 隐式反馈：之前这条出口是统计黑洞，补上（失败不影响主流程）
  void deps.aiFeedback
    ?.recordImplicit({
      conversationId,
      userId,
      signal: 'transferred',
      metadata: { reason: 'ai_error', mode },
    })
    .catch(() => undefined);
}
