# Chat Service — 技术分析与 Admin 客服端实现文档

> **文档版本**: v1.0  
> **更新日期**: 2026-03-16  
> **适用对象**: Admin 后台 / 客服端开发者

---

## 一、整体架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                     Flutter App (Client)                     │
│                                                             │
│  ┌───────────────┐    ┌──────────────┐   ┌──────────────┐  │
│  │  UI Layer     │    │ Providers    │   │  Services    │  │
│  │ (ChatPage,    │◄──►│(Riverpod     │◄──►│(ActionSvc,  │  │
│  │  ConvList…)   │    │ StateNotif)  │   │  SyncMgr…)  │  │
│  └───────────────┘    └──────────────┘   └──────┬───────┘  │
│                                                  │          │
│  ┌───────────────────────────┐   ┌───────────────▼──────┐  │
│  │   LocalDatabaseService    │   │    SocketService      │  │
│  │   (Sembast, 离线优先)     │   │  (Socket.IO Client)  │  │
│  └───────────────────────────┘   └───────────────┬───────┘  │
└──────────────────────────────────────────────────┼──────────┘
                                                   │ WebSocket
                        ┌──────────────────────────▼──────────┐
                        │         Backend Server               │
                        │  REST API  +  Socket.IO /events      │
                        └─────────────────────────────────────┘
