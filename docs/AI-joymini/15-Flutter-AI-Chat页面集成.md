# 15. Flutter AI Chat 页面集成

## 🎯 本步骤目标

在现有 Flutter Chat 框架中集成 AI 客服入口，**复用已有的 `ChatPage`、`ChatViewModel`、`CustomerServiceHelper`**，无需创建新页面。

---

## 📖 背景说明

### 承上

在 [14-AIChatAPI与ControllerSSE](14-AIChatAPI与ControllerSSE.md) 中，我们完成了：
- `AiCustomerController` 的 SSE 端点 `POST /ai-customer/chat/stream`
- `AiCustomerService.chatStream()` 使用 `streamEvents()` 流式推送

在 [20-Flutter-AI-人工融合方案](20-Flutter-AI-人工融合方案.md) 中，我们设计了整体架构：
- AI 回复通过 Socket.IO `chatMessage` 事件推送到现有对话
- AI Agent（LangGraph `answerSynthesizer`）判断是否需要转人工
- Flutter 端通过扩展而非重写来集成

### 这一步要解决的问题

1. **入口问题** — 用户在哪些地方可以启动 AI 客服对话？
2. **复用问题** — 如何让现有的 `ChatPage` 同时支持 AI 和人工消息？
3. **状态问题** — `ChatViewModel` 需要知道当前是否是 AI 回复中
4. **类型问题** — 新的 `MessageType.ai` 如何在现有消息流中工作？

### 设计决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 页面复用 | 新建 AI 页面 / 复用 ChatPage | **复用 ChatPage** | `ConversationType.support` 已有，Socket 通道已通 |
| 客服入口 | 单独入口 / 合并到客服入口 | **合并到 CustomerServiceHelper** | 用户感知统一，后端决定 AI 还是人工 |
| 消息类型 | 新增 type / 复用 text+meta | **新增 `MessageType.ai`(10)** | UI 渲染可以独立区分（AI 头像、推理步骤） |
| AI 状态 | ViewModel 单独字段 / 全局状态 | **ViewModel 字段 `isAiResponding`** | 局部状态，不需要全局 |

---

## ⚙️ 前置条件

### 环境要求

- Flutter Chat 现有架构已运行（Socket.IO + Riverpod + ChatPage）
- 后端 SSE 端点 `POST /ai-customer/chat/stream` 已实现（文档 14）
- Backend Socket Gateway 已扩展（文档 20 §4）

### 文件/配置准备

| 文件 | 说明 |
|------|------|
| `chat_page.dart` | 现有聊天页面，不需要修改 |
| `customer_service_helper.dart` | 客服入口，需要扩展 |
| `chat_view_model.dart` | 需要添加 AI 状态字段 |
| `chat_ui_model.dart` | 需要添加 `MessageType.ai` |
| `socket_service.dart` | Socket 事件监听需要扩展 |

---

## 📝 实现步骤

### Step 1: 新增 `MessageType.ai` (值 10)

**文件**：`lib/ui/chat/models/chat_ui_model.dart`

```dart
enum MessageType {
  text(0),
  image(1),
  audio(2),
  video(3),
  recalled(4),
  file(5),
  location(6),
  system(99),
  ai(10);  // ← 新增：AI 客服消息

  const MessageType(this.value);
  final int value;

  static MessageType fromValue(int value) {
    return MessageType.values.firstWhere(
      (e) => e.value == value,
      orElse: () => MessageType.text,
    );
  }
}
```

### Step 2: 扩展 `ChatViewModel` — 添加 AI 状态

**文件**：`lib/ui/chat/providers/chat_view_model.dart`

```dart
class ChatListState {
  // ... 现有字段

  // === 新增 AI 相关字段 ===
  final bool isAiResponding;        // AI 是否正在回复
  final String? aiThinkingStep;     // 当前 AI 推理步骤描述（可选显示）
  final bool needsHumanTransfer;    // AI 是否判断需要转人工

  const ChatListState({
    // ... 现有参数
    this.isAiResponding = false,
    this.aiThinkingStep,
    this.needsHumanTransfer = false,
  });

  ChatListState copyWith({
    // ... 现有参数
    bool? isAiResponding,
    String? aiThinkingStep,
    bool? needsHumanTransfer,
  }) {
    return ChatListState(
      // ... 现有参数
      isAiResponding: isAiResponding ?? this.isAiResponding,
      aiThinkingStep: aiThinkingStep ?? this.aiThinkingStep,
      needsHumanTransfer: needsHumanTransfer ?? this.needsHumanTransfer,
    );
  }
}
```

### Step 3: 扩展 `CustomerServiceHelper` — AI 客服入口

**文件**：`lib/core/services/customer_service/customer_service_helper.dart`

