# WebRTC 信令网关：NestJS WebSocket 实时通话信令设计

## 1. 引言

WebRTC 通话的核心挑战不在于媒体传输（P2P 通道会自动协商），而在于**信令交换**——呼叫方如何找到被叫方、Offer/Answer SDP 如何交换、ICE 候选者如何传达、以及当被叫方不在线时如何通过 FCM 推送唤醒。

本文以 NestJS 的 [`CallGateway`](apps/api/src/common/events/call/call.gateway.ts)（273 行）为例，解析基于 Socket.IO 的 WebRTC 信令网关设计。

## 2. 架构概览

```
┌─────────────┐          ┌───────────────────┐          ┌─────────────┐
│  Caller      │          │  NestJS Server    │          │  Callee     │
│  (Socket.IO) │          │  CallGateway      │          │  (Socket.IO)│
└──────┬───────┘          └─────────┬─────────┘          └──────┬──────┘
       │                            │                          │
       │ 1. call_invite             │                          │
       │   (sessionId, sdp,        │                          │
       │    mediaType) ────────────►│                          │
       │                            │  2. 转发到 user_{id}    │
       │                            │   room ────────────────►│
       │                            │                          │
       │                            │  3. 写入 Redis           │
       │                            │   pending_call:{id}      │
       │                            │   (60s TTL，离线兜底)    │
       │                            │                          │
       │                            │  4. EventEmitter         │
       │                            │   call.wake_up ─────────►│
       │                            │   (FCM Push，离线唤醒)   │
       │                            │                          │
       │                            │  5. call_accept          │
       │  ◄─────────────────────────│   (sdp answer) ──────────│
       │                            │                          │
       │                            │  6. call_ice (双向)      │
       │  ◄─────────────────────────│──────────────────────────│
       │                            │                          │
       │ 7. call_end                │                          │
       │   (reason, duration) ─────►│                          │
       │                            │  8. 转发 + Redis 清理    │
       │                            │   + 发送系统消息         │
       │  ◄─────────────────────────│──────────────────────────│
```

## 3. 信令事件全览

[`CallGateway`](apps/api/src/common/events/call/call.gateway.ts:25) 定义了 5 个 WebSocket 事件，每个事件对应 WebRTC 通话生命周期的一个步骤。

### 3.1 事件总表

| 事件名 | 方向 | DTO | 用途 |
|--------|------|-----|------|
| `call_invite` | Caller → Server → Callee | [`CallInviteDto`](apps/api/src/common/events/call/dto/call-signaling.dto.ts:24) | 发起通话，携带 Offer SDP |
| `call_accept` | Callee → Server → Caller | [`CallAcceptDto`](apps/api/src/common/events/call/dto/call-signaling.dto.ts:34) | 接听通话，携带 Answer SDP |
| `call_ice` | 双向 | [`CallIceCandidateDto`](apps/api/src/common/events/call/dto/call-signaling.dto.ts:41) | 交换 ICE 候选者 |
| `call_end` | 任意 → Server → 对方 | [`CallEndDto`](apps/api/src/common/events/call/dto/call-signaling.dto.ts:55) | 挂断/拒绝/取消 |
| `call_ringing` | Callee → Server → Caller | [`CallRingingDto`](apps/api/src/common/events/call/dto/call-signaling.dto.ts:79) | 对方已响铃 |

### 3.2 DTO 继承体系