```

### 核心分层说明

| 层级           | 技术                                                       | 职责                             |
| -------------- | ---------------------------------------------------------- | -------------------------------- |
| **传输层**     | Socket.IO over WebSocket                                   | 实时消息收发、事件分发           |
| **服务层**     | `SocketService` (Singleton + Mixin)                        | 连接管理、Token 刷新、消息路由   |
| **业务逻辑层** | `ChatEventHandler`, `ChatActionService`, `ChatSyncManager` | 房间管理、发送逻辑、消息同步     |
| **状态管理层** | Riverpod (`ConversationListProvider`, `ChatViewModel`)     | UI 响应式状态                    |
| **持久化层**   | `LocalDatabaseService` (Sembast)                           | 离线消息缓存、未读计数           |
| **API 层**     | REST HTTP                                                  | 历史消息拉取、会话详情、已读上报 |

---

## 二、会话类型（ConversationType）

```
DIRECT    —— 一对一私聊
GROUP     —— 群聊
BUSINESS  —— 商业/平台消息（系统通知）
SUPPORT   —— 客服会话（核心！）
```

> **客服会话（SUPPORT）** 是专门为客服场景设计的会话类型。  
> 客户端通过调用 `Api.chatBusinessApi('official_platform_support_v1')` 创建/获取与客服的会话，返回 `conversationId` 后进入聊天室。

---

## 三、消息类型（MessageType）

| 值  | 枚举名     | 描述                       |
| --- | ---------- | -------------------------- |
| 0   | `text`     | 文本消息                   |
| 1   | `image`    | 图片消息                   |
| 2   | `audio`    | 语音消息                   |
| 3   | `video`    | 视频消息                   |
| 4   | `recalled` | 已撤回消息（本地展示用）   |
| 5   | `file`     | 文件消息                   |
| 6   | `location` | 位置消息                   |
| 99  | `system`   | 系统消息（不触发已读上报） |

---

## 四、消息状态（MessageStatus）

| 枚举      | 含义                     |
| --------- | ------------------------ |
| `sending` | 发送中（本地乐观写入）   |
| `success` | 服务端已确认             |
| `failed`  | 发送失败（进入离线队列） |
| `read`    | 对方已读                 |
| `pending` | 等待重试                 |

---

## 五、Socket.IO 协议规范

### 5.1 连接

```
URL:    {API_BASE_URL}/events
传输:   WebSocket only（禁用 polling）
认证:   query.token=<JWT>  +  auth.token=<JWT>
重连:   最多 5 次自动重连
```

### 5.2 统一分发事件（服务端 → 客户端）

所有服务端推送均通过一个统一事件名 **`dispatch`** 下发，payload 结构如下：

```json
{
  "type": "<event_type_string>",
  "data": { ... }
}
```

### 5.3 完整事件类型表

#### 聊天类事件

| `type` 字段            | 触发场景                  | `data` 关键字段                                                                               |
| ---------------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| `chat_message`         | 收到新消息                | `id`, `conversationId`, `senderId`, `content`, `type`, `createdAt`, `seqId`, `meta`, `tempId` |
| `conversation_read`    | 对方已读                  | `conversationId`, `readerId`, `lastReadSeqId`                                                 |
| `message_recalled`     | 消息被撤回                | `conversationId`, `messageId`, `tip`, `isSelf`, `operatorId`, `seqId`                         |
| `conversation_updated` | 会话信息变更（头像/名称） | `conversationId`, `updates: {}`                                                               |
| `conversation_added`   | 被拉入新会话（群）        | `conversationId`                                                                              |

#### 联系人类事件

| `type` 字段      | 触发场景       |
| ---------------- | -------------- |
| `contact_apply`  | 收到好友申请   |
| `contact_accept` | 好友申请被接受 |

#### 群组类事件

| `type` 字段             | 触发场景         |
| ----------------------- | ---------------- |
| `member_kicked`         | 成员被踢出       |
| `member_muted`          | 成员被禁言       |
| `owner_transferred`     | 群主转让         |
| `member_role_updated`   | 成员角色变更     |
| `member_joined`         | 新成员加入       |
| `member_left`           | 成员离开         |
| `group_disbanded`       | 群解散           |
| `group_info_updated`    | 群信息更新       |
| `group_apply_new`       | 新的入群申请     |
| `group_apply_result`    | 入群申请结果     |
| `group_request_handled` | 管理员处理了申请 |

#### 业务/系统类事件

| `type` 字段                      | 触发场景         |
| -------------------------------- | ---------------- |
| `group_success` / `group_failed` | 群操作结果通知   |
| `group_update`                   | 群业务数据变更   |
| `wallet_change`                  | 钱包余额变动     |
| `force_logout`                   | 强制下线（踢号） |

### 5.4 客户端主动发出的事件

| 事件名         | 描述                             | Payload                                     |
| -------------- | -------------------------------- | ------------------------------------------- |
| `join_chat`    | 进入聊天室（开始监听该会话消息） | `{ conversationId }`                        |
| `leave_chat`   | 离开聊天室                       | `{ conversationId }`                        |
| `send_message` | 发送消息（带 ACK）               | `{ conversationId, content, type, tempId }` |
| `join_lobby`   | 加入大厅（全局状态监听）         | 无                                          |
| `leave_lobby`  | 离开大厅                         | 无                                          |

### 5.5 `send_message` ACK 响应格式

```json
// 成功
{ "status": "ok", "data": { "id": "...", "seqId": 123 } }

// 失败
{ "status": "error", "message": "..." }
```

---

## 六、消息 Data Model（`chat_message` 事件 data 字段）

```json
{
  "id": "msg_uuid",
  "conversationId": "conv_uuid",
  "senderId": "user_uuid",
  "content": "Hello!",
  "type": 0,
  "createdAt": 1710000000000,
  "seqId": 42,
  "tempId": "local_temp_id",
  "isSelf": false,
  "isRecalled": false,
  "meta": {},
  "sender": {
    "id": "user_uuid",
    "nickname": "Alice",
    "avatar": "https://..."
  }
}
```

### `meta` 字段说明（根据 type 不同）

| 消息类型     | meta 字段                                                         |
| ------------ | ----------------------------------------------------------------- |
| image (1)    | `fileExt`, `fileName`                                             |
| video (3)    | `blurHash`, `w`(width), `h`(height)                               |
| file (5)     | `fileName`, `fileSize`, `fileExt`                                 |
| audio (2)    | `duration`(ms)                                                    |
| location (6) | `latitude`, `longitude`, `address`, `title`, `thumb`(静态地图URL) |

---

## 七、REST API 接口

> 所有接口均需在 Header 携带 `Authorization: Bearer <JWT>`

### 7.1 获取/创建客服会话

```
POST /api/chat/business
Body: { "bizKey": "official_platform_support_v1" }
Response: { "conversationId": "conv_uuid" }
```

### 7.2 获取会话详情

```
GET /api/chat/conversation/:conversationId
Response: ConversationDetail（含成员列表、消息序号、已读状态等）
```

### 7.3 获取历史消息（分页）

```
GET /api/chat/messages
Params:
  conversationId: string  (必填)
  pageSize:       number  (默认 20)
  cursor:         number  (上一页最后一条 seqId，不传则获取最新)

