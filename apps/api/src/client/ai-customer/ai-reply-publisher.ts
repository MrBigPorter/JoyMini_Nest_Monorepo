import { SocketEvents } from '@lucky/shared';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { EventsGateway } from '@api/common/events/events.gateway';

/**
 * 把 AI 回复写入 chat_message 表 + 广播 CHAT_MESSAGE 事件
 * 让 AI 回复像普通 IM 消息一样进入统一的消息流
 *
 * ── 为什么必须走 dispatchToConversation（双通道）？ ──
 * 这里以前只发会话房间。客户端的 join_chat 一旦丢失（断线重连不重放），
 * 房间就是空的 → AI 回复写进了表，用户却一条都收不到（#87 N-9，2026-11-11 实测）。
 * 走双通道后，即使房间为空，`user_X` 私有房间仍能把消息送到，
 * 与普通 IM 消息的投递语义对齐。
 */
export async function publishAiReply(
  prisma: PrismaService,
  eventsGateway: EventsGateway,
  conversationId: string,
  newMessages: any[],
  userId: string,
  /** 会话成员 userId 列表；调用方已查过，直接复用，避免重复查询 */
  memberIds: string[] = [],
): Promise<void> {
  const lastAiContent = newMessages
    .filter((m: any) => m.type === 'ai')
    .map((m: any) => (typeof m.content === 'string' ? m.content : ''))
    .pop() ?? '';
  if (!lastAiContent) return;

  const otherMember = await prisma.chatMember.findFirst({
    where: { conversationId, userId: { not: userId } },
    select: { userId: true },
  });
  if (!otherMember) return;

  const conv = await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMsgSeqId: { increment: 1 } },
    select: { lastMsgSeqId: true },
  });

  const msg = await prisma.chatMessage.create({
    data: {
      conversationId,
      senderId: otherMember.userId,
      content: lastAiContent,
      type: 0,
      seqId: conv.lastMsgSeqId,
      // 这两列 schema 默认都是 'user'。不显式写的话，AI 回复在库里
      // 和用户消息长得一模一样：做"AI 回复占比"、或者以后从 DB 回放历史
      // 给 LangGraph 时，就分不清哪句是谁说的了。
      role: 'assistant',
      source: 'ai',
    },
    include: { sender: { select: { id: true, nickname: true, avatar: true } } },
  });

  eventsGateway.dispatchToConversation(
    conversationId,
    // 成员列表为空时至少要把消息推给提问者本人（senderId 是 AI 占位成员，不在推送对象里）
    memberIds.length > 0 ? memberIds : [userId],
    SocketEvents.CHAT_MESSAGE,
    {
      ...msg,
      isSelf: false,
      // createdAt 转时间戳 number（Flutter SocketMessage 要求 int，Date 会被序列化成 ISO 字符串导致解析失败）
      createdAt: msg.createdAt.getTime(),
    },
  );
}
