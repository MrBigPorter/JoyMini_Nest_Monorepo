import { SocketEvents } from '@lucky/shared';
import {
  CHAT_EVENTS,
  ConversationReadEvent,
  MessageCreatedEvent,
  MessageRecalledEvent,
  SupportConversationStartedEvent,
} from '@api/common/chat/events/chat.events';
import { OnEvent } from '@nestjs/event-emitter';
import { Injectable, Logger } from '@nestjs/common';
import { EventsGateway } from '@api/common/events/events.gateway';
import { PrismaService } from '@api/common/prisma/prisma.service';

@Injectable()
export class SocketListener {
  private readonly logger = new Logger(SocketListener.name);
  //  定义熔断阈值：500人以上的大群，不再给列表页发推送
  private readonly LARGE_GROUP_THRESHOLD = 500;
  constructor(
    private readonly eventsGateway: EventsGateway,
    private readonly prismaService: PrismaService,
  ) {}

  // ===========================================================================
  // 1. 处理新消息 (Message Created)
  // ===========================================================================
  @OnEvent(CHAT_EVENTS.MESSAGE_CREATED)
  async handleMessageCreated(event: MessageCreatedEvent) {
    this.logger.debug(
      `[SocketListener] MessageCreated event received: ` +
        `messageId=${event.messageId}, conversationId=${event.conversationId}, ` +
        `senderId=${event.senderId}, memberCount=${event.memberIds?.length || 0}`,
    );

    const socketPayload = {
      id: event.messageId,
      conversationId: event.conversationId,
      senderId: event.senderId,
      content: event.content,
      type: event.type,
      seqId: event.seqId,
      createdAt: event.createdAt,
      isRecalled: false,
      meta: event.meta,
      sender: {
        id: event.senderId,
        nickname: event.senderName,
        avatar: event.senderAvatar,
      },
      isSelf: false,
    };

    //  A. 房间广播 (O(1))，保证聊天窗口内实时更新
    this.logger.debug(
      `[SocketListener] Dispatching to conversation room: ${event.conversationId}`,
    );

    // 👈 修改点：去掉了多余的 .sockets
    const roomClients = this.eventsGateway['server']?.adapter?.rooms?.get(
      event.conversationId,
    );
    const clientCount = roomClients ? roomClients.size : 0;
    this.logger.debug(
      `[SocketListener] Room ${event.conversationId} has ${clientCount} clients before dispatch`,
    );

    this.eventsGateway.dispatch(
      event.conversationId,
      SocketEvents.CHAT_MESSAGE,
      socketPayload,
    );

    //  B. 列表预览：只针对小群或在线个人进行分发
    // 设定阈值（如500人），超过此人数的群不再执行 forEach 个人分发，靠"前台自愈"同步
    if (
      event.memberIds &&
      event.memberIds.length > 0 &&
      event.memberIds.length <= this.LARGE_GROUP_THRESHOLD
    ) {
      this.logger.debug(
        `[SocketListener] Dispatching to ${event.memberIds.length - 1} members (excluding sender)`,
      );
      event.memberIds.forEach((userId) => {
        if (userId !== event.senderId) {
          this.eventsGateway.dispatch(
            `user_${userId}`,
            SocketEvents.CHAT_MESSAGE,
            socketPayload,
          );
        }
      });
    } else if (
      event.memberIds &&
      event.memberIds.length > this.LARGE_GROUP_THRESHOLD
    ) {
      this.logger.debug(
        `[SocketListener] Skipping member-by-member dispatch for large group (${event.memberIds.length} members > ${this.LARGE_GROUP_THRESHOLD} threshold)`,
      );
    }

    this.logger.debug(
      `[SocketListener] MessageCreated event processed successfully for message: ${event.messageId}`,
    );
  }

  // ===========================================================================
  // 2. 处理消息撤回 (Message Recalled) [NEW]
  // ===========================================================================
  @OnEvent(CHAT_EVENTS.MESSAGE_RECALLED)
  handleMessageRecall(event: MessageRecalledEvent) {
    const recallPayload = {
      conversationId: event.conversationId,
      messageId: event.messageId,
      tip: 'A message was recalled',
      operatorId: event.operatorId,
      seqId: event.seqId,
    };

    // A. 广播给房间 (实时撤回)
    this.eventsGateway.dispatch(
      event.conversationId,
      SocketEvents.MESSAGE_RECALLED,
      { ...recallPayload, isSelf: false },
    );

    //  B. 广播给成员列表 -  必须加熔断！
    // 之前漏掉了这里。如果是万人群撤回，这里不加限制会炸。
    // 逻辑：大群撤回时，列表页的消息预览不需要立马变（等到刷新时再变）
    if (
      event.memberIds &&
      event.memberIds.length > 0 &&
      event.memberIds.length <= this.LARGE_GROUP_THRESHOLD
    ) {
      event.memberIds.forEach((userId) => {
        this.eventsGateway.dispatch(
          `user_${userId}`,
          SocketEvents.MESSAGE_RECALLED,
          {
            ...recallPayload,
            isSelf: event.operatorId === userId,
          },
          event.conversationId,
        );
      });
    }
  }

  // ===========================================================================
  // 3. 处理会话已读 (Conversation Read) [NEW]
  // ===========================================================================
  @OnEvent(CHAT_EVENTS.CONVERSATION_READ)
  handleConversationRead(event: ConversationReadEvent) {
    const readPayload = {
      conversationId: event.conversationId,
      readerId: event.readerId,
      lastReadSeqId: event.lastReadSeqId,
    };

    // 只需要广播给房间
    // 房间里的其他人收到后，会把那个人的消息标记为双勾
    // 房间里的自己收到后（多端同步），会消除红点
    this.eventsGateway.dispatch(
      event.conversationId,
      SocketEvents.CONVERSATION_READ,
      readPayload,
    );
  }

  // ===========================================================================
  // 4. 官方客服新会话 (Support Conversation Started)
  //    Flutter 用户首次点击「联系客服」时触发，通知所有在线 admin 刷新会话列表
  // ===========================================================================
  @OnEvent(CHAT_EVENTS.SUPPORT_CONVERSATION_STARTED)
  async handleSupportConversationStarted(
    event: SupportConversationStartedEvent,
  ) {
    try {
      const supportAdmins = await this.prismaService.adminUser.findMany({
        where: { status: 1, deletedAt: null },
        select: { id: true },
      });

      const payload = {
        conversationId: event.conversationId,
        businessId: event.businessId,
        userId: event.userId,
        timestamp: Date.now(),
      };

      supportAdmins.forEach((admin: any) => {
        this.eventsGateway.dispatch(
          `user_${admin.id}`,
          'support_new_conversation',
          payload,
        );
      });

      this.logger.log(
        `[SupportConversationStarted] Notified ${supportAdmins.length} admin(s) for conv ${event.conversationId}`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Support conversation notify failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