Response:
{
  "list": [ ...ChatMessage ],
  "nextCursor": 21,           // null 表示没有更多历史
  "partnerLastReadSeqId": 40  // 对方最后已读的 seqId
}
```

### 7.4 上报已读

```
POST /api/chat/read
Body: { "conversationId": "conv_uuid", "maxSeqId": 42 }
Response: { "unreadCount": 0, "lastReadSeqId": 42 }
```

### 7.5 撤回消息

```
POST /api/chat/recall
Body: { "conversationId": "conv_uuid", "messageId": "msg_uuid" }
Response: { "messageId": "...", "tip": "Message recalled" }
```

### 7.6 转发消息

```
POST /api/chat/forward
Body: { "messageId": "original_msg_id", "targetConversationIds": ["conv_1", "conv_2"] }
```

---

## 八、核心业务逻辑

### 8.1 消息发送流程（Pipeline 架构）

```
用户触发发送
     │
     ▼
ChatActionService.sendText / sendImage / sendFile ...
     │
     ├─ 1. 本地乐观写入 (status: sending)
     ├─ 2. 更新会话列表快照（lastMsgContent / lastMsgTime）
     └─ 3. 执行 Pipeline Steps：
             ├── PersistStep        — 持久化本地文件路径
             ├── ImageProcessStep   — 图片压缩 + 缩略图 + BlurHash
             ├── VideoProcessStep   — 视频压缩 + 缩略图提取
             ├── UploadStep         — 上传媒体至 CDN，回写 URL 到 content
             └── SyncStep           — emit('send_message')，ACK 后 status=success
                                      失败 → OfflineQueueManager 排队重试（最多 5 次）
```

### 8.2 消息接收流程

```
Socket dispatch(type='chat_message')
     │
     ▼
SocketChatMixin._onChatMessage()
     │
     ├─ chatMessageStream  ──►  ChatEventHandler._onSocketMessage()
     │                               └─ 写入 LocalDB，清除未读计数，触发已读防抖上报
     │
     └─ conversationListUpdateStream  ──►  ConversationListProvider
                                               └─ 更新最新消息、重新排序、刷新 UI
