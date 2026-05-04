# 端到端推送通知——NestJS Event-Driven FCM × Flutter 三层分发 × admin 后台管理

## 1. 概述

本文深入剖析本项目的**推送通知全链路架构**，从 NestJS API 端的消息创建→事件驱动→Firebase Cloud Messaging (FCM) 推送，到 Flutter 客户端的三层分发策略，再到 admin-next 后台的推送管理面板。

```
┌──────────────────────────────────────────────────────────────────┐
│                      API (NestJS)                                │
│                                                                  │
│  ChatService.sendMessage()                                       │
│    └─ EventEmitter.emit(CHAT_EVENTS.MESSAGE_CREATED)            │
│         └─ PushListener.handleFcmPush()                         │
│              └─ NotificationService.sendPrivateMessage()         │
│                   └─ admin.messaging().sendEachForMulticast()    │
│                        └─ Firebase Cloud Messaging (FCM)         │
│                             └─ 推送至设备                         │
│                                                                  │
│  CallGateway.handleCallInvite()                                  │
│    └─ EventEmitter.emit('call.wake_up')                         │
│         └─ PushListener.handleCallWakeUp()                      │
│              └─ NotificationService.sendCallWakeUpPush()         │
│                   └─ FCM Data-only Push                          │
│                        └─ 唤醒 App + CallDispatcher              │
│                                                                  │
│  AdminNotificationController                                     │
│    └─ AdminNotificationService                                   │
│         ├─ sendBroadcast() → Topic Push                          │
│         └─ sendTargeted() → Private Message                      │
│              └─ 操作审计日志写入 AdminPushLog                     │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Flutter App                                     │
│                                                                  │
│  firebaseMessagingBackgroundHandler (isolate)                    │
│    └─ CallDispatcher.dispatch()  ← 音视频信令直通                │
│                                                                  │
│  FcmService.setupMsgListeners()                                  │
│    ├─ onMessage (前台) → FcmDispatcher.dispatch()               │
│    ├─ onMessageOpenedApp (后台点击) → dispatch(isInteraction: t) │
│    └─ getInitialMessage (冷启动) → dispatch(isInteraction: t)    │
│                                                                  │
│  FcmDispatcher                                                   │
│    ├─ 音视频信令拦截 → CallDispatcher                            │
│    ├─ _handleInteraction → Handler 链                            │
│    │    ├─ ChatActionHandler → /chat/room/${id}                  │
│    │    ├─ GroupActionHandler → groupRoom                        │
│    │    └─ LuckyDrawActionHandler → /lucky-draw                  │
│    └─ _handleForeground → FcmUiFactory.showNotification()        │
│                                                                  │
│  fcmInitProvider (Riverpod)                                      │
│    ├─ setupMsgListeners()                                        │
│    ├─ getToken() → uploadTokenToBackend()                        │
│    └─ onTokenRefresh → uploadTokenToBackend()                    │
└──────────────────────────────────────────────────────────────────┘
```

**核心文件一览：**

| 层 | 文件 | 职责 |
|----|------|------|
| API (NestJS) | [`notification.service.ts`](apps/api/src/client/notification/notification.service.ts:1) | FCM 核心：发送私信、全员广播、音视频来电唤醒、设备注册 |
| API (NestJS) | [`push.listener.ts`](apps/api/src/client/notification/listeners/push.listener.ts:1) | 事件驱动：监听聊天消息和来电事件，触发推送 |
| API (NestJS) | [`notification.controller.ts`](apps/api/src/client/notification/notification.controller.ts:1) | 客户端接口：设备注册、测试推送 |
| API (NestJS) | [`admin/notification.service.ts`](apps/api/src/admin/notification/notification.service.ts:1) | 管理后台：推送历史查询、设备统计、广播/定向推送 |
| API (NestJS) | [`admin/notification.controller.ts`](apps/api/src/admin/notification/notification.controller.ts:1) | 管理后台 API 端点 |
| API (NestJS) | [`call.gateway.ts`](apps/api/src/common/events/call/call.gateway.ts:1) | 音视频通话信令网关，触发 FCM 唤醒 |
| API (NestJS) | [`chat.events.ts`](apps/api/src/common/chat/events/chat.events.ts:1) | 聊天事件定义，含 `pushMemberIds` 免打扰过滤 |
| Flutter | [`fcm_service.dart`](JoyMini_Flutter_App/lib/core/services/fcm/fcm_service.dart:1) | FCM 服务：Token 获取、权限请求、消息监听 |
| Flutter | [`fcm_dispatcher.dart`](JoyMini_Flutter_App/lib/core/services/fcm/fcm_dispatcher.dart:1) | 三层分发器：幂等校验→类型路由→交互/前台分流 |
| Flutter | [`fcm_payload.dart`](JoyMini_Flutter_App/lib/core/services/fcm/fcm_payload.dart:1) | 推送载荷强类型：FcmType 枚举 + FcmPayload 模型 |
| Flutter | [`fcm_ui_factory.dart`](JoyMini_Flutter_App/lib/core/services/fcm/fcm_ui_factory.dart:1) | 前台通知 UI：BotToast 卡片 + 动态图标 + 点击回调 |
| Flutter | [`fcm_service_provider.dart`](JoyMini_Flutter_App/lib/core/providers/fcm_service_provider.dart:1) | Riverpod 集成：服务注册 + Token 上报 + 刷新监听 |
| Flutter | [`bootstrap.dart`](JoyMini_Flutter_App/lib/app/bootstrap.dart:1) | 应用引导：Firebase 初始化 + 后台消息处理器注册 |
| Flutter | [`chat_handler.dart`](JoyMini_Flutter_App/lib/core/services/fcm/handlers/chat_handler.dart:1) | 聊天消息推送处理：跳转聊天室 |
| Flutter | [`group_handler.dart`](JoyMini_Flutter_App/lib/core/services/fcm/handlers/group_handler.dart:1) | 群组推送处理：跳转群组页 |
| Flutter | [`lucky_draw_handler.dart`](JoyMini_Flutter_App/lib/core/services/fcm/handlers/lucky_draw_handler.dart:1) | 抽奖券推送处理：跳转抽奖页 |

