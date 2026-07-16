# AI 客服 Socket 统一消息通道架构

## 背景：当前架构的问题

```
用户发消息                    AI 回复
   │                           │
POST /chat/message         POST /ai/customer/chat → GET /stream
   │                           │
   ▼                           ▼
ChatService               AiCustomerService.chatStream()
   │                           │
   ▼                           ▼
EventEmitter2              SSE res.write()
   │                           │
   ▼                           ▼
SocketListener → eventsGateway.dispatch()      TCP 连接
(chat_message 事件)          (跟 Socket 无关)
```

AI 回复走 SSE 协议，IM 消息走 Socket 协议。两套完全不连通，导致 ChatPage 需要 `isAiChat` 分支判断走哪条路。

## 目标架构：全走 Socket

```
用户发消息                    AI 回复
   │                           │
POST /chat/message         AiCustomerService.chatStream()
   │                           │
   ▼                           ▼
ChatService               新增: eventsGateway.dispatch()
   │                           │
   ▼                           ▼
EventEmitter2 ─→ eventsGateway.dispatch() ←─── 同一出口
(socket 分发)      │                   (ai_token / ai_done / ...)
                   │
                   ▼
              Socket 房间 (conversationId)
                   │
                   ▼
              Flutter SocketService
                   │
              ┌────┴────┐
              │         │
        chat_message  ai_token / ai_done
        (人工回复)     (AI 逐字回复)
```

**核心变化：`AiCustomerService.chatStream()` 的输出从 SSE `res.write()` 改为 Socket `eventsGateway.dispatch()`。**

## 改动明细

### 后端

#### 1. shared 常量加 AI 事件类型

**文件:** `packages/shared/src/im/constants.ts` — `SocketEvents`

```typescript
AI_TOKEN: 'ai_token',
AI_STEP: 'ai_step',
AI_DONE: 'ai_done',
AI_ERROR: 'ai_error',
AI_TRANSFER: 'ai_transfer',
```

Flutter 端同步在 `lib/core/constants/socket_events.dart` 加同名常量。

#### 2. EventsGateway 注入 AiCustomerService

**文件:** `apps/api/src/client/ai-customer/ai-customer.service.ts`

```typescript
constructor(
  private readonly eventsGateway: EventsGateway,
  // ...原有依赖
) {}
```

`EventsGateway` 在 `@Global()` 的 `EventsModule` 中已注册，可直接注入，无需改模块。

#### 3. chatStream callbacks 改为 dispatch

原来 callbacks 写 SSE：

```typescript
callbacks.onToken(token) → res.write(`data: ${JSON.stringify({...})}\n\n`)
```

改为 callbacks 走 Socket：

```typescript
// AiCustomerService 内部直接 dispatch，不再经过 controller
this.eventsGateway.dispatch(conversationId, 'ai_token', { content: token });
this.eventsGateway.dispatch(conversationId, 'ai_step', { step, ...data });
this.eventsGateway.dispatch(conversationId, 'ai_done', {});
this.eventsGateway.dispatch(conversationId, 'ai_transfer', { conversationId, reason });
this.eventsGateway.dispatch(conversationId, 'ai_error', { content: error.message });
```

**注意：SSE 端点保留，Blog 前端仍需使用。**

`AiCustomerController` 的 `POST /ai/customer/chat` + `GET /chat/stream/:streamId` 不变。当前 `chatStream` 方法同时推 SSE + Socket。

### 6. ChatService AI 路由（新增）

**文件:** `apps/api/src/common/chat/chat.service.ts`

`sendMessage()` 保存消息后新增路由：

```typescript
// 检测到 SUPPORT/AI 类型对话 → 触发 LangGraph
if (conversationMeta.type === 'SUPPORT' || conversationMeta.type === 'AI') {
  this.eventEmitter.emit(
    CHAT_EVENTS.AI_MESSAGE_REQUESTED,
    new AiMessageRequestedEvent(conversationId, content, userId),
  );
}
```

