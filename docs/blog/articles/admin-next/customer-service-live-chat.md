---
title: "客服实时聊天系统——WebSocket 实时推送 + 6 种消息类型 + 会话管理"
slug: "customer-service-live-chat"
date: "2026-05-03"
description: "深度解析 admin-next 新版客服聊天系统：从 WebSocket 实时通信、30s 轮询降级、游标分页消息历史，到 6 种富媒体消息（文字/图片/音频/视频/文件/位置）渲染、Bot 代理回复、强制撤回与会话关闭，涵盖前后端完整链路"
tags: ["admin-next", "NestJS", "WebSocket", "customer-service", "live-chat", "Prisma", "real-time", "file-upload", "cursor-pagination"]
---

# 客服实时聊天系统——WebSocket 实时推送 + 6 种消息类型 + 会话管理

## 1. 架构全景

客服实时聊天（Customer Service Live Chat）是 admin-next 后台与终端用户之间的核心沟通桥梁。系统采用**前后端分离 + WebSocket 实时推送**架构，全部代码集中在两个主要路径：

- **前端组件**: [`apps/admin-next/src/components/customer-service/`](apps/admin-next/src/components/customer-service/)
- **后端 API**: [`apps/api/src/admin/chat/`](apps/api/src/admin/chat/)

```
┌──────────────────────────────────────────────────────────────────────┐
│  admin-next (Next.js)                                                │
│                                                                       │
│  ┌──────────────── CustomerServiceDesk ──────────────────────┐       │
│  │  ┌──────────────┐  ┌────────────────────────────────────┐ │       │
│  │  │ Conversation │  │  ChatWindow                         │ │       │
│  │  │  List        │  │  ┌──────────┐ ┌──────────────────┐ │ │       │
│  │  │              │  │  │ Message  │ │ Quick Replies    │ │ │       │
│  │  │  Search      │  │  │ Bubble   │ │ Panel (7 tmpl)   │ │ │       │
│  │  │  Filter      │  │  │ (6 types)│ │                  │ │ │       │
│  │  │  (All/Active │  │  └──────────┘ └──────────────────┘ │ │       │
│  │  │   /Closed)   │  │  Upload Area (Image / File)        │ │       │
│  │  └──────────────┘  └────────────────────────────────────┘ │       │
│  │  SocketIndicator  (connected / connecting / polling)       │       │
│  └────────────────────────────────────────────────────────────┘       │
│                          │ WebSocket + HTTP                           │
└───────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  NestJS API (apps/api/src/admin/chat/)                               │
│                                                                       │
│  AdminChatController (6 endpoints)                                    │
│  ├─ GET    /admin/chat/conversations          ← 会话列表              │
│  ├─ GET    /admin/chat/conversations/:id/messages  ← 消息历史         │
│  ├─ POST   /admin/chat/conversations/:id/reply  ← 客服回复            │
│  ├─ POST   /admin/chat/messages/:id/force-recall ← 强制撤回          │
│  ├─ PATCH  /admin/chat/conversations/:id/close   ← 关闭会话          │
│  └─ POST   /admin/chat/upload-token              ← 媒体上传签名       │
│                                                                       │
│  AdminChatService → ChatService (标准消息链路)                        │
│                 → EventsGateway (WebSocket 广播)                      │
│                 → UploadService (S3 预签名 URL)                       │
└───────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Prisma Database                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │ Conversation │  │ ChatMessage  │  │ ChatMember   │                │
│  │ (id, type,   │─→│ (id, type,   │  │ (userId,     │                │
│  │  status,     │  │  content,    │  │  role,       │                │
│  │  lastMsg*)   │  │  seqId,      │  │  mutedUntil) │                │
│  └──────────────┘  │  isRecalled) │  └──────────────┘                │
│                    └──────────────┘                                   │
└───────────────────────────────────────────────────────────────────────┘
```

## 2. 数据库设计（Prisma）

客服聊天复用通用 IM 模块的 [`Conversation`](apps/api/prisma/schema.prisma:1182) 和 [`ChatMessage`](apps/api/prisma/schema.prisma:1260) 模型，通过 `type = SUPPORT` 区分客服会话。

### Conversation（会话表）