---

## 2. 消息推送主链路

### 2.1 链路全景

当用户在聊天中发送一条消息时，完整的推送链路如下：

```
用户 A 发送消息
    │
    ▼
ChatService.sendMessage()
    │
    ├─ 入库消息到 DB
    ├─ Socket 广播给在线用户
    └─ EventEmitter.emit(CHAT_EVENTS.MESSAGE_CREATED, event)
         │
         ▼
    PushListener.handleFcmPush(event)
         │
         ├─ 1. 熔断检查：targetIds 为空则跳过
         ├─ 2. 预览文本生成：_getPreviewText(type, content)
         └─ 3. 并发推送：targetIds.map(sendPrivateMessage)
              │
              ▼
         NotificationService.sendPrivateMessage(userId, title, body, data)
              │
              ├─ 查询用户设备 Token
              ├─ 构造 MulticastMessage
              │    ├─ notification: { title, body }
              │    ├─ data: { type, id, click_action }
              │    ├─ android: { priority: 'high', channelId, sound }
              │    └─ apns: { apns-priority: '10', contentAvailable: true }
              └─ admin.messaging().sendEachForMulticast(message)
                   │
                   ├─ 成功计数 / 失败计数
                   └─ 失败 Token 清理 → deleteInvalidToken()
```

### 2.2 事件定义 [`chat.events.ts`](apps/api/src/common/chat/events/chat.events.ts:1)

`CHAT_EVENTS` 常量定义了系统内所有聊天相关事件名：

```typescript
export const CHAT_EVENTS = {
  MESSAGE_CREATED: 'chat.message.created',   // 消息创建
  MESSAGE_RECALLED: 'chat.message.recalled', // 消息撤回
  CONVERSATION_READ: 'chat.conversation.read', // 会话已读
  SUPPORT_CONVERSATION_STARTED: 'chat.support.conversation.started', // 客服会话
};
```

`MessageCreatedEvent` 是推送链路的入口数据载体，包含发送方信息、接收方列表、消息类型等：

```typescript
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
    public readonly pushMemberIds?: string[], // 免打扰过滤后的推送目标
  ) {}
}
```

关键设计点：`pushMemberIds` 字段。当大群用户开启免打扰模式时，ChatService 会在事件中只保留未静音的用户 ID，避免对所有成员盲目推送。

### 2.3 PushListener——事件驱动的推送触发器 [`push.listener.ts`](apps/api/src/client/notification/listeners/push.listener.ts:1)

`PushListener` 是一个 `@Injectable()` 服务，通过 `@nestjs/event-emitter` 监听 `CHAT_EVENTS.MESSAGE_CREATED` 和 `call.wake_up` 事件。

```typescript
@Injectable()
export class PushListener {
  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent(CHAT_EVENTS.MESSAGE_CREATED, { async: true })
  async handleFcmPush(event: MessageCreatedEvent) {
    // 1. 优先使用免打扰过滤后的 pushMemberIds
    const targetIds = event.pushMemberIds || event.memberIds || [];

    // 2. 熔断：空列表则跳过
    if (targetIds.length === 0) {
      this.logger.debug(`[FCM] Skip push for empty target list`);
      return;
    }

    // 3. 生成预览文本
    const previewText = this._getPreviewText(event.type, event.content);

    // 4. 并发推送，排除发送者自己
    const pushPromises = targetIds.map(async (targetId) => {
      if (targetId === event.senderId) return;
      return this.notificationService.sendPrivateMessage(
        targetId, event.senderName, previewText, {
          type: 'chat',
          id: event.conversationId,
          title: event.senderName,
          body: previewText,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
      );
    });

    await Promise.allSettled(pushPromises);
  }
}
```

**三个关键设计：**

1. **`pushMemberIds` 免打扰过滤**：ChatService 在发送事件前会过滤已开启免打扰的成员，减少无效推送
2. **`Promise.allSettled` 并发推送**：将所有目标用户的推送请求并发执行，避免串行等待。数百用户的推送可在几百毫秒内完成
3. **排除发送者**：`if (targetId === event.senderId) return`，不让发送者收到自己的消息推送

预览文本生成器 `_getPreviewText` 根据消息类型返回国际化友好文本：

| 消息类型 | 预览文本 |
|---------|---------|
| `MESSAGE_TYPE.TEXT` | 原文内容 |
| `MESSAGE_TYPE.IMAGE` | `[Image]` |
| `MESSAGE_TYPE.AUDIO` | `[Voice]` |
| `MESSAGE_TYPE.VIDEO` | `[Video]` |
| `MESSAGE_TYPE.FILE` | `[File]` |
| `MESSAGE_TYPE.LOCATION` | `[Location]` |
| 系统消息 (99) | `[System] ${content}` |

### 2.4 NotificationService——FCM 发送核心 [`notification.service.ts`](apps/api/src/client/notification/notification.service.ts:1)

#### 2.4.1 初始化：Firebase Admin SDK

`OnModuleInit` 钩子在模块加载时读取 `FIREBASE_ADMIN_CREDENTIALS` 环境变量，初始化 Firebase Admin SDK：

