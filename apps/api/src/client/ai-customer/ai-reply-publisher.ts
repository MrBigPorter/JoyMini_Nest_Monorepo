import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { redactPiiText } from '@api/common/utils/pii-redaction';
import { EventsGateway } from '@api/common/events/events.gateway';
import {
  CHAT_EVENTS,
  MessageCreatedEvent,
} from '@api/common/chat/events/chat.events';

const logger = new Logger('AiReplyPublisher');

/**
 * 把 AI 回复写入 chat_message 表，并发布统一的 MESSAGE_CREATED 事件。
 *
 * ── 为什么不再直接 dispatchToConversation？ ──
 * 以前这里手动双通道补齐，socket 实时投递没漏，但绕过了统一事件：
 * 离线 FCM 推送、以及未来任何 MESSAGE_CREATED 消费者都看不到 AI 消息。
 * 现在改为落库后 emit 一次事件，由 SocketListener / PushListener 统一处理。
 *
 * 注意：事件只能发一次。P2002 重放分支必须直接 return，不能再次广播。
 */
export async function publishAiReply(
  prisma: PrismaService,
  eventsGateway: EventsGateway,
  eventEmitter: EventEmitter2,
  conversationId: string,
  newMessages: any[],
  userId: string,
  /** 会话成员 userId 列表；调用方已查过，直接复用 */
  memberIds: string[] = [],
  /** 附加元数据（如 RAG sources），写入 ChatMessage.meta 并随消息推送 */
  meta?: Record<string, any>,
  /**
   * 触发本次回复的用户消息 id。
   * 写入 ChatMessage.triggerMessageId（唯一索引）：崩溃重放时插入会撞唯一键，
   * 被下面的捕获逻辑吸收，不会产生第二条 AI 回复。
   */
  triggerMessageId?: string,
): Promise<void> {
  const rawAiContent =
    newMessages
      .filter((m: any) => m.type === 'ai')
      .map((m: any) => (typeof m.content === 'string' ? m.content : ''))
      .pop() ?? '';
  // 对外回复统一脱敏：资料页回显手机号/邮箱/证件号时不能原样发给用户。
  const lastAiContent = redactPiiText(rawAiContent) ?? rawAiContent;
  if (!lastAiContent) return;

  const otherMember = await prisma.chatMember.findFirst({
    where: { conversationId, userId: { not: userId } },
    select: { userId: true },
  });
  if (!otherMember) return;

  // 推送名单：免打扰成员只收 socket，不收 FCM。
  // 查询失败时退化为调用方传入的成员列表，不阻断消息。
  let allMemberIds = memberIds.length > 0 ? memberIds : [userId];
  let pushMemberIds = allMemberIds;
  try {
    const members = await prisma.chatMember.findMany({
      where: { conversationId },
      select: { userId: true, isMuted: true },
    });
    if (members.length > 0) {
      allMemberIds = members.map((m) => m.userId);
      pushMemberIds = members.filter((m) => !m.isMuted).map((m) => m.userId);
    }
  } catch (err: any) {
    logger.warn(
      `[publishAiReply] member lookup failed: ${err?.message ?? err}`,
    );
  }

  let msg: any;
  let conversationType: string | undefined;
  let businessId: string | undefined;
  try {
    // 取序号、写消息、更新会话快照必须同事务：
    // 唯一键冲突时一起回滚，不留 seqId 空洞，也不会出现列表快照领先于消息。
    msg = await prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMsgSeqId: { increment: 1 },
          lastMsgContent: lastAiContent,
          lastMsgType: 0,
          lastMsgTime: new Date(),
        },
        select: {
          lastMsgSeqId: true,
          type: true,
          businessId: true,
        },
      });
      conversationType = String(conv.type);
      businessId = conv.businessId ?? undefined;

      return tx.chatMessage.create({
        data: {
          conversationId,
          senderId: otherMember.userId,
          content: lastAiContent,
          type: 0,
          seqId: conv.lastMsgSeqId,
          triggerMessageId,
          // 这两列 schema 默认都是 'user'。不显式写的话，AI 回复在库里
          // 和用户消息长得一模一样：做"AI 回复占比"、或者以后从 DB 回放历史
          // 给 LangGraph 时，就分不清哪句是谁说的了。
          role: 'assistant',
          source: 'ai',
          meta: meta ?? undefined,
        },
        include: {
          sender: { select: { id: true, nickname: true, avatar: true } },
        },
      });
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // 同一触发消息已经回复过：崩溃恢复重放走到这里。
      // 不重复广播 —— 第一次能写库通常也已广播；这里只记录以便排查。
      logger.warn(
        `[publishAiReply] duplicate reply suppressed: conv=${conversationId}, triggerMessageId=${triggerMessageId}`,
      );
      return;
    }
    throw err;
  }

  eventEmitter.emit(
    CHAT_EVENTS.MESSAGE_CREATED,
    new MessageCreatedEvent(
      msg.id,
      conversationId,
      msg.content,
      msg.type,
      msg.sender?.id ?? otherMember.userId,
      msg.sender?.nickname ?? '',
      msg.sender?.avatar ?? '',
      msg.createdAt.getTime(),
      allMemberIds,
      msg.seqId,
      msg.meta,
      conversationType,
      businessId,
      pushMemberIds,
      true,
    ),
  );
}
