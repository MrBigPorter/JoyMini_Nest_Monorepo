---
title: "IM 聊天 & 联系人/群组架构——消息引擎 + 会话管理 + 群组权限 + 好友关系全链路"
slug: "im-chat-contact-group-architecture"
date: "2026-05-04"
description: "深度解析客户端 IM 即时通讯系统：从 Message Meta-First Engine、SeqId 游标分页、EventEmitter² 事件解耦，到群组管理（踢人/禁言/升降职/转让/解散）、好友关系（申请/处理/搜索状态机）、群组申请审批工作流，以及 WebRTC ICE Server 动态凭证生成，覆盖 900+ 行 ChatService 全量源码"
tags: ["NestJS", "IM", "Prisma", "WebSocket", "chat", "contact", "group", "WebRTC", "event-driven"]
---

# IM 聊天 & 联系人/群组架构——消息引擎 + 会话管理 + 群组权限 + 好友关系全链路

## 1. 架构全景

客户端 IM（Instant Messaging）系统是 App 内用户间沟通的核心基础设施。本系统覆盖 **消息收发、会话管理、群组运维、联系人（好友）关系、群组申请审批** 五大领域，与 [`admin-next` 客服聊天系统](customer-service-live-chat.md) 共享底层 `ChatService` 消息引擎，但面向的是 **C 端用户**之间的社交通信。

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Client App (Flutter / Mobile)                                               │
│                                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Conversation  │  │ Chat Room    │  │ Contacts     │  │ Group Discovery  │ │
│  │ List          │  │ (Messages)   │  │ (Friends)    │  │ (Search & Join)  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘ │
│                           │ HTTP REST + WebSocket                            │
└──────────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  NestJS API (apps/api/src/)                                                   │
│                                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────────────┐ │
│  │  ChatController  │  │ ContactController│  │  ChatGroupController (v6.0) │ │
│  │  (12 endpoints)  │  │  (5 endpoints)   │  │  (11 endpoints)             │ │
│  └────────┬────────┘  └────────┬────────┘  └───────────┬──────────────────┘ │
│           │                    │                        │                    │
│           ▼                    ▼                        ▼                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  ChatService (968 lines)     ContactService (279 lines)              │   │
│  │  ChatGroupService (829 lines)                                        │   │
│  └────────────────────────────────┬─────────────────────────────────────┘   │
│                                   │ EventEmitter²                           │
│  ┌────────────────────────────────▼─────────────────────────────────────┐   │
│  │  ChatListener (Event→Socket) → EventsGateway → WebSocket Clients     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  AdminChatController → AdminChatService (客服后台集成)               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 核心模块一览

| 模块 | 核心文件 | 关键职责 |
|------|----------|----------|
| **ChatController** | [`chat.controller.ts`](apps/api/src/common/chat/chat.controller.ts) | 12 个客户端聊天 API 端点 |
| **ChatService** | [`chat.service.ts`](apps/api/src/common/chat/chat.service.ts:46) | 968 行消息引擎核心：发送/撤回/转发/删除/已读/历史 |
| **ContactController** | [`contact.controller.ts`](apps/api/src/common/contact/contact.controller.ts) | 5 个联系人 API 端点 |
| **ContactService** | [`contact.service.ts`](apps/api/src/common/contact/contact.service.ts:18) | 279 行好友关系逻辑：加好友/搜索/处理请求 |
| **ChatGroupController** | [`chat-group.controller.ts`](apps/api/src/common/chat/chat-group.controller.ts:46) | 11 个群组管理 API 端点 |
| **ChatGroupService** | [`chat-group.service.ts`](apps/api/src/common/chat/chat-group.service.ts:41) | 829 行群组运维：踢人/禁言/升降职/转让/申请审批 |
| **ChatListener** | [`chat.listener.ts`](apps/api/src/common/events/listeners/chat.listener.ts:8) | Event→Socket 解耦转发：11 种群组事件 |
| **Chat Events** | [`chat.events.ts`](apps/api/src/common/chat/events/chat.events.ts:1) | 4 种消息事件常量 + Payload 类 |
| **Group Events** | [`chat-group.events.ts`](apps/api/src/common/chat/events/chat-group.events.ts:6) | 11 种群组事件常量 + Payload 类 |
| **AdminChatService** | [`admin-chat.service.ts`](apps/api/src/admin/chat/admin-chat.service.ts:25) | 325 行客服后台集成：回复/强制撤回/关闭会话 |

### 1.2 与客服聊天系统的边界

D1 文章 [`customer-service-live-chat.md`](customer-service-live-chat.md) 聚焦于 **admin-next 后台客服** 与用户的交互场景，涉及 `AdminChatController` 的 6 个端点以及前端 `CustomerServiceDesk`、`ChatWindow`、`MessageBubble` 等组件。本文则聚焦 **C 端用户** 之间的即时通讯，涵盖 `ChatController`（12 端点）、`ContactController`（5 端点）和 `ChatGroupController`（11 端点）共 **28 个客户端 API**，以及底层的消息引擎、群组管理和联系人体系。两者共享 `ChatService` 中的 `sendMessage`/`recallMessage` 等核心方法。

---

## 2. 数据模型

IM 系统涉及以下 Prisma 核心模型：

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| **Conversation** | 会话（私聊/群聊/客服） | `type`(DIRECT/GROUP/SUPPORT), `status`, `lastMsgSeqId`, `lastMsgContent`, `lastMsgType`, `ownerId`, `announcement`, `isMuteAll`, `joinNeedApproval` |
| **ChatMember** | 会话成员 | `userId`, `conversationId`, `role`(OWNER/ADMIN/MEMBER), `lastReadSeqId`, `clearedSeqId`, `isMuted`, `isPinned`, `mutedUntil` |
| **ChatMessage** | 消息记录 | `seqId`, `senderId`, `type`(TEXT/IMAGE/AUDIO/VIDEO/FILE/LOCATION/RECALLED), `content`, `meta`(JSON), `conversationId` |
| **ChatMessageHide** | 消息软删除（用户级隐藏） | `userId`, `messageId` (复合唯一) |
| **Friend** | 好友关系（双向记录） | `userId`, `friendId`, `status`, `remark` |
| **FriendRequest** | 好友申请 | `fromUserId`, `toUserId`, `status`(PENDING/ACCEPTED/REJECTED), `reason` |
| **GroupJoinRequest** | 加群申请 | `groupId`, `applicantId`, `status`(PENDING/ACCEPTED/REJECTED), `reason`, `handlerId` |

### 2.1 SeqId — 消息序列号