```typescript
@Injectable()
export class NotificationService implements OnModuleInit {
  onModuleInit() {
    if (!admin.apps.length) {
      const firebaseConfig = this.configService.get<string>('FIREBASE_ADMIN_CREDENTIALS');
      if (!firebaseConfig) {
        this.logger.warn('FIREBASE_CONFIG is not set.');
        return;
      }
      const serviceAccount = JSON.parse(firebaseConfig);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
  }
}
```

#### 2.4.2 设备注册 `registerDevice`

每次 Flutter App 启动或登录/退出时调用：

```typescript
async registerDevice(token: string, platform: string, userId?: string) {
  // PRISMA UPSERT：Token 唯一，存在则更新，不存在则创建
  const device = await this.prisma.device.upsert({
    where: { token },
    update: { platform, userId: userId || null, lastActive: new Date() },
    create: { token, platform, userId: userId || null },
  });

  // 自动订阅全员广播 Topic
  try {
    await admin.messaging().subscribeToTopic(token, this.GLOBAL_TOPIC);
  } catch (e) {
    this.logger.warn(`Failed to subscribe token to global topic: ${e}`);
  }
  return device;
}
```

**设计要点：**

- **upsert**：确保同一个 Token 在数据库中只有一条记录
- **userId 可解绑**：用户退出登录时，`userId` 传 `undefined` 即可解绑
- **Topic 自动订阅**：每次注册都自动订阅 `all_users` Topic，后续全员广播无需查库
- **`lastActive` 更新**：用于统计活跃设备数

#### 2.4.3 私信推送 `sendPrivateMessage`

向指定用户的所有设备发送推送，使用 `sendEachForMulticast` 实现批量发送：

```typescript
async sendPrivateMessage(userId: string, title: string, body: string, data?: any) {
  // 1. 查用户设备 Token
  const devices = await this.prisma.device.findMany({
    where: { userId },
    select: { token: true },
  });
  if (!devices.length) return;

  const tokens = devices.map((d) => d.token);

  // 2. 构造多播消息
  const message: admin.messaging.MulticastMessage = {
    notification: { title, body },
    data: data || {},
    tokens,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        channelId: 'high_importance_channel',
      },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          contentAvailable: true, // 后台唤醒
        },
      },
    },
  };

  // 3. 发送并处理失败
  const response = await admin.messaging().sendEachForMulticast(message);
  if (response.failureCount > 0) {
    response.responses.forEach((resp, idx) => {
      if (!resp.success &&
          resp.error?.code === 'messaging/registration-token-not-registered') {
        void this.deleteInvalidToken(tokens[idx]);
      }
    });
  }
}
```

**跨平台配置策略：**

| 配置项 | Android | iOS |
|--------|---------|-----|
| 优先级 | `priority: 'high'` | `apns-priority: '10'` |
| 音效 | `sound: 'default'` | `sound: 'default'` |
| 通知渠道 | `channelId: 'high_importance_channel'` | ❌ |
| 后台唤醒 | ❌ | `contentAvailable: true` |
| 角标 | ❌ | `badge: 1` |
| 点击跳转 | `clickAction: 'FLUTTER_NOTIFICATION_CLICK'` | ❌ |

**失效 Token 自动清理**：当 FCM 返回 `messaging/registration-token-not-registered` 错误时，自动删除该 Token 记录。

#### 2.4.4 全员广播 `sendBroadcast`

使用 FCM Topic 推送机制，所有已注册设备自动订阅了 `all_users` Topic：

```typescript
async sendBroadcast(title: string, body: string, data?: any) {
  const message: admin.messaging.Message = {
    topic: this.GLOBAL_TOPIC, // 全员广播 Topic
    notification: { title, body },
    data: data || {},
    // ... 跨平台配置同上
  };

  const response = await admin.messaging().send(message);
  return { success: true, messageId: response };
}
```

---

## 3. 音视频来电唤醒（Data-only Push）

### 3.1 特殊需求

音视频来电推送与普通消息推送有本质区别：

1. **必须唤醒 App**：用户可能在后台或 Kill 状态，需要显示来电屏幕
2. **不能有通知栏弹窗**：来电应直接显示 CallKit UI，而非通知栏消息
3. **实时性要求极高**：必须在秒级内送达
4. **防幽灵来电**：`call_end` 推送必须正确透传 type 字段

### 3.2 呼叫网关触发 [`call.gateway.ts`](apps/api/src/common/events/call/call.gateway.ts:1)

`CallGateway` 是 WebSocket 信令网关，处理音视频通话的信令交换。

当用户发起呼叫时：

```typescript
@SubscribeMessage('call_invite')
async handleCallInvite(@ConnectedSocket() client: Socket, @MessageBody() payload: CallInviteDto) {
  // 1. Socket 转发给在线用户
  this.server.to(targetRoom).emit('call_invite', invitePayload);

  // 2. Redis 缓存 pending_call（FCM 唤醒后重连补投）
  await this.redisService.set(`pending_call:${payload.targetId}`, JSON.stringify(invitePayload), 60);

  // 3. 触发 FCM 唤醒
  this.eventEmitter.emit('call.wake_up', {
    type: 'call_invite',      // 必须显式传递！
    targetId: payload.targetId,
    sessionId: payload.sessionId,
    senderId: senderId,
    mediaType: payload.mediaType,
    conversationId,
  });
}
```

**关键设计：**

- **Redis pending_call**：`TLL 60 秒`，当用户被 FCM 唤醒后重连 WebSocket 时，CallDispatcher 会检查是否有未处理的来电
- **conversationId 预取**：在 FCM payload 中预填会话 ID，让 Flutter 拒接时能发送 `call_end` 到正确的会话

当通话结束时：

```typescript
@SubscribeMessage('call_end')
async handleCallEnd(...) {
  // ...
  // type: 'call_end' 必须透传！
  this.eventEmitter.emit('call.wake_up', {
    targetId: payload.targetId,
    type: 'call_end',         // ← 命脉：不能硬编码为 call_invite！
    sessionId: payload.sessionId,
    // ...
  });
}
```

