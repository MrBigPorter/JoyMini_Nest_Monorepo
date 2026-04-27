import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  KickMemberDto,
  MuteMemberDto,
  SetAdminDto,
  TransferOwnerDto,
  UpdateGroupInfoDto,
} from '@api/common/chat/dto/group/group-manage.dto';
import {
  CHAT_GROUP_EVENTS,
  GroupInfoUpdatedEvent,
  GroupMemberKickedEvent,
  GroupMemberMutedEvent,
  GroupOwnerTransferredEvent,
  GroupMemberRoleUpdatedEvent,
  GroupDisbandedEvent,
  GroupMemberLeftEvent,
  GroupApplyResultEvent,
  GroupRequestHandledEvent,
  GroupApplyNewEvent,
} from '@api/common/chat/events/chat-group.events';
import {
  ChatMemberRole,
  CONVERSATION_TYPE,
  ConversationStatus,
  GroupJoinRequestStatus,
} from '@lucky/shared';
import {
  CHAT_EVENTS,
  MessageCreatedEvent,
} from '@api/common/chat/events/chat.events';

@Injectable()
export class ChatGroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // =================================================================
  //   Helper: Permission Guard
  // =================================================================
  private async _checkPermission(
    operatorId: string,
    conversationId: string,
    requiredRoles: ChatMemberRole[],
  ) {
    const member = await this.prisma.chatMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: operatorId } },
      select: { role: true, user: { select: { nickname: true } } },
    });

    if (!member) throw new ForbiddenException('You are not a member');
    // 强制类型转换，确保是枚举
    const role = member.role as ChatMemberRole;
    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException('Permission denied');
    }
    return member;
  }

  // =================================================================
  //  Action 1: Kick Member (踢人)
  // =================================================================
  async kickMember(operatorId: string, dto: KickMemberDto) {
    const operator = await this._checkPermission(
      operatorId,
      dto.conversationId,
      [ChatMemberRole.OWNER, ChatMemberRole.ADMIN],
    );

    //  [Standard] 统一变量名逻辑: targetUserId -> targetId
    const targetId = dto.targetUserId;

    if (operatorId === targetId)
      throw new BadRequestException('Cannot kick yourself');

    const target = await this.prisma.chatMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: dto.conversationId,
          userId: targetId,
        },
      },
      include: { user: { select: { nickname: true } } },
    });

    if (!target) throw new NotFoundException('Member not found');
    if (target.role === ChatMemberRole.OWNER)
      throw new ForbiddenException('Cannot kick owner');

    // 只有群主能踢管理员，管理员不能踢管理员
    if (
      operator.role === ChatMemberRole.ADMIN &&
      target.role === ChatMemberRole.ADMIN
    ) {
      throw new ForbiddenException('Admin cannot kick admin');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.chatMember.delete({
        where: {
          conversationId_userId: {
            conversationId: dto.conversationId,
            userId: targetId,
          },
        },
      });
      await this._createSystemMessage(
        tx,
        dto.conversationId,
        `${target.user.nickname} was removed from the group`,
      );
    });

    this.eventEmitter.emit(
      CHAT_GROUP_EVENTS.MEMBER_KICKED,
      new GroupMemberKickedEvent(
        dto.conversationId,
        operatorId,
        targetId,
        Date.now(),
      ), // targetId 对应构造函数
    );

    return { success: true, kickedUserId: targetId };
  }

  // =================================================================
  //  Action 2: Mute Member (禁言/解除禁言)
  // =================================================================
  async muteMember(operatorId: string, dto: MuteMemberDto) {
    await this._checkPermission(operatorId, dto.conversationId, [
      ChatMemberRole.OWNER,
      ChatMemberRole.ADMIN,
    ]);

    // duration > 0 是禁言，= 0 是解除禁言 (mutedUntil = null)
    const mutedUntil =
      dto.duration > 0 ? new Date(Date.now() + dto.duration * 1000) : null;

    const member = await this.prisma.chatMember.update({
      where: {
        conversationId_userId: {
          conversationId: dto.conversationId,
          userId: dto.targetUserId,
        },
      },
      data: { mutedUntil },
    });

    const mutedUntilTimestamp = member.mutedUntil
      ? member.mutedUntil.getTime()
      : null;

    this.eventEmitter.emit(
      CHAT_GROUP_EVENTS.MEMBER_MUTED,
      new GroupMemberMutedEvent(
        dto.conversationId,
        operatorId,
        dto.targetUserId,
        mutedUntilTimestamp,
      ), // 统一 targetId
    );

    return { success: true, mutedUntil: mutedUntilTimestamp };
  }

  // =================================================================
  //  Action 3: Set Admin (升降职)
  // =================================================================
  async setAdmin(operatorId: string, dto: SetAdminDto) {
    await this._checkPermission(operatorId, dto.conversationId, [
      ChatMemberRole.OWNER,
    ]);

    //  [Fix] 防止对群主操作 (虽然群主操作自己也没意义，但加上更安全)
    const targetMember = await this.prisma.chatMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: dto.conversationId,
          userId: dto.targetUserId,
        },
      },
    });
    if (!targetMember) throw new NotFoundException('Target member not found');
    if (targetMember.role === ChatMemberRole.OWNER) {
      throw new ForbiddenException('Cannot change role of the Owner');
    }

    const targetRole = dto.isAdmin
      ? ChatMemberRole.ADMIN
      : ChatMemberRole.MEMBER;

    await this.prisma.chatMember.update({
      where: {
        conversationId_userId: {
          conversationId: dto.conversationId,
          userId: dto.targetUserId,
        },
      },
      data: { role: targetRole },
    });

    const sysMsg = dto.isAdmin ? 'appointed as Admin' : 'removed from Admin';
    await this._createSystemMessage(
      this.prisma,
      dto.conversationId,
      `Member role updated: ${sysMsg}`,
    );

    this.eventEmitter.emit(
      CHAT_GROUP_EVENTS.MEMBER_ROLE_UPDATED,
      new GroupMemberRoleUpdatedEvent(
        dto.conversationId,
        operatorId,
        dto.targetUserId,
        targetRole,
      ),
    );

    return { success: true, role: targetRole };
  }

  // =================================================================
  //  Action 4: Transfer Owner (转让群主)
  // =================================================================
  async transferOwner(operatorId: string, dto: TransferOwnerDto) {
    await this._checkPermission(operatorId, dto.conversationId, [
      ChatMemberRole.OWNER,
    ]);

    //  [Fix] 必须先检查新群主是否在群里
    const newOwner = await this.prisma.chatMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: dto.conversationId,
          userId: dto.newOwnerId,
        },
      },
    });
    if (!newOwner)
      throw new NotFoundException('New owner must be a group member');

    await this.prisma.$transaction(async (tx) => {
      // 1. Old owner -> Member
      await tx.chatMember.update({
        where: {
          conversationId_userId: {
            conversationId: dto.conversationId,
            userId: operatorId,
          },
        },
        data: { role: ChatMemberRole.MEMBER },
      });

      // 2. New owner -> Owner
      await tx.chatMember.update({
        where: {
          conversationId_userId: {
            conversationId: dto.conversationId,
            userId: dto.newOwnerId,
          },
        },
        data: { role: ChatMemberRole.OWNER },
      });

      // 3. Update Conversation Owner
      await tx.conversation.update({
        where: { id: dto.conversationId },
        data: { ownerId: dto.newOwnerId },
      });

      await this._createSystemMessage(
        tx,
        dto.conversationId,
        'Group ownership transferred',
      );
    });

    this.eventEmitter.emit(
      CHAT_GROUP_EVENTS.OWNER_TRANSFERRED,
      new GroupOwnerTransferredEvent(
        dto.conversationId,
        operatorId,
        dto.newOwnerId, // targetId
      ),
    );

    return { success: true };
  }

  // =================================================================
  //  Action 5: Update Info (改名/公告/全员禁言)
  // =================================================================
  async updateGroupInfo(operatorId: string, dto: UpdateGroupInfoDto) {
    await this._checkPermission(operatorId, dto.conversationId, [
      ChatMemberRole.OWNER,
      ChatMemberRole.ADMIN,
    ]);

    //  [Standard] 精确构建 update 对象，防止 undefined 污染
    const dataToUpdate: any = {};
    const updatesForEvent: any = {}; // 专门用于 Event 的 Payload

    if (dto.name !== undefined && dto.name !== null) {
      dataToUpdate.name = dto.name;
      updatesForEvent.name = dto.name;
    }

    if (dto.avatar !== undefined) {
      dataToUpdate.avatar = dto.avatar;
      updatesForEvent.avatar = dto.avatar;
    }

    if (dto.announcement !== undefined && dto.announcement !== null) {
      dataToUpdate.announcement = dto.announcement;
      dataToUpdate.announcementAt = new Date();
      updatesForEvent.announcement = dto.announcement;
    }

    if (dto.isMuteAll !== undefined && dto.isMuteAll !== null) {
      dataToUpdate.isMuteAll = dto.isMuteAll;
      updatesForEvent.isMuteAll = dto.isMuteAll;
    }

    if (dto.joinNeedApproval !== undefined) {
      dataToUpdate.joinNeedApproval = dto.joinNeedApproval;
      updatesForEvent.joinNeedApproval = dto.joinNeedApproval;
    }

    // 如果没有实质性修改，直接返回
    if (Object.keys(dataToUpdate).length === 0) {
      const currentGroup = await this.prisma.conversation.findUnique({
        where: { id: dto.conversationId },
      });

      if (!currentGroup) throw new NotFoundException('Group not found');

      return {
        id: currentGroup.id,
        name: currentGroup.name ?? 'Group',
        avatar: currentGroup.avatar,
        announcement: currentGroup.announcement ?? undefined,
        isMuteAll: currentGroup.isMuteAll,
      };
    }

    const group = await this.prisma.conversation.update({
      where: { id: dto.conversationId },
      data: dataToUpdate,
    });

    // 3. 关键修正：生成系统消息 (让列表页感知)
    // 只要改名，就发一条 type 99 的系统消息
    if (dto.name) {
      await this._createSystemMessage(
        this.prisma,
        dto.conversationId,
        `Group name updated to "${dto.name}"`,
        {
          action: 'UPDATE_INFO',
          updates: { name: dto.name },
        },
      );
    }

    // 系统消息 (仅针对公告变更，全员禁言可以不发系统消息，或者单独发)
    if (dto.announcement) {
      await this._createSystemMessage(
        this.prisma,
        dto.conversationId,
        `Announcement updated: ${dto.announcement}`,
        {
          action: 'UPDATE_INFO',
          updates: { name: dto.name },
        },
      );
    }

    this.eventEmitter.emit(
      CHAT_GROUP_EVENTS.INFO_UPDATED,
      new GroupInfoUpdatedEvent(
        dto.conversationId,
        operatorId,
        updatesForEvent, //  [Fix] 只传修改了的字段
      ),
    );

    return {
      id: group.id,
      name: group.name ?? 'Group',
      avatar: group.avatar,
      announcement: group.announcement ?? undefined,
      isMuteAll: group.isMuteAll,
    };
  }

  // =================================================================
  //  Action 6: Disband Group (解散群)
  // =================================================================
  async disbandGroup(operatorId: string, conversationId: string) {
    await this._checkPermission(operatorId, conversationId, [
      ChatMemberRole.OWNER,
    ]);

    // 软删除: status = 0 (或者根据业务需求做物理删除)
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 0 },
    });

    this.eventEmitter.emit(
      CHAT_GROUP_EVENTS.GROUP_DISBANDED,
      new GroupDisbandedEvent(conversationId, operatorId, Date.now()),
    );

    return { success: true };
  }

  // =================================================================
  //  Action 7: Leave Group (主动退群)
  // =================================================================
  async leaveGroup(userId: string, conversationId: string) {
    const member = await this.prisma.chatMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      include: { user: { select: { nickname: true } } }, // 获取昵称用于发消息
    });
    if (!member) throw new NotFoundException('Not a member');

    if (member.role === ChatMemberRole.OWNER) {
      throw new ForbiddenException(
        'Owner cannot leave group directly. Transfer ownership or disband group first.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.chatMember.delete({
        where: { conversationId_userId: { conversationId, userId } },
      });

      //  [Fix] 增加一条退群灰条消息，让群里人知道
      await this._createSystemMessage(
        tx,
        conversationId,
        `${member.user.nickname} left the group`,
      );
    });

    this.eventEmitter.emit(
      CHAT_GROUP_EVENTS.MEMBER_LEFT,
      new GroupMemberLeftEvent(conversationId, userId, Date.now()),
    );

    return { success: true };
  }

  // =================================================================
  //  Action 8: Apply to Join Group (申请加群)
  // =================================================================
  async applyToGroup(userId: string, groupId: string, reason?: string) {
    // 1. 检查群是否存在且未解散
    const group = await this.prisma.conversation.findUnique({
      where: { id: groupId, status: 1 },
      select: { joinNeedApproval: true, name: true, type: true },
    });

    if (!group) throw new NotFoundException('Group not found or disbanded');
    if (group.type !== 'GROUP') throw new BadRequestException('Not a group');

    // 2. 检查用户是否已经是成员
    const isMember = await this.prisma.chatMember.count({
      where: { conversationId: groupId, userId },
    });
    if (isMember > 0) {
      throw new BadRequestException('Already a member');
    }

    // 3. 逻辑分支：若群未开启审批，则直接加入
    if (!group.joinNeedApproval) {
      await this.prisma.chatMember.create({
        data: { conversationId: groupId, userId, role: ChatMemberRole.MEMBER },
      });
      return {
        status: 'ACCEPTED',
        message: 'Joined directly',
      };
    }

    // 4. 防重校验：是否已有 Pending 申请
    const existingApplication = await this.prisma.groupJoinRequest.findFirst({
      where: {
        groupId,
        applicantId: userId,
        status: GroupJoinRequestStatus.PENDING,
      },
    });
    if (existingApplication)
      throw new BadRequestException('Application already pending');

    // 5. 创建申请记录
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true, avatar: true },
    });
    const request = await this.prisma.groupJoinRequest.create({
      data: {
        groupId,
        applicantId: userId,
        reason: reason || '',
        status: GroupJoinRequestStatus.PENDING,
      },
    });

    // 6.  异步通知管理员
    void this._notifyAdminsOfNewRequest(
      groupId,
      userId,
      user?.nickname || 'Unknown',
      user?.avatar || null,
      reason || '',
    );

    return {
      status: 'PENDING',
      requestId: request.id,
      message: 'Application submitted, pending approval',
    };
  }

  // =================================================================
  //  Action 9: Get Join Requests (管理员查看申请列表)
  // =================================================================
  async getJoinRequests(operatorId: string, groupId: string) {
    await this._checkPermission(operatorId, groupId, [
      ChatMemberRole.OWNER,
      ChatMemberRole.ADMIN,
    ]);

    return this.prisma.groupJoinRequest.findMany({
      where: { groupId },
      include: {
        applicant: { select: { id: true, nickname: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // =================================================================
  //  Action 10: Handle Join Request (审批处理)
  // =================================================================
  async handleJoinRequest(
    operatorId: string,
    requestId: string,
    action: 'accept' | 'reject',
  ) {
    const operator = await this.prisma.user.findUnique({
      where: { id: operatorId },
      select: { nickname: true },
    });

    return this.prisma.$transaction(async (tx) => {
      // 1. 获取申请记录并加锁 (防止并发操作)
      const request = await tx.groupJoinRequest.findUnique({
        where: { id: requestId },
        include: { conversation: { select: { name: true, id: true } } },
      });

      if (!request) throw new NotFoundException('Request not found');
      if (request.status !== GroupJoinRequestStatus.PENDING)
        throw new BadRequestException('Request already processed');

      // 2. 权限检查
      await this._checkPermission(operatorId, request.groupId, [
        ChatMemberRole.OWNER,
        ChatMemberRole.ADMIN,
      ]);

      const newStatus =
        action === 'accept'
          ? GroupJoinRequestStatus.ACCEPTED
          : GroupJoinRequestStatus.REJECTED;

      //  3. [关键步骤] 解决唯一约束冲突：先删除旧的已通过/已拒绝记录
      // 如果不先删掉旧的 status=1 的记录，下面的 update 会触发 Unique 约束报错
      if (action === 'accept') {
        await tx.groupJoinRequest.deleteMany({
          where: {
            groupId: request.groupId,
            applicantId: request.applicantId,
            status: {
              in: [
                GroupJoinRequestStatus.REJECTED,
                GroupJoinRequestStatus.ACCEPTED,
              ],
            },
            // 不要把处理的这条 requestId 删了
            id: { not: requestId },
          },
        });
      }

      //  4. 更新当前记录状态 (必须执行，否则该申请永远是 PENDING)
      await tx.groupJoinRequest.update({
        where: { id: requestId },
        data: {
          status: newStatus,
          handlerId: operatorId,
        },
      });

      // 5. 如果通过，执行加人逻辑
      if (action === 'accept') {
        // 使用 upsert 防止重复加入 ChatMember 导致的 500 错误
        await tx.chatMember.upsert({
          where: {
            conversationId_userId: {
              conversationId: request.groupId,
              userId: request.applicantId,
            },
          },
          update: { role: ChatMemberRole.MEMBER }, // 如果曾经是成员，重置角色
          create: {
            conversationId: request.groupId,
            userId: request.applicantId,
            role: ChatMemberRole.MEMBER,
          },
        });

        const applicant = await tx.user.findUnique({
          where: { id: request.applicantId },
          select: { nickname: true },
        });

        await this._createSystemMessage(
          tx,
          request.groupId,
          `${applicant?.nickname || 'New member'} joined the group`,
        );
      }

      this.eventEmitter.emit(
        CHAT_GROUP_EVENTS.APPLY_RESULT,
        new GroupApplyResultEvent(
          request.groupId,
          request.applicantId,
          request.conversation.name ?? 'Group',
          action === 'accept',
          Date.now(),
        ),
      );

      const admins = await tx.chatMember.findMany({
        where: {
          conversationId: request.groupId,
          role: { in: [ChatMemberRole.OWNER, ChatMemberRole.ADMIN] },
        },
        select: { userId: true },
      });

      this.eventEmitter.emit(
        CHAT_GROUP_EVENTS.REQUEST_HANDLED,
        new GroupRequestHandledEvent(
          requestId,
          request.groupId,
          newStatus,
          operatorId,
          operator?.nickname || 'Admin',
          Date.now(),
          admins.map((a) => a.userId),
        ),
      );

      return { success: true, status: newStatus };
    });
  }

  /**
   * Action 11: Search Groups (搜索群聊)
   * @param userId
   * @param keyword
   */
  async searchGroups(userId: string, keyword: string) {
    // 1. 查找符合条件的群组 (ID 精确匹配 或 Name 模糊匹配)
    const groups = await this.prisma.conversation.findMany({
      where: {
        type: CONVERSATION_TYPE.GROUP,
        status: ConversationStatus.NORMAL,
        OR: [
          { id: keyword }, // ID 精确匹配
          { name: { contains: keyword, mode: 'insensitive' } }, // Name 模糊匹配
        ],
      },
      take: 20, // 限制返回数量，防止过载
      select: {
        id: true,
        name: true,
        avatar: true,
        joinNeedApproval: true,
        //  核心修改：请求 Prisma 实时统计 members 关联表的数量
        _count: {
          select: { members: true },
        },
      },
    });
    // 2. 检查当前用户是否在这些群里
    const groupIds = groups.map((g) => g.id);
    const memberships = await this.prisma.chatMember.findMany({
      where: {
        conversationId: { in: groupIds },
        userId,
      },
      select: { conversationId: true },
    });
    const joinedSet = new Set(memberships.map((m) => m.conversationId));

    // 3. 组装返回数据
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      avatar: g.avatar,
      memberCount: g._count.members, // 直接使用 Prisma 统计结果
      joinNeedApproval: g.joinNeedApproval,
      isMember: joinedSet.has(g.id),
    }));
  }

  // =================================================================
  //  Private Helpers
  // =================================================================

  private async _notifyAdminsOfNewRequest(
    groupId: string,
    applicantId: string,
    nickname: string,
    avatar: string | null,
    reason: string,
  ) {
    const admins = await this.prisma.chatMember.findMany({
      where: {
        conversationId: groupId,
        role: { in: [ChatMemberRole.OWNER, ChatMemberRole.ADMIN] },
      },
      select: { userId: true },
    });

    this.eventEmitter.emit(
      CHAT_GROUP_EVENTS.APPLY_NEW,
      new GroupApplyNewEvent(
        groupId,
        applicantId,
        nickname,
        avatar,
        reason,
        Date.now(),
        admins.map((a) => a.userId),
      ),
    );
  }

  private async _createSystemMessage(
    tx: any,
    conversationId: string,
    content: string,
    meta: Record<string, any> = {},
  ) {
    const LARGE_GROUP_LIMIT = 500;
    const memberCount = await tx.chatMember.count({
      where: { conversationId },
    });

    const conv = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        lastMsgSeqId: { increment: 1 },
        lastMsgContent: content,
        lastMsgType: 99,
        lastMsgTime: new Date(),
      },
      select: { lastMsgSeqId: true },
    });

    const message = await tx.chatMessage.create({
      data: {
        conversationId,
        senderId: null,
        type: 99,
        content,
        seqId: conv.lastMsgSeqId,
        meta,
      },
    });

    let memberIds: string[] = [];
    if (memberCount <= LARGE_GROUP_LIMIT) {
      const members = await tx.chatMember.findMany({
        where: { conversationId },
        select: { userId: true },
      });
      memberIds = members.map((m: { userId: any }) => m.userId);
    }

    this.eventEmitter.emit(
      CHAT_EVENTS.MESSAGE_CREATED,
      new MessageCreatedEvent(
        message.id,
        conversationId,
        content,
        99,
        '',
        'System',
        '',
        message.createdAt.getTime(),
        memberIds,
        message.seqId,
        meta,
      ),
    );

    return message;
  }
}
