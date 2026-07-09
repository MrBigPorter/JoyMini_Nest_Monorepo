# 16. Flutter AI Chat Client — Socket.IO 集成

> ⚠️ **NOT IMPLEMENTED — 项目无 Flutter 代码**
>
> 本文档描述的是 Flutter 移动端实现，但当前项目为 **Next.js (Web) + NestJS (API)**，
> 不包含任何 Flutter/Dart 代码。本文档保留作为未来移动端开发的参考。

## 🎯 本步骤目标

实现 Flutter 端的 AI 客服 **Socket 事件处理和消息渲染**，包括：
1. `SocketChatMixin` 扩展 — 监听 AI 相关 Socket 事件
2. `ChatRoomController` — AI 事件分发
3. `ChatViewModel` — AI 消息状态管理
4. `AiBubble` 组件 — AI 消息渲染（推理步骤、转人工提示）
5. `ModernChatInputBar` — 双通道消息发送

---

## 📖 背景说明

### 承上

在 [15-Flutter-AI-Chat页面集成](15-Flutter-AI-Chat页面集成.md) 中，我们完成了：
- `MessageType.ai`(10) 枚举新增
- `ChatViewModel` AI 状态字段扩展
- `CustomerServiceHelper` AI 客服入口
- `ChatPage` isAiEnabled 标记

在 [20-Flutter-AI-人工融合方案](20-Flutter-AI-人工融合方案.md) 中，设计了**双通道消息流**：

```
用户发送消息
  ├── Socket.IO → 人工客服可见（现有通道）
  └── HTTP POST → /ai-customer/chat/stream → LangGraph → Socket.IO emitAiReply()
```

### 这一步要解决的问题

1. **AI 事件监听** — Socket.IO 需要处理新的事件类型（`aiReply`, `aiStep`, `aiTransfer`）
2. **AI 消息构建** — 从 Socket 数据构建 `ChatUiModel` 并插入消息列表
3. **推理步骤展示** — Agent 的中间步骤（tool_start/tool_end）如何在 UI 中展示
4. **双通道发送** — 用户发送消息时，同时发送到 Socket 和 AI 端点
5. **转人工状态** — AI 判断需要转人工时，UI 如何响应

### 设计决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| AI 事件 | 新建事件名 / 复用 chatMessage | **新建 `aiReply` 事件** | 与人工消息区分，客户端更容易处理 |
| 推理步骤 | Socket 独立事件 / 随 aiReply 携带 | **随 `aiReply.meta.steps` 携带** | 减少 Socket 事件数量，meta 字段已存在 |
| 双通道发送 | ChatViewModel 处理 / SocketChatMixin 处理 | **ChatViewModel 处理** | ViewModel 知道上下文，不需要改 Socket 层 |
| AI 气泡 | 独立 Widget / ChatBubble 扩展 | **独立 `AiBubble` Widget** | 渲染逻辑完全不同（推理步骤、机器人头像） |

---

## ⚙️ 前置条件

### 环境要求

- Flutter Chat 现有架构已运行
- 文档 15 的页面集成已完成
- 后端 Socket Gateway 已添加 `emitAiReply()` 方法（文档 20 §3）

### 文件/配置准备

| 文件 | 操作 |
|------|------|
| `socket_service.dart` + `chat_extension.dart` | 扩展 Socket 事件监听 |
| `chat_room_provider.dart` (`ChatRoomController`) | 添加 AI 事件处理 |
| `chat_view_model.dart` | 实现 AI 消息管理 |
| `chat_ui_model.dart` | `MessageType.ai` 已添加 |
| 新建 `ai_bubble.dart` | AI 消息气泡组件 |
| `chat_bubble.dart` | 添加 `MessageType.ai` 分发 |
| `modern_chat_input_bar.dart` | 双通道发送支持 |

---

## 📝 实现步骤

### Step 1: 后端 Socket 事件定义

需要在后端 `ChatGateway` 中定义新的 Socket 事件（参考文档 20 §3）：

| Socket 事件 | 方向 | 说明 |
|-------------|------|------|
| `aiReply` | Server → Client | AI 完整回复内容 + meta（推理步骤、是否需要转人工） |
| `aiTransfer` | Server → Client | 通知客户端正在转接人工客服 |