> **⚠️ 幽灵来电防御**：`type` 字段必须透传事件本身的类型（`call_invite` / `call_end`），绝不能硬编码。否则 `call_end` 时 Flutter 收到 type=call_invite 的 FCM，会显示"幽灵来电"屏幕，导致后续来电无法正常接收。

### 3.3 Data-only Push 实现 [`notification.service.ts:208`](apps/api/src/client/notification/notification.service.ts:208)

```typescript
async sendCallWakeUpPush(targetUserId: string, callData: {
  type?: string; sessionId?: string; senderId?: string;
  mediaType?: string; senderName?: string; senderAvatar?: string;
  conversationId?: string;
}) {
  const devices = await this.prisma.device.findMany({
    where: { userId: targetUserId },
    select: { token: true },
  });
  if (!devices.length) return;
  const tokens = devices.map((d) => d.token);

  const message: admin.messaging.MulticastMessage = {
    tokens,
    // 命脉 1：绝对不能写 notification 字段！只能写 data！
    data: {
      type: String(callData.type || 'call_invite'),
      sessionId: callData.sessionId || '',
      senderId: callData.senderId || '',
      mediaType: callData.mediaType || '',
      senderName,
      senderAvatar,
      conversationId: callData.conversationId || '',
      timestamp: String(Date.now()),
    },
    // 命脉 2：安卓必须强制 High 优先级
    android: { priority: 'high' },
    // 命脉 3：iOS 静默唤醒
    apns: {
      headers: { 'apns-priority': '10', 'apns-push-type': 'background' },
      payload: { aps: { contentAvailable: true } },
    },
  };

  await admin.messaging().sendEachForMulticast(message);
}
```

**Data-only vs Notification 推送对比：**

| 特性 | 普通通知推送 | Data-only 推送 |
|------|------------|---------------|
| `notification` 字段 | ✅ 有 | ❌ 绝对不能有 |
| `data` 字段 | ✅ 可选 | ✅ 必须 |
| 系统通知栏 | ✅ 自动显示 | ❌ 不显示 |
| 后台唤醒 | ⚠️ 有限制 | ✅ `contentAvailable: true` |
| 自定义 UI | ❌ | ✅ Flutter 自行渲染 |
| 适用场景 | 聊天消息、活动通知 | 来电唤醒、静默数据同步 |

---

## 4. Flutter 端三层分发架构

### 4.1 架构总览

Flutter 端采用**三层分发架构**处理 FCM 推送：

```
第一层：FcmService —— 消息源接入层
┌─────────────────────────────────────┐
│  FirebaseMessaging.onMessage        │  ← 前台消息
│  FirebaseMessaging.onMessageOpenedApp│  ← 后台点击
│  FirebaseMessaging.getInitialMessage │  ← 冷启动
│  firebaseMessagingBackgroundHandler  │  ← 后台 isolate
└──────────────┬──────────────────────┘
               │ 统一转化为 RemoteMessage
               ▼
第二层：FcmDispatcher —— 路由分发层
┌─────────────────────────────────────┐
│  1. 幂等性校验                       │
│  2. 音视频信令拦截 → CallDispatcher │
│  3. 类型路由                        │
│     ├─ isInteraction=true → Handler │
│     └─ isInteraction=false → UiFactory│
└──────────────┬──────────────────────┘
               │
     ┌─────────┼────────────┐
     ▼         ▼            ▼
第三层：Handler 链 —— 业务执行层
┌──────────┐ ┌──────────┐ ┌──────────────┐
│ Chat     │ │ Group    │ │ LuckyDraw    │
│ Handler  │ │ Handler  │ │ Handler      │
│ →聊天室  │ │ →群组页  │ │ →抽奖页      │
└──────────┘ └──────────┘ └──────────────┘
```

### 4.2 FcmService——接入层 [`fcm_service.dart`](JoyMini_Flutter_App/lib/core/services/fcm/fcm_service.dart:1)

```dart
class FcmService {
  final FirebaseMessaging _firebaseMessaging = FirebaseMessaging.instance;
  final FcmDispatcher _dispatcher = FcmDispatcher();

  // 1. 获取 Token：请求权限 → 获取设备令牌
  Future<String?> getToken() async {
    NotificationSettings settings = await _firebaseMessaging.requestPermission(
      alert: true, badge: true, sound: true,
    );
    if (settings.authorizationStatus != AuthorizationStatus.authorized) return null;

    String? token;
    if (identical(0, 0.0)) { // Web 环境
      token = await _firebaseMessaging.getToken(
        vapidKey: "BBbbdJ94sdOcNEhL1O7ejrE_tMvnZvwoiiQfeSO1O_...",
      );
    } else {
      token = await _firebaseMessaging.getToken();
    }
    return token;
  }

  // 2. 初始化消息监听：三个入口统一汇聚到 Dispatcher
  Future<void> setupMsgListeners() async {
    // A. 后台通知被点击
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      _dispatcher.dispatch(message, isInteraction: true);
    });

    // B. 前台收到消息
    FirebaseMessaging.onMessage.listen((message) {
      _dispatcher.dispatch(message, isInteraction: false);
    });

    // C. 冷启动（App 从 Kill 状态启动）
    RemoteMessage? initialMessage = await _firebaseMessaging.getInitialMessage();
    if (initialMessage != null) {
      _dispatcher.dispatch(initialMessage, isInteraction: true);
    }
  }

  // 3. Token 刷新流
  Stream<String> get onTokenRefresh => _firebaseMessaging.onTokenRefresh;
}
```

