---
title: 'EventBus: 单例事件总线 + GlobalEvent 类型体系——Flutter 跨模块解耦'
description: 分析 EventBus 单例模式与 GlobalEvent 类型体系，通过 broadcast Stream 实现跨模块通信；涵盖设备封禁、用户黑名单、强制更新等全局事件的触发与监听模式。
slug: event-bus-singleton-global-event-type-system
tags: Flutter, EventBus, Singleton, Stream, Architecture
---

# EventBus: 单例事件总线 + GlobalEvent 类型体系——Flutter 跨模块解耦

## 1. 背景

在 Flutter 应用中，模块间通信是一个普遍难题。当 HTTP 拦截器检测到设备被封禁时，它需要通知 UI 层弹出锁定对话框；当 WebSocket 收到系统维护通知时，它需要广播给所有页面。直接依赖注入会产生循环引用，而 Callback 传递在多层嵌套中难以管理。

**事件总线（Event Bus）** 模式通过一个全局的发布-订阅通道解决了这一问题：发送者和接收者不需要彼此引用，仅通过事件类型进行松耦合通信。

| 组件 | 文件 | 行数 | 角色 |
|------|------|------|------|
| **`EventBus`** | `event_bus.dart` | 20L | 单例事件总线 |
| **`GlobalEvent`** | `global_events.dart` | 14L | 全局事件数据类 |
| **`GlobalEventType`** | 同上 | 枚举 | 事件类型定义 |

---

## 2. EventBus——单例模式实现

### 2.1 单例结构

[`EventBus`](JoyMini_Flutter_App/lib/utils/events/event_bus.dart:5) 使用 Dart 最简洁的单例模式——`factory` 构造函数 + `static final` 内部实例：

```dart
class EventBus {
  static final EventBus _instance = EventBus._internal();
  factory EventBus() => _instance;
  EventBus._internal();

  final _controller = StreamController<GlobalEvent>.broadcast();

  void emit(GlobalEvent event) {
    _controller.add(event);
  }

  Stream<GlobalEvent> get stream => _controller.stream;
}
```

**关键设计点：**

| 特性 | 实现 | 说明 |
|------|------|------|
| 单例 | `factory EventBus()` | 无论何处调用 `EventBus()`，返回同一实例 |
| 广播 | `StreamController.broadcast()` | 允许多个监听者同时订阅 |
| 发送 | `emit(event)` | 向所有订阅者推送事件 |
| 监听 | `stream` getter | 外部通过 `EventBus().stream.listen(...)` 订阅 |

### 2.2 为什么用 broadcast Stream？

| Stream 类型 | 特点 | 适用场景 |
|-------------|------|----------|
| **单订阅（Single）** | 只能有一个监听者 | 文件读取、一次性数据流 |
| **广播（Broadcast）** | 允许多个监听者 | 事件总线、UI 通知 |

`GlobalEvent` 可能被多个模块同时监听：`GlobalHandler` 监听后弹出对话框，`Analytics` 模块记录事件，`Logging` 模块写入日志。`broadcast()` 确保每个订阅者都能收到完整的消息。

---

## 3. GlobalEvent 类型体系

### 3.1 事件类型枚举

[`GlobalEventType`](JoyMini_Flutter_App/lib/utils/events/global_events.dart:1) 定义了应用中最高优先级的全局事件：

```dart
enum GlobalEventType {
  deviceBanned,      // 设备封禁
  userBlacklisted,   // 用户黑名单
  forceUpdate,       // 强制更新
  maintenance,       // 系统维护
}
```

| 类型 | 触发场景 | 典型响应 |
|------|----------|----------|
| `deviceBanned` | HTTP 返回设备封禁错误码 | 弹出「设备已被封禁」对话框 |
| `userBlacklisted` | 用户被加入黑名单 | 强制退出登录 |
| `forceUpdate` | 检测到过期版本 | 跳转应用商店更新页面 |
| `maintenance` | 服务端进入维护模式 | 显示维护公告遮罩 |

### 3.2 事件数据模型

```dart
class GlobalEvent {
  final GlobalEventType type;
  final String? message;
  final Map<String, dynamic>? data;

  GlobalEvent(this.type, {this.message, this.data});
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `GlobalEventType` | 事件类型，监听者据此决定响应策略 |
| `message` | `String?` | 可选的描述信息，如封禁原因 |
| `data` | `Map?` | 可选的附加数据，如维护结束时间 |

---

## 4. 典型使用场景

### 4.1 HTTP 拦截器 → EventBus

这是最常见的触发路径。当 [`UnifiedInterceptor`](JoyMini_Flutter_App/lib/core/network/unified_interceptor.dart) 检测到 `security` 错误策略时，通过 EventBus 发出全局事件：

```dart
// 在 HTTP 响应拦截器中
if (strategy == ErrorStrategy.security) {
  EventBus().emit(GlobalEvent(
    GlobalEventType.deviceBanned,
    message: '设备因安全原因被封禁',
    data: {'banReason': banReason, 'banTime': DateTime.now().toIso8601String()},
  ));
  // 不再继续处理请求
  return;
}
```

### 4.2 GlobalHandler → UI 响应

[`GlobalHandler`](JoyMini_Flutter_App/lib/core/events/global_handler.dart) 是事件的主要消费者：

```dart
class GlobalHandler {
  late final StreamSubscription<GlobalEvent> _subscription;

