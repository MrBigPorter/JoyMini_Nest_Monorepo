# WebRTC 通话信令与聊天 DTO 架构：NestJS 实时通信

**日期：** 2026-05-01  
**标签：** `NestJS` `Socket.IO` `WebRTC` `Call Signaling` `Chat` `DTO` `Swagger` `TypeScript`  
**代码参考：** [`call.gateway.ts`](apps/api/src/common/events/call/call.gateway.ts) | [`chat.events.ts`](apps/api/src/common/chat/events/chat.events.ts) | [`conversation.response.dto.ts`](apps/api/src/common/chat/dto/conversation.response.dto.ts) | [`message.response.dto.ts`](apps/api/src/common/chat/dto/message.response.dto.ts) | [`call-signaling.dto.ts`](apps/api/src/common/events/call/dto/call-signaling.dto.ts)

---

## 目录

1. [架构概述](#1-架构概述)
2. [WebRTC 通话信令网关](#2-webrtc-通话信令网关)
3. [聊天事件系统 — EventEmitter2 集成](#3-聊天事件系统--eventemitter2-集成)
4. [聊天 DTO 架构 — Swagger 优先设计](#4-聊天-dto-架构--swagger-优先设计)
5. [通话结束消息流程](#5-通话结束消息流程)
6. [对比：API 聊天系统 vs Admin-Next 聊天客户端](#6-对比api-聊天系统-vs-admin-next-聊天客户端)
7. [关键要点](#7-关键要点)

---

## 1. 架构概述

实时通信系统结合了用于 WebRTC 通话的 **Socket.IO WebSocket 信令** 和用于聊天消息传播的 **类型化事件系统**：

```
┌───────────────────────────────────────────────────────────┐
│                    Socket.IO 命名空间: /events             │
│                                                           │
│  EventsGateway (聊天)      CallGateway (WebRTC)           │
│  ┌──────────────────┐   ┌──────────────────────────┐     │
│  │ JOIN_CHAT        │   │ call_invite               │     │
│  │ LEAVE_CHAT       │   │ call_accept               │     │
│  │ SEND_MESSAGE     │   │ call_ice                  │     │
│  │ join_lobby       │   │ call_end                  │     │
│  │ leave_lobby      │   └──────────┬───────────────┘     │
│  └────────┬─────────┘              │                      │
│           │                        │                      │
└───────────┼────────────────────────┼──────────────────────┘
            │                        │
            ▼                        ▼
┌──────────────────────┐  ┌──────────────────────┐
│  EventEmitter2        │  │  Redis (pending_call) │
│  (chat.message.*)     │  │  (FCM 降级)          │
│  (call.wake_up)       │  └──────────────────────┘
└──────────────────────┘
```

---

## 2. WebRTC 通话信令网关

[`CallGateway`](apps/api/src/common/events/call/call.gateway.ts) 在 Socket.IO 上实现了 **4 消息 WebRTC 信令协议**，遵循标准的 WebRTC offer/answer/ICE 模式。

### 2.1 信令流程

```
呼叫方                          服务器                           被叫方
  │                               │                               │
  │──── call_invite (sdp) ───────▶│──── call_invite ────────────▶│
  │                               │   (存入 Redis)                 │
  │                               │                               │
  │                               │       call_accept (sdp) ─────┤
  │◀─── call_accept (sdp) ───────│◀──────────────────────────────│
  │                               │                               │
  │──── call_ice (candidate) ────▶│──── call_ice ───────────────▶│
  │◀─── call_ice (candidate) ─────│◀──────────────────────────────│
  │                               │                               │
  │◀─── call_end (reason) ───────│──── call_end ────────────────▶│
  │                               │   (清除 Redis + 发送消息)     │
```

### 2.2 通话邀请 — Redis 降级

```typescript
@SubscribeMessage('call_invite')
async handleCallInvite(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: CallInviteDto,
) {
  const senderId = this.getUserId(client);
  if (!senderId) return;

  const targetRoom = `user_${payload.targetId}`;

  // 1. 缓存到 Redis（FCM 唤醒降级）
  await this.redisService.set(
    `pending_call:${payload.targetId}`,
    JSON.stringify({ ...payload, senderId }),
    PENDING_CALL_TTL_SEC,  // 60 秒
  );

  // 2. 转发给目标用户（如果在线）
  this.server.to(targetRoom).emit('call_invite', { ...payload, senderId });

  // 3. 预获取用于 FCM 载荷的会话 ID
  const conv = await this.chatService.ensureDirectConversation(senderId, payload.targetId);
  conversationId = conv.id;

  // 4. 触发 FCM 推送的唤醒事件
  this.eventEmitter.emit('call.wake_up', {
    type: 'call_invite',
    targetId: payload.targetId,
    sessionId: payload.sessionId,
    senderId,
    mediaType: payload.mediaType,
    conversationId,
  });
}
```

**Redis 缓存解决了一个关键的竞态条件：** 当被叫方收到 FCM 推送并打开应用时，Socket.IO 连接尚未建立的短暂瞬间内，`pending_call` 缓存确保通话邀请在连接就绪时可用。

### 2.3 通话接受 — SDP 中继

```typescript
@SubscribeMessage('call_accept')
handleCallAccept(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: CallAcceptDto,
) {
  const senderId = this.getUserId(client);
  if (!senderId) return;

  // 将 Answer SDP 转发给呼叫方
  this.server.to(`user_${payload.targetId}`).emit('call_accept', {
    ...payload,  // 包含 sdp, sessionId
    senderId,
  });
}
```

网关是一个**透明中继**——它从不处理 SDP 或 ICE candidate。这是有意为之：媒体加密密钥永远不会触及服务器（端到端加密 WebRTC）。

### 2.4 ICE Candidate 交换

```typescript
@SubscribeMessage('call_ice')
handleIceCandidate(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: CallIceCandidateDto,
) {
  const senderId = this.getUserId(client);
  if (!senderId) return;

  this.logger.debug(`❄️ [ICE] ${senderId} -> ${payload.targetId}`);
  this.server.to(`user_${payload.targetId}`).emit('call_ice', {
    ...payload,  // candidate, sdpMid, sdpMLineIndex
    senderId,
  });
}
```

ICE candidate **仅在调试时记录**，因为在连接建立期间它们每秒可能触发数十次。

### 2.5 通话结束 — 清理 + 消息

```typescript
@SubscribeMessage('call_end')
async handleCallEnd(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: CallEndDto,
) {
  const senderId = this.getUserId(client);
  if (!senderId) return;

  const targetRoom = `user_${payload.targetId}`;
  this.server.to(targetRoom).emit('call_end', { ...payload, senderId });

  // 1. 清除 Redis 缓存（双方）
  await this.redisService.del(`pending_call:${payload.targetId}`);
  await this.redisService.del(`pending_call:${senderId}`);

  // 2. 向聊天发送通话结束消息
  await this.sendCallEndMessage(senderId, payload);

  // 3. 触发 FCM 唤醒（type: 'call_end' 防止显示幽灵来电界面）
  this.eventEmitter.emit('call.wake_up', {
    targetId: payload.targetId,
    type: 'call_end',  // 关键：必须是 'call_end'，不能是 'call_invite'
  });
}
```

**FCM `type` 字段至关重要：** 如果 `call_end` 以 `type: 'call_invite'`（默认值）发出，即使通话已结束，接收端应用也会显示来电界面。

### 2.6 通话结束原因与消息内容

```typescript
private async sendCallEndMessage(callerId: string, payload: CallEndDto) {
  const { targetId, reason, conversationId } = payload;
  const duration = payload.duration || 0;
  const mediaType = payload.mediaType || 'audio';

  let content = '';
  if (reason === CallEndReason.MISSED) {
    content = '[未接]';
  } else if (reason === CallEndReason.REJECTED) {
    content = '[已拒绝]';
  } else if (duration > 0) {
    content = `[${mediaType === 'video' ? '视频' : '音频'}通话] 时长 ${this.formatDuration(duration)}`;
  } else {
    content = '[已取消]';
  }

  await this.chatService.sendMessage(callerId, {
    id: uuidv4(),
    conversationId: conversation.id,
    type: MESSAGE_TYPE.SYSTEM,
    content,
    meta: { callType: mediaType, duration, sessionId, reason, isSystemCallEnd: true },
  });
}
```

这会生成如下聊天消息：
- `[未接]` — 被叫方未接听
- `[已拒绝]` — 被叫方拒绝
- `[音频通话] 时长 5分23秒` — 通话成功
- `[已取消]` — 呼叫方在被叫方接听前挂断

---

## 3. 聊天事件系统 — EventEmitter2 集成

聊天系统使用 **EventEmitter2** 实现消息创建与下游效果（Socket 广播、FCM、审计日志）之间的松耦合。

### 3.1 事件定义

```typescript
// chat.events.ts
export const CHAT_EVENTS = {
  MESSAGE_CREATED: 'chat.message.created',
  MESSAGE_RECALLED: 'chat.message.recalled',
  CONVERSATION_READ: 'chat.conversation.read',
  SUPPORT_CONVERSATION_STARTED: 'chat.support.conversation.started',
};

export class MessageCreatedEvent {
  constructor(
    public readonly messageId: string,
    public readonly conversationId: string,
    public readonly content: string,
    public readonly type: number,
    public readonly senderId: string,
    public readonly senderName: string,
    public readonly senderAvatar: string,
    public readonly createdAt: number,
    public readonly memberIds: string[],
    public readonly seqId: number,
    public readonly meta: any,
    public readonly conversationType?: string,
    public readonly businessId?: string,
    public readonly pushMemberIds?: string[],  // 仅用于推送通知
  ) {}
}
```

### 3.2 事件消费

[`SocketListener`](apps/api/src/common/events/listeners/socket.listener.ts) 消费这些事件：

```typescript
@OnEvent(CHAT_EVENTS.MESSAGE_CREATED)
handleMessageCreated(event: MessageCreatedEvent) {
  // 广播到会话房间（所有在线成员）
  this.eventsGateway.dispatch(
    `conversation:${event.conversationId}`,
    'chat_message',
    { ...event },
  );

  // 大群断路器：如果超过 500 名成员，使用定向分发
  if (event.memberIds.length > 500) {
    event.memberIds.forEach(userId => {
      this.eventsGateway.dispatchToUser(userId, 'chat_message', { ...event });
    });
  }
}
```

### 3.3 类型化事件类 vs 字符串事件

| 方式 | 示例 | 优点 | 缺点 |
|----------|---------|------|------|
| **类型化类** | `new MessageCreatedEvent(...)` | 类型安全，重构友好 | 模板代码较多的构造函数 |
| **字符串事件** | `this.eventEmitter.emit('chat.message.created', rawData)` | 代码更少 | 无类型检查 |

本项目对所有聊天事件使用 **类型化事件类**，确保消费者确切知晓期望的数据结构。

---

## 4. 聊天 DTO 架构 — Swagger 优先设计

聊天 DTO 遵循**响应优先**模式，专为 Swagger/OpenAPI 文档生成而设计。

### 4.1 DTO 层级

```
会话 DTO：
├── ConversationIdResponseDto       — 简单 ID 响应（创建）
├── ConversationListResponseDto     — 收件箱列表项
├── ConversationMemberDto           — 成员信息
└── ConversationDetailResponseDto   — 完整详情（含成员）

消息 DTO：
├── MessageSenderDto                — 发送者信息
├── MessageResponseDto              — 单条消息
└── MessageListResponseDto          — 分页列表（基于游标）
```

### 4.2 会话列表 DTO

```typescript
export class ConversationListResponseDto {
  @ApiProperty({ description: '会话 ID' })
  id!: string;

  @ApiProperty({ enum: Object.values(ConversationType) })
  type!: ConversationType;

  @ApiProperty({ description: '显示名称' })
  name!: string;

  @ApiProperty({ description: '最后一条消息的内容', required: false })
  lastMsgContent?: string | null;

  @ApiProperty({ description: '最后一条消息的时间戳（毫秒）' })
  lastMsgTime!: number;

  @ApiProperty({ description: '未读消息数' })
  unreadCount!: number;

  @ApiProperty({ description: '最后一条消息的序列 ID' })
  lastMsgSeqId!: number;

  constructor(partial: Partial<ConversationListResponseDto>) {
    Object.assign(this, partial);
  }
}
```

**构造函数模式** — 使用 `constructor(partial: Partial<...>)` 配合 `Object.assign`，可以在保持完整类型安全的同时，方便地从 Prisma 查询结果构建对象。

### 4.3 自愈同步字段

`ConversationDetailResponseDto` 包含用于**自愈同步**的字段：

```typescript
// --- 同步与自愈 ---
@ApiProperty({ description: '会话的最新 SeqId' })
lastMsgSeqId!: number;

@ApiProperty({ description: '当前用户最后已读的 SeqId' })
myLastReadSeqId!: number;

@ApiProperty({ description: '计算得出的未读数 = lastMsgSeqId - myLastReadSeqId' })
unreadCount!: number;
```

`unreadCount` 是从序列 ID **计算**得出而非存储为计数器，防止服务端与客户端之间出现漂移。

### 4.4 基于游标的消息分页

```typescript
export class MessageListResponseDto {
  @ApiProperty({ type: [MessageResponseDto] })
  list!: MessageResponseDto[];

  @ApiProperty({
    description: '下一个游标（null = 没有更多页）',
    required: false, nullable: true, type: String,
    example: 'msg_cl5s8x...',
  })
  nextCursor!: string | null;
}
```

聊天场景中，基于游标的分页优于基于偏移量的分页，因为新消息不断加入——基于偏移量会导致重复或跳过的消息。

### 4.5 枚举重导出模式

```typescript
// chat-shared-enums.ts
export { ChatMemberRole } from '@lucky/shared';  // 仅类型
export const CHAT_MEMBER_ROLE_VALUES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
```

这解决了一个 **Swagger CLI 插件 bug**：从工作区包重导出的枚举在编译输出中解析为错误的导入路径。使用带有 `as const` 的 `const` 数组是推荐的解决方案。

---

## 5. 通话结束消息流程

通话结束时，一条**系统消息**被写入聊天记录：

```
1. 用户结束通话
        │
        ▼
2. CallGateway.handleCallEnd()
        │
        ├── 向被叫方发送 'call_end' (Socket.IO)
        ├── 清除 pending_call Redis 键
        ├── sendCallEndMessage()
        │     │
        │     ▼
        │   确定内容：
        │   - 未接  → '[未接]'
        │   - 已拒绝 → '[已拒绝]'
        │   - 时长 > 0 → '[音频通话] 时长 5分23秒'
        │   - 其他 → '[已取消]'
        │     │
        │     ▼
        │   chatService.sendMessage() → Prisma $transaction
        │     │
        │     ▼
        │   EventEmitter 发出 'chat.message.created'
        │     │
        │     ▼
        │   SocketListener → Socket 广播 + FCM
        │
        └── 发出 'call.wake_up' (type: 'call_end')
              │
              ▼
            FCM 推送: data.type = 'call_end'
            (应用不会显示来电界面)
```

---

## 6. 对比：API 聊天系统 vs Admin-Next 聊天客户端

| 特性 | API (NestJS) | Admin-Next (Next.js) |
|---------|-------------|---------------------|
| **Socket.IO** | Gateway + Listener | [`useChatSocket`](apps/admin-next/src/hooks/useChatSocket.ts) hook |
| **通话信令** | `CallGateway`（4 条消息） | 不适用（管理员不通话） |
| **事件模式** | EventEmitter2 类型化事件 | Socket `dispatch` 监听器 |
| **消息存储** | Prisma + seqId | 不适用（只读） |
| **FCM 推送** | `call.wake_up` 事件 | 不适用 |
| **DTO 模式** | Swagger 装饰类 | Zod 验证表单 |
| **分页** | 基于游标 (message.seqId) | 基于偏移量（表格） |
| **自愈** | 基于 SeqId 的未读数 | 服务端已读回执 |

---

## 7. 关键要点

1. **4 消息 WebRTC 信令** — `call_invite` → `call_accept` → `call_ice` → `call_end` 覆盖完整通话生命周期，同时保持服务器作为透明中继（无媒体处理）。

2. **Redis 待接通话缓存** — 解决了 FCM 唤醒与 Socket.IO 连接建立之间的竞态条件。60 秒 TTL 确保缓存自动清理。

3. **EventEmitter2 解耦** — 聊天消息创建发出类型化事件（`MessageCreatedEvent`、`MessageRecalledEvent`），由 `SocketListener` 消费用于 Socket 广播和 FCM 推送，保持消息服务与投递机制无关。

4. **通话记录系统消息** — 每次通话结束生成一条聊天系统消息，包含结果（未接/已拒绝/时长/已取消），使通话记录可通过常规聊天消息 API 访问。

5. **自愈同步** — `unreadCount` 计算为 `lastMsgSeqId - myLastReadSeqId` 而非存储为计数器，无需服务端修复即可防止漂移。

6. **Swagger 枚举解决方案** — 从工作区包重导出的枚举导致 Swagger CLI 插件导入路径错误。修复方案是使用 `const CHAT_MEMBER_ROLE_VALUES = [...] as const` 直接传递给 `@ApiProperty({ enum: CHAT_MEMBER_ROLE_VALUES })`。