**三个消息入口的区别：**

| 入口 | 触发时机 | `isInteraction` | 典型行为 |
|------|---------|----------------|---------|
| `onMessage` | App 在前台 | `false` | 显示 BotToast 通知条 |
| `onMessageOpenedApp` | 用户从后台点击通知 | `true` | 直接跳转页面 |
| `getInitialMessage` | 冷启动唤醒 | `true` | 直接跳转页面 |
| `onBackgroundMessage` | 后台 isolate | N/A | 仅 CallDispatcher 处理 |

### 4.3 FcmDispatcher——分发层 [`fcm_dispatcher.dart`](JoyMini_Flutter_App/lib/core/services/fcm/fcm_dispatcher.dart:1)

```dart
class FcmDispatcher {
  final Set<String> _processedMessageIds = {}; // 幂等校验集合
  final _groupHandler = GroupActionHandler();
  final _chatHandler = ChatActionHandler();
  final _luckyDrawHandler = LuckyDrawActionHandler();

  void dispatch(RemoteMessage message, {required bool isInteraction}) {
    // 1. 幂等性校验：已处理的消息直接拦截
    if (message.messageId != null &&
        _processedMessageIds.contains(message.messageId)) {
      return;
    }

    // 2. 音视频信令顶层拦截 → 移交 CallDispatcher
    final String typeStr = message.data['type']?.toString() ?? '';
    if (typeStr == 'call_invite' || typeStr == 'call_end' ||
        typeStr == 'call_accept' || typeStr == 'call_ice') {
      CallDispatcher.instance.dispatch(message.data);
      return; // 核心护盾：绝不往下走！
    }

    // 3. 转化为强类型 FcmPayload
    final payload = FcmPayload.fromMap(
      message.data,
      notificationTitle: message.notification?.title,
      notificationBody: message.notification?.body,
    );

    if (isInteraction) {
      _handleInteraction(payload); // 点击跳转
    } else {
      _handleForeground(payload);  // 前台展示
    }
  }
}
```

**三层拦截策略：**

1. **幂等性拦截**：使用 `_processedMessageIds` Set 记录已处理消息 ID，防止 `onMessage` 和 `onMessageOpenedApp` 同时触发
2. **音视频信令拦截**：在进入类型路由前，强制拦截 `call_invite`/`call_end`/`call_accept`/`call_ice` 四类信令，直接移交 `CallDispatcher`
3. **交互/前台分流**：根据 `isInteraction` 参数分流——点击通知走 Handler 链跳转页面，前台消息走 FcmUiFactory 展示通知条

#### 交互处理 `_handleInteraction`

```dart
void _handleInteraction(FcmPayload payload) {
  if (!payload.hasValidAction) return;

  switch (payload.type) {
    case FcmType.groupDetail:
      _groupHandler.handle(payload);
      break;
    case FcmType.chat:
      _chatHandler.handle(payload);
      break;
    case FcmType.luckyDraw:
      _luckyDrawHandler.handle(payload);
      break;
    // ...
  }
}
```

#### 前台展示 `_handleForeground`

```dart
void _handleForeground(FcmPayload payload) {
  FcmUiFactory.showNotification(
    payload,
    onTap: () {
      _handleInteraction(payload); // 用户点击通知条 → 复用交互逻辑
    },
  );
}
```

### 4.4 FcmPayload——强类型载荷 [`fcm_payload.dart`](JoyMini_Flutter_App/lib/core/services/fcm/fcm_payload.dart:1)

```dart
enum FcmType {
  groupDetail, // 群组详情
  chat,        // 聊天消息
  system,      // 系统通知
  callInvite,  // 来电（被顶层拦截，此处仅为类型完整性）
  luckyDraw,   // 抽奖券
  unknown      // 兜底
}

class FcmPayload {
  final FcmType type;
  final String id;
  final String title;
  final String body;
  final Map<String, dynamic> rawData;

  /// 只有类型不是 unknown 且 ID 不为空，才是有效业务动作
  bool get hasValidAction => type != FcmType.unknown && id.isNotEmpty;

  factory FcmPayload.fromMap(Map<String, dynamic> data,
      {String? notificationTitle, String? notificationBody}) {
    return FcmPayload(
      type: _parseType(data['type']),
      id: data['id']?.toString() ?? '',
      title: notificationTitle ?? data['title'] ?? '',
      body: notificationBody ?? data['body'] ?? '',
      rawData: data,
    );
  }

  static FcmType _parseType(String? typeStr) {
    switch (typeStr) {
      case 'group_detail': return FcmType.groupDetail;
      case 'chat': return FcmType.chat;
      case 'system': return FcmType.system;
      case 'call_invite': return FcmType.callInvite;
      case 'lucky_draw': return FcmType.luckyDraw;
      default: return FcmType.unknown;
    }
  }
}
```

**工厂方法设计**：`fromMap` 负责所有"脏活"——字段解析、空安全兜底、类型转换。调用方无需担心数据结构异常。

**`hasValidAction` 校验**：双重条件——`type != unknown` 确保已识别业务类型，`id.isNotEmpty` 确保有跳转目标。

### 4.5 FcmUiFactory——前台通知 UI [`fcm_ui_factory.dart`](JoyMini_Flutter_App/lib/core/services/fcm/fcm_ui_factory.dart:1)

```dart
class FcmUiFactory {
  static void showNotification(FcmPayload payload, {VoidCallback? onTap}) {
    BotToast.showCustomNotification(
      duration: const Duration(seconds: 5),
      toastBuilder: (cancelFunc) {
        return _buildAdvancedNotificationCard(
          payload: payload,
          onTap: () { cancelFunc(); onTap?.call(); },
          onDismiss: cancelFunc,
        );
      },
    );
  }
}
```