```prisma
model Conversation {
  id           String   @id @default(cuid())
  type         ConversationType  // SUPPORT 标识客服会话
  businessId   String?  @unique  // 业务钩子
  name         String?           // 会话标题
  avatar       String?           // 会话头像
  ownerId      String?           // 群主ID

  status       Int      @default(1)  // 1=NORMAL, 2=CLOSED
  isMuteAll    Boolean  @default(false)
  joinNeedApproval Boolean @default(false)
  announcement     String?  @db.VarChar(2000)

  // 快照字段（列表页快速渲染，免 JOIN）
  lastMsgContent String?
  lastMsgType    Int?      @default(0)
  lastMsgTime    DateTime?
  lastMsgSeqId   Int       @default(0)
  lastMsgSenderId String?

  messages     ChatMessage[]
  members      ChatMember[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

enum ConversationType {
  GROUP    // 手动创建的群
  DIRECT   // 私聊
  SUPPORT  // 客服聊天 ← 本系统使用
  BUSINESS // 自动业务群
}
```

关键设计决策：
- **`type = SUPPORT`** 作为过滤条件，与普通 IM 公用同一套表结构
- **快照字段**（`lastMsgContent`, `lastMsgType`, `lastMsgTime`, `lastMsgSeqId`）避免列表页每次查询都需要 JOIN 消息表
- **`status`** 字段支持 1=正常 / 2=已关闭，关闭后用户不能继续发消息

### ChatMessage（消息表）

```prisma
model ChatMessage {
  id             String   @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id])

  senderId       String?  // null = 系统消息
  sender         User?    @relation(fields: [senderId], references: [id])

  type           Int      @default(0) // 0:Text, 1:Image, 2:Audio, 3:Video, 99:System
  content        String   // 文本内容或媒体 URL
  meta           Json?    // {w, h, duration, fileName, fileSize, latitude, longitude...}

  seqId          Int      // 单调递增序列号（用于游标分页）
  clientTempId   String?  // 前端 UUID（去重/ACK）
  isRecalled     Boolean  @default(false)
  createdAt      DateTime @default(now())

  hiddenByUsers  ChatMessageHide[]

  @@index([conversationId, seqId]) // 核心索引：拉取历史记录
}
```

消息类型枚举（`type` 字段）：

| 值 | 类型 | 描述 | content 含义 |
|----|------|------|-------------|
| 0 | Text | 纯文本 | 文本内容 |
| 1 | Image | 图片 | 图片 URL |
| 2 | Audio | 语音 | 音频 URL，meta 含 duration |
| 3 | Video | 视频 | 视频 URL，meta 含 duration/w/h/thumbnail |
| 5 | File | 文件 | 文件 URL，meta 含 fileName/fileSize/fileExt |
| 6 | Location | 位置 | URL，meta 含 latitude/longitude/title/address/thumb |
| 99 | System | 系统消息 | 文本，senderId=null |

## 3. 前端组件体系

客服聊天前端由 7 个核心组件 + 5 个消息子组件组成，全部声明为 `'use client'`。

### 3.1 CustomerServiceDesk — 主布局

[`CustomerServiceDesk.tsx`](apps/admin-next/src/components/customer-service/CustomerServiceDesk.tsx:21) 是整个聊天的容器组件，负责：

**WebSocket 连接管理**：通过 `useChatSocket` hook 订阅 `conversationId` 房间，监听新消息和撤回事件：

```tsx
const { status, registerOnNewMessage, registerOnRecalled } = useChatSocket(
  conversationId,
  {
    onMessage: useCallback(
      (msg: ChatMessage) => {
        // 实时追加新消息到列表
      },
      [conversationId],
    ),
  },
);
```

**30s 轮询兜底**：当 WebSocket 断开时（`status === 'polling'`），自动降级为 HTTP 轮询，确保不丢失消息：

```tsx
const { data: convData, refetch } = useRequest(
  { url: '/admin/chat/conversations', params: { status: activeFilter } },
);

// 30 秒轮询
useEffect(() => {
  const timer = setInterval(() => void refetch(), 30_000);
  return () => clearInterval(timer);
}, [refetch]);
```

**状态过滤**：通过 `activeFilter` 状态控制会话列表显示范围（All / Active / Closed），切换时重置分页。

**三区布局**：左侧会话列表 / 右侧聊天窗口 / 顶部 SocketIndicator。