`seqId` 是 IM 系统的核心设计之一。每次发送消息时，`Conversation.lastMsgSeqId` 原子递增，新消息的 `seqId` 即递增后的值：

```typescript
// chat.service.ts:104
const conv = await tx.conversation.update({
  where: { id: conversationId },
  data: {
    lastMsgSeqId: { increment: 1 },
    lastMsgContent: this._getPreviewText(type, content),
    lastMsgType: type,
    lastMsgTime: new Date(),
  },
  select: { lastMsgSeqId: true },
});
```

SeqId 的用途：
- **消息排序**：`seqId` 单调递增，天然有序
- **游标分页**：`getMessages` 以 `seqId` 为游标实现分页
- **未读数计算**：`unreadCount = conv.lastMsgSeqId - myMember.lastReadSeqId`
- **清空历史**：`clearedSeqId` 截断，`seqId <= clearedSeqId` 的消息被隐藏
- **已读同步**：`markAsRead` 更新 `lastReadSeqId`

---

## 3. 消息引擎核心操作

### 3.1 sendMessage — Meta-First Engine

[`sendMessage`](apps/api/src/common/chat/chat.service.ts:60) 是整个聊天系统的核心方法，采用 **Meta-First** 设计：消息发送时先处理 `meta` 元数据，不同类型携带不同的结构化信息。

```
┌─────────────────────────────────────────────────────────────────┐
│ sendMessage(userId, dto)                                         │
│                                                                   │
│  1. IDEMPOTENCY CHECK                                            │
│     └─ chatMessage.findUnique({ id })                             │
│        ├─ 已存在 + senderId 匹配 → 直接返回已有消息               │
│        └─ 不存在 → 继续                                          │
│                                                                   │
│  2. META SANITIZATION (按类型清洗 meta)                          │
│     ├─ IMAGE/VIDEO → meta.w, meta.h 保障                          │
│     ├─ AUDIO     → meta.duration                                  │
│     ├─ FILE      → meta.fileName, fileSize, fileExt              │
│     └─ LOCATION  → meta.latitude, longitude, address, title      │
│                                                                   │
│  3. $TRANSACTION (原子操作)                                       │
│     ├─ conversation.update(lastMsgSeqId+1, preview, type, time)  │
│     ├─ chatMessage.create(seqId = newSeqId)                      │
│     └─ chatMember.updateMany(lastReadSeqId = newSeqId)           │
│                                                                   │
│  4. MEMBER QUERY + EVENT EMIT                                     │
│     ├─ chatMember.findMany(成员列表 + isMuted)                    │
│     └─ eventEmitter.emit(MESSAGE_CREATED, payload)               │
│        → ChatListener → EventsGateway → WebSocket broadcast      │
└─────────────────────────────────────────────────────────────────┘
```

关键设计点：

**幂等性（Idempotency）**：消息 ID 由客户端使用 `uuidv4()` 生成。如果同一条消息因网络重试被再次发送，服务端在第一步 `findUnique` 时发现已存在，直接返回已有消息，避免重复创建。

```typescript
// chat.service.ts:63-74
const existingMessage = await this.prisma.chatMessage.findUnique({
  where: { id },
});
if (existingMessage) {
  if (existingMessage.senderId !== userId)
    throw new ForbiddenException('Message ID conflict');
  return { ...existingMessage, createdAt: ..., isSelf: true };
}
```

**Meta 按类型清洗**：不同类型消息的 `meta` 字段规范不同，在发送前进行结构化工清洗：

```typescript
// chat.service.ts:76-100
const finalMeta: Record<string, any> = dto.meta || {};
if (type === MESSAGE_TYPE.AUDIO && meta?.duration)
  finalMeta.duration = meta.duration;
if ((type === MESSAGE_TYPE.IMAGE || type === MESSAGE_TYPE.VIDEO) && meta?.w && meta?.h) {
  finalMeta.w = meta.w;
  finalMeta.h = meta.h;
}
// FILE / LOCATION 同理...
```

**预览文本生成**：`_getPreviewText` 按消息类型生成会话列表预览文本：

```typescript
// chat.service.ts:928-945
private _getPreviewText(type: number, content: string): string {
  switch (type) {
    case MESSAGE_TYPE.TEXT:     return content;
    case MESSAGE_TYPE.IMAGE:    return '[Image]';
    case MESSAGE_TYPE.AUDIO:    return '[Voice]';
    case MESSAGE_TYPE.VIDEO:    return '[Video]';
    case MESSAGE_TYPE.FILE:     return '[File]';
    case MESSAGE_TYPE.LOCATION: return '[Location]';
    default:                    return '[Unsupported]';
  }
}
```

**事件驱动的 Socket 推送**：发送完成后不直接调用 WebSocket，而是通过 `EventEmitter2` 发出 `CHAT_EVENTS.MESSAGE_CREATED` 事件，由 [`ChatListener`](apps/api/src/common/events/listeners/chat.listener.ts) 异步处理 Socket 广播。这样实现了消息持久化与实时推送的解耦。

### 3.2 forwardMessage — 复用发送引擎

[`forwardMessage`](apps/api/src/common/chat/chat.service.ts:190) 将一条消息转发到多个目标会话：

```typescript
async forwardMessage(userId: string, dto: ForwardMessageDto) {
  const originalMsg = await this.prisma.chatMessage.findUnique({
    where: { id: dto.originalMsgId },
  });
  if (!originalMsg) throw new NotFoundException('Original message not found');

  const results = [];
  for (const targetConvId of dto.targetConversationIds) {
    try {
      const newMessage = await this.sendMessage(userId, {
        id: uuidv4(),
        type: originalMsg.type,
        conversationId: targetConvId,
        content: originalMsg.content,
        meta: originalMsg.meta as Record<string, any>,
      });
      results.push({ conversationId: targetConvId, message: newMessage });
    } catch (error: unknown) { /* ... */ }
  }
  return results;
}
```

**设计要点**：
- **复用 `sendMessage`**：转发本质是重新发送，复用同一方法保证 Socket 推送、未读更新等逻辑一致性
- **透传 meta**：图片的宽高、文件的名称大小、位置的经纬度等元数据全部保留
- **错误隔离**：单个目标失败不影响其他目标

### 3.3 recallMessage — 2 分钟撤回窗口

[`recallMessage`](apps/api/src/common/chat/chat.service.ts:228) 实现消息撤回，采用严格的 **2 分钟窗口**：

```typescript
if (!TimeHelper.isWithinRange(message.createdAt, new Date(), 120000)) {
  throw new ForbiddenException('Recall window expired');
}
```

