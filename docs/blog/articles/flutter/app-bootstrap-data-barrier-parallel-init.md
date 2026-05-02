# AppBootstrap：数据屏障 + 5 路并行初始化

## 概述

[`AppBootstrap`](JoyMini_Flutter_App/lib/app/bootstrap.dart) 是 Flutter 应用的启动协调器，实现了一种**两阶段初始化策略**，带有一个**数据屏障**，在所有关键前置条件满足之前阻止 UI 渲染。这种模式消除了常见的"已登出状态闪烁"问题——即 UI 在确定认证状态之前渲染，导致从"已登录"到"已登出"的突兀视觉切换。

启动过程分为两个阶段：

| 阶段 | 函数 | 描述 | 时机 |
|-------|----------|-------------|--------|
| **系统** | `initSystem()` | 5 路并行非 UI 初始化 | 在 `runApp()` 之前 |
| **数据** | `loadInitialOverrides()` | 令牌验证、数据水合、Riverpod 覆盖 | 恰好在 `runApp()` 之前 |

---

## 1. 第一阶段：系统初始化（`initSystem()`）

系统阶段使用 `Future.wait` 并行运行 5 个独立任务，然后即发即忘地启动 DeepLink 初始化：

```dart
class AppBootstrap {
  /// 第一阶段：系统级初始化（5 路并行）
  static Future<void> initSystem() async {
    // 首先，设置错误处理器
    _setupErrorHandlers();
    
    // 五个独立任务同时启动
    await Future.wait([
      AssetManager.init(),            // 资源预加载
      EasyLocalization.ensureInitialized(),  // i18n 引擎
      ApiCacheManager.init(),         // 缓存层设置
      Http.init(),                    // HTTP 客户端 + 拦截器
      _setupFirebase(),               // Firebase 带 10 秒超时
    ]);
    
    // DeepLink 初始化（即发即忘，非阻塞）
    DeepLinkService().init();
  }
}
```

### 5 个并行任务

| 任务 | 目的 | 关键性 |
|------|---------|-------------|
| [`AssetManager.init()`](JoyMini_Flutter_App/lib/app/bootstrap.dart) | 预加载图片、字体和资源 | 非致命——回退到占位符 |
| [`EasyLocalization.ensureInitialized()`](JoyMini_Flutter_App/lib/app/bootstrap.dart) | 初始化带语言检测的 i18n 引擎 | 关键——必须在 UI 前完成 |
| [`ApiCacheManager.init()`](JoyMini_Flutter_App/lib/core/cache/api_cache_manager.dart) | 打开 Hive/SharedPreferences 缓存盒子 | 关键——缓存读取依赖于此 |
| [`Http.init()`](JoyMini_Flutter_App/lib/core/api/http_client.dart) | 配置 Dio 实例，注册拦截器 | 关键——所有 API 调用依赖于此 |
| [`_setupFirebase()`](JoyMini_Flutter_App/lib/app/bootstrap.dart) | 初始化 Firebase + FCM，带 10 秒超时 | 非致命——优雅降级 |

### Firebase 10 秒超时模式

```dart
static Future<void> _setupFirebase() async {
  try {
    await Future.any([
      FirebaseService.initialize(),
      Future.delayed(const Duration(seconds: 10)),
    ]);
  } catch (e) {
    // 超时或错误——记录日志并继续
    // Firebase 功能（FCM、Auth）将不可用
    // 但应用仍正常启动
  }
}
```

这可以防止缓慢或失败的 Firebase 初始化阻塞整个应用启动。如果 Firebase 在 10 秒内未完成初始化，启动过程会跳过它继续执行，Firebase 依赖的功能将优雅降级。

---

## 2. 第二阶段：数据屏障（`loadInitialOverrides()`）

数据屏障是关键模式：在 `runApp()` 执行之前，启动引导程序读取所有持久化状态、验证它们，并准备 Riverpod provider 覆盖。这确保了**用户看到的第一个帧已经具有正确的认证状态**。

```dart
static Future<List<Override>> loadInitialOverrides() async {
  // 1. 从安全存储读取令牌（平台自适应）
  final token = await TokenStorage.read();
  
  // 2. 从 SharedPreferences 读取持久化用户状态
  final luckyState = await SharedPreferences.getInstance()
      .then((prefs) => prefs.getString('lucky_state'));
  
  // 3. 脏数据检测
  if (token != null && luckyState == null) {
    // 令牌存在但用户数据缺失（脏状态）
    // 清除令牌并重置为未认证
    await TokenStorage.clear();
    return [];  // 无覆盖 = 未认证默认值
  }
  
  // 4. 解析并准备覆盖
  if (token != null && luckyState != null) {
    final user = User.fromJson(jsonDecode(luckyState));
    return [
      authProvider.overrideWith((ref) => AuthNotifier(token, user)),
      userProvider.overrideWith((ref) => UserNotifier(user)),
    ];
  }
  
  return [];  // 无令牌 = 未认证
}
```