```

### 8.3 增量同步算法（Gap Detection）

进入聊天室时执行：

1. 查本地最大 `seqId`（`localMaxSeqId`）
2. 从服务端拉最新一页消息
3. 若 `serverMaxSeqId > localMaxSeqId` → 存在消息空洞 → 向前递归补全
4. 若差距过大（空洞跨越多页）→ 触发 `recursiveSyncGap` 递归回填

### 8.4 已读状态同步

- **自己 → 对方**：进入聊天室触发 `markAsRead()`，上报最大 `seqId`，防抖 800ms
- **对方 → 自己**：监听 `conversation_read` 事件，将 `seqId <= lastReadSeqId` 的我方消息本地标为 `read`

### 8.5 离线队列

`OfflineQueueManager` 监听以下时机自动 flush：

- 网络恢复（`connectivity_plus`）
- App 从后台切回前台（`AppLifecycleState.resumed`）
- 消息 Pipeline 失败时主动触发

---

## 九、Admin 客服端实现指南

> 目标：实现一个 Web/Admin 后台，让客服人员能统一接管所有 `SUPPORT` 类型会话并与用户实时通信。

### 9.1 需要实现的功能模块

| 模块           | 描述                                         |
| -------------- | -------------------------------------------- |
| **登录鉴权**   | Admin JWT 认证，携带 token 连接 Socket.IO    |
| **会话列表**   | 拉取所有 SUPPORT 类型会话，实时更新未读数    |
| **聊天室**     | `join_chat` 进房，收发消息，历史记录分页加载 |
| **已读管理**   | 进入会话后自动上报已读，气泡显示已读标记     |
| **消息撤回**   | 客服可在 2 分钟内撤回自己的消息              |
| **多媒体支持** | 图片/文件预览，上传后发送 CDN URL            |
| **快捷回复**   | 预设客服话术，一键填入输入框                 |
| **会话转接**   | 将会话分配给其他客服人员（可选）             |
| **监控大屏**   | 实时在线会话数、待回复数、平均响应时长       |

---

### 9.2 Socket.IO 接入（TypeScript 示例）

```typescript
import { io, Socket } from "socket.io-client";

const socket: Socket = io("https://api.yourdomain.com/events", {
  transports: ["websocket"],
  auth: { token: ADMIN_JWT },
  query: { token: ADMIN_JWT },
  reconnectionAttempts: 5,
  autoConnect: false,
});

socket.connect();

// 统一分发事件监听
socket.on("dispatch", (payload: { type: string; data: any }) => {
  switch (payload.type) {
    case "chat_message":
      handleIncomingMessage(payload.data);
      break;
    case "conversation_read":
      handleReadReceipt(payload.data);
      break;
    case "message_recalled":
      handleRecall(payload.data);
      break;
  }
});

// 进入会话房间
function joinRoom(conversationId: string) {
  socket.emit("join_chat", { conversationId });
}