```
┌──────────────────────────────────────────────────────────┐
│ recallMessage(userId, messageId)                         │
│                                                           │
│  1. 验证：消息存在 + 发送者匹配 + 2分钟窗口内            │
│  2. $transaction：                                        │
│     ├─ chatMessage.update(content→'[Recalled]',           │
│     │                   type→RECALLED, meta→{})           │
│     └─ 若被撤回的是最后一条消息 → conversation 同步更新  │
│  3. eventEmitter.emit(MESSAGE_RECALLED)                   │
│     → ChatListener → Socket 广播                         │
└──────────────────────────────────────────────────────────┘
```

**最后一条同步**：如果被撤回的消息恰好是会话的最后一条，需要同步更新 `Conversation` 的 `lastMsgContent` 和 `lastMsgType`，否则会话列表仍显示旧内容。

### 3.4 deleteMessage — 软删除（Hide Pattern）

[`deleteMessage`](apps/api/src/common/chat/chat.service.ts:292) 不物理删除消息，而是通过 `ChatMessageHide` 表记录用户层面的隐藏：

```typescript
await this.prisma.chatMessageHide.upsert({
  where: { userId_messageId: { userId, messageId } },
  update: {},
  create: { userId, messageId },
});
```

查询消息时通过 `hiddenByUsers: { none: { userId } }` 过滤：

```typescript
// chat.service.ts:559
const whereCondition = {
  conversationId,
  hiddenByUsers: { none: { userId } },
  seqId: { gt: clearedSeqId },
};
```

### 3.5 clearHistory — SeqId 截断

[`clearHistory`](apps/api/src/common/chat/chat.service.ts:310) 使用 **SeqId 截断** 策略实现清空历史——将用户的 `clearedSeqId` 更新为当前 `lastMsgSeqId`：

```typescript
await this.prisma.chatMember.update({
  where: { conversationId_userId: { conversationId, userId } },
  data: { clearedSeqId: conv.lastMsgSeqId },
});
```

之后所有 `seqId <= clearedSeqId` 的消息在查询时被过滤，但数据库中的数据不删除。这种方式 **零数据搬迁、零锁竞争**，适合大规模聊天场景。

### 3.6 markAsRead — SeqId 已读同步

[`markAsRead`](apps/api/src/common/chat/chat.service.ts:336) 更新成员的 `lastReadSeqId`，并触发 `CONVERSATION_READ` 事件：

```typescript
const targetSeqId = maxSeqId
  ? Math.min(maxSeqId, conversation.lastMsgSeqId)
  : conversation.lastMsgSeqId;

const updatedMember = await this.prisma.chatMember.update({
  where: { conversationId_userId: { conversationId, userId } },
  data: { lastReadSeqId: targetSeqId },
  select: { lastReadSeqId: true },
});

this.eventEmitter.emit(CHAT_EVENTS.CONVERSATION_READ,
  new ConversationReadEvent(conversationId, userId, targetSeqId));

return { lastReadSeqId: updatedMember.lastReadSeqId };
```

**未读数计算**：客户端展示的未读数在服务端由 `lastMsgSeqId - lastReadSeqId` 实时计算。

---

## 4. 会话管理

### 4.1 getConversationList — N+1 优化

[`getConversationList`](apps/api/src/common/chat/chat.service.ts:376) 查询用户的所有会话，针对 `DIRECT` 类型做了 **N+1 优化**：

```
┌─────────────────────────────────────────────────────────────┐
│ getConversationList(userId, page=1, pageSize=200)            │
│                                                               │
│  1. conversation.findMany(where: members.some.userId)        │
│     └─ 一次查询拿到所有会话                                    │
│                                                               │
│  2. 分离 DIRECT 类型 ID                                      │
│     └─ chatMember.findMany(where: conversationId IN [...]    │
│                            AND userId ≠ myId)                │
│        └─ 一次性查询所有私聊的对方信息                        │
│                                                               │
│  3. 内存组装：partnersMap + members[0] 设置                   │
│     ├─ DIRECT → partner.nickname / partner.avatar            │
│     ├─ GROUP  → conv.name / conv.avatar                      │
│     ├─ unreadCount = lastMsgSeqId - lastReadSeqId            │
│     └─ isPinned / isMuted 取自 myMember                      │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 getConversationDetail — 应用状态注入

[`getConversationDetail`](apps/api/src/common/chat/chat.service.ts:428) 返回会话详情，除了基础信息外，还注入 **申请状态** 和 **待审批数量**：

```typescript
// 如果是陌生人 + 群聊 → 检查是否有待审批的入群申请
let applicationStatus: 'NONE' | 'PENDING' = 'NONE';
if (!myMember && conv.type === CONVERSATION_TYPE.GROUP) {
  const pendingRequest = await this.prisma.groupJoinRequest.findFirst({
    where: { groupId: conversationId, applicantId: userId, status: 0 },
  });
  if (pendingRequest) applicationStatus = 'PENDING';
}

