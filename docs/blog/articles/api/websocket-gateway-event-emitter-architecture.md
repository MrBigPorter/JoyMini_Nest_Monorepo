# API WebSocket 实时通信 — Gateway + EventEmitter 事件分发架构

## 一、概述

JoyMini API 的实时通信系统基于 **Socket.IO** + **NestJS EventEmitter** 构建，采用统一的事件分发模式。核心架构分为三层：

```
┌─────────────────────────────────────────────┐
│              EventsGateway                  │
│         (Socket.IO, namespace: /events)      │
│                                              │
│  dispatch(room, type, data)  ← 统一分发出口   │
└──────────────────────┬──────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ SocketRoom   │ │ user_X   │ │ conversation │
│ (lobby)      │ │ (私密)   │ │ (聊天房间)   │
└──────────────┘ └──────────┘ └──────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│              SocketListener                  │
│     (EventEmitter @OnEvent 监听器)           │
│                                              │
│  chat_message → 房间广播 + 成员推送 + 熔断     │
│  message_recalled → 撤回广播 + 成员推送       │
│  conversation_read → 已读同步                 │
│  support_new_conversation → admin 通知        │
└─────────────────────────────────────────────┘
```

---

## 二、EventsGateway — Socket.IO 网关

### 2.1 网关配置

```typescript
// apps/api/src/common/events/events.gateway.ts
@WebSocketGateway({
  namespace: '/events',
  cors: { origin: '*' },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: any;
```

### 2.2 连接认证 + 私有房间

```typescript
async handleConnection(client: Socket) {
  const token = client.handshake.query.token || client.handshake.auth?.token;

  if (token) {
    // 尝试两种 JWT Secret（client / admin）
    const secrets = [process.env.JWT_SECRET, process.env.ADMIN_JWT_SECRET].filter(Boolean);
    for (const secret of secrets) {
      try {
        const payload = this.jwtService.verify<JwtPayloadLike>(token, { secret });
        userId = payload.sub;
        break;
      } catch { /* try next */ }
    }

    if (userId) {
      const privateRoom = `user_${userId}`;
      await client.join(privateRoom);
      setSocketUserId(client, userId);

      // FCM 唤醒重连时，补投待接来电
      const pendingCall = await this.redisService.get(`pending_call:${userId}`);
      if (pendingCall) {
        client.emit('call_invite', JSON.parse(pendingCall));
      }
    }
  }
}
```

**关键设计**：
- **双 Secret 认证**：依次尝试 client JWT 和 admin JWT，一套网关服务两种用户
- **私有房间**：每个用户自动加入 `user_{userId}` 房间，用于点对点推送
- **来电补投**：通过 Redis 缓存待接来电，重连时自动推送

### 2.3 统一分发方法（核心）

```typescript
dispatch(room: string, type: string, data: unknown, excludeRoom?: string) {
  const payload = { type, data };

  if (excludeRoom) {
    this.server.to(room).except(excludeRoom).emit(SocketEvents.DISPATCH, payload);
  } else {
    this.server.to(room).emit(SocketEvents.DISPATCH, payload);
  }
}
```

**所有业务通知都必须经过 `dispatch()`**，前端只监听 `SocketEvents.DISPATCH`（`'dispatch'`）一个事件，通过 `payload.type` 区分业务类型：

```typescript
// 前端监听示例
socket.on('dispatch', (payload) => {
  switch (payload.type) {
    case 'chat_message':      // 新消息
    case 'message_recalled':   // 消息撤回
    case 'conversation_read':  // 已读回执
    case 'group_update':       // 拼团更新
    case 'support_new_conversation': // 客服新会话
  }
});
```

### 2.4 聊天房间管理

```typescript
@SubscribeMessage(SocketEvents.JOIN_CHAT)
async handleJoinChat(client: Socket, payload) {
  const conversationId = extractConversationId(payload);
  await client.join(conversationId);
  return { status: 'joined', conversationId };
}

@SubscribeMessage(SocketEvents.LEAVE_CHAT)
handleLeaveChat(client: Socket, payload) {
  const conversationId = extractConversationId(payload);
  client.leave(conversationId);
}
```

### 2.5 消息发送（Prisma 事务）

```typescript
@SubscribeMessage(SocketEvents.SEND_MESSAGE)
async handleSendMessage(client: Socket, payload) {
  // 使用 $transaction 保证 seqId 递增一致性
  const result = await this.prismaService.$transaction(async (tx) => {
    await tx.conversation.updateMany({
      where: { id: conversationId },
      data: { lastMsgSeqId: { increment: 1 } },
    });

    const seqId = await this.getSeqId(tx, conversationId);

    const msg = await tx.chatMessage.create({
      data: { conversationId, senderId: userId, content, type, seqId, clientTempId },
      include: { sender: true },
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMsgContent: content, lastMsgType: type, lastMsgTime: new Date() },
    });
    return msg;
  });

  // 房间广播
  this.dispatch(conversationId, SocketEvents.CHAT_MESSAGE, { ...result, isSelf: false });

  // 触发完整分发链 → SocketListener 处理成员推送 + FCM
  this.eventEmitter.emit(CHAT_EVENTS.MESSAGE_CREATED, new MessageCreatedEvent(...));
}
```

---

## 三、SocketListener — EventEmitter 事件监听

### 3.1 架构模式