### 3.2 ConversationList — 会话列表

[`ConversationList.tsx`](apps/admin-next/src/components/customer-service/ConversationList.tsx:25) 提供：

- **搜索框**：实时输入关键词搜索用户名或会话名称
- **三态筛选**：All / Active(1) / Closed(2)，通过 `filter` 属性控制
- **无限滚动加载**：分页加载更多会话
- **会话渲染**：每个会话使用 [`ConversationItem`](apps/admin-next/src/components/customer-service/ConversationItem.tsx:8) 组件，展示头像（渐变色背景）、昵称、未读数量（`>99` 显示 `99+`）、最后一条消息预览、StatusBadge（Active/Closed）和时间

```tsx
// 筛选按钮实现
{[{ label: t('customerService.all'), value: undefined },
  { label: t('customerService.active'), value: 1 },
  { label: t('customerService.closed'), value: 2 },
].map((opt) => (
  <button
    key={opt.value ?? 'all'}
    onClick={() => setActiveFilter(opt.value)}
    className={activeFilter === opt.value ? '...bg-primary...' : '...'}
  >
    {opt.label}
  </button>
))}
```

### 3.3 ChatWindow — 聊天窗口

[`ChatWindow.tsx`](apps/admin-next/src/components/customer-service/ChatWindow.tsx:30) 是功能最复杂的组件，涵盖消息全生命周期：

**消息加载**：使用 `loadMore` 函数实现游标分页，每页 30 条：

```tsx
const loadMore = useCallback(async () => {
  const res = await request({
    url: `/admin/chat/conversations/${conversationId}/messages`,
    params: { cursor: cursorRef.current, pageSize: 30 },
  });
  cursorRef.current = res.nextCursor;
  setAllMessages((prev) => [...res.list, ...prev]); // 追加到顶部
}, [conversationId]);
```

**实时消息追加**：通过 `registerOnNewMessage` 注册回调，WebSocket 收到新消息时追加到列表底部：

```tsx
registerOnNewMessage?.((msg) => {
  setAllMessages((prev) => {
    if (prev.some((m) => m.id === msg.id || m.seqId === msg.seqId)) return prev;
    return [...prev, msg];
  });
});
```

**消息撤回处理**：通过 `registerOnRecalled` 更新已撤回消息的状态：

```tsx
registerOnRecalled?.((data) => {
  setAllMessages((prev) =>
    prev.map((m) =>
      m.id === data.messageId ? { ...m, isRecalled: true, content: '...' } : m,
    ),
  );
});
```

**发送消息**：`handleSend` 函数支持纯文本发送，内容会携带 `isSupport: true` 标识：

```tsx
const handleSend = async (text?: string) => {
  const content = text ?? inputValue.trim();
  if (!content) return;
  await request({
    method: 'POST',
    url: `/admin/chat/conversations/${conversationId}/reply`,
    data: { content, type: 0, agentName: adminName },
  });
  setInputValue('');
};
```

**文件上传**：`handleFileUpload` 分两步：
1. 调用 `POST /admin/chat/upload-token` 获取 S3 预签名 URL
2. 上传文件到 S3，成功后发送消息（包含 URL + meta 信息）

对于图片消息，额外获取图片宽高比用于渲染：

```tsx
const handleFileUpload = async (file: File, msgType: number) => {
  // 1. 获取上传 Token
  const { uploadUrl, publicUrl } = await request({
    method: 'POST',
    url: '/admin/chat/upload-token',
    data: { fileName: file.name, fileType: file.type },
  });

  // 2. 上传到 S3
  await fetch(uploadUrl, { method: 'PUT', body: file });

  // 3. 发送消息
  const meta: Record<string, unknown> = { ... };
  if (msgType === 1) {
    // 图片：获取宽高
    await new Promise<void>((resolve) => {
      img.onload = () => { meta.w = img.naturalWidth; meta.h = img.naturalHeight; resolve(); };
    });
  }
  await request({ method: 'POST', url: `/admin/chat/conversations/${conversationId}/reply`,
    data: { content: publicUrl, type: msgType, meta } });
};
```

**快速回复**：通过 `QuickRepliesPanel` 组件提供 7 条预设快捷回复模板，点击即发送。