**文件:** `apps/api/src/common/chat/events/chat.events.ts`

新增 `AI_MESSAGE_REQUESTED: 'ai.message.requested'` + `AiMessageRequestedEvent`。

### 7. AiMessageListener（新增）

**文件:** `apps/api/src/client/ai-customer/ai-message.listener.ts`

```typescript
@OnEvent(CHAT_EVENTS.AI_MESSAGE_REQUESTED)
async handleAiMessageRequest(payload) {
  // 调用 AiCustomerService.chatStream()
  // 内部已注入 EventsGateway，通过 Socket 推 ai_token/ai_done
}
```

#### 4. 新事件类型说明

| Socket 事件 | 方向 | 说明 |
|---|---|---|
| `ai_token` | 服务端→客户端 | AI 回复的逐字 token，`{ content: string }` |
| `ai_step` | 服务端→客户端 | AI 处理步骤，`{ step: string, ... }` |
| `ai_done` | 服务端→客户端 | AI 回复完成 |
| `ai_error` | 服务端→客户端 | AI 处理出错，`{ content: string }` |
| `ai_transfer` | 服务端→客户端 | 转人工，`{ conversationId, reason }` |

#### 5. 保留 SSE，仅 Flutter 端切换

SSE 协议不动，因为 Blog 前端依赖 SSE。Flutter App 端优先走 Socket，退回到 SSE 作为兜底。

```
Flutter App → Socket（ai_token / ai_done）
Blog 前端  → SSE（token / step / done）
```

### Flutter

#### 1. SocketDispatcherMixin 加 AI 路由

**文件:** `lib/core/services/socket/socket_service.dart`

```dart
// _handleDispatch 新增分支
case SocketEvents.aiToken:
case SocketEvents.aiStep:
case SocketEvents.aiDone:
case SocketEvents.aiTransfer:
case SocketEvents.aiError:
  _onAiEvent(type, data);
  break;
```

声明抽象方法：

```dart
void _onAiEvent(String type, dynamic data);
```

#### 2. SocketChatMixin 加 AI StreamController

**文件:** `lib/core/services/socket/chat_extension.dart`

```dart
final _aiEventController = StreamController<Map<String, dynamic>>.broadcast();
Stream<Map<String, dynamic>> get aiEventStream => _aiEventController.stream;

@override
void _onAiEvent(String type, dynamic data) {
  if (!_aiEventController.isClosed) {
    _aiEventController.add({'type': type, 'data': data});
  }
}
```

#### 3. ChatEventHandler 订阅 AI 事件

**文件:** `lib/ui/chat/handlers/chat_event_handler.dart`

```dart
// init() 中新增
_aiSub = _socketService.aiEventStream.listen(_onAiEvent);

@override
void dispose() {
  _aiSub?.cancel();
  // ...原有 dispose
}

void _onAiEvent(Map<String, dynamic> payload) {
  final type = payload['type'] as String;
  final data = payload['data'] as Map<String, dynamic>;
  switch (type) {
    case 'ai_token':
      final token = data['content'] as String? ?? '';
      _appendAiToken(token);
      break;
    case 'ai_step':
      _handleAiStep(data);
      break;
    case 'ai_done':
      _finalizeAiMessage();
      break;
    case 'ai_transfer':
      _handleAiTransfer(data['conversationId']);
      break;
    case 'ai_error':
      _handleAiError(data['content']);
      break;
  }
}
```

#### 4. ChatPage 去掉 isAiChat 分支

- 不再需要 `useAiMode` / `_transferredToHuman`
- 统一使用 `ChatViewModel` + `ChatRoomController`
- SUPPORT 对话和 GROUP/DIRECT 对话用同一套 UI，仅通过 `ConversationType` 限制功能（SUPPORT 禁语音/视频/文件/位置）
- AI 消息：streaming 期间在内存积累 token → 完成后写入 DB → DB 流触发 UI 更新（和现有 IM 消息一样的路径）

