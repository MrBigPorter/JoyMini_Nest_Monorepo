---
title: 'useChatSocket — Admin 客服实时通信的 Socket.IO 实践'
slug: use-chat-socket-realtime-customer-service
tags: Next.js, Admin, WebSocket, Socket.IO, TypeScript, React, Real-Time, Customer Service
description: useChatSocket 是一个 250 行的自定义 React Hook，封装了 Socket.IO 实时通信的完整生命周期管理，包括连接管理、房间隔离、统一事件分发、消息映射和 ACK 超时发送模式。
---

# useChatSocket — Admin 客服实时通信的 Socket.IO 实践

> **难度**: ⭐⭐⭐⭐  
> **适用场景**: 管理后台需要实时推送的任何模块（客服、订单通知、系统告警）  
> **源码位置**: [`useChatSocket.ts`](../../../../apps/admin-next/src/hooks/useChatSocket.ts)

## 一、为什么需要专用 Socket Hook？

管理后台的客服模块需要处理**双向实时通信**：

- 用户点击「联系客服」→ Admin 侧**立即**弹出新会话通知
- 客服回复一条消息 → 用户端**立即**收到，无需轮询
- 消息撤回、会话关闭等操作需要**实时同步**

如果只用 HTTP 轮询（30s），会出现：

| 问题 | 体验 |
|------|------|
| 新消息延迟 | 最长 30s 才看到 |
| 重复渲染 | 每次轮询刷新整个列表 |
| 服务器压力 | 每秒 N 个请求 × 在线客服数 |

因此我们选择 **Socket.IO + NestJS Gateway** 架构，通过一个 250 行的自定义 Hook [`useChatSocket`](../../../../apps/admin-next/src/hooks/useChatSocket.ts) 将底层复杂性封装为三个清晰的返回值：

```ts
const { status, joinRoom, sendViaSocket } = useChatSocket({
  conversationId,
  onMessage,
  onRecalled,
  onConversationUpdated,
});
```

## 二、架构总览：全链路 Socket 通信

### 2.1 通信链路

```
Flutter 用户          API Gateway (nginx)         NestJS Server          Admin Next.js
   │                       │                          │                      │
   │  ── WebSocket ──────►  │  /socket.io/ proxy  ──►  │  /events Gateway  ──►  useChatSocket
   │                       │                          │                      │
   │  ◄── Socket.IO ──────  │  ◄── emit dispatch ────  │  ◄── ACK pattern ──  │
```

关键路径：

1. **nginx 代理** — `/socket.io/` 路径代理到 NestJS `:3000`
2. **NestJS Gateway** — `@WebSocketGateway({ namespace: '/events' })` 处理所有客服事件
3. **Socket.IO client** — 浏览器端通过 `io('/events', { transports: ['websocket'] })` 直连

### 2.2 与前端 Blog HttpClient 的对比

| 维度 | Blog HttpClient (HTTP) | Admin useChatSocket (WebSocket) |
|------|----------------------|-------------------------------|
| 协议 | Axios + HTTP/1.1 | Socket.IO over WebSocket |
| 状态 | 无状态请求-响应 | 有状态长连接 |
| 推送 | 只能客户端拉取 | 服务端任意推送 |
| 重连 | 每次请求独立 | 自动重连 + 房间重新加入 |
| 并发 | 请求级 dedup | 事件级 dispatch 分发 |

## 三、核心设计剖析

### 3.1 连接生命周期 — 单次挂载

Hook 使用一个 `useEffect`（仅依赖 `getUserIdFromToken`）在组件挂载时建立连接，并在卸载时断开：

```ts
useEffect(() => {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('auth_token')
    : null;
  if (!token) return;

  const currentUserId = getUserIdFromToken(token);
  setStatus('connecting');

  const socket = io('/events', {
    transports: ['websocket'],
    auth: { token },
    query: { token },
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  // ... 事件绑定 ...

  return () => {
    socket.disconnect();
    socketRef.current = null;
    currentRoomRef.current = null;
    setStatus('disconnected');
  };
}, [getUserIdFromToken]);
```

**设计要点**：

| 决策 | 理由 |
|------|------|
| `reconnectionAttempts: 5` | 防止无限重连消耗资源，5 次足够覆盖临时网络波动 |
| `reconnectionDelay: 2000` | 2s 间隔平衡即时性和服务器压力 |
| `transports: ['websocket']` | 强制 WebSocket，跳过 long-polling 降级 |
| `auth` + `query` 双重传 token | NestJS Gateway 两端兼容 |

### 3.2 房间管理 — 按会话隔离

客服一次只能处理一个会话，但需要：