**关闭确认**：已关闭的会话显示 "会话已关闭" 状态，不显示输入框。

### 3.4 MessageBubble — 消息气泡

[`MessageBubble.tsx`](apps/admin-next/src/components/customer-service/MessageBubble.tsx:16) 根据消息类型动态渲染不同 UI 组件：

```tsx
const renderContent = () => {
  if (msg.isRecalled) {
    return <span className="italic opacity-60">[Message recalled]</span>;
  }
  switch (msg.type) {
    case 1:  return <ImageMessage content={msg.content} meta={msg.meta} />;
    case 2:  return <AudioMessage msgId={msg.id} content={msg.content} meta={msg.meta} />;
    case 3:  return <VideoMessage content={msg.content} meta={msg.meta} />;
    case 5:  return <FileMessage content={msg.content} meta={msg.meta} isSupport={isSupport} />;
    case 6:  return <LocationMessage meta={msg.meta} />;
    case 99: return <SystemMessage content={msg.content} meta={msg.meta} />;
    default: return <p>{msg.content}</p>; // 文本 (0)
  }
};
```

视觉区分：
- **客服（Support）**：青色背景（`bg-teal-600`），右对齐
- **用户（User）**：蓝色背景（`bg-blue-500`），左对齐
- **系统消息**（type=99）：居中显示，无气泡背景
- **媒体消息**（图片/视频/音频/文件）：无气泡背景，直接渲染媒体组件

### 3.5 消息子组件

| 组件 | 文件 | 功能 |
|------|------|------|
| [`ImageMessage`](apps/admin-next/src/components/customer-service/messages/ImageMessage.tsx) | `messages/ImageMessage.tsx` | 缩略图预加载 + 点击灯箱放大，自适应宽高比 |
| [`AudioMessage`](apps/admin-next/src/components/customer-service/messages/AudioMessage.tsx) | `messages/AudioMessage.tsx` | 波形可视化 + 播放/暂停 + 动态宽度 |
| [`VideoMessage`](apps/admin-next/src/components/customer-service/messages/VideoMessage.tsx) | `messages/VideoMessage.tsx` | 缩略图 + 播放按钮遮罩 + 全屏 Modal 播放器 |
| [`FileMessage`](apps/admin-next/src/components/customer-service/messages/FileMessage.tsx) | `messages/FileMessage.tsx` | 文件扩展名图标 + 文件名 + 大小 + 下载 |
| [`LocationMessage`](apps/admin-next/src/components/customer-service/messages/LocationMessage.tsx) | `messages/LocationMessage.tsx` | 地图缩略图 + 标题/地址 + Google Maps 链接 |

### 3.6 状态指示器

| 组件 | 文件 | WebSocket 状态 | 显示 |
|------|------|----------------|------|
| [`SocketIndicator`](apps/admin-next/src/components/customer-service/SocketIndicator.tsx) | `SocketIndicator.tsx` | `connected` | 🟢 Wifi 图标 + "Live" |
| | | `connecting` | 🟡 旋转 RefreshCw + "Connecting" |
| | | `disconnected`/`polling` | ⚪ WifiOff + "Polling" |
| [`StatusBadge`](apps/admin-next/src/components/customer-service/StatusBadge.tsx) | `StatusBadge.tsx` | 1 (Active) | 🟢 Clock + "Active" |
| | | 2 (Closed) | ⚪ CheckCircle + "Closed" |

## 4. 后端 API 详解

所有 API 通过 [`AdminJwtAuthGuard`](apps/api/src/admin/auth/admin-jwt-auth.guard.ts) + [`RolesGuard`](apps/api/src/admin/auth/roles.guard.ts) 双重鉴权，需要 `SUPER_ADMIN`、`ADMIN` 或 `EDITOR` 角色。

### 4.1 会话列表

```http
GET /v1/admin/chat/conversations?page=1&pageSize=20&status=1&keyword=search
```

查询逻辑（[`AdminChatService.getConversations()`](apps/api/src/admin/chat/admin-chat.service.ts:38)）：
1. 默认过滤 `type = SUPPORT`，只显示客服会话
2. 可选 `status` 过滤（1=Active, 2=Closed）
3. 可选 `keyword` 搜索（匹配会话名称或成员昵称）
4. 按 `lastMsgTime` 降序排列
5. 每页最多携带 10 个成员信息

