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
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CHAT_EVENTS,
  SupportQueueChangedEvent,
} from '@api/common/chat/events/chat.events';
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
import { HandoffLifecycleService } from '@api/common/chat/handoff/handoff-lifecycle.service';
import { deriveHandoffState } from '@api/common/chat/handoff/handoff-state';

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
    private readonly eventEmitter: EventEmitter2,
    private readonly handoffLifecycleService: HandoffLifecycleService,
  ) {}

  /**
   * 广播队列变化：交给 SocketListener 扇出给所有在线客服。
   * 这里不直接遍历 admin，避免业务层关心「谁在线」。
   */
  private notifyQueueChanged(
    conversationId: string,
    reason: string,
    handlerId: string | null,
  ): void {
    this.eventEmitter.emit(
      CHAT_EVENTS.SUPPORT_QUEUE_CHANGED,
      new SupportQueueChangedEvent(conversationId, reason, handlerId),
    );
  }

  /**
   * 人工回复/手动切回 AI 后，离线留言视为已处理。
   *
   * 不新增表：只把 aiMetadata.handoffCallback.status 从 pending 改成 handled。
   * WHERE 里再带一次 pending 条件，重复回复不会反复写。
   */
  private async markHandoffCallbackHandled(
    conversationId: string,
    raw: Prisma.JsonValue | null,
  ): Promise<void> {
    const merged = mergeHandoffCallbackHandled(raw);
    if (!merged) return;

    await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        aiMetadata: {
          path: ['handoffCallback', 'status'],
          equals: 'pending',
        },
      },
      data: { aiMetadata: merged as Prisma.InputJsonValue },
    });
  }

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
    } else if (queue === 'callback') {
      // 离线留言：无人在线时 AI 继续服务，只记 aiMetadata.handoffCallback。
      // 不新增表，直接用 JSON 条件筛 pending。
      where.aiMetadata = {
        path: ['handoffCallback', 'status'],
        equals: 'pending',
      };
      if (status === undefined) where.status = CONV_STATUS.NORMAL;
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
        ? // 排队先后看 transferredAt（转人工那一刻），不是 handlerAssignedAt ——
          // handlerAssignedAt 现在表示最后一次人工侧活动，用户消息不再刷新
          { transferredAt: { sort: 'asc', nulls: 'last' } }
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

    // handlerId 是 admin_users.id，但 Conversation 没有到 AdminUser 的关系，
    // 这里一次性批量取名字，避免列表 N+1；排队哨兵不查。
    const handlerIds = Array.from(
      new Set(
        list
          .map((c) => c.handlerId)
          .filter((id): id is string => id != null && id !== AWAITING_HUMAN),
      ),
    );
    const handlerNames = new Map<string, string>();
    if (handlerIds.length > 0) {
      const admins = await this.prisma.adminUser.findMany({
        where: { id: { in: handlerIds } },
        select: { id: true, username: true, realName: true },
      });
      for (const admin of admins) {
        handlerNames.set(admin.id, admin.realName?.trim() || admin.username);
      }
    }

    const now = Date.now();

    return {
      list: list.map((c) => {
        const autoReturnAt =
          this.handoffLifecycleService.getAutoReturnAt(c) ?? null;
        return {
          id: c.id,
          type: c.type,
          name: c.name,
          status: c.status,
          handlerId: c.handlerId,
          handlerName: c.handlerId
            ? (handlerNames.get(c.handlerId) ?? null)
            : null,
          handoffState: deriveHandoffState(c),
          autoReturnAt: autoReturnAt?.getTime() ?? null,
          transferReason: c.transferReason,
          waitingSeconds: (() => {
            const since = c.transferredAt ?? c.handlerAssignedAt;
            return since
              ? Math.max(0, Math.floor((now - since.getTime()) / 1000))
              : null;
          })(),
          lastMsgContent: c.lastMsgContent,
          lastMsgTime: c.lastMsgTime?.getTime() ?? 0,
          trafficSource:
            (c.aiMetadata as Record<string, unknown> | null)?.trafficSource ??
            null,
          lastMsgSeqId: c.lastMsgSeqId,
          memberCount: c.members.length,
          members: c.members.map((m) => ({
            userId: m.userId,
            nickname: m.user?.nickname ?? null,
            avatar: m.user?.avatar ?? null,
            role: m.role,
          })),
        };
      }),
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

    this.notifyQueueChanged(conversationId, 'claimed', result.handlerId);

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
        role: m.role,
        source: m.source,
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

    // 判空永远在第一行：会话不存在时，下面任何 conv.handlerId 都会 TypeError（500）
    if (!conv) throw new NotFoundException('Conversation not found');

    // ── 回复即接管（T2-5 / S2-B）──────────────────────────────
    // 排队中   → CAS 认领；撞车就 409，这条消息不发（让客服先看见"被接了"）
    // AI 处理中 → 直接接管；否则 AI 下一条还会插话
    // 别人的会话 → 帮答，不改归属（团队可以互相顶班）
    let claimedNow = false;

    if (conv.handlerId === AWAITING_HUMAN) {
      const result = await this.supportHandlerService.claim(
        conversationId,
        adminId,
      );
      if (result.status !== 'claimed') {
        throw new ConflictException(
          'Conversation has already been claimed by another agent',
        );
      }
      claimedNow = true;
    } else if (conv.handlerId === null) {
      // 用条件更新而不是 update：两个客服同时回复 AI 会话时只有一个人抢到
      const taken = await this.prisma.conversation.updateMany({
        where: { id: conversationId, handlerId: null },
        data: {
          handlerId: adminId,
          handlerAssignedAt: new Date(),
        },
      });
      claimedNow = taken.count === 1; // 只有抢到的那个人才算接管成功
    }

    const botMember = conv.members.find((m) => m.user?.isRobot);
    if (!botMember) {
      throw new NotFoundException('Support bot member not found');
    }

    const agentLabel = dto.agentName ?? adminName ?? 'Support';
    const msgType = dto.type ?? MSG_TYPE_TEXT;
    const message = await this.chatService.sendMessage(
      botMember.userId,
      {
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
      },
      // 客服后台回复必须落 human_agent：sendMessage 的默认值是 user，
      // 不显式传的话洞察页“人工消息”恒为 0（#118 P1-4）。
      { source: 'human_agent' },
    );

    // 客服回复 = 最后一次人工侧活动，刷新空闲回收计时。
    // 条件里带 handlerId：帮答别人名下的会话不能延长别人的计时。
    await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        handlerId: adminId,
        status: CONV_STATUS.NORMAL,
      },
      data: { handlerAssignedAt: new Date() },
    });

    // 离线留言被人工回复后，callback 队列里不应再显示。
    await this.markHandoffCallbackHandled(conversationId, conv.aiMetadata);

    // 首次人工回复时间：只写一次。
    // 用 updateMany + where null 而不是 update —— 帮答场景下两个人几乎同时回复，
    // 第二次不能把"首次"冲成"最后一次"。
    await this.prisma.conversation.updateMany({
      where: { id: conversationId, firstResponseAt: null },
      data: { firstResponseAt: new Date() },
    });

    this.logger.log(
      `Admin [${adminName}] replied to conversation ${conversationId} via bot ${botMember.userId} (type=${msgType})`,
    );

    // 抢到归属 → 其他客服的待接入列表要立即移除这条
    if (claimedNow) {
      this.notifyQueueChanged(conversationId, 'claimed', adminId);
    }

    return {
      id: message.id,
      seqId: message.seqId,
      content: message.content,
      createdAt: message.createdAt,
      isSystem: false,
      meta: message.meta,
      // 前端据此把会话从「待接入」挪到「我的」，并提示是否抢到
      claimedNow,
      handlerId: claimedNow ? adminId : conv.handlerId,
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

    // 关闭 = 离开队列 / 离开「我的」，两种情况都要让客服列表立刻更新
    this.notifyQueueChanged(conversationId, 'closed', null);

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

  /**
   * 切换 AI/人工模式。
   *
   * - 切回 AI：交给 HandoffLifecycleService.returnToAi('admin_return')，
   *   由它 CAS + 写审计/系统消息 + 广播；权限由 controller 的 @Roles 保证。
   * - 切人工：只允许从 AI_ACTIVE（handlerId=null）进入排队；
   *   已有客服（或已在排队）时 no-op，不能把别人的会话抢走。
   */
  async switchHandler(
    conversationId: string,
    mode: 'ai' | 'human',
    actor = 'admin',
  ) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        handlerId: true,
        status: true,
        aiMetadata: true,
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    if (mode === 'ai') {
      // 先清 callback，再让生命周期服务读取最新 aiMetadata，
      // 避免后写的 callback 合并覆盖 handoffResetPending / handoffHistory。
      await this.markHandoffCallbackHandled(conversationId, conv.aiMetadata);

      const changed = await this.handoffLifecycleService.returnToAi(
        conversationId,
        'admin_return',
        { actor },
      );

      this.logger.log(
        `[Admin] Switched conversation ${conversationId} to AI mode (actor=${actor}, changed=${changed})`,
      );
      return { success: true, mode, changed };
    }

    // 已经有人接管 / 已在排队：no-op，绝不覆盖现有客服。
    if (conv.handlerId != null) {
      return { success: true, mode, changed: false };
    }

    // 只在 handlerId 仍为 null 时写入排队哨兵（CAS），避免与认领竞态。
    const result = await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        handlerId: null,
        status: CONV_STATUS.NORMAL,
      },
      data: {
        handlerId: AWAITING_HUMAN,
        handlerAssignedAt: new Date(),
        // 手工切人工也是「排队」，同样要写排队起点
        transferredAt: new Date(),
        transferReason: 'manual_switch',
      },
    });

    if (result.count === 0) {
      // 会话在这期间被关闭/认领，按 no-op 处理
      return { success: true, mode, changed: false };
    }

    this.logger.log(
      `[Admin] Switched conversation ${conversationId} to human mode (actor=${actor})`,
    );
    this.notifyQueueChanged(conversationId, 'manual_switch', AWAITING_HUMAN);

    return { success: true, mode, changed: true };
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

/**
 * 把 pending 的离线 callback 合并为 handled。
 *
 * 保留 aiMetadata 里的其他字段（trafficSource / handoffHistory 等）；
 * 已经是 handled 或没有 callback 时返回 null，调用方跳过写库。
 */
function mergeHandoffCallbackHandled(
  raw: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const base = raw as Record<string, unknown>;
  const callback = base.handoffCallback;
  if (!callback || typeof callback !== 'object' || Array.isArray(callback)) {
    return null;
  }

  const callbackRecord = callback as Record<string, unknown>;
  if (callbackRecord.status !== 'pending') return null;

  return {
    ...base,
    handoffCallback: {
      ...callbackRecord,
      status: 'handled',
      handledAt: new Date().toISOString(),
    },
  };
}