### 脏数据检测

这种模式最有价值的地方在于**脏数据清理**。没有它，会发生以下情况：

1. 应用在已认证状态下被杀死
2. 令牌在安全存储中保留
3. 用户状态 JSON 丢失（SharedPreferences 写入被中断）
4. 应用启动 → 找到令牌 → UI 显示已登录 → API 调用失败 → UI 切换为已登出

数据屏障在步骤 4 **在 UI 渲染之前**捕获此问题，完全避免视觉闪烁。

---

## 3. 与 `main.dart` 集成

启动引导程序在 [`main.dart`](JoyMini_Flutter_App/lib/main.dart) 中以结构化的顺序被调用：

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // 第一阶段：系统初始化（5 路并行）
  await AppBootstrap.initSystem();
  
  // 第二阶段：数据屏障——加载所有持久化状态
  final overrides = await AppBootstrap.loadInitialOverrides();
  
  // 创建带覆盖的 ProviderContainer
  final container = ProviderContainer(overrides: overrides);
  
  // 现在渲染——认证状态已经正确
  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const JoyMiniApp(),
    ),
  );
}
```

执行流程：

```
main() 被调用
  │
  ├─ WidgetsFlutterBinding.ensureInitialized()
  │
  ├─ initSystem()
  │   ├─ Future.wait([AssetManager, EasyLocalization, ApiCacheManager, Http, Firebase])
  │   │   └─ 全部 5 个完成（Firebase 可能在 10 秒超时）
  │   └─ DeepLinkService().init()（即发即忘）
  │
  ├─ loadInitialOverrides()
  │   ├─ 从安全存储读取令牌
  │   ├─ 从 SharedPreferences 读取 lucky_state
  │   ├─ 脏数据检查：令牌存在但无状态 → 清除令牌
  │   └─ 返回 auth + user provider 的 Riverpod 覆盖
  │
  ├─ ProviderContainer(overrides: overrides)
  │
  └─ runApp() ←─ UI 以正确的认证状态渲染
```

---

## 4. 错误隔离

第一阶段中的每个并行任务都独立进行错误隔离。如果其中一个失败，其他任务继续执行：

```dart
static Future<void> initSystem() async {
  _setupErrorHandlers();  // 全局错误处理器始终优先
  
  await Future.wait([
    _tryInit(AssetManager.init(), 'AssetManager'),
    _tryInit(EasyLocalization.ensureInitialized(), 'EasyLocalization'),
    _tryInit(ApiCacheManager.init(), 'ApiCacheManager'),
    _tryInit(Http.init(), 'Http'),
    _tryInit(_setupFirebase(), 'Firebase'),
  ]);
}

static Future<void> _tryInit(Future<void> task, String name) async {
  try {
    await task;
  } catch (e) {
    // 记录错误但不崩溃启动
    // 功能将优雅降级
  }
}
```

这种错误隔离模式确保单个初始化失败（例如 Firebase 超时、缓存盒子损坏）永远不会阻塞整个应用的启动。

---

## 5. 设计决策

| 决策 | 理由 |
|----------|-----------|
| **两阶段拆分** | 系统初始化（并行，I/O 密集型）+ 数据屏障（顺序，状态验证）——按初始化类型分离关注点 |
| **5 个任务的 `Future.wait`** | 通过并行化独立 I/O 操作最大化启动速度 |
| **即发即忘 DeepLink** | 深度链接注册不阻塞 UI——链接在注册后到达仍可通过流正常工作 |
| **脏数据检测** | 以最小的代码代价防止常见的"认证状态闪烁"用户体验错误 |
| **Riverpod 覆盖** | 比全局单例更灵活——支持使用模拟覆盖进行测试 |

---

## 关键要点

1. **两阶段启动**：系统初始化（5 路并行）→ 数据屏障（状态验证）——在保持数据正确性的同时最大化并行度。
2. **数据屏障模式**：所有持久化状态在 `runApp()` **之前**被读取和验证，确保第一个帧具有正确的认证状态。
3. **Firebase 10 秒超时**：防止 Firebase 初始化失败阻塞应用启动——优雅降级。
4. **脏数据清理**：自动检测并修复令牌存在但用户信息缺失的场景，防止"已登录闪烁到已登出"的用户体验错误。
5. **错误隔离**：每个并行任务独立包裹在 try-catch 中，单个失败不会导致整个启动引导崩溃。
6. **Riverpod 覆盖**：使用 `ProviderContainer(overrides:)` 既可实现正确的初始状态，也可通过模拟 provider 实现可测试性。
