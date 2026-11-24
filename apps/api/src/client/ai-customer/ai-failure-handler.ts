import type { Prisma } from '@prisma/client';
import { SocketEvents } from '@lucky/shared';
import { incCounter } from '@api/common/metrics/metrics';
import { emitStage } from '@api/common/logger/structured-logger';
import { publishAiReply } from './ai-reply-publisher';
import type { PrismaService } from '@api/common/prisma/prisma.service';
import type { EventsGateway } from '@api/common/events/events.gateway';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { AgentPresence } from '@api/common/chat/handoff/handoff-presence.service';
import type { AiFeedbackService } from '@api/common/ai/ai-feedback.service';
import { detectLanguage } from '@api/common/utils/language';

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

/**
 * 兜底话术必须跟随用户语言。
 *
 * ── 为什么不能只有中文 ──
 * 这些句子是「LLM 不可用 / 无依据 / 客服离线」时唯一的输出。英文或菲律宾语
 * 用户被转人工后收到一句中文，等于这条链路对他们完全不可用；验收里也会被
 * 判成语言不一致（`knowledge:r83`）。
 *
 * ── 为什么静态文案而不是让模型翻译 ──
 * 出现这些句子的前提就是模型已经不可用，或者模型正在编造。让故障组件生成
 * 道歉语是最常见的反模式。这里只做一次语言判定 + 查表。
 *
 * 只区分中/非中：`detectLanguage` 把拉丁文字（含菲律宾语）判成 en，
 * 用英文兜底是产品默认市场语言，比中文更有用。
 */
export type HandoffReplyKind =
  | 'ai_failure'
  | 'offline_handoff'
  | 'quota_exceeded'
  | 'no_evidence';

const HANDOFF_REPLIES: Record<
  HandoffReplyKind,
  { zh: string; en: string }
> = {
  ai_failure: {
    zh: '抱歉，我这边暂时处理不了你的问题，已经帮你转接人工客服，请稍等。',
    en: "Sorry, I can't handle this right now. I've transferred you to our human support team — please hold on.",
  },
  offline_handoff: {
    zh: '人工客服暂时不在线，您可以先留言，我们会尽快联系您',
    en: 'Our human support team is offline right now. You can leave a message here and we will get back to you as soon as possible.',
  },
  quota_exceeded: {
    // 配额不是「模型故障」也不是「客服离线」，不能复用上面两句，否则用户
    // 会以为没人上班，而真实原因是本次对话的 token 预算用完了。
    zh: '本次对话已达到 AI 使用上限，请稍后再试，或留言由人工跟进。',
    en: 'This conversation has reached the AI usage limit. Please try again later, or leave a message and our team will follow up.',
  },
  no_evidence: {
    // 发布门禁降级专用：模型没坏、知识库没命中，先确认再回答。
    zh: '这个问题我需要先跟人工确认一下，已为你转接人工客服，请稍等。',
    en: "I need to double-check this with a human agent before answering. I've transferred you to our support team — please hold on.",
  },
};

/**
 * 去掉不含语言信号的 token（URL、长 ID/订单号/地址 id）。
 *
 * ── 为什么需要 ──
 * `detectLanguage` 按字符占比判定。真实用例：
 *   「帮我删掉收货地址 cmwu8yfd9000k... 可以吗」
 * 26 个拉丁字母把中文占比压到 32%，整体被判成 `mixed`，
 * 于是中文用户收到英文兜底话术。可这段 id 不是"用英文说话"，
 * 它是数据本身，不该参与语言判定。
 *
 * 只剔除明显是标识符的片段：含数字/下划线/连字符的串，或长度 ≥ 12 的
 * 纯字母串（cuid 这类）。普通英文单词（refundable、withdrawal）不受影响。
 */
function stripIdentifiers(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\b/g, ' ')
    .replace(/\b[A-Za-z]{12,}\b/g, ' ');
}

/** 按用户问题语言取兜底话术；非中文一律英文。 */
export function handoffReply(
  kind: HandoffReplyKind,
  userText?: string | null,
): string {
  const text = stripIdentifiers(String(userText ?? ''));
  const zh = detectLanguage(text) === 'zh';
  return HANDOFF_REPLIES[kind][zh ? 'zh' : 'en'];
}

/**
 * 所有语言的兜底话术原文。
 * 判定「这句话是不是回答」时必须全语言匹配，否则英文降级会被
 * 当成真实回答计入无依据作答，指标方向就反了。
 */
export const HANDOFF_REPLY_TEXTS: readonly string[] = Object.values(
  HANDOFF_REPLIES,
).flatMap((replies) => [replies.zh, replies.en]);

/** 兜底话术：不依赖任何外部服务（中文原文，兼容旧调用方） */
export const AI_FAILURE_REPLY = HANDOFF_REPLIES.ai_failure.zh;

/** 无客服在线时的留言提示（不承诺转接，避免用户空等） */
export const OFFLINE_HANDOFF_REPLY = HANDOFF_REPLIES.offline_handoff.zh;

/** 配额耗尽的专用话术（中文原文，兼容旧调用方） */
export const QUOTA_EXCEEDED_REPLY = HANDOFF_REPLIES.quota_exceeded.zh;

/**
 * 依据门禁降级话术（中文原文，兼容旧调用方）。
 * 实际发布时用 `handoffReply('no_evidence', 用户问句)` 取对应语言。
 */
export const NO_EVIDENCE_HANDOFF_REPLY = HANDOFF_REPLIES.no_evidence.zh;

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
  /** 用户本轮提问原文：只用来判定兜底话术语言，不落库、不进日志 */
  userText?: string;
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
  const {
    conversationId,
    userId,
    memberIds = [],
    triggerMessageId,
    userText,
  } = params;

  emitStage('transfer', { source: 'fallback', reason: 'ai_error' }, 'warn');
  incCounter('handoff_escalations_total', {
    reason: 'ai_error',
    source: 'fallback',
  });

  const offline = await isOfflineHandoff(deps);
  const mode = offline ? 'offline' : 'online';
  const reply = handoffReply(
    offline ? 'offline_handoff' : 'ai_failure',
    userText,
  );

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