// 发送消息（带 ACK，10s 超时）
function sendMessage(conversationId: string, content: string, type = 0) {
  const tempId = `admin_${Date.now()}`;
  socket.emit(
    "send_message",
    { conversationId, content, type, tempId },
    (ack: { status: string; data?: any; message?: string }) => {
      if (ack.status === "ok") {
        console.log("Sent, seqId:", ack.data.seqId);
      } else {
        console.error("Send failed:", ack.message);
      }
    },
  );
}
```

---

### 9.3 会话数据结构（TypeScript）

```typescript
interface Conversation {
  id: string;
  type: "DIRECT" | "GROUP" | "BUSINESS" | "SUPPORT";
  name: string;
  avatar?: string;
  lastMsgContent?: string;
  lastMsgTime: number; // Unix ms
  unreadCount: number;
  isPinned: boolean;
  isMuted: boolean;
  lastMsgSeqId: number;
  lastMsgStatus: "sending" | "success" | "failed" | "read" | "pending";
}
```

---

### 9.4 消息数据结构（TypeScript）

```typescript
interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string; // 文本内容 或 媒体 CDN URL
  type: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 99;
  createdAt: number; // Unix ms
  seqId?: number;
  isRecalled?: boolean;
  isSelf: boolean;
  meta?: {
    // image
    fileExt?: string;
    fileName?: string;
    // video
    blurHash?: string;
    w?: number;
    h?: number;
    // file
    fileSize?: number;
    // audio
    duration?: number;
    // location
    latitude?: number;
    longitude?: number;
    address?: string;
    title?: string;
    thumb?: string;
  };
  sender?: { id: string; nickname: string; avatar?: string };
}
```

---

### 9.5 历史消息加载（分页）

```typescript
async function loadMessages(conversationId: string, cursor?: number) {
  const params = new URLSearchParams({ conversationId, pageSize: "20" });
  if (cursor) params.set("cursor", String(cursor));

  const res = await fetch(`/api/chat/messages?${params}`, {
    headers: { Authorization: `Bearer ${ADMIN_JWT}` },
  });
  // 返回: { list: ChatMessage[], nextCursor: number | null, partnerLastReadSeqId: number }
  return res.json();
}
```

---

### 9.6 消息内容渲染建议

> 图片、视频、音频有完整的媒体处理规范，详见 **第十一章**。下表为快速参考。

| 消息类型     | content 内容            | 渲染方式                                                       | 详细规范 |
| ------------ | ----------------------- | -------------------------------------------------------------- | -------- |
| text (0)     | 文本字符串              | 直接展示，支持 Emoji                                           | —        |
| image (1)    | 图片 CDN 相对/绝对 URL  | BlurHash 占位 → CDN 缩放图（240px） → 点击全屏                 | 见 §10.1 |
| audio (2)    | 音频 CDN URL            | 静态波形 + 时长 + 点击播放，`meta.duration`(ms)                | 见 §10.3 |
| video (3)    | 视频 CDN URL            | `meta.remote_thumb` 封面 + BlurHash 占位 + 时长标签 + 播放按钮 | 见 §10.2 |
| file (5)     | 文件 CDN URL            | `meta.fileName` + `meta.fileSize` + 下载/打开按钮              | —        |
| location (6) | `"[Location]"` 占位字符 | `meta.thumb` 静态地图图片，点击打开地图                        | —        |
| system (99)  | 系统提示文本            | 居中灰色小字，**不触发已读上报**                               | —        |
| recalled (4) | `"[Message Recalled]"`  | 斜体灰色提示文字                                               | —        |

---

### 9.7 消息序列号（seqId）规范

- `seqId` 是单会话内全局递增序列号
- 用于：检测消息空洞、标记已读水位（`lastReadSeqId`）、消息跳转定位
- Admin 端建议按 `seqId` 升序排列消息列表

---

### 9.8 客服会话识别

客户端通过以下方式创建客服会话（已在 Flutter 端实现）：

```dart
Api.chatBusinessApi('official_platform_support_v1')
// 返回 { conversationId: "xxx" } 进入 /chat/room/:conversationId
```

Admin 端过滤 `type == 'SUPPORT'` 即可识别所有客服会话。  
`bizKey = 'official_platform_support_v1'` 为当前正式平台客服会话的唯一业务键。

---

### 9.9 安全注意事项

1. **Token 有效期**：JWT 过期后需刷新再重连 Socket，避免断连
2. **发送超时**：`send_message` 建议设置 10s 超时，超时后给用户错误提示
3. **消息去重**：以 `id` 字段为唯一键，防止网络抖动导致重复渲染
4. **系统消息过滤**：`type == 99` 不应触发已读上报
5. **权限隔离**：Admin 客服账号只应操作 `SUPPORT` 类型会话，不得访问 `DIRECT`/`GROUP` 私人会话

---

## 十、媒体消息处理完整规范

> ⚠️ **此章节是 Admin 端实现媒体消息的关键依据**，客户端在发送/接收每种媒体时有固定的字段结构与渲染优先级，不遵循会导致显示不一致。

---

### 10.1 图片消息（type = 1）

#### 发送侧处理流程（Flutter 已实现）

```
原始图片文件
    │
    ▼ ImageCompressionService.compressForUpload()
    ├─ 若文件 > 500KB → 压缩至 maxWidth=1920, quality=80, format=JPEG
    ├─ 若文件 ≤ 500KB → 原样使用
    │
    ▼ ImageCompressionService.getTinyThumbnail()
    ├─ 生成 200px 缩略图（quality=50）→ 存为 previewBytes（内存）
    │   供接收方在图片加载前即时展示
    │
    ▼ ImageProcessStep → ThumbBlurHashService.build()
    ├─ 从缩略图计算 BlurHash（4x3 分量，32x32 像素输入）
    ├─ 写入 meta.blurHash、meta.w、meta.h
    │
    ▼ UploadStep
    ├─ 上传压缩后的图片到 CDN
    ├─ content = CDN 相对路径（如 "uploads/chat/xxx.jpg"）
    │
    ▼ SyncStep（发送到服务器）
    └─ 最终 content 更新为服务器确认的 CDN URL