// 如果是管理员/群主 → 统计待审批数量
let pendingRequestCount = 0;
if (conv.type === CONVERSATION_TYPE.GROUP && myMember) {
  const isManager = myMember.role === 'OWNER' || myMember.role === 'ADMIN';
  if (isManager) {
    pendingRequestCount = await this.prisma.groupJoinRequest.count({
      where: { groupId: conversationId, status: GroupJoinRequestStatus.PENDING },
    });
  }
}
```

### 4.3 getMessages — SeqId 游标分页

[`getMessages`](apps/api/src/common/chat/chat.service.ts:537) 采用 **SeqId 游标分页** 替代传统 Offset 分页：

```
┌──────────────────────────────────────────────────────────┐
│ getMessages(userId, dto)                                  │
│                                                           │
│  WHERE conditions:                                        │
│   ├─ conversationId = dto.conversationId                  │
│   ├─ hiddenByUsers: none { userId }  (软删除过滤)        │
│   ├─ seqId > clearedSeqId            (清空历史过滤)      │
│   └─ [cursor] seqId < cursor          (游标分页)          │
│                                                           │
│  ORDER BY seqId DESC                                      │
│  TAKE pageSize (= 20)                                     │
│                                                           │
│  RETURN:                                                  │
│   ├─ list: 消息数组 (含 sender 信息)                      │
│   ├─ nextCursor: 最后一条消息的 seqId                     │
│   └─ partnerLastReadSeqId: 对方已读位置                   │
└──────────────────────────────────────────────────────────┘
```

**前端读取指示器**：通过 `partnerLastReadSeqId` 字段，前端可以渲染"对方已读到哪里"的指示线。

---

## 5. 群组管理（ChatGroupService）

群组管理由 [`ChatGroupService`](apps/api/src/common/chat/chat-group.service.ts:41) 负责，提供 11 种群组运维操作，每种操作后通过 `EventEmitter2` 触发对应事件，由 `ChatListener` 分发给 WebSocket 客户端。

### 5.1 权限模型

群组采用三层角色体系：

| 角色 | 操作权限 |
|------|----------|
| **OWNER** | 所有操作：踢人/禁言/升降职/转让/解散/更新信息/审批申请 |
| **ADMIN** | 有限操作：踢普通成员/禁言/更新信息/审批申请（不能踢 ADMIN，不能升降职） |
| **MEMBER** | 无管理操作：可退群/发送消息 |

权限守卫通过 `_checkPermission` 统一拦截：

```typescript
// chat-group.service.ts:50-67
private async _checkPermission(
  operatorId: string,
  conversationId: string,
  requiredRoles: ChatMemberRole[],
) {
  const member = await this.prisma.chatMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: operatorId } },
    select: { role: true },
  });
  if (!member) throw new ForbiddenException('You are not a member');
  const role = member.role as ChatMemberRole;
  if (!requiredRoles.includes(role)) {
    throw new ForbiddenException('Permission denied');
  }
  return member;
}
```

### 5.2 群组管理操作

| 操作 | 方法 | 所需角色 | 说明 |
|------|------|----------|------|
| **踢人** | `kickMember` | OWNER/ADMIN | ADMIN 不能踢 ADMIN，不能踢 OWNER |
| **禁言** | `muteMember` | OWNER/ADMIN | `duration>0` 禁言，`=0` 解除，`mutedUntil` 绝对时间 |
| **升降职** | `setAdmin` | OWNER 仅 | `isAdmin` 控制 MEMBER↔ADMIN |
| **转让** | `transferOwner` | OWNER 仅 | $transaction 双 update + conversation.ownerId |
| **更新信息** | `updateGroupInfo` | OWNER/ADMIN | 改名/改头像/公告/全员禁言/审批开关 |
| **解散** | `disbandGroup` | OWNER 仅 | 软删除（status=0） |
| **退群** | `leaveGroup` | MEMBER/ADMIN | OWNER 需先转让或解散 |

**踢人逻辑**的关键约束：

```typescript
// chat-group.service.ts:96-105
if (target.role === ChatMemberRole.OWNER)
  throw new ForbiddenException('Cannot kick owner');
if (operator.role === ChatMemberRole.ADMIN && target.role === ChatMemberRole.ADMIN)
  throw new ForbiddenException('Admin cannot kick admin');
```

**转让群主**采用 `$transaction` 保证原子性：

```typescript
// chat-group.service.ts:252-286
await this.prisma.$transaction(async (tx) => {
  // 1. 旧群主 → MEMBER
  await tx.chatMember.update({ where: {...}, data: { role: ChatMemberRole.MEMBER } });
  // 2. 新群主 → OWNER
  await tx.chatMember.update({ where: {...}, data: { role: ChatMemberRole.OWNER } });
  // 3. 更新 Conversation.ownerId
  await tx.conversation.update({ where: { id: dto.conversationId }, data: { ownerId: dto.newOwnerId } });
  // 4. 系统消息
  await this._createSystemMessage(tx, dto.conversationId, 'Group ownership transferred');
});
```

**更新群信息**的精确构建模式——防止 `undefined` 污染数据库：

```typescript
// chat-group.service.ts:310-337
const dataToUpdate: any = {};
if (dto.name !== undefined && dto.name !== null) {
  dataToUpdate.name = dto.name;
}
if (dto.announcement !== undefined && dto.announcement !== null) {
  dataToUpdate.announcement = dto.announcement;
  dataToUpdate.announcementAt = new Date();
}
// ... 只有实际变更的字段进入 update
const group = await this.prisma.conversation.update({
  where: { id: dto.conversationId },
  data: dataToUpdate,
});
```

### 5.3 系统消息

群组管理操作（踢人/退群/改名/转让等）会自动生成 **系统消息**（`type=99`），显示在聊天窗口中：

```typescript
// chat-group.service.ts:768-828
private async _createSystemMessage(tx, conversationId, content, meta = {}) {
  const LARGE_GROUP_LIMIT = 500;
  const memberCount = await tx.chatMember.count({ where: { conversationId } });

  // 1. 递增 lastMsgSeqId
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

  // 2. 创建系统消息
  const message = await tx.chatMessage.create({
    data: {
      conversationId, senderId: null, type: 99, content,
      seqId: conv.lastMsgSeqId, meta,
    },
  });

  // 3. 大群优化：500人以下才给每个成员发 Socket
  let memberIds: string[] = [];
  if (memberCount <= LARGE_GROUP_LIMIT) {
    const members = await tx.chatMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    memberIds = members.map((m) => m.userId);
  }

  // 4. 事件推送
  this.eventEmitter.emit(CHAT_EVENTS.MESSAGE_CREATED,
    new MessageCreatedEvent(/* ... */));
}
```

**大群优化**：超过 500 人的大群不逐个推送系统消息 Socket，避免性能问题。

### 5.4 群组搜索

[`searchGroups`](apps/api/src/common/chat/chat-group.service.ts:690) 支持用户搜索公开群组：

```typescript
async searchGroups(userId: string, keyword: string) {
  const groups = await this.prisma.conversation.findMany({
    where: {
      type: CONVERSATION_TYPE.GROUP,
      status: ConversationStatus.NORMAL,
      OR: [
        { id: keyword },                         // ID 精确匹配
        { name: { contains: keyword, mode: 'insensitive' } }, // 名称模糊
      ],
    },
    take: 20,
    select: {
      id: true, name: true, avatar: true,
      joinNeedApproval: true,
      _count: { select: { members: true } },     // 实时成员数
    },
  });

  // 检查用户是否已在各群中
  const groupIds = groups.map((g) => g.id);
  const memberships = await this.prisma.chatMember.findMany({
    where: { conversationId: { in: groupIds }, userId },
    select: { conversationId: true },
  });
  const joinedSet = new Set(memberships.map((m) => m.conversationId));

  return groups.map((g) => ({
    ...g,
    memberCount: g._count.members,
    isMember: joinedSet.has(g.id),
  }));
}
```

### 5.5 群组创建与会话管理

**创建群聊** [`createGroupChat`](apps/api/src/common/chat/chat.service.ts:827)：

```typescript
async createGroupChat(creatorId: string, dto: CreateGroupDto) {
  const uniqueMembers = Array.from(new Set([creatorId, ...dto.memberIds]));
  const conversation = await this.prisma.conversation.create({
    data: {
      type: CONVERSATION_TYPE.GROUP,
      name: dto.name,
      status: ConversationStatus.NORMAL,
      ownerId: creatorId,
      members: {
        create: uniqueMembers.map((uid) => ({
          userId: uid,
          role: uid === creatorId ? ChatMemberRole.OWNER : ChatMemberRole.MEMBER,
        })),
      },
    },
  });
  this._triggerAvatarUpdate(conversation.id);
  return conversation;
}
```

**邀请加入** [`inviteToGroup`](apps/api/src/common/chat/chat.service.ts:757) 去重 + 批量 `createMany`：

```typescript
const existing = await this.prisma.chatMember.findMany({
  where: { conversationId: groupId, userId: { in: memberIds } },
  select: { userId: true },
});
const existingSet = new Set(existing.map((m) => m.userId));
const newMembers = memberIds.filter((id) => !existingSet.has(id));