### 4.2 消息历史（游标分页）

```http
GET /v1/admin/chat/conversations/:id/messages?cursor=500&pageSize=30
```

区别于传统 `OFFSET` 分页，游标分页（[`AdminChatService.getMessages()`](apps/api/src/admin/chat/admin-chat.service.ts:109)）使用 `seqId` 做游标：

```typescript
const where: Prisma.ChatMessageWhereInput = { conversationId };
if (cursor) {
  where.seqId = { lt: cursor }; // 小于游标值的旧消息
}

const messages = await this.prisma.chatMessage.findMany({
  where,
  orderBy: { seqId: 'desc' },
  take: pageSize,
});
```

优势：**高性能、无偏移**，适合高频插入的消息表。

### 4.3 客服回复（Bot 代理）

```http
POST /v1/admin/chat/conversations/:id/reply
Content-Type: application/json

{
  "content": "您好，有什么可以帮助您的？",
  "type": 0,
  "meta": {}
}
```

核心设计（[`AdminChatService.replyToConversation()`](apps/api/src/admin/chat/admin-chat.service.ts:162)）：

1. **查找 Bot 机器人成员**：会话中必须有一个 `isRobot=true` 的用户作为代理
2. **通过 ChatService 标准链路发送**：复用通用 IM 的 `sendMessage()`，确保消息进入同一套序列号体系
3. **注入客服信息**：`meta` 中携带 `isSupport: true`、`agentName`、`realAdminId`，前端据此区分客服气泡样式

```typescript
const botMember = conv.members.find((m) => m.user?.isRobot);
const message = await this.chatService.sendMessage(botMember.userId, {
  id: uuidv4(),
  conversationId,
  content: dto.content,
  type: msgType,
  meta: { isSupport: true, agentName: agentLabel, realAdminId: adminId },
});
```

### 4.4 强制撤回

```http
POST /v1/admin/chat/messages/:id/force-recall
```

与普通用户的 2 分钟撤回限制不同，管理员可以 **不受时间限制** 强制撤回任意消息（[`AdminChatService.forceRecallMessage()`](apps/api/src/admin/chat/admin-chat.service.ts:217)）：

```typescript
await this.prisma.chatMessage.update({
  where: { id: messageId },
  data: { isRecalled: true, content: '[Message Recalled by Support]', meta: {} },
});

// WebSocket 广播撤回事件
this.eventsGateway.dispatch(message.conversationId, 'message_recalled', {
  conversationId: message.conversationId,
  messageId: message.id,
  tip: 'Message recalled by support',
});
```

### 4.5 关闭会话

```http
PATCH /v1/admin/chat/conversations/:id/close
Content-Type: application/json

{
  "reason": "问题已解决"
}
```

关闭逻辑（[`AdminChatService.closeConversation()`](apps/api/src/admin/chat/admin-chat.service.ts:250)）使用 **Prisma 事务** 保证原子性：

```typescript
await this.prisma.$transaction(async (tx) => {
  // 1. 更新会话状态 + 快照
  const updated = await tx.conversation.update({
    where: { id: conversationId },
    data: {
      status: CONV_STATUS.CLOSED,  // 2
      lastMsgSeqId: { increment: 1 },
      lastMsgContent: `[System]: ${reason}`,
      lastMsgType: MSG_TYPE_SYSTEM,
      lastMsgTime: new Date(),
    },
    select: { lastMsgSeqId: true },
  });

  // 2. 插入关闭系统消息
  await tx.chatMessage.create({
    data: {
      id: messageId,
      conversationId,
      senderId: null,  // 系统消息
      content: reason,
      type: MSG_TYPE_SYSTEM,  // 99
      seqId: updated.lastMsgSeqId,
      meta: { closedBy: adminName, isClose: true },
    },
  });
});
```

### 4.6 媒体上传 Token

```http
POST /v1/admin/chat/upload-token
Content-Type: application/json

{
  "fileName": "photo.jpg",
  "fileType": "image/jpeg"
}
```

返回 S3 预签名 URL（[`AdminChatService.getUploadToken()`](apps/api/src/admin/chat/admin-chat.service.ts:317)），前端直接 `PUT` 上传，无需经过后端中转：

