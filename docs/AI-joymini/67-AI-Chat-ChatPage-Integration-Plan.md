# AI Chat 集成到现有聊天系统

## 背景

AI 聊天（SSE 流式）被做成了一个独立的 AiChatPage，但正确的体验应该是像淘宝/天猫客服一样 — 在**现有的聊天窗口**里对话，而不是跳到一个新页面。

**现状**：独立的 `AiChatPage` + `AiChatNotifier` + `AiChatState` + `SseClient`，路由 `/ai/chat`  
**目标**：把 AI 聊天嵌入现有的 `ChatPage`，对话列表里加一个 "AI 智能客服" 入口

## 方案

核心策略：用 `conversationId == 'ai_chat'` 做分支，AI 模式走 SSE，不走 Socket。Socket 基础设施完全不动。

```
ChatPage(conversationId="abc123")
  → 现有 Socket 路径（不变）

ChatPage(conversationId="ai_chat")
  → aiChatViewModelProvider（跳过所有 Socket providers）
  → sendMessage() → SseClient → SSE 流
  → token 事件 → 更新内存中的 AiChatState
  → done 事件 → 持久化到本地 DB
```

## 改动清单

### 1. 新建 `AiChatViewModel` — 带 DB 持久化的核心状态管理器

**文件**: `lib/core/store/ai_chat/ai_chat_view_model.dart`

职责：
- 管理 `SseClient` 生命周期（发送/取消/重试）
- 流期间：消息存在内存 `AiChatState`，每个 token 更新不写 DB
- 流完成：用户消息 + AI 消息一次写入 DB（`MessageRepository.saveOrUpdate`）
- 冷启动：`init()` 从 DB 加载历史 AI 消息
- sessionId 持久化在 SharedPreferences

Provider 注册：
```dart
final aiChatViewModelProvider = StateNotifierProvider.family.autoDispose<
  AiChatViewModel, AiChatState, String>((ref, conversationId) {
  final repo = ref.read(messageRepositoryProvider);
  return AiChatViewModel(repo)..init();
});
```

### 2. 修改对话列表 — 注入 AI 入口

**文件**: `lib/ui/chat/providers/conversation_provider.dart`

在 `_fetchList()` / `_sortAndEmit()` 中，注入一个固定的 AI 条目：
```dart
final aiEntry = Conversation(
  id: 'ai_chat',
  type: ConversationType.support,
  name: 'AI 智能客服',
  lastMsgContent: '点击开始 AI 对话',
  isPinned: true,
  ...
);
```
- AI 条目始终在列表最顶部
- Socket 消息处理 `_onNewMessage` 跳过 `conversationId == 'ai_chat'`

### 3. 修改 `ChatPage` — AI 模式分支

**文件**: `lib/ui/chat/chat_room/chat_page.dart`

在 `build()` 开头：
```dart
final isAiChat = widget.conversationId == kAiConversationId;
if (isAiChat) return _buildAiChatView(context);
// ... 现有 Socket 路径不变
```

`_buildAiChatView()` 渲染：
- AI AppBar（机器人头像 + 标题 + 停止/清空按钮）
- AI 消息列表（用 `ListView.builder` + `ChatBubble`，传 `MessageType.ai` 消息）
- AI 输入栏（纯文本输入框，无语音/文件/表情）
- 自动滚动监听 + 空状态快捷问题

### 4. 新建 `AiMsgBubble` — AI 消息气泡

**文件**: `lib/ui/chat/components/bubbles/ai_msg_bubble.dart`

渲染逻辑：
- 气泡内文本（打字机效果增量更新）
- 空内容 + 接收中 → 三点跳动指示器
- 文本后 + 接收中 → 闪烁光标
- 步骤文本（"正在查余额..."）
- 失败状态 → 重试按钮

从旧 `AiChatPage` 提取 `TypingIndicator` 和 `TypingCursor` 到共享文件。

### 5. 修改 `ChatBubble` — 添加 MessageType.ai 分支

**文件**: `lib/ui/chat/components/chat_bubble.dart`

```dart
case MessageType.ai: return AiMsgBubble(message: message);
```

### 6. 修改路由 — 重定向旧 AI 页面

**文件**: `lib/app/routes/app_router.dart`

```dart
GoRoute(
  path: '/ai/chat',
  redirect: (_, __) => '/chat/room/ai_chat',
),
```

### 7. 清理旧文件（可选）

旧独立文件不动（无引用后自然废弃）：
- `lib/app/page/ai_chat/ai_chat_page.dart`
- `lib/core/store/ai_chat/ai_chat_provider.dart`（`AiChatNotifier`）

## 不修改的文件

- `SocketService` / `ChatEventHandler` / `chat_extension.dart` / pipeline 等 Socket 基础设施
- `ChatRoomController` / `ChatActionService` — AI 模式直接跳过
- `MessageType` 枚举 — `ai(8)` 和 `card(9)` 已加
- `ConversationType` 枚举 — 复用 `support`
- `SseClient` / `AiChatState` — 直接复用

## 实施顺序

| 步 | 文件 | 说明 |
|----|------|------|
| 1 | `ai_chat_view_model.dart` | 核心 ViewModel + DB 持久化 |
| 2 | `ai_msg_bubble.dart` | AI 消息气泡 + TypingIndicator/Cursor |
| 3 | `chat_bubble.dart` | 添加 MessageType.ai 分支 |
| 4 | `conversation_provider.dart` | 注入 AI 条目 |
| 5 | `chat_page.dart` | AI 模式分支 + 子组件 |
| 6 | `app_router.dart` | 重定向旧路由 |

## 验证方法

1. 打开对话列表 → 顶部出现 "AI 智能客服" 条目
2. 点击进入 → 显示 ChatPage，AppBar 是 AI 样式
3. 发消息 → SSE 流开始 → 打字机逐字显示
4. 关闭页面再打开 → 历史消息还在（DB 持久化）
5. 清空对话 → 所有消息消失，sessionId 重置
6. 现有的 Socket 聊天不受影响