**事件数据格式：**

```typescript
// aiReply 事件
interface AiReplyPayload {
  conversationId: string;
  messageId: string;
  content: string;           // AI 回复文本
  meta: {
    steps?: Array<{          // Agent 推理步骤（可选展开显示）
      type: 'tool_start' | 'tool_end';
      tool: string;
      input?: any;
      output?: any;
    }>;
    intent?: string;          // 识别的用户意图
    needsHumanTransfer: boolean;  // AI 是否判断需要转人工
    transferReason?: string;     // 转人工原因
  };
  createdAt: string;          // ISO 8601
}

// aiTransfer 事件
interface AiTransferPayload {
  conversationId: string;
  message: string;            // "正在转接人工客服，请稍候..."
  estimatedWaitTime?: number; // 预计等待时间（秒）
}
```

### Step 2: 扩展 `SocketChatMixin` — 监听 AI 事件

**文件**：`lib/core/services/socket/chat_extension.dart`

```dart
mixin SocketChatMixin on SocketDispatcherMixin {
  // ... 现有 StreamControllers

  // 新增：AI 回复事件流
  final _aiReplyController = StreamController<Map<String, dynamic>>.broadcast();
  final _aiTransferController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get aiReplyStream => _aiReplyController.stream;
  Stream<Map<String, dynamic>> get aiTransferStream => _aiTransferController.stream;

  @override
  void _onChatMessage(data) {
    // 现有处理逻辑...
  }

  /// 处理 AI 回复事件
  void _onAiReply(Map<String, dynamic> data) {
    _aiReplyController.add(data);
  }

  /// 处理转人工事件
  void _onAiTransfer(Map<String, dynamic> data) {
    _aiTransferController.add(data);
  }

  /// 初始化 Socket 事件监听（扩展）
  void initAiChatEvents() {
    socket?.on('aiReply', _onAiReply);
    socket?.on('aiTransfer', _onAiTransfer);
  }

  /// 清理 AI 事件监听
  void disposeAiChatEvents() {
    socket?.off('aiReply', _onAiReply);
    socket?.off('aiTransfer', _onAiTransfer);
    _aiReplyController.close();
    _aiTransferController.close();
  }
}
```

在 `SocketService` 的初始化方法中调用 `initAiChatEvents()`：

```dart
// socket_service.dart
void _initHandlers() {
  _initChatHandlers();     // 现有方法
  initAiChatEvents();      // ← 新增：AI 事件
  // ...
}
```

### Step 3: 扩展 `ChatRoomController` — AI 事件分发

**文件**：`lib/ui/chat/providers/chat_room_provider.dart`

```dart
class ChatRoomController extends StateNotifier<ChatRoomState> {
  // ... 现有逻辑

  StreamSubscription? _aiReplySub;
  StreamSubscription? _aiTransferSub;

  @override
  Future<void> activate(String conversationId) async {
    await super.activate(conversationId);  // 调用现有 activate

    // 订阅 AI 事件
    _aiReplySub = socketService.aiReplyStream
      .where((data) => data['conversationId'] == conversationId)
      .listen(_handleAiReply);

    _aiTransferSub = socketService.aiTransferStream
      .where((data) => data['conversationId'] == conversationId)
      .listen(_handleAiTransfer);
  }

  void _handleAiReply(Map<String, dynamic> data) {
    final messageId = data['messageId'] as String;
    final content = data['content'] as String;
    final meta = data['meta'] as Map<String, dynamic>?;

    // 构建 ChatUiModel（type = ai）
    final aiMessage = ChatUiModel(
      id: messageId,
      conversationId: data['conversationId'],
      content: content,
      type: MessageType.ai,
      isMe: false,
      status: MessageStatus.sent,
      createdAt: DateTime.parse(data['createdAt'] as String),
      meta: meta,  // 携带推理步骤和转人工标记
    );

    // 通知 ViewModel 添加消息
    _addMessage(aiMessage);

    // 检查是否需要转人工
    if (meta?['needsHumanTransfer'] == true) {
      _setNeedsHumanTransfer(true);
    }
  }

  void _handleAiTransfer(Map<String, dynamic> data) {
    // 添加系统消息："正在转接人工客服..."
    final systemMessage = ChatUiModel(
      id: 'transfer_${DateTime.now().millisecondsSinceEpoch}',
      conversationId: data['conversationId'],
      content: data['message'] as String? ?? '正在转接人工客服，请稍候...',
      type: MessageType.system,
      isMe: false,
      status: MessageStatus.sent,
      createdAt: DateTime.now(),
    );
    _addMessage(systemMessage);
  }

  @override
  void dispose() {
    _aiReplySub?.cancel();
    _aiTransferSub?.cancel();
    super.dispose();
  }
}
```