if (newMembers.length > 0) {
  await this.prisma.$transaction(async (tx) => {
    await tx.chatMember.createMany({
      data: newMembers.map((uid) => ({
        conversationId: groupId, userId: uid, role: ChatMemberRole.MEMBER,
      })),
    });
  });
  this.eventEmitter.emit(CHAT_GROUP_EVENTS.MEMBER_JOINED, { /* ... */ });
  this._triggerAvatarUpdate(groupId);
}
```

**退群与自动解散** [`leaveGroup`](apps/api/src/common/chat/chat.service.ts:806)：

```typescript
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
}
```

### 5.6 群组头像异步合成

群组的九宫格头像通过 **BullMQ 异步任务** 合成：

```typescript
// chat.service.ts:952-967
private _triggerAvatarUpdate(conversationId: string) {
  this.avatarQueue.add('update_chat_group', { conversationId }, {
    delay: 500,                    // 延迟 500ms 等待事务提交
    removeOnComplete: true,        // 自动清理完成的任务
    jobId: `chat_avatar_${conversationId}`, // 幂等性：同群不重复排队
  });
}
```

触发时机：创建群聊、邀请新成员、成员退群。

---

## 6. 加群申请审批工作流

群组支持 **申请加入** 模式（`joinNeedApproval = true`），由 [`ChatGroupService`](apps/api/src/common/chat/chat-group.service.ts:468-683) 实现完整的审批流程。

### 6.1 申请流程图

```
┌──────────┐         ┌──────────┐         ┌──────────┐
│ 申请人    │         │ 群管理员  │         │ 数据库    │
└────┬─────┘         └────┬─────┘         └────┬─────┘
     │                    │                    │
     │  POST /apply       │                    │
     │───────────────────>│                    │
     │                    │   检查群存在 & 状态  │
     │                    │──────────────────>│
     │                    │<──────────────────│
     │                    │                    │
     │  ┌ 如果 joinNeedApproval = false ──┐   │
     │  │ 直接创建 ChatMember             │   │
     │  │ return { status: 'ACCEPTED' }  │   │
     │  └────────────────────────────────┘   │
     │                    │                    │
     │  ┌ 如果 joinNeedApproval = true ───┐  │
     │  │ 检查重复申请                    │   │
     │  │ 创建 GroupJoinRequest(PENDING) │   │
     │  │ 异步通知管理员                  │   │
     │  │ return { status: 'PENDING' }   │   │
     │  └────────────────────────────────┘   │
     │                    │                    │
     │                    │ GET /requests      │
     │                    │───────────────────>│
     │                    │<──────────────────│
     │                    │  申请列表          │
     │                    │                    │
     │                    │ POST /request/handle│
     │                    │───────────────────>│
     │                    │  $transaction:     │
     │                    │  1. 删除旧记录     │
     │                    │  (防唯一约束冲突)  │
     │                    │  2. 更新申请状态   │
     │                    │  3. [accept]       │
     │                    │     upsert 成员    │
     │                    │     发系统消息     │
     │                    │<──────────────────│
     │                    │                    │
     │  Socket: APPLY_RESULT                  │
     │<════════════════════════════════════════│
```

### 6.2 申请接口

**提交申请** [`applyToGroup`](apps/api/src/common/chat/chat-group.service.ts:468)：

```typescript
async applyToGroup(userId: string, groupId: string, reason?: string) {
  // 1. 检查群存在且未解散
  const group = await this.prisma.conversation.findUnique({
    where: { id: groupId, status: 1 },
    select: { joinNeedApproval: true, name: true, type: true },
  });
  if (!group) throw new NotFoundException('Group not found or disbanded');

  // 2. 检查是否已是成员
  const isMember = await this.prisma.chatMember.count({
    where: { conversationId: groupId, userId },
  });
  if (isMember > 0) throw new BadRequestException('Already a member');

  // 3. 无需审批 → 直接加入
  if (!group.joinNeedApproval) {
    await this.prisma.chatMember.create({
      data: { conversationId: groupId, userId, role: ChatMemberRole.MEMBER },
    });
    return { status: 'ACCEPTED', message: 'Joined directly' };
  }

  // 4. 防重校验
  const existingApplication = await this.prisma.groupJoinRequest.findFirst({
    where: { groupId, applicantId: userId, status: GroupJoinRequestStatus.PENDING },
  });
  if (existingApplication) throw new BadRequestException('Application already pending');

  // 5. 创建申请记录
  const request = await this.prisma.groupJoinRequest.create({
    data: { groupId, applicantId: userId, reason: reason || '', status: GroupJoinRequestStatus.PENDING },
  });

  // 6. 异步通知管理员
  void this._notifyAdminsOfNewRequest(groupId, userId, ...);
  return { status: 'PENDING', requestId: request.id, message: 'Application submitted' };
}
```

### 6.3 审批处理

[`handleJoinRequest`](apps/api/src/common/chat/chat-group.service.ts:559) 使用 `$transaction` 处理审批，关键步骤：

**1. 旧记录预清理**：先删除该用户的历史已处理记录，防止 `ChatMember` 复合唯一约束冲突：

```typescript
if (action === 'accept') {
  await tx.groupJoinRequest.deleteMany({
    where: {
      groupId: request.groupId,
      applicantId: request.applicantId,
      status: { in: [GroupJoinRequestStatus.REJECTED, GroupJoinRequestStatus.ACCEPTED] },
      id: { not: requestId }, // 保留当前处理的记录
    },
  });
}
```

**2. 成员添加使用 upsert**：防止用户重新加入时唯一约束冲突：

```typescript
await tx.chatMember.upsert({
  where: { conversationId_userId: { conversationId: request.groupId, userId: request.applicantId } },
  update: { role: ChatMemberRole.MEMBER },
  create: { conversationId: request.groupId, userId: request.applicantId, role: ChatMemberRole.MEMBER },
});
```

**3. 事件通知**：审批处理后发射 `APPLY_RESULT`（通知申请人）和 `REQUEST_HANDLED`（通知其他管理员）。

### 6.4 事件分发

`ChatListener` 负责将审批事件分发到对应 Socket 频道：

```typescript
// chat.listener.ts:160-192
@OnEvent(CHAT_GROUP_EVENTS.APPLY_NEW)
handleGroupApplyNew(payload) {
  payload.adminIds.forEach((adminId) => {
    this.eventsGateway.dispatchToUser(adminId, SocketEvents.GROUP_APPLY_NEW, payload);
  });
}