**UI 特性：**

- 使用 `BotToast` 自定义通知条，不干扰 App 正常操作
- 左侧动态图标：根据 `FcmType` 显示不同图标（聊天气泡、群组图标、抽奖券等）
- 颜色策略：绿色 = 聊天消息、橙色 = 群组、蓝色 = 系统通知
- 右侧关闭按钮：用户可关闭通知而不触发跳转
- 触感反馈：`HapticFeedback.lightImpact()` 增加物理反馈

### 4.6 Handler 链——业务执行层

**ChatActionHandler** [`chat_handler.dart`](JoyMini_Flutter_App/lib/core/services/fcm/handlers/chat_handler.dart:1)：

```dart
class ChatActionHandler extends BaseHandler {
  void handle(FcmPayload payload) {
    appRouter.push('/chat/room/${payload.id}?title=${Uri.encodeComponent(payload.title)}');
  }
}
```

**GroupActionHandler** [`group_handler.dart`](JoyMini_Flutter_App/lib/core/services/fcm/handlers/group_handler.dart:1)：

```dart
class GroupActionHandler extends BaseHandler {
  void handle(FcmPayload payload) {
    appRouter.pushNamed('groupRoom', pathParameters: {'groupId': payload.id});
  }
}
```

**LuckyDrawActionHandler** [`lucky_draw_handler.dart`](JoyMini_Flutter_App/lib/core/services/fcm/handlers/lucky_draw_handler.dart:1)：

```dart
class LuckyDrawActionHandler extends BaseHandler {
  void handle(FcmPayload payload) {
    appRouter.pushNamed('luckyDraw');
  }
}
```

所有 Handler 均继承自 `BaseHandler` 抽象类 [`base_handler.dart`](JoyMini_Flutter_App/lib/core/services/fcm/handlers/base_handler.dart:1)，便于扩展新的推送类型。

---

## 5. 后台消息处理（独立 Isolate）

### 5.1 背景 Handler [`bootstrap.dart:23`](JoyMini_Flutter_App/lib/app/bootstrap.dart:23)

当 App 在后台或被 Kill 时，FCM 消息由独立 Isolate 处理。这是通过 `@pragma('vm:entry-point')` 注解的顶层函数实现的：

```dart
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  // 所有后台推送统一交给 CallDispatcher 处理
  await CallDispatcher.instance.dispatch(message.data);
}
```

**设计要点：**

- **独立 Isolate**：后台 Handler 在独立的 Dart Isolate 中运行，与主 UI Isolate 隔离
- **Firebase 重新初始化**：独立 Isolate 需要重新 `Firebase.initializeApp()`
- **仅 CallDispatcher**：后台 Handler 只处理音视频信令，普通消息在 App 打开后由主 Isolate 处理

### 5.2 CallDispatcher 三方锁机制

`CallDispatcher` 使用三层锁解决 Socket + FCM 双路径的竞态问题：

```
主线程 Socket 收到 call_invite
    │
    ├─ Lock 1 (In-Memory): _activeSessionId 内存互斥锁
    │   如果已存在活跃会话，丢弃新信令
    │
    ├─ Lock 2 (SharedPreferences Death Lock): 挂断后黑名单
    │   防止延迟 FCM 信令复活已结束的通话
    │
    └─ Lock 3 (SharedPreferences Claim Lock): 先到先得
        Socket 或 FCM 谁先处理谁获得控制权
```

这一机制在 [`docs/blog/articles/flutter/global-handler-callkit-webrtc.md`](docs/blog/articles/flutter/global-handler-callkit-webrtc.md) 和 [`call_arbitrator.dart`](JoyMini_Flutter_App/lib/ui/chat/core/call_manager/storage/call_arbitrator.dart:1) 中有详细论述。

### 5.3 Firebase 初始化 [`bootstrap.dart:120`](JoyMini_Flutter_App/lib/app/bootstrap.dart:120)

```dart
static Future<void> _setupFirebase() async {
  try {
    await FirebaseService.initialize()
        .timeout(const Duration(seconds: 10)); // 10 秒超时保护

    if (!kIsWeb) {
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    }
  } catch (e) {
    debugPrint('[Firebase] Init failed or timed out: $e'); // 不崩溃
  }
}
```

**设计要点：**

- **10 秒超时保护**：弱网/离线时 Firebase.init 可能无限挂起，超时后 App 在无 Firebase 状态下继续运行
- **Web 平台豁免**：`onBackgroundMessage` 仅在非 Web 平台注册
- **并行初始化**：在 `AppBootstrap.initSystem()` 中与其他服务（AssetManager、EasyLocalization、ApiCacheManager、Http）并行执行

---

## 6. Riverpod 集成：fcmInitProvider

### 6.1 Provider 定义 [`fcm_service_provider.dart`](JoyMini_Flutter_App/lib/core/providers/fcm_service_provider.dart:1)

```dart
// 普通 Provider：创建 FcmService 实例
final fcmServiceProvider = Provider<FcmService>((ref) {
  return FcmService(ref);
});

// FutureProvider：异步初始化流程
final fcmInitProvider = FutureProvider<void>((ref) async {
  final fcmService = ref.watch(fcmServiceProvider);

  // 1. 启动消息监听
  await fcmService.setupMsgListeners();

  // 2. 获取 Token 并上传到后端
  String? token = await fcmService.getToken();
  if (token != null) {
    await uploadTokenToBackend(token);
  }

  // 3. 监听 Token 刷新
  fcmService.onTokenRefresh.listen((newToken) async {
    await uploadTokenToBackend(newToken);
  });
});
```

### 6.2 Token 上报逻辑