### Step 4: 扩展 `ChatViewModel` — AI 消息管理

**文件**：`lib/ui/chat/providers/chat_view_model.dart`

```dart
class ChatViewModel extends StateNotifier<ChatListState> {
  // ... 现有逻辑

  /// 发送消息（AI 支持的双通道模式）
  Future<void> sendMessageWithAi(String content, {Map<String, dynamic>? extraMeta}) async {
    if (content.trim().isEmpty || state.isAiResponding) return;

    // 1. 添加用户消息到本地（现有逻辑）
    addMessage(content);

    // 2. 标记 AI 正在回复
    state = state.copyWith(isAiResponding: true, needsHumanTransfer: false);

    // 3. 发送到 Socket（人工客服可见）
    _socketService.sendMessage(
      conversationId: _conversationId,
      content: content,
      type: 0, // text
      meta: extraMeta,
    );

    // 4. 发送到 AI 端点（HTTP POST，触发 LangGraph 处理）
    //    这个请求会触发后端执行 graph → emitAiReply() → Socket 推送回来
    await _sendToAiEndpoint(content);
  }

  Future<void> _sendToAiEndpoint(String content) async {
    try {
      final response = await http.post(
        Uri.parse('$apiBaseUrl/ai-customer/chat/stream'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
        },
        body: jsonEncode({
          'conversationId': _conversationId,
          'message': content,
        }),
      );

      // 注意：AI 回复不在这里处理！
      // AI 回复通过 Socket.IO aiReply 事件异步推送回来
      // 这里只是触发后端 graph 执行

    } catch (e) {
      // 如果 AI 端点调用失败，不影响 Socket 消息（人工客服仍然能看到）
      state = state.copyWith(
        isAiResponding: false,
        aiThinkingStep: null,
      );
    }
  }

  /// 处理 AI 回复（由 ChatRoomController 触发）
  void handleAiReply(Map<String, dynamic> data) {
    final needsHumanTransfer = data['meta']?['needsHumanTransfer'] == true;

    state = state.copyWith(
      isAiResponding: false,
      aiThinkingStep: null,
      needsHumanTransfer: needsHumanTransfer,
    );
  }

  /// 用户主动请求转人工
  Future<void> requestHumanTransfer() async {
    try {
      await http.post(
        Uri.parse('$apiBaseUrl/ai-customer/transfer'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
        },
        body: jsonEncode({
          'conversationId': _conversationId,
        }),
      );

      state = state.copyWith(
        needsHumanTransfer: true,
        isAiResponding: false,
      );
    } catch (e) {
      // 处理错误
    }
  }
}
```

### Step 5: 创建 `AiBubble` Widget

**文件**：`lib/ui/chat/components/ai_bubble.dart`（新建）

