import { SocketEvents } from '@lucky/shared';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { EventsGateway } from '@api/common/events/events.gateway';

/**
 * 把 AI 回复写入 chat_message 表 + 广播 CHAT_MESSAGE 事件
 * 让 AI 回复像普通 IM 消息一样进入统一的消息流
 */
export async function publishAiReply(
  prisma: PrismaService,
  eventsGateway: EventsGateway,
  conversationId: string,
  newMessages: any[],
  userId: string,
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
    },
    include: { sender: { select: { id: true, nickname: true, avatar: true } } },
  });

  eventsGateway.dispatch(conversationId, SocketEvents.CHAT_MESSAGE, {
    ...msg, isSelf: false,
  });
}