```dart
Future<void> uploadTokenToBackend(String? token) async {
  // 平台判断
  String platformName;
  if (kIsWeb) {
    platformName = 'web';
  } else if (Platform.isAndroid) {
    platformName = 'android';
  } else if (Platform.isIOS) {
    platformName = 'ios';
  } else {
    platformName = 'unknown';
  }

  final dto = FcmNotificationDeviceRegisterDto(
    token: token!,
    platform: platformName,
  );

  await Api.fcmNotificationDeviceRegisterApi(dto); // POST /v1/client/notifications/device/register
}
```

### 6.3 App 入口激活 [`app.dart:53`](JoyMini_Flutter_App/lib/app/app.dart:53)

```dart
class App extends ConsumerWidget {
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(fcmInitProvider); // 激活 FCM 初始化流程
    // ...
  }
}
```

通过 `ref.watch(fcmInitProvider)` 在 App 顶层组件中激活 FCM 初始化全流程，无需手动调用任何方法。

---

## 7. Admin 后台推送管理

### 7.1 控制器 [`admin/notification.controller.ts`](apps/api/src/admin/notification/notification.controller.ts:1)

```typescript
@Controller('admin/notifications')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminNotificationController {
  // GET /v1/admin/notifications/logs — 推送历史（分页/过滤）
  @Get('logs')
  getLogs(@Query() query: QueryPushLogDto) { /* ... */ }

  // GET /v1/admin/notifications/devices/stats — 设备统计
  @Get('devices/stats')
  getDeviceStats() { /* ... */ }

  // POST /v1/admin/notifications/broadcast — 全员广播
  @Post('broadcast')
  async sendBroadcast(@Body() dto: AdminSendBroadcastDto, @CurrentUserId() adminId: string) { /* ... */ }

  // POST /v1/admin/notifications/targeted — 定向推送
  @Post('targeted')
  async sendTargeted(@Body() dto: AdminSendTargetedDto, @CurrentUserId() adminId: string) { /* ... */ }
}
```

### 7.2 AdminNotificationService [`admin/notification.service.ts`](apps/api/src/admin/notification/notification.service.ts:1)

#### 设备统计 `getDeviceStats`

```typescript
async getDeviceStats() {
  const [total, android, ios, web, activeInLast7Days] = await Promise.all([
    this.prisma.device.count(),
    this.prisma.device.count({ where: { platform: 'android' } }),
    this.prisma.device.count({ where: { platform: 'ios' } }),
    this.prisma.device.count({ where: { platform: 'web' } }),
    this.prisma.device.count({
      where: { lastActive: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
  ]);
  return { total, android, ios, web, activeInLast7Days };
}
```

#### 全员广播 `sendBroadcast`

```typescript
async sendBroadcast(dto: AdminSendBroadcastDto, adminId: string) {
  const adminName = await this.resolveAdminName(adminId);

  try {
    await this.notificationService.sendBroadcast(dto.title, dto.body, dto.extraData);
  } catch (err) {
    // 记录失败日志
  }

  // 写入推送日志
  const log = await this.prisma.adminPushLog.create({
    data: {
      adminId, adminName,
      type: 'broadcast',
      title: dto.title, body: dto.body,
      status, successCount, failureCount,
    },
  });

  // 操作审计日志
  await this.operationLogService.log({
    adminId, adminName,
    module: OpModule.SYSTEM,
    action: OpAction.SYSTEM.SEND_NOTIF,
    details: `Broadcast: "${dto.title}" — ${successCount} dispatched`,
  });

  return log;
}
```

#### 定向推送 `sendTargeted`

```typescript
async sendTargeted(dto: AdminSendTargetedDto, adminId: string) {
  const deviceCount = await this.prisma.device.count({
    where: { userId: dto.targetUserId },
  });

  if (deviceCount === 0) {
    // 无设备 → 记录失败日志
  } else {
    await this.notificationService.sendPrivateMessage(
      dto.targetUserId, dto.title, dto.body, dto.extraData,
    );
  }

  // 写入推送日志 + 操作审计日志
}
```

**核心设计：**

- **双重日志**：每次推送操作同时写入 `AdminPushLog`（推送日志）和 `OperationLog`（操作审计日志）
- **设备预检**：定向推送前查询目标用户是否有设备 Token，无设备则直接记录失败
- **管理员身份**：通过 `resolveAdminName` 解析操作管理员姓名，记录到日志中

### 7.3 AdminPushLog 数据模型

| 字段 | 类型 | 说明 |
|------|------|------|
| `adminId` | String | 操作管理员 ID |
| `adminName` | String | 管理员姓名 |
| `type` | `broadcast` / `targeted` | 推送类型 |
| `title` | String | 推送标题 |
| `body` | String | 推送内容 |
| `targetUserId` | String? | 定向推送目标用户 |
| `extraData` | JSON? | 附加数据 |
| `status` | `sent` / `failed` | 推送状态 |
| `successCount` | Int | 成功设备数 |
| `failureCount` | Int | 失败设备数 |

---

## 8. 设备注册 API 与 DTO

### 8.1 客户端 API [`notification.controller.ts:11`](apps/api/src/client/notification/notification.controller.ts:11)

```typescript
@UseGuards(OptionalJwtAuthGuard)
@Controller('/client/notifications')
export class NotificationController {
  // POST /v1/client/notifications/device/register
  @Post('device/register')
  async registerDevice(
    @Body() body: RegisterDeviceDto,
    @CurrentUserId() userId: string | null,  // 可选认证
  ) {
    await this.notificationService.registerDevice(body.token, body.platform, userId ?? undefined);
    return { success: true };
  }
}
```

**`OptionalJwtAuthGuard`** 是关键设计：用户登录前后均可注册设备 Token。