- **连接时** — 自动加入私有房间 `user_{userId}`，接收所有新会话通知
- **选择会话时** — 加入该会话 room，接收该会话的消息
- **切换会话时** — `leave` 旧 room，`join` 新 room
- **重连后** — 自动重新加入当前 room

```ts
// 连接时加入私有房间
socket.on('connect', () => {
  setStatus('connected');
  if (currentUserId) {
    const privateRoom = `user_${currentUserId}`;
    socket.emit('join_chat', { conversationId: privateRoom });
    currentRoomRef.current = privateRoom;
  }
});

// 重连后自动重新加入
socket.on('reconnect', () => {
  setStatus('connected');
  if (currentRoomRef.current) {
    socket.emit('join_chat', { conversationId: currentRoomRef.current });
  }
});
```

**房间切换 effect** — 监听 `conversationId` 变化：

```ts
useEffect(() => {
  const socket = socketRef.current;
  if (!socket || !socket.connected) return;

  if (currentRoomRef.current && currentRoomRef.current !== conversationId) {
    socket.emit('leave_chat', { conversationId: currentRoomRef.current });
  }
  if (conversationId) {
    socket.emit('join_chat', { conversationId });
    currentRoomRef.current = conversationId;
  } else {
    currentRoomRef.current = null;
  }
}, [conversationId]);
```

### 3.3 统一事件分发 — Dispatch 模式

NestJS Gateway 将所有客服事件包装为统一的 `dispatch` 事件，Hook 内用 `switch-case` 分发：

```
dispatch payload:
┌─────────────────────────────────┐
│ {                               │
│   type: string,                 │  ← 事件类型标识
│   data: RawSocketData           │  ← 原始数据（运行时未校验类型）
│ }                               │
└─────────────────────────────────┘
```

4 种事件类型：

| type | 触发时机 | 回调 |
|------|---------|------|
| `chat_message` | 新消息 | `onMessageRef.current()` + `onConversationUpdatedRef.current()` |
| `message_recalled` | 消息被撤回 | `onRecalledRef.current()` |
| `conversation_updated` | 会话状态变更 | `onConversationUpdatedRef.current()` |
| `support_new_conversation` | 用户首次点击联系客服 | `onConversationUpdatedRef.current()` |

**为什么不用单独的事件名？** 统一 `dispatch` 让 Gateway 侧只需要一个 `@SubscribeMessage('dispatch')` 装饰器，客户端也只需注册一个监听器，减少连接开销。

### 3.4 消息映射 — `mapRawMessage`

Socket 推送的原始数据是 `Record<string, unknown>`，需要映射为强类型 [`ChatMessage`](../../../../apps/admin-next/src/type/types.ts:1269)：

```ts
function mapRawMessage(raw: RawSocketData): ChatMessage {
  return {
    id: (raw.id as string) ?? '',
    seqId: (raw.seqId as number) ?? 0,
    content: (raw.content as string) ?? '',
    type: (raw.type as number) ?? 0,
    isRecalled: (raw.isRecalled as boolean) ?? false,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    meta: (raw.meta as ChatMessage['meta']) ?? null,
    senderId: (raw.senderId as string | null) ?? null,
    sender: (raw.sender as ChatMessage['sender']) ?? null,
    isSystem: (raw.isSystem as boolean) ?? raw.senderId === null,
  };
}
```

**安全策略**：每个字段都用 `??` 提供默认值，防止后端字段缺失导致前端崩溃。

### 3.5 稳定回调引用 — Stable Callback Refs

这是本 Hook 最重要的模式。React 的 `useEffect` 依赖数组要求回调函数稳定，但 `onMessage`、`onRecalled` 等由父组件传入，每次渲染都可能变化。

解决方式：**使用 `useRef` 存储最新回调，`useEffect` 只依赖 ref 本身**。

```ts
const onMessageRef = useRef(onMessage);
const onRecalledRef = useRef(onRecalled);
const onConversationUpdatedRef = useRef(onConversationUpdated);

useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
useEffect(() => { onRecalledRef.current = onRecalled; }, [onRecalled]);
useEffect(() => { onConversationUpdatedRef.current = onConversationUpdated; }, [onConversationUpdated]);
```

这样 Socket 的 `dispatch` 事件监听器永远引用 ref 的最新值，而不会因为回调变化导致 socket 重新连接：

```ts
socket.on('dispatch', (payload) => {
  switch (payload.type) {
    case 'chat_message':
      onMessageRef.current(mapRawMessage(payload.data));  // ← 总是最新回调
      break;
    // ...
  }
});
```

### 3.6 发送消息 — ACK 模式 + 10s 超时

