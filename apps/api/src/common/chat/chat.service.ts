import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  ChatMemberRole,
  CONVERSATION_TYPE,
  ConversationStatus,
  GroupJoinRequestStatus,
  MESSAGE_TYPE,
  SocketSyncTypes,
  TimeHelper,
} from '@lucky/shared';
import { SearchUserDto } from '@api/common/chat/dto/search-user.dto';
import { GetMessagesDto } from '@api/common/chat/dto/get-messages.dto';
import { CreateMessageDto } from '@api/common/chat/dto/create-message.dto';
import { MarkAsReadDto } from '@api/common/chat/dto/mark-as-read.dto';
import { DeleteMessageDto } from '@api/common/chat/dto/delete-message.dto';
import { CreateGroupDto } from '@api/common/chat/dto/group-chat.dto';
import { AVATAR_QUEUE_NAME } from '@api/common/avatar/avatar.processor';
import { v4 as uuidv4 } from 'uuid';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { ConversationListResponseDto } from '@api/common/chat/dto/conversation.response.dto';
import { NotificationService } from '@api/client/notification/notification.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import {
  CHAT_EVENTS,
  ConversationReadEvent,
  MessageCreatedEvent,
  MessageRecalledEvent,
  AiMessageRequestedEvent,
} from '@api/common/chat/events/chat.events';

import { CHAT_GROUP_EVENTS } from '@api/common/chat/events/chat-group.events';
import { ForwardMessageDto } from '@api/common/chat/dto/forward-message.dto';
import { ConfigService } from '@nestjs/config';

const SUPPORT_CONVERSATION_STARTED = 'chat.support.conversation.started';