```dart
import 'package:flutter/material.dart';
import '../models/chat_ui_model.dart';

class AiBubble extends StatelessWidget {
  final ChatUiModel message;

  const AiBubble({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    final meta = message.meta;
    final steps = meta?['steps'] as List<dynamic>?;
    final needsHumanTransfer = meta?['needsHumanTransfer'] == true;
    final intent = meta?['intent'] as String?;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // AI 机器人头像
        CircleAvatar(
          backgroundColor: Colors.blue.shade100,
          child: Icon(Icons.psychology, color: Colors.blue.shade700),
        ),
        SizedBox(width: 8),

        // 消息内容
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // AI 标识
              Text(
                'AI 客服',
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.grey.shade600,
                  fontWeight: FontWeight.w500,
                ),
              ),
              SizedBox(height: 4),

              // 推理步骤（可折叠）
              if (steps != null && steps.isNotEmpty)
                _buildStepsSection(steps),

              // 消息正文
              Container(
                padding: EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.blue.shade50,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  message.content,
                  style: TextStyle(fontSize: 15),
                ),
              ),

              // 转人工提示
              if (needsHumanTransfer)
                _buildTransferBanner(),

              // 意图标签（可选）
              if (intent != null)
                Padding(
                  padding: EdgeInsets.only(top: 4),
                  child: Text(
                    '识别意图: $intent',
                    style: TextStyle(fontSize: 11, color: Colors.grey),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildStepsSection(List<dynamic> steps) {
    return Container(
      margin: EdgeInsets.only(bottom: 4),
      padding: EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '推理步骤',
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
          ),
          ...steps.map((step) {
            final icon = step['type'] == 'tool_start' ? '🔧' : '✅';
            return Text(
              '$icon ${step['tool']}',
              style: TextStyle(fontSize: 11, color: Colors.grey.shade700),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildTransferBanner() {
    return Container(
      margin: EdgeInsets.only(top: 8),
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.orange.shade50,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.orange.shade200),
      ),
      child: Row(
        children: [
          Icon(Icons.swap_horiz, color: Colors.orange.shade700, size: 18),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              '转接人工客服中...',
              style: TextStyle(fontSize: 13, color: Colors.orange.shade800),
            ),
          ),
        ],
      ),
    );
  }
}
```

### Step 6: 修改 `ChatBubble` — 分发 `MessageType.ai`

**文件**：`lib/ui/chat/components/chat_bubble.dart`

```dart
class ChatBubble extends StatelessWidget {
  final ChatUiModel message;

  const ChatBubble({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    switch (message.type) {
      case MessageType.ai:
        return AiBubble(message: message);  // ← 新增：AI 消息

      case MessageType.text:
        return _buildTextBubble(message);

      case MessageType.system:
        return _buildSystemMessage(message);

      // ... 其他类型保持不变
    }
  }
}
```

### Step 7: 修改 `ModernChatInputBar` — AI 状态支持

**文件**：`lib/ui/chat/components/chat_input/modern_chat_input_bar.dart`

```dart
class ModernChatInputBar extends StatelessWidget {
  final bool isAiResponding;    // ← 新增：AI 回复中
  final bool isAiEnabled;       // ← 新增：是否 AI 客服对话
  final VoidCallback? onTransferToHuman;  // ← 新增：转人工按钮回调

  const ModernChatInputBar({
    super.key,
    // ... 现有参数
    this.isAiResponding = false,
    this.isAiEnabled = false,
    this.onTransferToHuman,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Colors.grey.shade200)),
      ),
      child: isAiResponding
          ? _buildAiRespondingBar()  // ← AI 回复中显示等待状态
          : _buildInputBar(),        // ← 正常输入栏
    );
  }

  Widget _buildAiRespondingBar() {
    return Container(
      padding: EdgeInsets.symmetric(vertical: 12, horizontal: 16),
      child: Row(
        children: [
          SizedBox(
            width: 16, height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          SizedBox(width: 8),
          Text('AI 回答中...', style: TextStyle(color: Colors.grey)),
          Spacer(),
          TextButton(
            onPressed: onTransferToHuman,
            child: Text('转人工', style: TextStyle(color: Colors.orange)),
          ),
        ],
      ),
    );
  }
}
```

### Step 8: 在 `ChatPage` 中组装

**文件**：`lib/ui/chat/chat_room/chat_page.dart`

