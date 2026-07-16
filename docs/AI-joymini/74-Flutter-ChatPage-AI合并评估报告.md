# Flutter ChatPage AI 与 IM 合并 — 评估报告

## 背景

当前 Flutter 端有**两套完全独立的聊天系统**：

| | AI 模式（isAiChat=true） | IM 模式（isAiChat=false） |
|---|---|---|
| ViewModel | AiChatViewModel + AiChatState | ChatViewModel + ChatListState |
| 数据源 | SSE 流 | Socket + REST + DB 流 |
| 发送路径 | SSE POST | REST API pipeline |
| 消息列表 | ListView（无分页） | ScrollablePositionedList（无限滚动） |
| 输入栏 | TextField + send button（纯文本） | ModernChatInputBar（语音/图片/视频/文件/位置） |
| AppBar | `_buildAiAppBar`（无呼叫/设置） | `_buildAppBar`（头像/名称/呼叫/设置） |
| 空状态 | 机器人图标 + "AI" 文字 | "No messages yet" |
| 错误处理 | 全局 error bar | 单条消息 failed 状态 |
| 状态提示 | "正在查询..." statusText | 无 |
| 分页 | 无（一次拉 100 条） | 无限滚动游标分页 |
| 持久化 | SSE done 后调用 _persistMessages | DB 流持续订阅 |

ChatPage 第 73 行 `final isAiChat = widget.conversationId == kAiConversationId` 一票决定走哪个分支，互不互通。

## 13 个场景评估

### ✅ 简单（改动少或无改动）

| # | 场景 | 评估 |
|---|---|---|
| 3 | **AI done 事件** | AiChatViewModel 已正确处理 `done` → `completeAiMessage()` → `_persistMessages()`。只需在 done 后可选加入 Socket 房间 |
| 8 | **AI 阶段断网** | SSE error 已有 retry 机制，需适配混合模式 |
| 9 | **人工阶段断网** | Socket 自动重连已实现（10 次重试 + 房间重入），无需改动 |
| 12 | **旧 AI 对话兼容** | DB 中已有 `ai_chat` 历史记录，统一 UI 后自然兼容 |

### ⚠️ 中等（需改动但路径清晰）

| # | 场景 | 问题 | 方案 |
|---|---|---|---|
| 1 | **打开客服 → AI 自动开始** | `CustomerServiceHelper.startChat()` 创建 SUPPORT 对话后走 IM 模式，AI 不启动 | ChatPage 检测新 SUPPORT 对话自动走 SSE |
| 2 | **AI 处理中用户发消息** | 当前静默忽略（无反馈） | 加消息队列 + 输入栏 disabled 状态 |
| 5 | **转人工后人工发消息** | Socket 消息需路由到同一界面 | `ChatEventHandler` 已存在，只需加入房间 |
| 6 | **转人工后用户发消息** | 需切换发送通道到 Socket | `handleSendText` 根据当前模式选择通道 |
| 7 | **离开页面再回来** | AI 阶段 autoDispose 销毁 SSE 流，回来空白 | 持久化 conversationId + 模式状态 |
| 10 | **用户连续快速发消息** | AI 阶段静默丢弃 | 实现 `pendingQueue` |
| 11 | **AI 错误重试** | `retry()` 硬编码 `messages[0]/[1]` 索引 | 改为按 `messageType` 查找 |
| 13 | **带上下文进入** | `CustomerServiceHelper.pendingEntryPoint` 暂存但未消费 | ChatPage `initState` 消费上下文 |

### 🔴 复杂（需重构）

| # | 场景 | 问题 | 方案 |
|---|---|---|---|
| 4 | **SSE transfer 事件** | **完全未实现**：`SseEventType.transfer` 枚举存在，但 SSE client 解析器 `default: continue` 静默丢弃，`AiChatViewModel._onSseEvent` 无对应 case | 三处改动：SSE client 解析 + AiChatViewModel 处理 + 模式切换逻辑 |

## 6 个关键问题