export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
    @InjectQueue(AVATAR_QUEUE_NAME) private readonly avatarQueue: Queue,
  ) {}

  // =================================================================
  //  CORE OPERATION: sendMessage (Unified Meta-First Engine)
  // =================================================================
  async sendMessage(userId: string, dto: CreateMessageDto) {
    const { id, conversationId, content, type, meta } = dto;

    const existingMessage = await this.prisma.chatMessage.findUnique({
      where: { id },
    });
    if (existingMessage) {
      if (existingMessage.senderId !== userId)
        throw new ForbiddenException('Message ID conflict');
      return {
        ...existingMessage,
        createdAt: existingMessage.createdAt.getTime(),
        isSelf: true,
      };
    }

    const finalMeta: Record<string, any> = dto.meta || {};
    if (type === MESSAGE_TYPE.AUDIO && meta?.duration)
      finalMeta.duration = meta.duration;
    if (
      (type === MESSAGE_TYPE.IMAGE || type === MESSAGE_TYPE.VIDEO) &&
      meta?.w &&
      meta?.h
    ) {
      finalMeta.w = meta.w;
      finalMeta.h = meta.h;
    }

    if (type === MESSAGE_TYPE.FILE) {
      if (meta?.fileName) finalMeta.fileName = meta.fileName;
      if (meta?.fileSize) finalMeta.fileSize = meta.fileSize;
      if (meta?.fileExt) finalMeta.fileExt = meta.fileExt;
    }

    if (type === MESSAGE_TYPE.LOCATION) {
      if (meta?.latitude) finalMeta.latitude = meta.latitude;
      if (meta?.longitude) finalMeta.longitude = meta.longitude;
      if (meta?.address) finalMeta.address = meta.address;
      if (meta?.title) finalMeta.title = meta.title;
      if (meta?.thumb) finalMeta.thumb = meta.thumb;
    }

    const { message, conversationMeta } = await this.prisma.$transaction(
      async (tx) => {
        const conv = await tx.conversation.update({
          where: { id: conversationId },
          data: {
            lastMsgSeqId: { increment: 1 },
            lastMsgContent: this._getPreviewText(type, content),
            lastMsgType: type,
            lastMsgTime: new Date(),
          },
          select: { lastMsgSeqId: true, type: true, businessId: true },
        });

        const msg = await tx.chatMessage.create({
          data: {
            id,
            conversationId,
            senderId: userId,
            content,
            type,
            meta: Object.keys(finalMeta).length > 0 ? finalMeta : undefined,
            seqId: conv.lastMsgSeqId,
          },
          include: {
            sender: { select: { id: true, nickname: true, avatar: true } },
          },
        });

        await tx.chatMember.updateMany({
          where: { conversationId, userId },
          data: { lastReadSeqId: conv.lastMsgSeqId },
        });

        return {
          message: msg,
          conversationMeta: {
            type: conv.type,
            businessId: conv.businessId ?? undefined,
          },
        };
      },
    );

    const messageDto = {
      ...message,
      createdAt: message.createdAt.getTime(),
      isRecalled: false,
    };

    // 2. 查出需要通知的成员 ID (必须在 Service 层做，因为只有这里懂业务)
    // 优化：利用 Prisma 关联查询直接拿，或者复用之前的查询结果
    const members = await this.prisma.chatMember.findMany({
      where: { conversationId },
      select: { userId: true, isMuted: true },
    });
    const memberIds = members.map((m) => m.userId);

    // only push to members who are not muted
    const pushMemberIds = members
      .filter((m) => !m.isMuted)
      .map((m) => m.userId);

    this.eventEmitter.emit(
      CHAT_EVENTS.MESSAGE_CREATED,
      new MessageCreatedEvent(
        message.id,
        message.conversationId,
        message.content,
        message.type,
        message.sender?.id || '',
        message.sender?.nickname || '',
        message.sender?.avatar || '',
        message.createdAt.getTime(),
        memberIds,
        message.seqId,
        message.meta,
        conversationMeta.type,
        conversationMeta.businessId,
        pushMemberIds,
      ),
    );

    // ── AI 路由：SUPPORT 对话的用户消息 → 触发 LangGraph ──
    // 用户在 SUPPORT 对话中发消息时，不走 Socket 人工客服，
    // 而是先由 AI 处理。AI 的回复通过 Socket ai_token/ai_done 推送。
    // 转人工后不再触发 AI（由数据库 handler 字段控制）。
    if (conversationMeta.type === 'SUPPORT' || conversationMeta.type === 'AI') {
      this.eventEmitter.emit(
        CHAT_EVENTS.AI_MESSAGE_REQUESTED,
        new AiMessageRequestedEvent(conversationId, content, userId),
      );
    }

    return { ...messageDto, isSelf: true };
  }

  // =================================================================
  //  CORE OPERATION: forwardMessage
  // =================================================================
  async forwardMessage(userId: string, dto: ForwardMessageDto) {
    // find original message
    const originalMsg = await this.prisma.chatMessage.findUnique({
      where: { id: dto.originalMsgId },
    });

    if (!originalMsg) throw new NotFoundException('Original message not found');

    const results = [];

    // 3. 循环发送给目标会话
    // 注意：这里复用 sendMessage 是为了保证 Socket 推送、未读数更新、最后一条消息更新等逻辑的一致性
    for (const targetConvId of dto.targetConversationIds) {
      try {
        // createMessageDto 里 content/type/meta 都是可选的，所以我们构造一个新的 DTO，确保必填项满足 sendMessage 的要求
        const newMessage = await this.sendMessage(userId, {
          id: uuidv4(),
          type: originalMsg.type,
          conversationId: targetConvId,
          content: originalMsg.content, // 图片/视频/文件直接复用 URL
          // 关键：必须透传 meta (宽、高、时长、文件名等)
          // 注意：sendMessage 内部会重新清洗 meta，所以这里直接传过去即可
          meta: originalMsg.meta as Record<string, any>,
        });
        results.push({ conversationId: targetConvId, message: newMessage });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to forward message to conversation ${targetConvId}: ${message}`,
        );
      }
    }
    return results;
  }

  // =================================================================
  //  CORE OPERATION: recallMessage (2-Minute Rule)
  // =================================================================
  async recallMessage(userId: string, messageId: string) {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId)
      throw new ForbiddenException('Cannot recall others messages');

    if (!TimeHelper.isWithinRange(message.createdAt, new Date(), 120000)) {
      throw new ForbiddenException('Recall window expired');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. 数据库逻辑 (保持不变)
      const msg = await tx.chatMessage.update({
        where: { id: messageId },
        data: {
          content: '[Message Recalled]',
          type: MESSAGE_TYPE.RECALLED,
          meta: {},
        },
      });

      const conv = await tx.conversation.findUnique({
        where: { id: msg.conversationId },
        select: { lastMsgSeqId: true },
      });
      if (conv?.lastMsgSeqId === msg.seqId) {
        await tx.conversation.update({
          where: { id: msg.conversationId },
          data: {
            lastMsgContent: '[Message Recalled]',
            lastMsgType: MESSAGE_TYPE.RECALLED,
          },
        });
      }
      return { messageId: msg.id, tip: 'Message recalled', seqId: msg.seqId };
    });

    // 2. 查出需要通知的成员 (为了 Socket 列表更新)
    const members = await this.prisma.chatMember.findMany({
      where: { conversationId: message.conversationId },
      select: { userId: true },
    });
    const memberIds = members.map((m) => m.userId);

    //  [Refactor] 触发事件，而不是直接调 Socket
    this.eventEmitter.emit(
      CHAT_EVENTS.MESSAGE_RECALLED,
      new MessageRecalledEvent(
        message.conversationId,
        messageId,
        userId,
        result.seqId,
        memberIds,
      ),
    );

    return result;
  }

  // =================================================================
  //  CORE OPERATION: deleteMessage (Soft Delete)
  // =================================================================
  async deleteMessage(userId: string, dto: DeleteMessageDto) {
    const { messageId } = dto;
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
    });
    if (!message) return;

    await this.prisma.chatMessageHide.upsert({
      where: { userId_messageId: { userId, messageId } },
      update: {},
      create: { userId, messageId },
    });
    return { messageId };
  }

  /**
   * clear chat history for a user in a conversation (soft delete using cursor truncation)
   */
  async clearHistory(userId: string, conversationId: string) {
    // get lastMsgSeqId for the conversation
    const conv = await this.prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      select: {
        lastMsgSeqId: true,
      },
    });

    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    // update clearedSeqId for the user in chatMember
    await this.prisma.chatMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { clearedSeqId: conv.lastMsgSeqId },
    });
    return { success: true };
  }

  // =================================================================
  //  CORE OPERATION: markAsRead (Read Sync)
  // =================================================================
  async markAsRead(userId: string, dto: MarkAsReadDto) {
    const { conversationId, maxSeqId } = dto;
    if (!conversationId) {
      throw new BadRequestException('Invalid conversationId');
    }

    // 1. 数据库逻辑
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { lastMsgSeqId: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const targetSeqId = maxSeqId
      ? Math.min(maxSeqId, conversation.lastMsgSeqId)
      : conversation.lastMsgSeqId;

    const updatedMember = await this.prisma.chatMember.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: { lastReadSeqId: targetSeqId },
      select: { lastReadSeqId: true },
    });

    //  [Refactor] 触发事件，而不是直接调 Socket
    this.eventEmitter.emit(
      CHAT_EVENTS.CONVERSATION_READ,
      new ConversationReadEvent(conversationId, userId, targetSeqId),
    );

    return { lastReadSeqId: updatedMember.lastReadSeqId };
  }

  // =================================================================
  //  QUERIES: Lists & Details (N+1 Optimized)
  // =================================================================
  async getConversationList(userId: string, page = 1, pageSize = 200) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        members: { some: { userId } },
        status: ConversationStatus.NORMAL,
      },
      include: { members: { where: { userId } } },
      orderBy: { lastMsgTime: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const directIds = conversations
      .filter((c) => c.type === CONVERSATION_TYPE.DIRECT)
      .map((c) => c.id);
    const partnersMap = new Map<
      string,
      { nickname: string | null; avatar: string | null }
    >();
    if (directIds.length > 0) {
      const partners = await this.prisma.chatMember.findMany({
        where: { conversationId: { in: directIds }, userId: { not: userId } },
        include: { user: { select: { nickname: true, avatar: true } } },
      });
      partners.forEach((p) => partnersMap.set(p.conversationId, p.user));
    }

    return conversations.map((conv) => {
      const partner = partnersMap.get(conv.id);
      const mySettings = conv.members[0];
      return new ConversationListResponseDto({
        id: conv.id,
        type: conv.type,
        name: partner?.nickname || conv.name || 'Unknown',
        avatar: partner?.avatar || conv['avatar'],
        lastMsgContent: conv.lastMsgContent,
        lastMsgTime: conv.lastMsgTime?.getTime() || 0,
        isPinned: mySettings?.isPinned ?? false,
        isMuted: mySettings?.isMuted ?? false,
        unreadCount: Math.max(
          0,
          conv.lastMsgSeqId - (mySettings?.lastReadSeqId ?? 0),
        ),
      });
    });
  }

  /**
   * 获取会话详情：包括成员列表、未读数、个人设置等
   * @param conversationId
   * @param userId
   */
  async getConversationDetail(conversationId: string, userId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          include: {
            user: { select: { id: true, nickname: true, avatar: true } },
          },
          orderBy: { role: 'asc' },
        },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    let displayName = conv.name;
    let displayAvatar = conv['avatar'];
    if (conv.type === CONVERSATION_TYPE.DIRECT) {
      const partner = conv.members.find((m) => m.userId !== userId);
      if (partner) {
        displayName = partner.user.nickname;
        displayAvatar = partner.user.avatar;
      }
    }

    //获取当前用户在这个会话里的状态
    const myMember = conv.members.find((m) => m.userId === userId);

    // =========================================================
    //  [新增逻辑] 检查申请状态 (仅针对陌生人 + 群聊)
    // =========================================================
    let applicationStatus: 'NONE' | 'PENDING' = 'NONE';

    // 如果我不是成员，且这是个群组
    if (!myMember && conv.type === CONVERSATION_TYPE.GROUP) {
      // 查一下是否有待审批的记录
      // 假设你的表名叫 groupJoinRequest，状态 0 是 PENDING
      const pendingRequest = await this.prisma.groupJoinRequest.findFirst({
        where: {
          groupId: conversationId,
          applicantId: userId,
          status: 0, // 0 = PENDING
        },
      });

      if (pendingRequest) {
        applicationStatus = 'PENDING';
      }
    }

    //检查待审批数量 (仅针对管理员/群主)
    let pendingRequestCount = 0;

    // 如果我是管理员或群主，查一下有多少待审批的记录
    if (conv.type === CONVERSATION_TYPE.GROUP && myMember) {
      const isManager = myMember.role === 'OWNER' || myMember.role === 'ADMIN';
      if (isManager) {
        pendingRequestCount = await this.prisma.groupJoinRequest.count({
          where: {
            groupId: conversationId,
            status: GroupJoinRequestStatus.PENDING, // 0 = PENDING
          },
        });
      }
    }

    // 如果当前用户不是成员（极端情况），给予默认值
    const myLastReadSeqId = myMember?.lastReadSeqId ?? 0;
    // 计算未读数：(总消息数 - 我已读的)
    // 确保不小于 0
    const unreadCount = Math.max(0, conv.lastMsgSeqId - myLastReadSeqId);
    const isStranger = !myMember;

    return {
      id: conv.id,
      name: displayName,
      avatar: displayAvatar,
      type: conv.type,
      ownerId: conv.ownerId,

      announcement: conv.announcement,
      isMuteAll: conv.isMuteAll,
      joinNeedApproval: conv.joinNeedApproval,

      lastMsgSeqId: conv.lastMsgSeqId, // 会话最新的一条 Seq
      myLastReadSeqId: myLastReadSeqId, // 我读到了哪一条
      unreadCount: unreadCount, // 算出来的未读数 (前端自愈的依据)
      isPinned: myMember?.isPinned ?? false,
      isMuted: myMember?.isMuted ?? false,

      applicationStatus: applicationStatus,
      pendingRequestCount: pendingRequestCount,

      memberCount: conv.members.length,
      // 如果是陌生人，返回空列表；如果是成员，才返回完整列表
      members: isStranger
        ? []
        : conv.members.map((m) => ({
            userId: m.userId,
            nickname: m.user.nickname,
            avatar: m.user.avatar,
            role: m.role,
            mutedUntil: m.mutedUntil ? new Date(m.mutedUntil).getTime() : null,
          })),
    };
  }

  // =================================================================
  //  CORE OPERATION: getMessages (SeqId Optimization)
  // =================================================================
  async getMessages(userId: string, dto: GetMessagesDto) {
    const { conversationId, cursor, pageSize = 20 } = dto;

    // get my clearedSeqId to filter out messages that should be hidden due to clear history
    const myMember = await this.prisma.chatMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { clearedSeqId: true },
    });

    if (!myMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    const clearedSeqId = myMember?.clearedSeqId ?? 0;

    const partner = await this.prisma.chatMember.findFirst({
      where: { conversationId, userId: { not: userId } },
      select: { lastReadSeqId: true },
    });

    const whereCondition: Prisma.ChatMessageWhereInput = {
      conversationId,
      hiddenByUsers: { none: { userId } },
      seqId: { gt: clearedSeqId }, // find messages with seqId greater than clearedSeqId to implement clear history
    };

    if (cursor) {
      // If cursor is provided, we want messages with seqId less than cursor (for pagination)
      whereCondition.seqId = { gt: clearedSeqId, lt: cursor };
    }

    const messages = await this.prisma.chatMessage.findMany({
      where: whereCondition,
      orderBy: { seqId: 'desc' },
      take: pageSize,
      include: {
        sender: { select: { id: true, nickname: true, avatar: true } },
      },
    });

    let nextCursor: number | null = null;
    if (messages.length > 0) {
      nextCursor = messages[messages.length - 1].seqId;
    }

    return {
      list: messages.map((m) => ({
        id: m.id,
        seqId: m.seqId,
        content: m.content,
        type: m.type,
        createdAt: m.createdAt.getTime(),
        isSelf: m.senderId === userId,
        meta: m.meta,
        sender: m.sender,
      })),
      nextCursor,
      partnerLastReadSeqId: partner?.lastReadSeqId ?? 0,
    };
  }

  // =================================================================
  //  CORE OPERATION: setMute (Personal Setting)
  // =================================================================
  async setMute(userId: string, conversationId: string, isMuted: boolean) {
    const member = await this.prisma.chatMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    await this.prisma.chatMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { isMuted },
    });

    return { success: true, isMuted };
  }

  // =================================================================
  //  CORE OPERATION: setPin (Personal Setting)
  // =================================================================
  async setPin(userId: string, conversationId: string, isPinned: boolean) {
    const member = await this.prisma.chatMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member)
      throw new ForbiddenException('Not a member of this conversation');

    await this.prisma.chatMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { isPinned },
    });

    return { success: true, isPinned };
  }
  // =================================================================
  //  GROUP & MEMBERSHIP (Business, Direct, Group)
  // =================================================================

  /**
   * 客户端统一入口：/chat/business?businessId=xxx
   * 现阶段用于客服渠道建联：按 SupportChannel 查 botUserId，创建/复用 SUPPORT 1v1 会话。
   * 返回当前用户在该会话中的 ChatMember。
   * @param businessId
   * @param userId
   */
  async addMemberToBusinessGroup(businessId: string, userId: string) {
    const channel = await this.prisma.supportChannel.findUnique({
      where: { id: businessId },
      include: {
        botUser: {
          select: { id: true, nickname: true, avatar: true, isRobot: true },
        },
      },
    });
    if (!channel || !channel.isActive) {
      throw new NotFoundException('Support channel not found or inactive');
    }

    const existingConversation = await this.prisma.conversation.findFirst({
      where: {
        type: CONVERSATION_TYPE.SUPPORT,
        // 只复用「正常」状态的会话；CLOSED(status=2) 的旧会话不复用，
        // 让用户在 Admin 关闭对话后可以重新发起一个全新的客服会话。
        status: ConversationStatus.NORMAL,
        AND: [
          { members: { some: { userId } } },
          { members: { some: { userId: channel.botUserId } } },
        ],
      },
      include: { members: { where: { userId }, take: 1 } },
    });

    const existingMember = existingConversation?.members.find(
      (m) => m.userId === userId,
    );
    if (existingMember) {
      return existingMember;
    }

    const member = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          type: CONVERSATION_TYPE.SUPPORT,
          name: channel.name,
          avatar: channel.botUser.avatar,
          status: ConversationStatus.NORMAL,
          lastMsgContent: 'Welcome!',
          lastMsgTime: new Date(),
          members: {
            create: [
              { userId, role: ChatMemberRole.MEMBER },
              { userId: channel.botUserId, role: ChatMemberRole.MEMBER },
            ],
          },
        },
        include: { members: { where: { userId }, take: 1 } },
      });

      const createdMember = conversation.members.find(
        (m) => m.userId === userId,
      );
      if (!createdMember) {
        throw new InternalServerErrorException(
          'Failed to create support member',
        );
      }
      return createdMember;
    });

    this.eventEmitter.emit(
      (CHAT_EVENTS as Record<string, string>).SUPPORT_CONVERSATION_STARTED ??
        SUPPORT_CONVERSATION_STARTED,
      {
        conversationId: member.conversationId,
        businessId,
        userId,
      },
    );

    return member;
  }

  /**
   * 确保两个用户之间有一个直接会话，如果没有则创建一个新的直接会话
   * @param myId
   * @param targetId
   */
  async ensureDirectConversation(myId: string, targetId: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: CONVERSATION_TYPE.DIRECT,
        AND: [
          { members: { some: { userId: myId } } },
          { members: { some: { userId: targetId } } },
        ],
      },
    });
    if (existing) return existing;
    return this.prisma.conversation.create({
      data: {
        type: CONVERSATION_TYPE.DIRECT,
        status: ConversationStatus.NORMAL,
        members: {
          create: [
            { userId: myId, role: ChatMemberRole.OWNER },
            { userId: targetId, role: ChatMemberRole.OWNER },
          ],
        },
      },
    });
  }

  /**
   * 将用户邀请加入群聊，如果用户已经是成员则忽略，返回新加入的成员数量
   * @param operatorId
   * @param dto
   */
  async inviteToGroup(
    operatorId: string,
    dto: { groupId: string; memberIds: string[] },
  ) {
    const { groupId, memberIds } = dto;
    const operator = await this.prisma.chatMember.findUnique({
      where: {
        conversationId_userId: { conversationId: groupId, userId: operatorId },
      },
    });
    if (!operator) throw new ForbiddenException('Not a member');

    const existing = await this.prisma.chatMember.findMany({
      where: { conversationId: groupId, userId: { in: memberIds } },
      select: { userId: true },
    });
    const existingSet = new Set(existing.map((m) => m.userId));
    const newMembers = memberIds.filter((id) => !existingSet.has(id));
    if (newMembers.length > 0) {
      // 1. 数据库操作
      await this.prisma.$transaction(async (tx) => {
        await tx.chatMember.createMany({
          data: newMembers.map((uid) => ({
            conversationId: groupId,
            userId: uid,
            role: ChatMemberRole.MEMBER,
          })),
        });
      });

      //  优化：不再循环发 Member 对象，只发一个“同步列表”指令
      // 发送到 EventEmitter，让 Listener 去分发
      this.eventEmitter.emit(CHAT_GROUP_EVENTS.MEMBER_JOINED, {
        conversationId: groupId,
        operatorId,
        targetIds: newMembers,
        syncType: SocketSyncTypes.FULL_SYNC, // 告诉前端大群变动，去拉接口
      });

      this._triggerAvatarUpdate(groupId);
    }
    return { count: newMembers.length };
  }

  /**
   * 用户主动退群，如果是最后一个成员则解散群聊
   * @param userId
   * @param groupId
   */
  async leaveGroup(userId: string, groupId: string) {
    await this.prisma.chatMember.delete({
      where: { conversationId_userId: { conversationId: groupId, userId } },
    });
    const remaining = await this.prisma.chatMember.count({
      where: { conversationId: groupId },
    });
    if (remaining === 0) {
      await this.prisma.conversation.delete({ where: { id: groupId } });
    } else {
      this._triggerAvatarUpdate(groupId);
    }

    return { success: true };
  }

  /**
   * 创建群聊，并把创建者和成员都加入到群聊中
   * @param creatorId
   * @param dto
   */
  async createGroupChat(creatorId: string, dto: CreateGroupDto) {
    const uniqueMembers = Array.from(new Set([creatorId, ...dto.memberIds]));
    const conversation = await this.prisma.conversation.create({
      data: {
        type: CONVERSATION_TYPE.GROUP,
        name: dto.name,
        status: ConversationStatus.NORMAL,
        lastMsgContent: 'Group created',
        lastMsgTime: new Date(),
        ownerId: creatorId,
        members: {
          create: uniqueMembers.map((uid) => ({
            userId: uid,
            role:
              uid === creatorId ? ChatMemberRole.OWNER : ChatMemberRole.MEMBER,
          })),
        },
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, nickname: true, avatar: true } },
          },
        },
      },
    });
    this._triggerAvatarUpdate(conversation.id);

    return conversation;
  }

  /**
   * 搜索用户（用于添加好友、拉人进群等场景），支持昵称模糊、手机号和 ID 精确搜索
   * @param myUserId
   * @param dto
   */
  async searchUsers(myUserId: string, dto: SearchUserDto) {
    return this.prisma.user.findMany({
      where: {
        AND: [
          { id: { not: myUserId } },
          { isRobot: false },
          {
            OR: [
              { nickname: { contains: dto.keyword, mode: 'insensitive' } },
              { phone: { contains: dto.keyword } },
              { id: { equals: dto.keyword } },
            ],
          },
        ],
      },
      take: 20,
      select: { id: true, nickname: true, avatar: true },
    });
  }

  // =================================================================
  //  WEBRTC: Get Dynamic ICE Servers (Secure)
  // =================================================================
  getIceServers(userId: string) {
    // 1. 从 .env 获取配置
    const secret = this.configService.get<string>('TURN_SECRET');
    const turnUrl = this.configService.get<string>('TURN_URL');

    if (!secret || !turnUrl) {
      this.logger.warn('TURN server is not configured properly.');
      throw new InternalServerErrorException('WebRTC config error');
    }

    // 2. 设定过期时间 (例如 24 小时后过期)
    // 注意：Coturn 要求单位是“秒”，不是毫秒
    const ttl = 24 * 3600;
    const timestamp = Math.floor(Date.now() / 1000) + ttl;

    // 3. 拼接用户名: "过期时间戳:用户ID"
    const turnUsername = `${timestamp}:${userId}`;

    // 4. 使用 HMAC-SHA1 算法生成密码 (这是 Coturn 的标准算法)
    const turnPassword = crypto
      .createHmac('sha1', secret)
      .update(turnUsername)
      .digest('base64');
    // 5. 返回给前端的格式
    return [
      // 免费的 Google STUN 服务 (用于打洞)
      { urls: 'stun:stun.l.google.com:19302' },
      // 你的私有 TURN 服务 (用于中转)
      {
        urls: turnUrl,
        username: turnUsername,
        credential: turnPassword,
      },
    ];
  }

  /**
   * 根据消息类型生成预览文本（用于会话列表的最后一条消息显示），比如图片显示为 "[Image]"，语音显示为 "[Voice]"，位置显示为 "[Location]" 等
   * @param type
   * @param content
   * @private
   */
  private _getPreviewText(type: number, content: string): string {
    switch (type) {
      case MESSAGE_TYPE.TEXT:
        return content;
      case MESSAGE_TYPE.IMAGE:
        return '[Image]';
      case MESSAGE_TYPE.AUDIO:
        return '[Voice]';
      case MESSAGE_TYPE.VIDEO:
        return '[Video]';
      case MESSAGE_TYPE.FILE:
        return '[File]';
      case MESSAGE_TYPE.LOCATION:
        return '[Location]';
      default:
        return '[Unsupported]';
    }
  }

  /**
   * 触发群头像更新的异步任务，利用 BullMQ 的去重和延迟功能，避免频繁更新导致的性能问题
   * @param conversationId
   * @private
   */
  private _triggerAvatarUpdate(conversationId: string) {
    this.avatarQueue
      .add(
        'update_chat_group',
        { conversationId },
        {
          delay: 500,
          removeOnComplete: true,
          jobId: `chat_avatar_${conversationId}`,
        },
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Chat Avatar Queue ERROR] ${message}`);
      });
  }
}