```json
{
  "uploadUrl": "https://bucket.s3.amazonaws.com/...?signature=...",
  "publicUrl": "https://cdn.example.com/chat/abc123.jpg"
}
```

## 5. WebSocket 事件体系

系统通过 [`EventsGateway`](apps/api/src/common/events/events.gateway.ts) 实现实时通信，关键事件：

| 事件名 | 触发时机 | 载荷 |
|--------|---------|------|
| `chat_message` | 新消息发送 | `{id, conversationId, senderId, content, type, seqId, ...sender}` |
| `message_recalled` | 消息撤回 | `{conversationId, messageId, tip, seqId}` |
| `message_deleted` | 消息删除 | `{conversationId, messageId, seqId}` |
| `conversation_updated` | 会话状态变更 | `{conversationId, status, lastMsg*}` |

前端通过 `useChatSocket` hook 统一管理订阅与事件分发，自动处理连接/重连/降级。

## 6. 关键设计决策

### 6.1 为什么用 Bot 代理回复？

客服回复不走 `senderId = adminId` 直接写库，而是通过 **Bot 机器人成员** 代理：

```
Admin Reply → 查找 Bot Member → ChatService.sendMessage(botUserId) → 推送
```

这样做的好处：
- **消息序列号统一**：所有消息（用户和客服）通过同一套 `seqId` 递增
- **WebSocket 事件统一**：用户端监听同一个 `chat_message` 事件即可
- **权限隔离**：管理员不直接加入用户会话，通过 Bot 做中间层

### 6.2 快照设计

`Conversation` 表包含 `lastMsgContent`、`lastMsgType`、`lastMsgTime`、`lastMsgSeqId` 四个快照字段，每次新消息写入时同步更新。这使得会话列表页 **不需要 JOIN ChatMessage 表**，大幅提升查询性能。

### 6.3 游标分页 vs OFFSET 分页

| 维度 | OFFSET 分页 | 游标分页（Cursor） |
|------|------------|-------------------|
| 新消息插入影响 | 偏移量变化，数据错位 | 无影响 |
| 性能 | OFFSET 越大越慢 | 恒定 O(log n) |
| 适用场景 | 静态数据 | 实时消息流 |
| 实现复杂度 | 简单 | 中等 |

消息系统选择游标分页，因为消息表持续写入，OFFSET 分页会导致用户滚动时看到重复或缺失的消息。

### 6.4 降级策略

| 网络状况 | 消息接收方式 | 用户体验 |
|---------|-------------|---------|
| WebSocket 连接正常 | 实时推送 | SocketIndicator 显示 🟢 Live |
| WebSocket 短暂断开 | 30s HTTP 轮询 | SocketIndicator 显示 ⚪ Polling |
| WebSocket 完全不可用 | 持续 HTTP 轮询 | 用户手动刷新可恢复 |

## 7. 消息类型展示对比

```
┌──────────────────────────────────────────────────────────────────────────┐
│  客服（右对齐，青色）             用户（左对齐，蓝色）      系统（居中） │
│                                                                          │
│  ┌──────────────────────┐ ┌───┐                                         │
│  │ 您好，有什么可以帮您？│ │你好│  ← 文本消息                           │
│  └──────────────────────┘ └───┘                                         │
│                                                                          │
│  ┌──────────────────┐  ┌──────────┐                                     │
│  │ ╔══════════╗     │  │ ╔══════╗ │  ← 图片消息（可点击放大）           │
│  │ ║ 200x200  ║     │  │ ║ 照片 ║ │                                     │
│  │ ╚══════════╝     │  │ ╚══════╝ │                                     │
│  └──────────────────┘  └──────────┘                                     │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────┐                                 │
│  │ ▶ ▁▂▃▄▅▆▇ 0:15  │  │ ▶ ▁▂▃▄ 0:08 │  ← 音频消息（波形可视化）      │
│  └──────────────────┘  └──────────────┘                                 │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────┐                                 │
│  │ ▶ [Thumbnail]    │  │ ▶ [封面]     │  ← 视频消息（Modal 播放器）    │
│  │ 0:30             │  │    0:45      │                                 │
│  └──────────────────┘  └──────────────┘                                 │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────┐                                 │
│  │ [PDF] report.pdf │  │ [ZIP] docs   │  ← 文件消息（下载链接）        │
│  │ 2.3 MB    ⬇     │  │ 1.1 MB  ⬇   │                                 │
│  └──────────────────┘  └──────────────┘                                 │
│                                                                          │
│                       ┌────────────────────┐                            │
│                       │ 🗺 [Map Thumbnail]  │  ← 位置消息（Google Maps） │
│                       │ Starbucks          │                            │
│                       │ 123 Main St        │                            │
│                       └────────────────────┘                            │
│                                                                          │
│            ═════════════════════════════════════════                      │
│            "问题已解决" — 会话已关闭                 ← 系统消息(居中)    │
│            ═════════════════════════════════════════                      │
└──────────────────────────────────────────────────────────────────────────┘
```