```dart
class ChatPageState extends ConsumerState<ChatPage> {
  @override
  Widget build(BuildContext context) {
    final chatState = ref.watch(chatViewModelProvider);
    final isAiEnabled = widget.isAiEnabled;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          if (isAiEnabled && !chatState.isAiResponding)
            IconButton(
              icon: Icon(Icons.support_agent),
              tooltip: '转人工',
              onPressed: () => _viewModel.requestHumanTransfer(),
            ),
        ],
      ),
      body: Column(
        children: [
          // 消息列表（现有）
          Expanded(child: _buildMessageList(chatState)),

          // 输入栏（传递 AI 状态）
          ModernChatInputBar(
            isAiResponding: isAiEnabled && chatState.isAiResponding,
            isAiEnabled: isAiEnabled,
            onTransferToHuman: () => _viewModel.requestHumanTransfer(),
            onSend: (text) {
              if (isAiEnabled) {
                _viewModel.sendMessageWithAi(text);
              } else {
                _viewModel.sendMessage(text);  // 普通 Socket 发送
              }
            },
          ),
        ],
      ),
    );
  }
}
```

---

## ✅ 验收方式

### 手动验证

```bash
cd /Users/porter/Developer/JoyMini_Flutter_App && flutter run
```

### 测试场景

| 场景 | 操作 | 预期结果 |
|------|------|----------|
| **AI 回复** | 在 AI 客服对话中发送消息 | 输入栏显示"AI 回答中..."，AI 回复出现在消息列表，带机器人头像 |
| **推理步骤** | AI 使用工具（如查询订单） | 消息上方显示可折叠的推理步骤（🔧/✅） |
| **AI 转人工** | AI 判断需要转人工 | AI 回复下方出现橙色"转接人工客服中..."横幅 |
| **手动转人工** | 点击 AppBar 的"转人工"按钮 | 调用 `POST /ai-customer/transfer`，出现系统消息"正在转接..." |
| **普通客服不变** | 进入非 AI 客服对话 | 输入栏和消息渲染与原来完全一致 |
| **AI 回复中禁发** | AI 回复时尝试发送 | 输入栏被禁用，显示"AI 回答中..." |

### 数据流验证

```
用户输入 "查一下我的订单"
  → sendMessageWithAi()
    → Socket sendMessage（人工可见）
    → HTTP POST /ai-customer/chat/stream（触发 AI 处理）
  → 后端执行 LangGraph
    → intentRouter → orderAgent → answerSynthesizer
  → Socket emitAiReply()
    → _onAiReply → _addMessage → AiBubble 渲染
```

---

## 🔗 与文档 20 的关系

本步骤是 [20-Flutter-AI-人工融合方案](20-Flutter-AI-人工融合方案.md) 中 **Flutter 端 7 项改动的具体实现**：

| 文档 20 的 Flutter 改动 | 本步骤 |
|--------------------------|--------|
| 1. `MessageType.ai`(10) | 文档 15 Step 1 |
| 2. `AiBubble` 组件 | Step 5 |
| 3. `ChatBubble` 分发 | Step 6 |
| 4. AI 回复中输入栏状态 | Step 7 |
| 5. `CustomerServiceHelper` 扩展 | 文档 15 Step 3 |
| 6. API 方法（sendMessageWithAi） | Step 4 |
| 7. `ChatViewModel` 扩展 | Step 4 |

---

## 🔜 下一步预告

前端 AI Chat 集成到此完成。接下来是 **Phase 5（进阶能力）**。

在 [**17-完整RAG节点**](17-完整RAG节点.md) 中，我们将：
- 用 pgvector 向量搜索替换 Phase 1 的关键词匹配 Stub
- 实现 `EmbeddingService` 生成向量
- 在 RAG Node 中执行向量搜索
- 接入 `KnowledgeSyncService` 的增量同步

---

## 📚 关键设计决策回顾

1. **新建 Socket 事件** — `aiReply` / `aiTransfer`，与现有 `chatMessage` 分开，客户端处理更简单
2. **推理步骤随 `aiReply.meta` 携带** — 不单独发事件，减少 Socket 消息数量
3. **双通道发送** — 用户消息同时走 Socket（人工可见）和 HTTP（AI 处理），互不影响
4. **独立 `AiBubble` Widget** — 渲染逻辑与普通文本气泡完全不同（机器人头像、推理步骤、转人工横幅）
5. **AI 端点失败不阻断 Socket 发送** — AI 端点不可用时，人工客服仍然能看到用户消息