```

#### 图片消息最终字段结构

```json
{
  "content": "uploads/chat/2024/03/abc123.jpg",
  "type": 1,
  "meta": {
    "w": 1080,
    "h": 1920,
    "blurHash": "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
    "fileExt": "jpg",
    "fileName": "photo.jpg"
  }
}
```

#### Admin 端渲染规范

| 步骤                 | 说明                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| **1. 占位图**        | 优先用 `previewBytes`（base64/bytes）渲染模糊缩略图；若无则用 `meta.blurHash` 渲染 BlurHash 占位 |
| **2. 宽高比**        | `meta.w / meta.h`，建议 clamp 到 `[0.5, 2.0]`，气泡固定宽度 240px                                |
| **3. 图片 URL 构建** | `content` 若为相对路径（`uploads/...`）须拼上图片 CDN 域名                                       |
| **4. CDN 缩放参数**  | 列表缩略图：`width=240,quality=75,fit=cover,f=auto`；预览大图：`width=1200,quality=85,f=auto`    |
| **5. CDN URL 格式**  | `https://{IMG_BASE_URL}/cdn-cgi/image/{params}/{relative_path}`                                  |
| **6. 点击行为**      | 打开全屏图片预览，建议支持双指缩放                                                               |
| **7. 发送中状态**    | 在图片气泡上叠加半透明蒙层 + loading 圆圈                                                        |
| **8. 发送失败状态**  | 叠加红色 error 图标，点击可重试                                                                  |

#### CDN URL 示例

```
列表缩略图（240px）:
https://img.yourdomain.com/cdn-cgi/image/width=240,quality=75,fit=cover,f=auto/uploads/chat/abc.jpg

全屏预览（1200px）:
https://img.yourdomain.com/cdn-cgi/image/width=1200,quality=85,f=auto/uploads/chat/abc.jpg
```

---

### 10.2 视频消息（type = 3）

#### 发送侧处理流程（Flutter 已实现）

```
原始视频文件
    │
    ▼ 缩略图提取
    ├─ Mobile: VideoCompress.getByteThumbnail(path, quality=30) → JPEG bytes
    ├─ Web:    canvas 截帧 at 0.1s, maxWidth=320, quality=0.85 → JPEG bytes
    │
    ▼ ThumbBlurHashService.build(thumbJpeg)
    ├─ meta.blurHash = BlurHash 字符串
    ├─ meta.w = 缩略图宽度
    ├─ meta.h = 缩略图高度
    │
    ▼ VideoProcessor.process()（Mobile）
    ├─ 视频压缩（ffmpeg）
    ├─ meta.duration = 时长（毫秒）
    │
    ▼ UploadStep（双目标上传）
    ├─ 缩略图 → CDN → meta.remote_thumb = "uploads/chat/thumb_xxx.jpg"
    └─ 视频主体 → CDN → content = "uploads/chat/xxx.mp4"
```

#### 视频消息最终字段结构

```json
{
  "content": "uploads/chat/2024/03/video_abc.mp4",
  "type": 3,
  "meta": {
    "w": 1280,
    "h": 720,
    "duration": 15000,
    "blurHash": "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
    "thumb": "uploads/chat/2024/03/thumb_abc.jpg",
    "remote_thumb": "uploads/chat/2024/03/thumb_abc.jpg"
  }
}
```

> `meta.thumb` 与 `meta.remote_thumb` 可能同时存在，内容相同，以 `meta.remote_thumb` 为准；若不存在则使用 `meta.thumb`。

#### Admin 端渲染规范