## 8. 完整工作流

以下是一个典型的客服对话全流程：

```
用户发送消息
    │
    ▼
WebSocket 推送 chat_message
    │
    ▼
客服端实时显示
    │
    ▼
客服在 QuickReplies 选择模板 / 手动输入 / 上传文件
    │
    ▼
POST /admin/chat/conversations/:id/reply
    │
    ├─ 查找 Bot Member (isRobot=true)
    ├─ ChatService.sendMessage() 写入 DB
    ├─ 更新会话快照 (lastMsgContent, lastMsgTime, lastMsgSeqId)
    └─ WebSocket 广播 chat_message 给所有成员
    │
    ▼
用户端实时收到回复
    │
    ... (多次对话)
    │
    ▼
客服点击「关闭会话」
    │
    ▼
PATCH /admin/chat/conversations/:id/close
    │
    ├─ Prisma 事务：更新 status=2 + 插入系统消息
    └─ WebSocket 广播 conversation_updated
    │
    ▼
双方看到「会话已关闭」提示，输入框隐藏
    │
    ▼
如有需要，客服可强制撤回历史不当消息
    │
    ▼
POST /messages/:id/force-recall
    ├─ 更新 isRecalled=true
    └─ WebSocket 广播 message_recalled
```

## 9. 安全与权限

| 端点 | 最小角色 | 说明 |
|------|---------|------|
| 会话列表 | EDITOR | 基础客服功能 |
| 消息历史 | EDITOR | 查看用户聊天记录 |
| 回复 | EDITOR | 发送客服消息 |
| 强制撤回 | ADMIN | 敏感操作，需要更高权限 |
| 关闭会话 | EDITOR | 结束对话 |
| 上传 Token | EDITOR | 获取媒体上传权限 |

所有端点通过 `@Roles()` 装饰器声明，由 `RolesGuard` 运行时校验：

```typescript
@Post('messages/:id/force-recall')
@Roles(Role.SUPER_ADMIN, Role.ADMIN) // 仅超级管理员和管理员
forceRecall(@Param('id') messageId: string) { ... }
```

## 10. 扩展点

当前的客服系统具有很高的可扩展性：

1. **多机器人支持**：可以配置多个 Bot 用户，分配给不同客服团队
2. **富文本消息**：扩展 `type` 枚举值，新增红包消息、商品卡片等类型
3. **客服分配**：新增 `supportAgentId` 字段，实现客服自动分配与转接
4. **满意度评价**：关闭会话时触发评价消息，收集用户反馈
5. **消息搜索**：利用 `ChatMessage.content` 的全文索引，实现全局消息搜索
6. **CSV 导出**：基于消息历史接口，导出对话记录用于 QA 分析

## 11. 总结

admin-next 客服实时聊天系统展示了完整的 **WebSocket 实时 + HTTP 降级 + 富媒体消息** 实现方案：

- **前端**: 7 个组件 + 5 个消息子组件，覆盖搜索、筛选、发送、上传、撤回、快速回复全链路
- **后端**: 6 个 REST API + EventsGateway WebSocket，通过 Bot 代理复用通用 IM 消息系统
- **数据库**: Conversation + ChatMessage 双表，快照字段优化列表性能，游标分页保障消息流分页正确
- **安全**: 三层鉴权（JWT + Role + 端点级 Roles 装饰器）
- **降级**: WebSocket 断开时自动切换 30s HTTP 轮询，保证消息不丢失

这套架构不仅适用于客服系统，同样可以复用于 IM 管理后台、订单沟通记录、群组管理等场景。
