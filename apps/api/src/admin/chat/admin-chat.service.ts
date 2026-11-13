import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, ConversationType } from '@prisma/client';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { UploadService } from '@api/common/upload/upload.service';
import { EventsGateway } from '@api/common/events/events.gateway';
import { ChatService } from '@api/common/chat/chat.service';
import { v4 as uuidv4 } from 'uuid';
import { QueryConversationsDto } from './dto/query-conversations.dto';
import {
  AdminReplyDto,
  AdminUploadTokenDto,
  CloseConversationDto,
  QueryMessagesDto,
} from './dto/admin-chat.dto';
import {
  SupportHandlerService,
  AWAITING_HUMAN,
} from '@api/common/chat/support-handler.service';

/** Conversation.status 枚举值 */
const CONV_STATUS = { NORMAL: 1, CLOSED: 2 } as const;

/** 系统客服消息的类型（TEXT=0） */
const MSG_TYPE_TEXT = 0;
/** 系统消息类型（前端可以根据 senderId===null 判断样式） */
const MSG_TYPE_SYSTEM = 99;

@Injectable()
export class AdminChatService {
  private readonly logger = new Logger(AdminChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly eventsGateway: EventsGateway,
    private readonly chatService: ChatService,
    private readonly supportHandlerService: SupportHandlerService,
  ) {}