```typescript
export class BaseCallDto {
  @IsUUID() @IsNotEmpty()
  sessionId!: string;  // 唯一通话 ID（前端生成 UUID v4）

  @IsString() @IsNotEmpty()
  targetId!: string;   // 接收方 ID
}

export class CallInviteDto extends BaseCallDto {
  @IsEnum(CallMediaType) mediaType!: CallMediaType;  // audio / video
  @IsString() @IsNotEmpty() sdp!: string;            // WebRTC Offer SDP
}

export class CallAcceptDto extends BaseCallDto {
  @IsString() @IsNotEmpty() sdp!: string;            // WebRTC Answer SDP
}

export class CallIceCandidateDto extends BaseCallDto {
  @IsString() @IsNotEmpty() candidate!: string;
  @IsString() @IsNotEmpty() sdpMid!: string;
  @IsNumber() sdpMLineIndex!: number;
}

export class CallEndDto extends BaseCallDto {
  @IsEnum(CallEndReason) reason!: CallEndReason;   // MISSED / REJECTED / ...
  @IsOptional() conversationId?: string;
  @IsOptional() mediaType?: CallMediaType;
  @IsOptional() @Min(0) duration?: number;         // 通话秒数
  @IsOptional() startedAt?: number;                // 开始时间戳
}
```

## 4. 核心机制详解

### 4.1 [呼叫邀请](apps/api/src/common/events/call/call.gateway.ts:53)：三重送达保证

`handleCallInvite` 使用三种机制确保呼叫消息送达：

```typescript
@SubscribeMessage('call_invite')
async handleCallInvite(client: Socket, payload: CallInviteDto) {
  const senderId = this.getUserId(client);
  
  // (A) 实时转发：目标在线则直接收到
  const targetRoom = `user_${payload.targetId}`;
  this.server.to(targetRoom).emit('call_invite', invitePayload);

  // (B) Redis 缓存：60秒 TTL，离线后上线补投
  await this.redisService.set(
    `pending_call:${payload.targetId}`,
    JSON.stringify(invitePayload),
    PENDING_CALL_TTL_SEC,  // 60秒
  );

  // (C) FCM 推送唤醒：通过 EventEmitter 触发
  this.eventEmitter.emit('call.wake_up', {
    type: 'call_invite',
    targetId: payload.targetId,
    sessionId: payload.sessionId,
    senderId: senderId,
    mediaType: payload.mediaType,
    conversationId,  // 预取会话 ID
  });
}
```

三种机制的关系：

| 机制 | 目标 | 延迟 | 适用场景 |
|------|------|------|---------|
| Socket.IO 直接转发 | 当前在线用户 | 实时 | App 在前台 |
| Redis `pending_call` | 60 秒内重连的用户 | 秒级 | App 在后台刚被杀死 |
| FCM Push (`call.wake_up`) | 完全离线的用户 | 数秒 | App 被系统杀死 |

**为什么需要预取 `conversationId`？**

```typescript
const conv = await this.chatService.ensureDirectConversation(
  senderId, payload.targetId,
);
conversationId = conv.id;
```

FCM payload 中需要包含 `conversationId`，这样被叫方收到 Push 后，点击通知可以直接打开正确的聊天页面。如果等到接听时再查询，FCM 通知栏无法携带该信息。

### 4.2 [接听呼叫](apps/api/src/common/events/call/call.gateway.ts:115)：Answer SDP 中继

```typescript
@SubscribeMessage('call_accept')
handleCallAccept(client: Socket, payload: CallAcceptDto) {
  const senderId = this.getUserId(client);
  const targetRoom = `user_${payload.targetId}`;
  this.server.to(targetRoom).emit('call_accept', {
    ...payload,  // 包含 answer sdp, sessionId
    senderId,
  });
}
```

这里的关键是 **信令服务器不做任何 SDP 解析或修改**——它只是纯中继（Relay）。Offer/Answer 的 SDP 协商完全由两端浏览器/客户端完成，服务器只负责送达。

### 4.3 [ICE 候选者交换](apps/api/src/common/events/call/call.gateway.ts:144)：高频数据包转发

```typescript
@SubscribeMessage('call_ice')
handleIceCandidate(client: Socket, payload: CallIceCandidateDto) {
  const senderId = this.getUserId(client);
  this.server.to(targetRoom).emit('call_ice', {
    ...payload,  // 包含 candidate, sdpMid, sdpMLineIndex
    senderId,
  });
}
```