  void start() {
    _subscription = EventBus().stream.listen((event) {
      switch (event.type) {
        case GlobalEventType.deviceBanned:
          _showLockDialog(event.message ?? '设备已被封禁');
          break;
        case GlobalEventType.userBlacklisted:
          _forceLogout(event.message);
          break;
        case GlobalEventType.forceUpdate:
          _navigateToAppStore();
          break;
        case GlobalEventType.maintenance:
          _showMaintenanceOverlay(event.data);
          break;
      }
    });
  }

  void dispose() {
    _subscription.cancel();
  }
}
```

### 4.3 WebSocket → EventBus

WebSocket 收到服务器推送的维护通知后，通过 EventBus 通知全应用：

```dart
socket.on('maintenance', (data) {
  EventBus().emit(GlobalEvent(
    GlobalEventType.maintenance,
    message: '系统将于 ${data['startTime']} 进行维护',
    data: data,
  ));
});
```

---

## 5. 订阅生命周期管理

### 5.1 在 StatefulWidget 中订阅

```dart
class MyWidgetState extends State<MyWidget> {
  StreamSubscription<GlobalEvent>? _subscription;

  @override
  void initState() {
    super.initState();
    _subscription = EventBus().stream.listen(_handleGlobalEvent);
  }

  void _handleGlobalEvent(GlobalEvent event) {
    // 处理事件...
  }

  @override
  void dispose() {
    _subscription?.cancel();  // ← 必须取消订阅，防止内存泄漏
    super.dispose();
  }
}
```

### 5.2 在 Riverpod Provider 中订阅

```dart
final globalEventHandlerProvider = Provider<StreamSubscription<GlobalEvent>?>((ref) {
  final subscription = EventBus().stream.listen((event) {
    // 通过 ref.read 更新其他 provider 的状态
    switch (event.type) {
      case GlobalEventType.maintenance:
        ref.read(maintenanceStateProvider.notifier).state = true;
        break;
      // ...
    }
  });
  ref.onDispose(subscription.cancel);
  return subscription;
});
```

---

## 6. 设计决策分析

### 6.1 为什么不使用 Riverpod 的事件机制？

| 方案 | 优势 | 劣势 |
|------|------|------|
| **EventBus + Stream** | 独立于状态管理框架，任何位置都可 emit | 需要手动管理订阅生命周期 |
| **Riverpod Provider** | 框架自动管理 | 只能在 Provider / Widget 中使用 |
| **InheritedWidget** | 无外部依赖 | 多层嵌套后难以维护 |

EventBus 选择独立的 Stream 方案，是因为事件可能在任何层面触发（拦截器、WebSocket、定时器），而这些位置不一定能访问 Riverpod 的 `Ref`。

### 6.2 单例 vs 依赖注入

| 方案 | EventBus 单例 | GetIt 注入 |
|------|--------------|------------|
| 访问便利性 | `EventBus()` 随处可用 | 需先注册再 `GetIt.I.get()` |
| 测试难度 | 较难 Mock | 可替换注册实例 |
| 代码量 | 20 行 | 需额外注册代码 |

对于这个仅 20 行的小型工具类，单例是最务实的选择。如果需要测试，可以通过封装一个可替换的 `EventBusInterface` 来实现。

---

## 7. 局限性与改进方向

### 7.1 当前局限

| 局限 | 说明 | 影响 |
|------|------|------|
| 无类型安全 | 所有事件都用 `GlobalEvent`，`data` 是弱类型 Map | 监听者需自行解析 |
| 无去重 | 相同事件可能多次触发 | 需在监听侧做幂等 |
| 无异步 | emit 是同步的，阻塞当前执行 | 不适合大量监听者 |

### 7.2 改进方向

```dart
// 1. 泛型事件总线
class TypedEventBus<T> {
  final _controller = StreamController<T>.broadcast();
  void emit(T event) => _controller.add(event);
  Stream<T> get stream => _controller.stream;
}

// 2. 带去重的包装
class DedupEventBus extends EventBus {
  final Set<String> _recentIds = {};
  void emitOnce(GlobalEvent event, {required String id}) {
    if (_recentIds.contains(id)) return;
    _recentIds.add(id);
    emit(event);
  }
}
```

---

## 8. 总结

`EventBus` + `GlobalEvent` 模式为 Flutter 应用提供了一个极轻量（34 行总代码）的跨模块通信通道：

- **单例模式**确保全局只有一个事件通道，`EventBus()` 调用在任何位置等效
- **broadcast Stream** 允许多个消费者独立订阅，互不干扰
- **全局事件类型**（deviceBanned、userBlacklisted、forceUpdate、maintenance）覆盖了应用最高优先级的系统级通知
- **松耦合**：发送者不需要知道谁在监听，监听者不需要修改发送者代码

这套模式在 HTTP 拦截器、WebSocket 和 UI 层之间架起了一座轻量桥梁，是 Flutter 架构中「关键但简单」的基础设施。

### 相关文章

- [UnifiedInterceptor 错误策略分发](unified-interceptor-error-strategy-token-refresh.md)
- [GlobalHandler 全局事件总线](global-handler-callkit-webrtc.md)
- [DeepLink + OAuth 统一处理](deep-link-oauth-global-handler.md)