  // ─────────────────────────────────────────────
  // 1. 会话列表
  // ─────────────────────────────────────────────
  async getConversations(dto: QueryConversationsDto, adminId: string) {
    const { page = 1, pageSize = 20, type, keyword, status, queue } = dto;

    const where: Prisma.ConversationWhereInput = {
      // 默认只看 SUPPORT，若传了 type 则按传入值
      type: type ?? ConversationType.SUPPORT,
    };

    // 归属维度 → handlerId 条件（和 status 是两个正交的筛选）
    if (queue === 'awaiting') {
      where.handlerId = AWAITING_HUMAN;
      if (status === undefined) where.status = CONV_STATUS.NORMAL; // 待接入只看正常的
    } else if (queue === 'mine') {
      where.handlerId = adminId; // 只看当前登录客服的
    } else if (queue === 'ai') {
      where.handlerId = null; // 只看 AI 处理中（未被客服认领）的
    }

    if (status !== undefined) {
      where.status = status;
    }

    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        {
          members: {
            some: {
              user: {
                nickname: { contains: keyword, mode: 'insensitive' },
              },
            },
          },
        },
      ];
    }

    // 待接入：等得最久的排最前（防止老会话被新会话淹没）
    // 其他视图：最近有消息的排最前
    const orderBy: Prisma.ConversationOrderByWithRelationInput =
      queue === 'awaiting'
        ? { handlerAssignedAt: 'asc' }
        : { lastMsgTime: 'desc' };
    const [total, list] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          members: {
            include: {
              user: { select: { id: true, nickname: true, avatar: true } },
            },
            take: 10,
          },
        },
      }),
    ]);

    const now = Date.now();

    return {
      list: list.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        status: c.status,
        handlerId: c.handlerId,
        transferReason: c.transferReason,
        waitingSeconds: (() => {
          const since = c.transferredAt ?? c.handlerAssignedAt;
          return since
            ? Math.max(0, Math.floor((now - since.getTime()) / 1000))
            : null;
        })(),
        lastMsgContent: c.lastMsgContent,
        lastMsgTime: c.lastMsgTime?.getTime() ?? 0,
        lastMsgSeqId: c.lastMsgSeqId,
        memberCount: c.members.length,
        members: c.members.map((m) => ({
          userId: m.userId,
          nickname: m.user?.nickname ?? null,
          avatar: m.user?.avatar ?? null,
          role: m.role,
        })),
      })),
      total,
      page,
      pageSize,
    };
  }

  // ─────────────────────────────────────────────
  // 1.1 客服认领会话（T2-5）
  // ─────────────────────────────────────────────
  //
  // 只做一件事：把 service 的三种结果翻译成 HTTP 语义。
  // 判定本身在 SupportHandlerService.claim 的那条 CAS 里，
  // 这里不查库、不判断"能不能接"。

  async claimConversation(conversationId: string, adminId: string) {
    const result = await this.supportHandlerService.claim(
      conversationId,
      adminId,
    );

    if (result.status === 'not_found') {
      throw new NotFoundException('Conversation not found');
    }
    if (result.status === 'conflict') {
      throw new ConflictException(
        'Conversation has already been claimed by another agent',
      );
    }

    return { success: true, conversationId, handlerId: result.handlerId };
  }

  // ─────────────────────────────────────────────
  // 2. 消息历史（游标分页，admin 无权限限制）
  // ─────────────────────────────────────────────
  async getMessages(conversationId: string, dto: QueryMessagesDto) {
    const { cursor, pageSize = 30 } = dto;

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, lastMsgSeqId: true },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    const where: Prisma.ChatMessageWhereInput = { conversationId };
    if (cursor) {
      where.seqId = { lt: cursor };
    }

    const messages = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { seqId: 'desc' },
      take: pageSize,
      include: {
        sender: { select: { id: true, nickname: true, avatar: true } },
      },
    });

    const nextCursor =
      messages.length > 0 ? messages[messages.length - 1].seqId : null;

    return {
      list: messages.map((m) => ({
        id: m.id,
        seqId: m.seqId,
        content: m.content,
        type: m.type,
        isRecalled: m.isRecalled,
        createdAt: m.createdAt.getTime(),
        meta: m.meta,
        senderId: m.senderId,
        sender: m.sender
          ? {
              id: m.sender.id,
              nickname: m.sender.nickname,
              avatar: m.sender.avatar,
            }
          : null,
        isSystem: m.senderId === null,
      })),
      nextCursor,
      totalSeqId: conv.lastMsgSeqId,
    };
  }

  // ─────────────────────────────────────────────
  // 3. 客服回复（通过 botUserId 走 ChatService 标准链路）
  // ─────────────────────────────────────────────
  async replyToConversation(
    conversationId: string,
    dto: AdminReplyDto,
    adminName: string,
    adminId: string,
  ) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          include: {
            user: { select: { id: true, isRobot: true } },
          },
        },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    const botMember = conv.members.find((m) => m.user?.isRobot);
    if (!botMember) {
      throw new NotFoundException('Support bot member not found');
    }

    const agentLabel = dto.agentName ?? adminName ?? 'Support';
    const msgType = dto.type ?? MSG_TYPE_TEXT;
    const message = await this.chatService.sendMessage(botMember.userId, {
      id: uuidv4(),
      conversationId,
      content: dto.content,
      type: msgType,
      meta: {
        isSupport: true,
        agentName: agentLabel,
        realAdminId: adminId,
        ...(dto.meta ?? {}),
      },
    });

    this.logger.log(
      `Admin [${adminName}] replied to conversation ${conversationId} via bot ${botMember.userId} (type=${msgType})`,
    );

    return {
      id: message.id,
      seqId: message.seqId,
      content: message.content,
      createdAt: message.createdAt,
      isSystem: false,
      meta: message.meta,
    };
  }

  // ─────────────────────────────────────────────
  // 4. 强制撤回（不受2分钟限制）
  // ─────────────────────────────────────────────
  async forceRecallMessage(messageId: string) {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');

    await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        isRecalled: true,
        content: '[Message Recalled by Support]',
        meta: {},
      },
    });

    this.logger.warn(`Admin force-recalled message ${messageId}`);

    // 🔔 推送撤回事件到会话房间
    this.eventsGateway.dispatch(message.conversationId, 'message_recalled', {
      conversationId: message.conversationId,
      messageId: message.id,
      tip: 'Message recalled by support',
      isSelf: false,
      operatorId: null,
      seqId: message.seqId,
    });

    return { success: true, messageId };
  }

  // ─────────────────────────────────────────────
  // 5. 关闭/归档会话
  // ─────────────────────────────────────────────
  async closeConversation(
    conversationId: string,
    dto: CloseConversationDto,
    adminName: string,
  ) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    const reason = dto.reason ?? 'Closed by support agent';
    const messageId = uuidv4();

    let closedSeqId = 0;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          status: CONV_STATUS.CLOSED,
          // 释放归属：否则关掉的会话会一直挂在客服的「我的」列表里
          handlerId: null,
          handlerAssignedAt: null,
          lastMsgSeqId: { increment: 1 },
          lastMsgContent: `[System]: ${reason}`,
          lastMsgType: MSG_TYPE_SYSTEM,
          lastMsgTime: new Date(),
        },
        select: { lastMsgSeqId: true },
      });
      closedSeqId = updated.lastMsgSeqId;

      await tx.chatMessage.create({
        data: {
          id: messageId,
          conversationId,
          senderId: null,
          content: reason,
          type: MSG_TYPE_SYSTEM,
          seqId: updated.lastMsgSeqId,
          meta: { closedBy: adminName, isClose: true },
        },
      });
    });

    this.logger.log(
      `Admin [${adminName}] closed conversation ${conversationId}`,
    );

    // 🔔 推送关闭系统消息到会话房间
    this.eventsGateway.dispatch(conversationId, 'chat_message', {
      id: messageId,
      conversationId,
      senderId: null,
      content: reason,
      type: MSG_TYPE_SYSTEM,
      createdAt: Date.now(),
      seqId: closedSeqId,
      isSystem: true,
      isSelf: false,
      isRecalled: false,
      meta: { closedBy: adminName, isClose: true },
      sender: null,
    });

    return { success: true, conversationId };
  }

  /** 切换 AI/人工模式 */
  async switchHandler(conversationId: string, mode: 'ai' | 'human') {
    const data =
      mode === 'ai'
        ? {
            handlerId: null as string | null,
            handlerAssignedAt: null as Date | null,
          }
        : {
            handlerId: 'awaiting_human' as string | null,
            handlerAssignedAt: new Date(),
          };

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data,
    });

    this.logger.log(
      `[Admin] Switched conversation ${conversationId} to ${mode} mode`,
    );
    return { success: true, mode };
  }

  // ─────────────────────────────────────────────
  // 6. Admin 上传 Token（图片/文件消息前先获取签名 URL）
  // ─────────────────────────────────────────────
  async getUploadToken(adminId: string, dto: AdminUploadTokenDto) {
    return this.uploadService.generatePresignedUrl(
      adminId,
      dto.fileName,
      dto.fileType,
      'chat',
    );
  }
}