ICE 交换的特点：
- **频次高**：一个通话可能交换数十到上百个候选者
- **日志级别低**：使用 `debug` 而非 `log`，避免打满日志
- **纯透传**：服务器不做任何 ICE 候选者筛选或处理

### 4.4 [挂断/拒绝/取消](apps/api/src/common/events/call/call.gateway.ts:166)：清理与记录

`handleCallEnd` 是最复杂的事件，因为它需要：

```typescript
@SubscribeMessage('call_end')
async handleCallEnd(client: Socket, payload: CallEndDto) {
  // 1. 转发挂断信号给目标
  this.server.to(targetRoom).emit('call_end', { ...payload, senderId });

  // 2. 清除 Redis 缓存（双方都要清）
  await this.redisService.del(`pending_call:${payload.targetId}`);
  await this.redisService.del(`pending_call:${senderId}`);

  // 3. 发送通话结束消息到聊天
  await this.sendCallEndMessage(senderId, payload);

  // 4. FCM 唤醒通知（告知对方通话已结束）
  this.eventEmitter.emit('call.wake_up', {
    targetId: payload.targetId,
    type: 'call_end',  // 必须透传！否则 FCM 会显示幽灵来电
    ...
  });
}
```

**FCM `type` 字段的 Bug 修复**：注释中特别强调 `type: 'call_end'` 必须透传，否则 FCM 的 `data.type` 会被硬编码为 `'call_invite'`，导致 App 收到后显示"幽灵来电屏幕"——这是一个已经踩过的坑。

## 5. 通话记录：系统消息持久化

挂断后，[`sendCallEndMessage`](apps/api/src/common/events/call/call.gateway.ts:204) 会生成一条系统消息写入聊天记录。

### 5.1 通话状态判断逻辑

```typescript
let content = '';

if (reason === CallEndReason.MISSED) {
  content = '[Missed]';
} else if (reason === CallEndReason.REJECTED) {
  content = '[Rejected]';
} else if (duration > 0) {
  const durationText = this.formatDuration(duration);
  content = `[${mediaTypeText}Call] Time ${durationText}`;
} else {
  content = '[Cancelled]';  // 发起方提前取消，时长为0
}
```

四种通话结束状态：

| 状态 | 条件 | 示例消息 |
|------|------|---------|
| `MISSED` | 对方未接听 | `[Missed]` |
| `REJECTED` | 对方拒绝 | `[Rejected]` |
| 正常结束 | `duration > 0` | `[AudioCall] Time 5m32s` |
| `CANCELLED` | `duration === 0` 且非上述原因 | `[Cancelled]` |

### 5.2 系统消息写入

```typescript
await this.chatService.sendMessage(callerId, {
  id: uuidv4(),
  conversationId: conversation.id,
  type: MESSAGE_TYPE.SYSTEM,        // 系统消息
  content,                          // '[AudioCall] Time 5m32s'
  meta: {
    callType: mediaType,            // audio / video
    duration: duration,
    startedAt: payload.startedAt,
    sessionId: payload.sessionId,
    reason: reason,
    isSystemCallEnd: true,          // 标记，前端渲染特殊样式
  },
});
```

这条消息在聊天列表中以系统消息形式展示，例如 "📞 [AudioCall] Time 5m32s"，点击可查看通话详情。

### 5.3 时长格式化

```typescript
private formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0)       return `${hours}h${minutes}m${secs}s`;
  else if (minutes > 0) return `${minutes}m${secs}s`;
  else                  return `${secs}s`;
}
```

## 6. 用户房间模式

信令网关的核心路由机制是**用户房间模式**：

```typescript
const targetRoom = `user_${payload.targetId}`;
this.server.to(targetRoom).emit('call_invite', payload);
```

| 概念 | 说明 |
|------|------|
| 房间名格式 | `user_{userId}` |
| 房间创建时机 | Socket 连接时由 [`EventsGateway.handleConnection`](apps/api/src/common/events/events.gateway.ts:82) 自动加入 |
| 路由方式 | 根据 `targetId` 拼接房间名，直接 emit |
| 多设备支持 | 同一用户多个 Socket 都在同一个 `user_{id}` 房间，所有设备同时收到 |