发送消息需要等待服务器确认（ACK）以获取正式的 `id` 和 `seqId`。Hook 用 `Promise` 包装：

```ts
const sendViaSocket = useCallback(
  (convId: string, content: string, type = 0, tempId?: string):
    Promise<{ id: string; seqId: number }> => {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        reject(new Error('Socket not connected'));
        return;
      }
      const tid = tempId ?? `admin_${Date.now()}`;
      const timer = setTimeout(() => reject(new Error('Send timeout')), 10_000);
      socket.emit('send_message',
        { conversationId: convId, content, type, tempId: tid },
        (ack) => {
          clearTimeout(timer);
          if (ack.status === 'ok' && ack.data) {
            resolve(ack.data);
          } else {
            reject(new Error(ack.message ?? 'Send failed'));
          }
        },
      );
    });
  },
  [],
);
```

**ACK 流程**：

```
Admin Browser           NestJS Server
    │                        │
    │── send_message ──────► │  包含 tempId 用于乐观渲染匹配
    │                        │── 保存消息到数据库
    │◄── ack { status,data }─│  返回正式 id + seqId
    │                        │── broadcast dispatch('chat_message')
    │◄── dispatch ──────────│  推送给会话内所有人
```

**超时保护**：10s 无响应自动 reject，防止消息「卡住」UI。

## 四、组件集成模式

### 4.1 SocketIndicator — 状态可视化

[`SocketIndicator`](../../../../apps/admin-next/src/components/customer-service/SocketIndicator.tsx) 是一个纯展示组件，将 `SocketStatus` 映射为视觉反馈：

| Status | 颜色 | 图标 | 文案 | 含义 |
|--------|------|------|------|------|
| `connected` | 绿色 | `Wifi` | Live | 实时连接正常 |
| `connecting` | 黄色 | `RefreshCw` (旋转) | Connecting... | 正在建立/恢复连接 |
| `disconnected` | 灰色 | `WifiOff` | Polling | 降级为 HTTP 轮询 |
| `error` | 灰色 | `WifiOff` | Polling | 连接失败，降级 |

在 `PageHeader` 的 `action` 插槽中显示：

```tsx
<PageHeader
  title={t('customerService.deskTitle')}
  action={<SocketIndicator status={socketStatus} />}
/>
```

### 4.2 CustomerServiceDesk — 完整集成

[`CustomerServiceDesk`](../../../../apps/admin-next/src/components/customer-service/CustomerServiceDesk.tsx) 展示了完整的集成模式：

```tsx
// 1. 使用 Hook
const { status: socketStatus } = useChatSocket({
  conversationId: selectedConv?.id ?? null,
  onMessage: useCallback((msg: ChatMessage) => {
    onNewMessageRef.current?.(msg);
    refreshList();  // 刷新会话列表（更新末条消息、未读数）
  }, [refreshList]),
  onRecalled: useCallback((data) => {
    onRecalledRef.current?.(data);
  }, []),
  onConversationUpdated: useCallback(() => {
    refreshList();  // 刷新会话列表
  }, [refreshList]),
});

// 2. 30s HTTP 轮询作为降级
const { data, loading, run: refreshList } = useRequest(
  () => chatApi.getConversations(queryParams, { trace: false }),
  { refreshDeps: [page, keyword, statusFilter], pollingInterval: 30000 },
);
```

**降级策略**：Socket 连接时实时更新，Socket 断开时 30s 轮询兜底。两种更新互不干扰 — WebSocket 推送触发 `refreshList()`，轮询也会自动触发。

### 4.3 ChatWindow 通信 — Callback Ref 桥接

`ChatWindow` 是一个独立组件，需要接收 `onMessage` 回调并在消息到达时滚动到底部。但 `useChatSocket` 的 `onMessage` 在父组件 `CustomerServiceDesk` 中注册，如何通知到 `ChatWindow`？

**答案：Callback Ref 桥接模式**

```tsx
// 父组件中定义 ref 函数
const onNewMessageRef = useRef<((msg: ChatMessage) => void) | null>(null);
const onRecalledRef = useRef<((...) => void) | null>(null);

// 传递给 ChatWindow 注册
<ChatWindow
  registerOnNewMessage={(fn) => { onNewMessageRef.current = fn; }}
  registerOnRecalled={(fn) => { onRecalledRef.current = fn; }}
/>

// useChatSocket 回调中转
onMessage: useCallback((msg) => {
  onNewMessageRef.current?.(msg);  // 通知 ChatWindow
  refreshList();                    // 刷新会话列表
}, [refreshList]),
```

这样 `ChatWindow` 不需要知道 `useChatSocket` 的存在，通过注册模式实现解耦。

## 五、与前端 Blog Fetcher 架构的对比