| 步骤            | 说明                                                                   |
| --------------- | ---------------------------------------------------------------------- |
| **1. 封面图**   | 读取 `meta.remote_thumb`（或 `meta.thumb`），拼接 CDN 域名后显示为封面 |
| **2. 封面占位** | 若封面未加载完，用 `meta.blurHash` 渲染 BlurHash 占位                  |
| **3. 宽高比**   | 同图片，使用 `meta.w / meta.h`，clamp `[0.5, 2.0]`                     |
| **4. 时长标签** | `meta.duration / 1000` 秒，格式化为 `MM:SS`，显示在封面右下角          |
| **5. 播放按钮** | 封面中心叠加播放图标，点击触发播放                                     |
| **6. 视频 URL** | `content` 拼接 CDN 域名，直接用 `<video>` 标签或播放器 SDK 播放        |
| **7. 互斥播放** | 同一页面同时只能有一个视频播放，切换时暂停上一个                       |
| **8. Web 端**   | 直接 `<video src="{fullUrl}" controls />` 即可；无需额外处理           |

#### 视频缩略图 CDN URL

```
封面缩略图（240px）:
https://img.yourdomain.com/cdn-cgi/image/width=240,quality=75,fit=cover,f=auto/uploads/chat/thumb_abc.jpg

完整视频 URL:
https://img.yourdomain.com/uploads/chat/video_abc.mp4
```

> ⚠️ 视频文件本身**不经过** `cdn-cgi/image/` 缩放链路，直接拼接 `imgBaseUrl/` 前缀即可。

---

### 10.3 语音/音频消息（type = 2）

#### 发送侧处理流程（Flutter 已实现）

```
录音完成（本地路径 + 时长 ms）
    │
    ▼ ChatMessageFactory.voice()
    ├─ meta.duration = 时长（毫秒）（同时存入顶层 duration 字段）
    │
    ▼ PersistStep（保存本地文件路径到沙盒）
    │
    ▼ UploadStep
    └─ 音频文件 → CDN → content = "uploads/chat/voice_xxx.m4a"
       （无压缩，无缩略图，直接上传）
```

#### 语音消息最终字段结构

```json
{
  "content": "uploads/chat/2024/03/voice_abc.m4a",
  "type": 2,
  "meta": {
    "duration": 8500
  }
}
```

> `meta.duration` 单位为**毫秒**。Flutter 端同时将 `duration` 写入 `ChatUiModel` 顶层字段，Admin 端统一从 `meta.duration` 读取即可。

#### Admin 端渲染规范

| 步骤            | 说明                                                                            |
| --------------- | ------------------------------------------------------------------------------- |
| **1. 时长显示** | `meta.duration / 1000` 取整（秒），格式如 `"8''"` 或 `"00:08"`                  |
| **2. 气泡宽度** | 动态：`min_width + duration_sec * 5px`，建议约束在 `[140px, 65vw]`              |
| **3. 波形图**   | 显示静态随机波形（12根柱），用 `messageId` 作为随机种子（保证同一消息波形一致） |
| **4. 播放状态** | 播放中动画波形高亮；暂停/停止恢复静态                                           |
| **5. 音频 URL** | `content` 拼接 CDN 域名，使用 `<audio>` 标签或 Web Audio API                    |
| **6. 互斥播放** | 同一页面同时只能播放一条语音，切换时停止上一条                                  |
| **7. 进度展示** | 播放时可在波形柱上叠加进度颜色                                                  |

#### 波形柱高度生成算法（保证与客户端一致）

```typescript
// 用 messageId 作为种子，生成与 Flutter 端完全一致的波形
function generateWaveform(messageId: string, barCount = 12): number[] {
  // 模拟 Dart 的 hashCode 算法
  let seed = 0;
  for (let i = 0; i < messageId.length; i++) {
    seed = (Math.imul(31, seed) + messageId.charCodeAt(i)) | 0;
  }
  // 使用 LCG 伪随机数生成器
  const heights: number[] = [];
  for (let i = 0; i < barCount; i++) {
    seed = (Math.imul(1664525, seed) + 1013904223) | 0;
    const rand = (seed >>> 0) / 0xffffffff; // [0, 1)
    heights.push(0.3 + rand * 0.7); // [0.3, 1.0)
  }
  return heights;
}
```