#### 5. 简化后的消息路径

```
用户发消息: POST /chat/message（统一）
  ↓
ChatService → 判断对话模式
  ├─ AI 模式 → 触发 LangGraph → Socket 推 ai_token
  └─ 人工模式 → Socket 推 chat_message（现有流程）
  ↓
Flutter 收消息:
  Socket → _handleDispatch
    ├─ chat_message → DB 流 → ChatViewModel → UI
    └─ ai_token     → ChatEventHandler → 累积 → ChatViewModel → UI
```

## 迁移步骤

### Phase 1: 后端双推（SSE + Socket 共存，不改 Flutter）

1. shared 常量加 AI 事件类型
2. `EventsGateway` 注入 `AiCustomerService`
3. `chatStream` 方法新增 Socket dispatch 输出（保留 SSE）
4. 后端同时推 SSE + Socket，Flutter 仍走 SSE，Blog 不受影响

### Phase 2: Flutter 接收 Socket AI 事件

5. `SocketEvents` 加 AI 类型
6. `SocketDispatcherMixin` + `SocketChatMixin` 加 AI 路由和 StreamController
7. `ChatEventHandler` 订阅 AI 事件
8. Flutter 能从 Socket 收 AI 回复，ChatPage 仍用 SSE

### Phase 3: ChatPage 统一

9. `AiChatViewModel` + `AiChatState` 逻辑合并到 `ChatViewModel` + `ChatListState`
10. 去掉 `isAiChat` / `useAiMode` / `_transferredToHuman`
11. 发消息统一走 `POST /chat/message`
12. SUPPORT 对话功能限制（禁语音/视频/文件/位置）

### Phase 4: 清理（选择性）

13. 如果不再需要 SSE Flutter 代码，删除 `lib/core/services/ai/` 下的 SSE 客户端
14. 删除 `ai_chat_view_model.dart`、`ai_chat_state.dart`

**SSE 服务端端点保留，Blog 前端仍需使用。**

## 涉及文件

### 后端
- `packages/shared/src/im/constants.ts` — SocketEvents 加 AI 常量
- `apps/api/src/common/chat/events/chat.events.ts` — +AI_MESSAGE_REQUESTED + AiMessageRequestedEvent
- `apps/api/src/common/chat/chat.service.ts` — sendMessage AI 路由
- `apps/api/src/client/ai-customer/ai-customer.service.ts` — 注入 EventsGateway + dispatch
- `apps/api/src/client/ai-customer/ai-customer.controller.ts` — 保留 SSE，可选拆方法
- `apps/api/src/client/ai-customer/ai-customer.module.ts` — 导入 EventsModule + AiMessageListener
- `apps/api/src/client/ai-customer/ai-message.listener.ts` — 接收 AI_MESSAGE_REQUESTED 触发 LangGraph

### Flutter
- `lib/core/constants/socket_events.dart` — 加 AI 常量
- `lib/core/services/socket/socket_service.dart` — _handleDispatch 加 AI 分支
- `lib/core/services/socket/chat_extension.dart` — 加 aiEventStream
- `lib/ui/chat/handlers/chat_event_handler.dart` — 订阅 AI 事件
- `lib/ui/chat/providers/chat_view_model.dart` — 合并 AiChatViewModel 逻辑
- `lib/ui/chat/providers/chat_room_provider.dart` — 适配 AI 模式
- `lib/ui/chat/chat_room/chat_page.dart` — 去掉 isAiChat 分支
- `lib/ui/chat/chat_room/chat_page_widgets.dart` — 合并 AI/IM 组件

## 验证

1. SUPPORT 对话用户发消息 → AI 通过 Socket 逐字回复
2. 转人工后 → 消息通过 Socket 正常推送（`chat_message`）
3. Socket 重连后 AI 流能继续
4. Blog 前端 SSE 不受影响
5. 群聊/私聊功能不受影响