@OnEvent(CHAT_GROUP_EVENTS.APPLY_RESULT)
handleGroupApplyResult(payload) {
  this.eventsGateway.dispatchToUser(payload.applicantId, SocketEvents.GROUP_APPLY_RESULT, payload);
  if (payload.approved) {
    this.eventsGateway.dispatchToUser(payload.applicantId, SocketEvents.CONVERSATION_ADDED, {
      conversationId: payload.conversationId,
      syncType: 'full_sync',
    });
  }
}
```

---

## 7. 联系人/好友关系系统

联系人系统由 [`ContactService`](apps/api/src/common/contact/contact.service.ts:18) 实现，包含 5 个核心操作。

### 7.1 好友关系状态机

```
                ┌──────────┐
                │ STRANGER │
                └────┬─────┘
                     │ POST /contacts/add
                     ▼
              ┌──────────────┐
              │  SENT (待审批) │
              └──────┬───────┘
                     │ POST /contacts/handle (accept=true)
                     ▼
              ┌──────────┐
              │  FRIEND   │
              └──────────┘
```

### 7.2 添加好友

[`addFriend`](apps/api/src/common/contact/contact.service.ts:27) 使用 `upsert` 模式——重复请求不会创建新记录，而是更新现有记录的 `status` 和 `reason`：

```typescript
await this.prisma.friendRequest.upsert({
  where: { fromUserId_toUserId: { fromUserId: userId, toUserId: friendId } },
  update: { status: FRIEND_REQUEST_STATUS.PENDING, reason, updatedAt: new Date() },
  create: { fromUserId: userId, toUserId: friendId, reason, status: FRIEND_REQUEST_STATUS.PENDING },
});
```

发送后通过 `EventsGateway.dispatch` 向接收方推送实时通知：

```typescript
this.eventsGateway.dispatch(
  `user_${friendId}`,
  SocketEvents.CONTACT_APPLY,
  { applicantId: userId, reason },
);
```

### 7.3 处理好友请求

[`handleFriendRequest`](apps/api/src/common/contact/contact.service.ts:120) 采用 **双向好友记录** 设计——`Friend` 表存储两条记录（`A→B` 和 `B→A`），通过 `upsert` 保证幂等性：

```typescript
await this.prisma.$transaction(async (tx) => {
  await tx.friendRequest.update({
    where: { id: request.id },
    data: { status: FRIEND_REQUEST_STATUS.ACCEPTED },
  });

  // 双向好友记录 (upsert 防重复)
  await tx.friend.upsert({
    where: { userId_friendId: { userId, friendId: targetId } },
    create: { userId, friendId: targetId, status: FRIEND_SHIP_STATUS.FRIENDS, remark: '' },
    update: { status: FRIEND_SHIP_STATUS.FRIENDS },
  });
  await tx.friend.upsert({
    where: { userId_friendId: { userId: targetId, friendId: userId } },
    create: { userId: targetId, friendId: userId, status: FRIEND_SHIP_STATUS.FRIENDS, remark: '' },
    update: { status: FRIEND_SHIP_STATUS.FRIENDS },
  });
});

this.eventsGateway.dispatch(`user_${targetId}`, SocketEvents.CONTACT_ACCEPT, { friendId: userId });
```

### 7.4 搜索用户

[`searchUsers`](apps/api/src/common/contact/contact.service.ts:215) 返回用户列表并标注关系状态：

```typescript
const users = await this.prisma.user.findMany({
  where: {
    AND: [
      { id: { not: myUserId } },
      { isRobot: false },
      { OR: [
        { nickname: { contains: dto.keyword, mode: 'insensitive' } },
        { phone: { contains: dto.keyword } },
        { id: { equals: dto.keyword } },
      ]},
    ],
  },
  take: 20,
  select: { id: true, nickname: true, avatar: true, phone: true },
});

// 已加好友的 → FRIEND
// 已发申请但未处理的 → SENT
// 其余 → STRANGER
const friendIdSet = new Set(friends.map((f) => f.friendId));
const sentRequestSet = new Set(sentRequests.map((r) => r.toUserId));