## 7. Redis 离线缓存

```typescript
const PENDING_CALL_TTL_SEC = 60;

await this.redisService.set(
  `pending_call:${payload.targetId}`,
  JSON.stringify(invitePayload),
  PENDING_CALL_TTL_SEC,
);
```

这个缓存有两个用途：

1. **离线后重连补投**——用户断网后重新连接 Socket，可以在 connection 时检查 `pending_call:{userId}` 是否有未接来电
2. **FCM 点击回调**——用户点击 FCM 通知打开 App，从 `pending_call` 中读取呼叫详情，直接显示来电界面

TTL 设为 60 秒与呼叫超时时间对齐——超过 60 秒未接听，缓存自动过期。

## 8. 安全与边界处理

### 8.1 用户身份验证

```typescript
private getUserId(client: Socket): string | null {
  const data = client.data as Record<string, unknown>;
  return typeof data.userId === 'string' ? data.userId : null;
}
```

所有信令事件首先检查 `client.data.userId`——这个值由 [`EventsGateway.handleConnection`](apps/api/src/common/events/events.gateway.ts:82) 在连接建立时通过 JWT 认证后挂载。如果 socket 没有 userId，信令被直接拒绝。

### 8.2 错误隔离

```typescript
// 查询失败不阻断信令
try {
  conv = await this.chatService.ensureDirectConversation(...);
} catch {
  // conversationId 留 undefined
}

// 发送通话记录失败只打日志
try {
  await this.chatService.sendMessage(...);
} catch (error) {
  this.logger.error(`生成通话记录失败: ${error}`);
}
```

核心原则：**信令传输不能因为辅助功能的失败而被阻断**。conversationId 查询、通话记录写入都是附加功能，失败时最多影响体验（FCM 缺少会话上下文、聊天记录缺失），但不影响核心通话建立。

## 9. 架构总结

### 9.1 完整的通话生命周期

```
 Caller                    Server                   Callee
   │                         │                        │
   │──── call_invite ───────►│──── call_invite ──────►│
   │                         │   + Redis pending_call  │
   │                         │   + FCM call.wake_up    │
   │                         │                        │
   │◄─── call_ringing ──────│◄─── call_ringing ───────│
   │                         │                        │
   │◄─── call_accept ───────│◄─── call_accept ────────│
   │                         │                        │
   │◄─── call_ice ──────────│◄─── call_ice ───────────│ (双向多次)
   │──── call_ice ──────────►──── call_ice ──────────►│
   │                         │                        │
   │  === WebRTC P2P Media === (音频/视频流)          │
   │                         │                        │
   │──── call_end ──────────►──── call_end ──────────►│
   │   (reason, duration)    │   + Redis 清理          │
   │                         │   + 系统消息写入         │
   │                         │   + FCM call_end        │
```

### 9.2 信令网关的设计模式

| 模式 | 实现 |
|------|------|
| **纯中继（Relay）** | 服务器不解码 SDP/ICE，只负责转发 |
| **用户房间路由** | `user_{id}` 房间名 + `server.to(room).emit()` |
| **三重送达保证** | Socket.IO + Redis + FCM |
| **离线缓存** | `pending_call:{id}` 60s TTL |
| **故障隔离** | 辅助功能（聊天记录）失败不阻断信令 |
| **枚举语义化** | `CallEndReason.MISSED` / `CallMediaType.VIDEO` |

---

*本文源码基于 [`apps/api/src/common/events/call/call.gateway.ts`](apps/api/src/common/events/call/call.gateway.ts)（273行）和 [`call-signaling.dto.ts`](apps/api/src/common/events/call/dto/call-signaling.dto.ts)（80行），完整包含 5 个信令事件、Redis 离线缓存、FCM 唤醒推送、通话记录系统消息、ICE 候选者中继等全部实现。*