### 1. transfer 事件全线断裂 ⛔

**表现：** 后端已经发 `transfer` 事件，但 Flutter 端完全不处理。

```
后端 → SSE transfer → SSE client → default: continue → 丢弃
```

**修复路径（3 处）：**
- `sse_client_io.dart` / `sse_client_dio.dart` — 加 `case 'transfer':` 解析
- `ai_chat_view_model.dart` — 加 `SseEventType.transfer` 处理（切换模式）
- 新增模式切换逻辑（SSE → Socket）

### 2. `refreshAiEntry()` 调用了不存在的方法 ⛔

```dart
// ai_chat_view_model.dart:319
ref.read(conversationListProvider.notifier).refreshAiEntry();
// → conversation_provider.dart 中 refreshAiEntry() 方法已被删除
// → 运行时抛出 NoSuchMethodError
```

**修复：** 删除 `ai_chat_view_model.dart` 中对 `refreshAiEntry()` 的调用，改为普通 `_persistMessages()` 后直接 emit。

### 3. 两种 ViewModel 状态不兼容

| 维度 | AiChatViewModel | ChatViewModel |
|---|---|---|
| 消息来源 | SSE 内存累加 | DB 流 + REST sync |
| 发送路径 | SSE POST | REST API pipeline |
| 错误处理 | 全局 error bar | 单条消息 failed 状态 |
| 分页 | 无（全量 100 条） | 无限滚动游标分页 |

### 4. 输入栏差异大

AI 用简陋的 TextField + send button，IM 用 `ModernChatInputBar`（语音/图片/视频/文件/位置）。合并后 AI 阶段也需要使用 `ModernChatInputBar`，仅禁用部分功能。

### 5. 入口上下文丢失

`CustomerServiceHelper.pendingEntryPoint` / `pendingMetadata` 已暂存到静态变量，但 ChatPage 的 `initState` 从未读取消费。

### 6. ChatPageLogic 与 ChatViewModel 强耦合

`chat_page_logic.dart` 的 mixin 方法直接 `ref.read(chatViewModelProvider(...))`，无法复用给 AiChatViewModel。

## 推荐合并策略

### 最优路径：ChatViewModel 扩展 AI 能力

不是合并两套 ViewModel，而是在 `ChatViewModel` 中增加 AI 模式支持：

```
ChatViewModel 扩展：
  - 新增 ChatMode.ai / ChatMode.human 枚举
  - 新增 SSE 事件监听（与 DB 流并列）
  - 新增 pendingQueue（AI 处理中暂存用户消息）
  - 新增 statusText / isReceiving / aiError 字段
  - sendMessage 根据 ChatMode 选择 SSE 或 REST API
```

ChatPage 改造：
```
  - 去掉 if (isAiChat) 分支
  - 统一使用 ModernChatInputBar（AI 阶段禁用部分功能）
  - 统一使用 ScrollablePositionedList
  - ChatPageLogic 适配 ChatMode
```

### 优先级建议

```
Phase A（必须，否则不可用）:
  1. 修复 refreshAiEntry() 调用（运行时崩溃）
  2. SSE client 解析 transfer 事件
  3. AiChatViewModel 处理 transfer → 切换模式

Phase B（核心体验）:
  4. ChatPage 检测新 SUPPORT 对话自动走 SSE
  5. 消费 pendingEntryPoint / pendingMetadata
  6. 统一输入栏为 ModernChatInputBar

Phase C（完善）:
  7. ChatViewModel 扩展 AI 能力
  8. 消息队列 + 输入栏禁用状态
  9. 去掉 isAiChat 分支，统一 UI
```

## 当前完成状态

| 部分 | 状态 |
|---|---|
| 后端 Phase 1-2（DTO/MemoryService/Controller/Service/GraphState） | ✅ 已完成 |
| Flutter 评估 | ✅ 已完成 |
| Flutter Phase A 修复 | ⛔ 未开始 |
| Flutter Phase B-C 合并 | ⏳ 待定 |