return users.map((user) => ({
  ...user,
  status: friendIdSet.has(user.id) ? RELATIONSHIP_STATUS.FRIEND
        : sentRequestSet.has(user.id) ? RELATIONSHIP_STATUS.SENT
        : RELATIONSHIP_STATUS.STRANGER,
}));
```

### 7.5 获取好友列表 & 申请列表

**好友列表** [`getContacts`](apps/api/src/common/contact/contact.service.ts:190)：

```typescript
const friends = await this.prisma.friend.findMany({
  where: { userId, status: FRIEND_SHIP_STATUS.FRIENDS },
  include: { friend: { select: { id: true, nickname: true, avatar: true, phone: true } } },
  orderBy: { friend: { nickname: 'asc' } },
});
return friends.map((f) => ({
  id: f.friend.id,
  nickname: f.remark || f.friend.nickname, // 备注优先于昵称
  avatar: f.friend.avatar,
  phone: f.friend.phone,
}));
```

**申请列表** [`getFriendRequests`](apps/api/src/common/contact/contact.service.ts:90)：

```typescript
const requests = await this.prisma.friendRequest.findMany({
  where: { toUserId: userId, status: FRIEND_REQUEST_STATUS.PENDING },
  include: { fromUser: { select: { id: true, nickname: true, avatar: true } } },
  orderBy: { createdAt: 'desc' },
});
```

---

## 8. 事件驱动架构（EventEmitter² 解耦）

整个 IM 系统采用 **事件驱动架构**，服务层不直接依赖 WebSocket，而是通过 `EventEmitter2` 发射事件，由 [`ChatListener`](apps/api/src/common/events/listeners/chat.listener.ts) 统一转发到 `EventsGateway`。

### 8.1 消息事件

| 事件常量 | 触发时机 | 推送目标 |
|----------|----------|----------|
| `MESSAGE_CREATED` | 消息发送成功 | 会话所有成员（+ FCM 推送给静音成员以外的用户） |
| `MESSAGE_RECALLED` | 消息撤回成功 | 会话所有成员 |
| `CONVERSATION_READ` | 用户标记已读 | 会话成员（用于更新对方的已读指示器） |
| `SUPPORT_CONVERSATION_STARTED` | 用户发起客服会话 | 在线管理员 |
| `MEMBER_JOINED` | 成员被邀请/加入 | 老成员 + 新成员（`CONVERSATION_ADDED`） |

### 8.2 群组事件

| 事件常量 | 触发时机 | 推送方式 |
|----------|----------|----------|
| `MEMBER_KICKED` | 管理员踢人 | 房间广播 + 定向通知被踢者 |
| `MEMBER_MUTED` | 禁言/解除禁言 | 房间广播 |
| `MEMBER_ROLE_UPDATED` | 升降职 | 房间广播 |
| `OWNER_TRANSFERRED` | 转让群主 | 房间广播 |
| `INFO_UPDATED` | 改名/改头像/公告 | 房间广播 |
| `MEMBER_LEFT` | 成员退群 | 房间广播 + 定向通知退群者 |
| `GROUP_DISBANDED` | 解散群 | 房间广播 |
| `APPLY_NEW` | 新加群申请 | 定向通知管理员（`dispatchToUser`） |
| `APPLY_RESULT` | 审批结果 | 定向通知申请人 |
| `REQUEST_HANDLED` | 申请已被处理 | 定向通知其他管理员 |

### 8.3 好友事件

| 事件 | 触发时机 | 推送目标 |
|------|----------|----------|
| `CONTACT_APPLY` | 发送好友申请 | `user_{friendId}` |
| `CONTACT_ACCEPT` | 同意好友申请 | `user_{targetId}` |

---

## 9. 客服后台集成

管理员通过 [`AdminChatService`](apps/api/src/admin/chat/admin-chat.service.ts:25) 与用户互动，覆盖 325 行逻辑。

### 9.1 客服会话列表

[`getConversations`](apps/api/src/admin/chat/admin-chat.service.ts:38) 支持按会话状态筛选（ALL/ACTIVE/CLOSED），并查询最后一条回复时间：

```typescript
async getConversations(dto: QueryConversationsDto) {
  const where: Prisma.ChatMemberWhereInput = {
    userId: dto.adminId,
    conversation: { type: CONVERSATION_TYPE.SUPPORT },
  };
  if (dto.status === 'active') {
    where.conversation = { ...where.conversation, status: ConversationStatus.NORMAL };
  } else if (dto.status === 'closed') {
    where.conversation = { ...where.conversation, status: 2 };
  }

  const [total, list] = await this.prisma.$transaction([
    this.prisma.chatMember.count({ where }),
    this.prisma.chatMember.findMany({
      where,
      include: {
        conversation: {
          include: {
            members: {
              include: { user: { select: { id: true, nickname: true, avatar: true } } },
            },
          },
        },
      },
      orderBy: { conversation: { lastMsgTime: 'desc' } },
      skip: (dto.page - 1) * dto.pageSize,
      take: dto.pageSize,
    }),
  ]);
}
```

### 9.2 客服回复 & 强制撤回

**回复消息** [`replyToConversation`](apps/api/src/admin/chat/admin-chat.service.ts:162) 复用 `ChatService.sendMessage`：

```typescript
async replyToConversation(adminId: string, dto: ReplyDto) {
  const member = await this.prisma.chatMember.findUnique({
    where: { conversationId_userId: { conversationId: dto.conversationId, userId: adminId } },
  });
  if (!member) throw new ForbiddenException('Not a member');

  return this.chatService.sendMessage(adminId, {
    id: uuidv4(),
    conversationId: dto.conversationId,
    content: dto.content,
    type: dto.type || MESSAGE_TYPE.TEXT,
    meta: dto.meta,
  });
}
```

**强制撤回** [`forceRecallMessage`](apps/api/src/admin/chat/admin-chat.service.ts:217) 绕过 2 分钟窗口限制，管理员可以撤回任意消息（不论发送者和时间）。

### 9.3 关闭客服会话

[`closeConversation`](apps/api/src/admin/chat/admin-chat.service.ts:250) 使用 `$transaction` 关闭会话并发送系统消息：

```typescript
await this.prisma.$transaction(async (tx) => {
  await tx.conversation.update({
    where: { id: conversationId },
    data: { status: 2, closedBy: adminName },
  });
  await this.chatService.sendMessage(adminId, {
    id: uuidv4(),
    conversationId,
    content: closeMessage || 'Conversation closed',
    type: MESSAGE_TYPE.TEXT,
  });
});
```

---

## 10. 业务/客服会话建联

### 10.1 客服渠道建联

[`addMemberToBusinessGroup`](apps/api/src/common/chat/chat.service.ts:645) 是客户端接入客服的统一入口。它通过 `SupportChannel` 查找到对应的 Bot 客服用户，创建或复用 SUPPORT 类型会话：

```typescript
async addMemberToBusinessGroup(businessId: string, userId: string) {
  const channel = await this.prisma.supportChannel.findUnique({
    where: { id: businessId },
    include: { botUser: { select: { id: true, nickname: true, avatar: true } } },
  });
  if (!channel || !channel.isActive)
    throw new NotFoundException('Support channel not found or inactive');

  // 复用现有「正常」状态的客服会话
  const existingConversation = await this.prisma.conversation.findFirst({
    where: {
      type: CONVERSATION_TYPE.SUPPORT,
      status: ConversationStatus.NORMAL, // CLOSED 的旧会话不复用
      AND: [
        { members: { some: { userId } } },
        { members: { some: { userId: channel.botUserId } } },
      ],
    },
  });
  if (existingConversation) return existingConversation.members[0];

  // 创建新 SUPPORT 会话
  const member = await this.prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: {
        type: CONVERSATION_TYPE.SUPPORT,
        name: channel.name,
        avatar: channel.botUser.avatar,
        members: {
          create: [
            { userId, role: ChatMemberRole.MEMBER },
            { userId: channel.botUserId, role: ChatMemberRole.MEMBER },
          ],
        },
      },
    });
    // ...
  });

  // 通知在线管理员有新客服会话
  this.eventEmitter.emit(SUPPORT_CONVERSATION_STARTED, { conversationId, businessId, userId });
  return member;
}
```

### 10.2 私聊建联

[`ensureDirectConversation`](apps/api/src/common/chat/chat.service.ts:727) 确保两个用户之间存在直接会话，不复用 CLOSED 会话：

```typescript
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
```

---

## 11. WebRTC ICE Server — 动态 TURN 凭证

IM 系统支持音视频通话（WebRTC），[`getIceServers`](apps/api/src/common/chat/chat.service.ts:886) 动态生成 TURN 服务器的临时凭证：

```typescript
getIceServers(userId: string) {
  const secret = this.configService.get<string>('TURN_SECRET');
  const turnUrl = this.configService.get<string>('TURN_URL');
  if (!secret || !turnUrl) throw new InternalServerErrorException('WebRTC config error');

  const ttl = 24 * 3600; // 24小时过期
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const turnUsername = `${timestamp}:${userId}`;
  const turnPassword = crypto.createHmac('sha1', secret).update(turnUsername).digest('base64');

  return [
    { urls: 'stun:stun.l.google.com:19302' },   // Google 公共 STUN
    { urls: turnUrl, username: turnUsername, credential: turnPassword }, // 私有 TURN
  ];
}
```

**安全设计**：
- 用户名格式为 `expirationTimestamp:userId`，Coturn 服务器据此验证时效性
- 密码使用 HMAC-SHA1 基于共享密钥生成，客户端无法伪造
- 24 小时自动过期，减少凭证泄露风险

---

## 12. 文件上传

客户端通过 [`getUploadToken`](apps/api/src/common/chat/chat.controller.ts:254) 获取文件上传凭证，委托 [`UploadService`](apps/api/src/common/upload/upload.service.ts) 生成预签名 URL：

```typescript
@Post('upload-token')
async getUploadToken(@CurrentUserId() userId: string, @Body() body: GetUploadTokenDto) {
  return this.uploadService.generatePresignedUrl(userId, body.fileName, body.fileType, 'chat');
}
```

`module` 参数设为 `'chat'`，文件存储在 `uploads/chat/user_id/xxx.jpg` 路径下。

---

## 13. 安全与性能

### 13.1 安全措施

| 风险 | 防护措施 |
|------|----------|
| **消息 ID 冲突** | Idempotency check — 已有消息 + senderId 不匹配则拒绝 |
| **撤回他人消息** | senderId 严格校验 |
| **越权操作群组** | `_checkPermission` 三层角色校验 |
| **群主直接退群** | 403 Forbidden — 必须转让或解散 |
| **踢群主** | 403 Forbidden |
| **Admin 踢 Admin** | 403 Forbidden |
| **重复好友申请** | upsert 模式 + 状态校验 |
| **重复加群申请** | COUNT 校验 + 唯一约束 |
| **大群消息风暴** | 500 人阈值限制 Socket 推送范围 |

### 13.2 性能设计

| 优化点 | 方案 |
|--------|------|
| **消息查询** | SeqId 游标分页（O(1) 查询，无 OFFSET 偏移） |
| **清空历史** | SeqId 截断（零数据搬迁） |
| **软删除** | ChatMessageHide 表 upsert（零 I/O 写放大） |
| **群头像合成** | BullMQ 异步 + jobId 幂等 + 500ms 延迟 |
| **会话列表 N+1** | 批量 partner 查询 |
| **系统消息推送** | 500 人阈值控制 |
| **搜索用户** | LIMIT 20 防过载 |
| **群组搜索** | LIMIT 20 + 精确/模糊双模式 |

---

## 14. 总结

本文覆盖了客户端 IM 系统的完整架构，核心设计模式总结如下：

| 设计模式 | 应用场景 | 关键代码 |
|----------|----------|----------|
| **Meta-First Engine** | 消息发送前按类型清洗 meta | [`chat.service.ts:76`](apps/api/src/common/chat/chat.service.ts:76) |
| **Idempotency Key** | 客户端生成消息 UUID，防重复 | [`chat.service.ts:63`](apps/api/src/common/chat/chat.service.ts:63) |
| **SeqId 游标分页** | 消息历史查询，O(1) 性能 | [`chat.service.ts:537`](apps/api/src/common/chat/chat.service.ts:537) |
| **SeqId 截断清空** | 零数据搬迁的清空历史 | [`chat.service.ts:310`](apps/api/src/common/chat/chat.service.ts:310) |
| **Hide Pattern 软删除** | ChatMessageHide 表 upsert | [`chat.service.ts:292`](apps/api/src/common/chat/chat.service.ts:292) |
| **EventEmitter² 解耦** | 服务层 → 事件 → Socket 推送 | [`chat.listener.ts:8`](apps/api/src/common/events/listeners/chat.listener.ts:8) |
| **乐观锁权限守卫** | `_checkPermission` 三层角色矩阵 | [`chat-group.service.ts:50`](apps/api/src/common/chat/chat-group.service.ts:50) |
| **批量 upsert 好友** | 双向好友记录 + upsert 幂等 | [`contact.service.ts:143`](apps/api/src/common/contact/contact.service.ts:143) |
| **预清理 + upsert 加群** | 防止唯一约束冲突 | [`chat-group.service.ts:593`](apps/api/src/common/chat/chat-group.service.ts:593) |
| **动态 TURN 凭证** | HMAC-SHA1 时间戳签名 | [`chat.service.ts:886`](apps/api/src/common/chat/chat.service.ts:886) |
| **应用状态注入** | 详情接口携带申请状态 + 待审批数 | [`chat.service.ts:458`](apps/api/src/common/chat/chat.service.ts:458) |
| **大群阈值保护** | 500 人限制系统消息 Socket 推送 | [`chat-group.service.ts:774`](apps/api/src/common/chat/chat-group.service.ts:774) |

### 相关文章

- [客服实时聊天系统——WebSocket 实时推送 + 6 种消息类型 + 会话管理](customer-service-live-chat.md) — admin-next 后台客服系统，与本文共享底层 ChatService
- [仪表盘 & 数据统计系统](dashboard-statistics-system.md) — 后台运营数据大盘
- [Admin RBAC：用户 & 角色权限管理](admin-rbac-authorization.md) — 后台权限体系