> ⚠️ Flutter 使用 Dart 的 `String.hashCode`（Java 风格 31 乘法 hash），上方的 JS 实现尽量逼近，但由于语言差异可能存在微小偏差。若要严格一致，建议在后端 API 预生成并下发波形数据。

#### 音频完整 CDN URL

```
https://img.yourdomain.com/uploads/chat/voice_abc.m4a
```

---

### 10.4 媒体 URL 通用解析规则

Admin 端在渲染所有媒体消息时，对 `content` 字段的处理统一按以下规则：

```typescript
const IMG_BASE_URL = "https://img.yourdomain.com"; // 图片/媒体 CDN 域名
const API_BASE_URL = "https://api.yourdomain.com"; // 接口域名

function resolveMediaUrl(content: string): string {
  if (!content) return "";

  // 1. 已是完整 https URL → 直接使用
  if (content.startsWith("https://") || content.startsWith("http://")) {
    return content;
  }

  // 2. 相对路径（uploads/...）→ 拼接图片 CDN 域名
  if (content.startsWith("uploads/")) {
    return `${IMG_BASE_URL}/${content}`;
  }

  // 3. 其他情况（旧格式兼容）→ 拼接并尝试
  return `${IMG_BASE_URL}/${content.replace(/^\//, "")}`;
}

// 图片专用：带 CDN 缩放参数
function resolveImageUrl(content: string, width = 240): string {
  const base = resolveMediaUrl(content);
  if (!base || !base.includes("uploads/")) return base;

  // 提取 uploads/ 之后的路径
  const key = base.substring(base.indexOf("uploads/"));
  return `${IMG_BASE_URL}/cdn-cgi/image/width=${width},quality=75,fit=cover,f=auto/${key}`;
}
```

---

### 10.5 各媒体类型字段速查表

| 字段                | image(1)        | video(3)        | audio(2)     | file(5)         |
| ------------------- | --------------- | --------------- | ------------ | --------------- |
| `content`           | 图片 CDN URL    | 视频 CDN URL    | 音频 CDN URL | 文件 CDN URL    |
| `meta.w`            | ✅ 图片宽度(px) | ✅ 视频宽度(px) | ❌           | ❌              |
| `meta.h`            | ✅ 图片高度(px) | ✅ 视频高度(px) | ❌           | ❌              |
| `meta.blurHash`     | ✅              | ✅              | ❌           | ❌              |
| `meta.duration`     | ❌              | ✅ 时长(ms)     | ✅ 时长(ms)  | ❌              |
| `meta.remote_thumb` | ❌              | ✅ 封面图 URL   | ❌           | ❌              |
| `meta.thumb`        | ❌              | ✅（备用封面）  | ❌           | ❌              |
| `meta.fileName`     | ✅（原始名）    | ❌              | ❌           | ✅              |
| `meta.fileSize`     | ❌              | ❌              | ❌           | ✅ bytes        |
| `meta.fileExt`      | ✅ `jpg`/`png`  | ❌              | ❌           | ✅ `pdf`/`zip`… |

---

## 十一、扩展事件（未来规划）

| 事件          | 描述                |
| ------------- | ------------------- |
| `typing`      | 正在输入指示器      |
| `call_invite` | 音视频通话邀请      |
| `call_accept` | 接受通话            |
| `call_end`    | 结束通话            |
| `call_ice`    | WebRTC ICE 候选交换 |

> 当前客服端建议暂不实现音视频通话，仅支持文字 / 图片 / 文件消息即可。

---

_EOF_