- **登录前注册**：`userId` 为 `null`，Token 仅绑定设备，不绑定用户
- **登录后注册**：`userId` 为当前用户 ID，Token 绑定到用户
- **退出登录注册**：`userId` 为 `undefined`，Token 与用户解绑

### 8.2 RegisterDeviceDto

```typescript
class RegisterDeviceDto {
  @IsString()
  token: string;        // FCM 设备令牌

  @IsString()
  platform: string;     // 'android' | 'ios' | 'web'
}
```

### 8.3 测试 API

```typescript
// POST /v1/client/notifications/test/send — 手动触发私信推送
@Post('test/send')
async sendTest(@Body() body: SendTestDto) {
  await this.notificationService.sendPrivateMessage(body.userId, body.title, body.body);
  return { success: true };
}

// POST /v1/client/notifications/test/broadcast — 手动触发全员广播
@Post('test/broadcast')
async testBroadcast(@Body() body: SendBroadcastDto) {
  const result = await this.notificationService.sendBroadcast(body.title, body.body);
  return { success: true, message: '广播任务已提交给 Firebase', result };
}
```

---

## 9. 竞态条件与防御策略

### 9.1 FCM + Socket 双路径竞态

音视频通话场景下，来电信号同时通过 WebSocket 和 FCM 两条路径送达：

```
Socket 路径（在线用户）：  用户 A → CallGateway → Socket.IO → 用户 B
FCM 路径（唤醒路径）：     CallGateway → EventEmitter → PushListener → FCM → 用户 B
```

**问题**：两条路径可能同时触发 `CallDispatcher.dispatch()`，导致重复来电屏幕。

**解决方案**：[`CallArbitrator`](JoyMini_Flutter_App/lib/ui/chat/core/call_manager/storage/call_arbitrator.dart:1) 三层锁：

1. **In-Memory 互斥锁**：`_activeSessionId` 变量，同一微任务内去重
2. **SharedPreferences Death Lock**：挂断后写入黑名单，防止延迟 FCM 信令复活
3. **SharedPreferences Claim Lock**：先到先得，后到的被忽略

### 9.2 FCM 消息幂等性

Dispatcher 使用 `_processedMessageIds` Set 记录已处理消息 ID：

```dart
if (message.messageId != null &&
    _processedMessageIds.contains(message.messageId)) {
  return; // 已处理，跳过
}
_processedMessageIds.add(message.messageId!);
```

防止以下重复触发：
- `onMessage`（前台）与 `onMessageOpenedApp`（后台点击）同时触发
- FCM 重试导致的重复消息
- Token 刷新期间的双重推送

### 9.3 幽灵来电防御

```
call_end 事件 → CallGateway
  → eventEmitter.emit('call.wake_up', { type: 'call_end', ... }) ← 必须透传 type
  → PushListener.handleCallWakeUp
  → NotificationService.sendCallWakeUpPush
  → FCM data.type = 'call_end' ← 不能硬编码！
  → Flutter 后台 isolate 收到 type=call_end
  → CallDispatcher 识别为挂断，不显示来电屏幕
```

> **如果 `type` 被硬编码为 `'call_invite'`**：Flutter 会在通话结束后显示"幽灵来电"屏幕，用户无法接听（因为会话已结束），且后续真实来电也无法正常处理。

### 9.4 免打扰过滤

ChatService 在创建 `MessageCreatedEvent` 时，会计算 `pushMemberIds`：

```typescript
// 伪代码示意
const allMembers = await getConversationMembers(conversationId);
const mutedMembers = await getMutedMembers(conversationId);
event.pushMemberIds = allMembers.filter(id => !mutedMembers.includes(id));
```

这确保：
- 开启免打扰的用户不会收到 FCM 推送
- 大群（数百人）场景下减少无效推送
- PushListener 中 `targetIds.length === 0` 时熔断

---

## 10. 总结

### 核心架构要点

| 层次 | 关键设计 | 解决的问题 |
|------|---------|-----------|
| API 事件驱动 | `@OnEvent` + `Promise.allSettled` | 推送与主业务解耦，并发推送提升性能 |
| FCM 私信推送 | `sendEachForMulticast` + 失效 Token 清理 | 用户多设备同步推送，自动维护 Token 有效性 |
| FCM 广播推送 | Topic 订阅机制 | 全员推送无需查库，FCM 内部路由 |
| Data-only 唤醒 | 纯 data 字段 + 高优先级 + `contentAvailable` | 后台唤醒 App，不显示通知栏 |
| Flutter 三层分发 | Service → Dispatcher → Handler | 清晰职责分离，易于扩展新推送类型 |
| 音视频信令顶层拦截 | Dispatcher 顶层校验 `type` | 防止普通推送逻辑误处理来电信令 |
| 三方锁竞态防御 | In-Memory + Death Lock + Claim Lock | Socket/FCM 双路径去重 |
| 管理后台双重日志 | PushLog + OperationLog | 推送可追溯，操作可审计 |
| 免打扰过滤 | `pushMemberIds` 字段 | 尊重用户偏好，减少无效推送 |

### 数据流全景

```
用户发送消息
  → ChatService 落库 + 广播事件
  → PushListener 并发推送
  → NotificationService FCM 发送
  → Firebase Cloud Messaging
  → Flutter FcmService 接收
  → FcmDispatcher 分发
  → Handler 执行跳转 / UiFactory 展示

管理后台发送推送
  → AdminNotificationController
  → AdminNotificationService 发送 + 日志
  → NotificationService FCM 发送
  → Firebase Cloud Messaging
  → Flutter 接收并展示

音视频来电
  → CallGateway Socket 转发 + FCM 唤醒
  → PushListener Data-only 推送
  → Flutter 后台 Handler → CallDispatcher
  → 三方锁防重 → 来电屏幕
```