使用 NestJS 的 `EventEmitter2` 进行模块解耦：

```
EventsGateway (WebSocket)
  │ emit(CHAT_EVENTS.MESSAGE_CREATED, event)
  ▼
SocketListener (@OnEvent)
  │ dispatch() → 房间广播 + 成员推送
  ▼
EventsGateway (WebSocket)
  └── dispatch(conversationId, 'chat_message', payload)
  └── dispatch(`user_${userId}`, 'chat_message', payload)
```

### 3.2 消息创建事件

```typescript
@OnEvent(CHAT_EVENTS.MESSAGE_CREATED)
handleMessageCreated(event: MessageCreatedEvent) {
  const socketPayload = {
    id: event.messageId,
    conversationId: event.conversationId,
    content: event.content, type: event.type, seqId: event.seqId,
    sender: { id: event.senderId, nickname: event.senderName, avatar: event.senderAvatar },
    isSelf: false,
  };

  // A. 房间广播 (O(1)) — 实时聊天
  this.eventsGateway.dispatch(event.conversationId, SocketEvents.CHAT_MESSAGE, socketPayload);

  // B. 成员推送 — 列表预览更新（含熔断）
  if (event.memberIds.length <= this.LARGE_GROUP_THRESHOLD) {
    event.memberIds.forEach((userId) => {
      if (userId !== event.senderId) {
        this.eventsGateway.dispatch(`user_${userId}`, SocketEvents.CHAT_MESSAGE, socketPayload);
      }
    });
  }
}
```

### 3.3 大群熔断

```typescript
private readonly LARGE_GROUP_THRESHOLD = 500;
```

超过 500 人的大群，不再给每个成员单独推送列表预览（避免 O(n) 循环导致性能问题），依赖前端自愈机制刷新列表。

### 3.4 消息撤回事件

```typescript
@OnEvent(CHAT_EVENTS.MESSAGE_RECALLED)
handleMessageRecall(event: MessageRecalledEvent) {
  const recallPayload = {
    conversationId: event.conversationId,
    messageId: event.messageId,
    tip: 'A message was recalled',
    operatorId: event.operatorId,
    seqId: event.seqId,
  };

  // 房间广播（实时撤回）
  this.eventsGateway.dispatch(event.conversationId, SocketEvents.MESSAGE_RECALLED, recallPayload);

  // 成员推送（含熔断）
  if (event.memberIds.length <= this.LARGE_GROUP_THRESHOLD) {
    event.memberIds.forEach((userId) => {
      this.eventsGateway.dispatch(
        `user_${userId}`, SocketEvents.MESSAGE_RECALLED,
        { ...recallPayload, isSelf: event.operatorId === userId },
        event.conversationId,  // 排除已在房间内的人
      );
    });
  }
}
```

### 3.5 客服新会话通知

```typescript
@OnEvent(CHAT_EVENTS.SUPPORT_CONVERSATION_STARTED)
async handleSupportConversationStarted(event) {
  const supportAdmins = await this.prismaService.adminUser.findMany({
    where: { status: 1, deletedAt: null },
    select: { id: true },
  });

  supportAdmins.forEach((admin) => {
    this.eventsGateway.dispatch(
      `user_${admin.id}`, 'support_new_conversation', payload,
    );
  });
}
```

当 Flutter 用户首次点击「联系客服」时，通知所有在线 Admin 刷新会话列表。

---

## 四、Call Gateway — WebRTC 通话

```typescript
// apps/api/src/common/events/call/call.gateway.ts
@WebSocketGateway({ namespace: '/call', cors: { origin: '*' } })
export class CallGateway {
  @SubscribeMessage('call_invite')
  async handleCallInvite(client: Socket, data: CallSignalingDto) {
    // 通过 Redis 缓存来电，用于 FCM 唤醒后补投
    await this.redisService.set(`pending_call:${data.targetUserId}`, JSON.stringify(data), 30);
    // 推送到目标用户的私有房间
    this.eventsGateway.dispatch(`user_${data.targetUserId}`, 'call_invite', data);
  }
}
```

---

## 五、与其他项目对比

| 维度 | API (NestJS) | admin-next (Next.js) | frontend-blog |
|------|-------------|---------------------|--------------|
| 框架 | Socket.IO + EventEmitter2 | Socket.IO Client | — |
| 房间 | `user_{id}` / `conversationId` / `group_lobby` | Socket rooms | — |
| 分发 | 统一 `dispatch()` 模式 | 不适用（客户端仅接收） | — |
| 认证 | 双 Secret JWT 验证 | JWT token 传递 | — |
| 熔断 | 500 人大群阈值 | — | — |
| 离线推送 | Redis 缓存 + FCM 补投 | — | — |
| 事件模型 | EventEmitter 解耦 | callback ref bridge | — |

---

## 六、最佳实践

1. **统一 `dispatch()` 出口**：所有业务通知必须经过 `dispatch()`，前端只监听一个入口事件，通过 `type` 区分
2. **使用 `except()` 去重**：分发时排除已在房间内的用户，避免消息重复
3. **大群熔断**：超过阈值的群聊，不逐个推送列表预览，防止性能退化
4. **Redis 来电缓存**：用户断开期间收到的通话邀请，通过 Redis 缓存，重连后补投
5. **Prisma 事务保证 seqId**：消息发送在事务中递增 `lastMsgSeqId`，保证聊天顺序一致性