```dart
/// 客服场景类型
enum CustomerServiceScene {
  support,    // 普通客服
  business,   // 业务咨询
  aiSupport,  // ← 新增：AI 客服（由后端决定 AI 还是人工）
}

class CustomerServiceHelper {
  /// 开始客服对话（支持 AI 路由）
  static Future<void> startChat({
    required BuildContext context,
    required CustomerServiceScene scene,
    String? businessId,
  }) async {
    // 1. 调用 API 获取/创建 conversation
    final conversationId = await _getOrCreateConversation(scene, businessId);

    if (context.mounted) {
      // 2. 导航到 ChatPage（现有页面，复用）
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ChatPage(
            conversationId: conversationId,
            title: _getTitle(scene),
            isAiEnabled: scene == CustomerServiceScene.aiSupport, // ← 传递 AI 标记
          ),
        ),
      );
    }
  }

  static String _getTitle(CustomerServiceScene scene) {
    switch (scene) {
      case CustomerServiceScene.aiSupport:
        return 'AI 客服助手';
      case CustomerServiceScene.support:
        return '在线客服';
      case CustomerServiceScene.business:
        return '业务咨询';
    }
  }
}
```

### Step 4: 修改 `ChatPage` — 接收 AI 标记

**文件**：`lib/ui/chat/chat_room/chat_page.dart`

```dart
class ChatPage extends ConsumerStatefulWidget {
  final String conversationId;
  final String title;
  final bool isAiEnabled;  // ← 新增：标记是否为 AI 客服对话

  const ChatPage({
    super.key,
    required this.conversationId,
    required this.title,
    this.isAiEnabled = false,  // ← 默认 false
  });

  // ...
}
```

在 `ChatPage` 的 `build` 方法中，根据 `isAiEnabled` 决定是否显示 AI 专属 UI：

```dart
// 在 ChatPage build 方法中
// 如果 isAiEnabled，显示 AI 客服的标题栏样式
AppBar(
  title: Text(widget.title),
  actions: [
    if (widget.isAiEnabled)
      IconButton(
        icon: Icon(Icons.psychology),
        onPressed: () => _showAiInfo(context),
      ),
  ],
)
```

### Step 5: 添加导航入口

在应用的主导航或客服入口菜单中添加 AI 客服入口：

```dart
// 在客服入口菜单中（例如客服页面或设置页面）
ListTile(
  leading: Icon(Icons.support_agent),
  title: Text('在线客服'),
  onTap: () => CustomerServiceHelper.startChat(
    context: context,
    scene: CustomerServiceScene.support,
  ),
),
ListTile(
  leading: Icon(Icons.psychology),
  title: Text('AI 客服助手'),
  subtitle: Text('智能解答，7x24 小时在线'),
  onTap: () => CustomerServiceHelper.startChat(
    context: context,
    scene: CustomerServiceScene.aiSupport,
  ),
),
```

---

## ✅ 验收方式

### 手动验证

```bash
# 1. 启动 Flutter 应用
cd /Users/porter/Developer/JoyMini_Flutter_App && flutter run

# 2. 进入 AI 客服
# 点击"AI 客服助手"入口

# 3. 验证
# - 进入 ChatPage 对话界面
# - 标题显示"AI 客服助手"
# - AI 标记正确传递
```

### 预期结果

| 场景 | 预期 |
|------|------|
| 点击"AI 客服助手"入口 | 进入 ChatPage，标题显示"AI 客服助手" |
| 发送消息 | 消息通过 Socket.IO 发送，AI 回复通过 Socket `chatMessage` 事件返回 |
| AI 回复中 | 输入栏显示"AI 思考中..."，不可发送 |
| AI 判断转人工 | 消息列表显示"正在转接人工客服..."气泡 |
| 切换回普通客服 | 入口不同，ConversationType 不同，互不干扰 |

---

## 🔗 与文档 16 的对接

本步骤完成页面集成和入口。实际的 **Socket 事件处理** 和 **AI 回复渲染** 在 [16-Flutter-AI-ChatClient与Socket集成](16-Flutter-AI-ChatClient与Socket集成.md) 中实现。

---

## 🔜 下一步预告

在 [**16-Flutter-AI-ChatClient与Socket集成**](16-Flutter-AI-ChatClient与Socket集成.md) 中，我们将：
- 在 `SocketChatMixin` 中处理 AI 相关 Socket 事件
- 扩展 `ChatViewModel` 接收 AI 消息
- 实现 `AiBubble` 组件渲染
- 实现 `ModernChatInputBar` 双通道发送

---

## 📚 关键设计决策回顾

1. **不新建页面** — 直接复用 `ChatPage`，通过 `isAiEnabled` 标记区分
2. **`MessageType.ai`(10)** — 新增枚举值，不与现有类型冲突
3. **`CustomerServiceHelper` 扩展** — 统一入口，后端决定 AI 还是人工路由
4. **`ChatViewModel` 局部状态** — `isAiResponding` 只在 ViewModel 中维护，不需要全局 Store