| 维度 | Blog Fetcher (HTTP) | Admin useChatSocket (WebSocket) |
|------|---------------------|--------------------------------|
| 核心文件 | [`fetcher.ts`](../../../../apps/frontend-blog/src/lib/fetcher.ts) (7 层) | [`useChatSocket.ts`](../../../../apps/admin-next/src/hooks/useChatSocket.ts) (1 层) |
| 复杂度来源 | 三模式 CSR/SSG/SSR 适配 | 房间管理 + 重连恢复 |
| 缓存策略 | React Query + IndexedDB | N/A（消息已存数据库） |
| 重试机制 | 指数退避 3 次 | Socket.IO 自动 5 次 |
| 请求去重 | GET inflight dedup | N/A（事件驱动） |
| Token 刷新 | 单飞 refreshAccessToken | 连接时一次性验证 |
| 错误策略 | handleBizError + handleHttpError | dispatch 统一分发 |

**关键差异**：HTTP 层解决的是「请求可靠性」（重试、去重、token 刷新），WebSocket 解决的是「连接可靠性」（重连、房间恢复、消息顺序）。

## 六、错误处理与边界情况

### 6.1 连接失败

```
Socket connect_error
  ↓
setStatus('error')
  ↓
SocketIndicator 显示灰色 WifiOff
  ↓
30s HTTP polling 兜底
```

### 6.2 Token 过期

Token 在连接时验证。如果 JWT 过期，Socket.IO 的 `connect_error` 事件会触发。此时：

1. `status` 变为 `error`
2. `SocketIndicator` 显示降级状态
3. 用户可以通过页面刷新获取新 token

### 6.3 重连后状态不一致

WebSocket 重连后，当前选中的会话房间可能已经丢失。Hook 在 `reconnect` 事件中自动恢复：

```ts
socket.on('reconnect', () => {
  setStatus('connected');
  if (currentRoomRef.current) {
    socket.emit('join_chat', { conversationId: currentRoomRef.current });
  }
});
```

同时 `CustomerServiceDesk` 还暴露了 `joinRoom` 方法供手动恢复。

### 6.4 时序边界

| 场景 | 处理方式 |
|------|---------|
| 组件卸载时消息到达 | `useEffect` cleanup 断开 socket |
| 发送消息时 Socket 断开 | `sendViaSocket` 立即 reject |
| 快速切换会话 | 第二个 `useEffect` 的 cleanup 比第一个晚，先 leave 旧 room 再 join 新 room |
| 多条消息并发 | Promise 各自独立，ACK 通过 `tempId` 匹配 |

## 七、测试策略

[`CustomerServiceDesk.test.tsx`](../../../../apps/admin-next/src/__tests__/views/CustomerServiceDesk.test.tsx) 中对 `useChatSocket` 进行了 mock：

```ts
vi.mock('@/hooks/useChatSocket', () => ({
  useChatSocket: () => ({
    status: 'connected',
    joinRoom: vi.fn(),
    sendViaSocket: vi.fn(),
  }),
}));
```

**测试关注点**：

| 测试用例 | 验证内容 |
|----------|---------|
| status 正确传递 | SocketIndicator 显示对应状态 |
| onMessage 触发 | ChatWindow 收到新消息 |
| conversationId 变化 | join/leave room 被调用 |
| sendViaSocket 调用 | send_message emit 包含正确参数 |

## 八、总结

[`useChatSocket`](../../../../apps/admin-next/src/hooks/useChatSocket.ts) 是一个**250 行的 Hook，封装了整个 WebSocket 实时通信的复杂性**：

- **单次挂载** — 连接生命周期与组件绑定，避免内存泄漏
- **房间隔离** — 按会话隔离消息，`user_{id}` 私有房间接收系统通知
- **统一 dispatch** — 4 种事件类型通过 switch-case 分发，Gateway 侧只需一个 `@SubscribeMessage`
- **稳定 refs** — 用 `useRef` 打破回调闭包陷阱，socket 不会因父组件重渲染而重连
- **ACK 超时** — 发送消息 10s 超时保护，`tempId` 支持乐观渲染
- **自动恢复** — 重连后自动恢复当前房间，HTTP 30s 轮询兜底

---

**相关阅读**：

- [A4: HttpClient 请求层 — 双环境配置 + 单飞 Token 刷新](./http-client-auth-refresh-retry.md) — HTTP 层的可靠性设计
- [F3: 三模式 Fetcher 适配层](../frontend/nextjs-universal-fetcher.md) — 前端 Blog 的请求架构
- [JoyMini Admin — 智能管理后台概览](../projects/joymini-admin-nextjs.md) — 项目整体介绍
