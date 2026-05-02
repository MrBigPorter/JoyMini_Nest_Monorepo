# AppStartup 数据预热 — 应用启动时的多路数据预加载屏障

> **Article F9** | **Difficulty:** ⭐⭐⭐⭐ | **Source:** `joy_mini_app/lib/core/startup/`

## 1. 问题背景

移动应用启动时面临一个核心矛盾：**用户体验延迟 vs 数据就绪依赖**。

```
冷启动时间线：
[App Launch] → [Flutter Engine Init] → [runApp()] → [First Frame]
                                                         ↓
                                              用户看到空白/骨架屏
                                                         ↓
                                              [Async Data Fetching]
                                                         ↓
                                              [Real UI Rendered]
```

传统做法是 runApp 后逐个发请求，导致：
- **闪烁跳跃**：骨架屏 → 真实内容 → 又变骨架屏
- **竞态条件**：页面 A 需要的数据依赖页面 B 的数据
- **瀑布请求**：请求串行执行，白屏时间 = Σ(每个请求)

**AppStartup** 的解法：**在 runApp 之前预先加载所有关键数据**，首个页面渲染时数据已就绪。

```
[App Launch] → [Startup Preloader] → [Multi-path parallel fetch]
                                         ↓
                                    [Data ready]
                                         ↓
                                    [runApp()] → [First Frame with data]
```

## 2. 核心架构

### 2.1 AppStartup 类

```dart
class AppStartup {
  late final AuthNotifier _authNotifier;
  late final ConfigStore _configStore;
  late final UserStore _userStore;
  late final WalletStore _walletStore;

  /// 启动屏障 — 所有关键数据就绪后 runApp
  Future<void> initialize() async {
    // Phase 1: 基础设施
    await _initInfrastructure();

    // Phase 2: 并行预加载
    await _preloadCriticalData();

    // Phase 3: 状态机就绪
    await _hydrateStores();
  }

  Future<void> _initInfrastructure() async {
    // 初始化 Flutter 插件（无需 await，后台进行）
    WidgetsFlutterBinding.ensureInitialized();

    // 初始化日志
    await Logger.init();

    // 初始化 Sentry / Crashlytics
    await SentryFlutter.init(
      (options) => options.dsn = _config.sentryDsn,
    );
  }

  Future<void> _preloadCriticalData() async {
    // 并行执行，不相互阻塞
    await Future.wait([
      _authNotifier.tryAutoLogin(),       // Token 自动登录
      _configStore.fetchRemoteConfig(),    // 远程配置
      _userStore.hydrate(),                // 用户缓存
      _walletStore.hydrate(),              // 钱包缓存
      _prefetchApiData(),                  // API 数据预热
    ], eagerError: false); // 不因单个失败阻断整个流程
  }

  Future<void> _hydrateStores() async {
    // 确保 Provider 树上的 Store 已填充
    _authNotifier.setInitialized();
    _configStore.setInitialized();
  }
}
```

### 2.2 StartupPhase — 阶段化执行

```dart
enum StartupPhase {
  /// 基础设施（必须成功）
  infrastructure,

  /// 认证（必须成功，否则跳转登录页）
  authentication,

  /// 核心数据（容忍失败，降级处理）
  coreData,

  /// 预热数据（失败不影响启动）
  warmup,
}

abstract class StartupTask {
  String get name;
  StartupPhase get phase;
  bool get isCritical => false;
  Duration? get timeout;
  Future<void> execute();
}

class StartupPipeline {
  final Map<StartupPhase, List<StartupTask>> _tasks = {};
  final Logger _logger = Logger('Startup');

  void register(StartupTask task) {
    _tasks.putIfAbsent(task.phase, () => []).add(task);
  }

  Future<StartupReport> run() async {
    final report = StartupReport();
    final stopwatch = Stopwatch()..start();

    for (final phase in StartupPhase.values) {
      final tasks = _tasks[phase] ?? [];
      if (tasks.isEmpty) continue;

      _logger.info('[Startup] Phase: ${phase.name} (${tasks.length} tasks)');

      final phaseStopwatch = Stopwatch()..start();

      // 同 phase 任务并行
      final results = await Future.wait(
        tasks.map((t) => _executeTask(t)),
        eagerError: phase == StartupPhase.infrastructure,
      );

      report.addPhase(phase.name, phaseStopwatch.elapsed, results);
    }

    report.totalDuration = stopwatch.elapsed;
    return report;
  }

  Future<TaskResult> _executeTask(StartupTask task) async {
    try {
      if (task.timeout != null) {
        await task.execute().timeout(task.timeout!);
      } else {
        await task.execute();
      }
      return TaskResult.success(task.name);
    } catch (e, stack) {
      if (task.isCritical) rethrow;
      _logger.warning('[Startup] ⚠️ ${task.name} failed: $e');
      return TaskResult.failure(task.name, e);
    }
  }
}
```

## 3. 并行预加载策略

### 3.1 核心预加载任务

```dart
// ============ Phase: Infrastructure ============

class InitLoggerTask extends StartupTask {
  @override
  String get name => 'init_logger';
  @override
  StartupPhase get phase => StartupPhase.infrastructure;
  @override
  bool get isCritical => true;
  @override
  Future<void> execute() => Logger.init();
}

class InitCrashReportingTask extends StartupTask {
  @override
  String get name => 'init_crashlytics';
  @override
  StartupPhase get phase => StartupPhase.infrastructure;
  @override
  bool get isCritical => false; // 崩溃上报失败不影响启动
  @override
  Future<void> execute() => Crashlytics.init();
}

// ============ Phase: Authentication ============

class AutoLoginTask extends StartupTask {
  @override
  String get name => 'auto_login';
  @override
  StartupPhase get phase => StartupPhase.authentication;
  @override
  bool get isCritical => false; // 未登录也允许启动
  @override
  Duration? get timeout => const Duration(seconds: 5);

  @override
  Future<void> execute() async {
    final auth = GetIt.instance<AuthNotifier>();
    await auth.tryAutoLogin();
  }
}

// ============ Phase: Core Data ============

class HydrateUserStoreTask extends StartupTask {
  @override
  String get name => 'hydrate_user_store';
  @override
  StartupPhase get phase => StartupPhase.coreData;
  @override
  Future<void> execute() async {
    final store = GetIt.instance<UserStore>();
    await store.hydrate();
  }
}

class HydrateWalletStoreTask extends StartupTask {
  @override
  String get name => 'hydrate_wallet_store';
  @override
  StartupPhase get phase => StartupPhase.coreData;
  @override
  Future<void> execute() async {
    final store = GetIt.instance<WalletStore>();
    await store.hydrate();
  }
}

class FetchRemoteConfigTask extends StartupTask {
  @override
  String get name => 'fetch_remote_config';
  @override
  StartupPhase get phase => StartupPhase.coreData;
  @override
  bool get isCritical => false;
  @override
  Duration? get timeout => const Duration(seconds: 3);

  @override
  Future<void> execute() async {
    final config = GetIt.instance<ConfigStore>();
    await config.fetchRemoteConfig();
  }
}

// ============ Phase: Warmup ============

class PrefetchHomeDataTask extends StartupTask {
  @override
  String get name => 'prefetch_home';
  @override
  StartupPhase get phase => StartupPhase.warmup;
  @override
  Future<void> execute() async {
    final api = GetIt.instance<Http>();
    await Future.wait([
      api.get('/api/v1/home/banners'),
      api.get('/api/v1/home/products'),
      api.get('/api/v1/home/categories'),
    ]);
  }
}
```

### 3.2 预加载注册

```dart
void configureStartup() {
  final pipeline = StartupPipeline();

  // Infrastructure
  pipeline.register(InitLoggerTask());
  pipeline.register(InitCrashReportingTask());
  pipeline.register(InitFirebaseTask());

  // Authentication
  pipeline.register(AutoLoginTask());
  pipeline.register(RestoreSessionTask());

  // Core Data
  pipeline.register(HydrateUserStoreTask());
  pipeline.register(HydrateWalletStoreTask());
  pipeline.register(FetchRemoteConfigTask());
  pipeline.register(InitFcmTask());

  // Warmup
  pipeline.register(PrefetchHomeDataTask());
  pipeline.register(PrefetchSystemNoticeTask());
  pipeline.register(PrefetchMessageUnreadTask());

  GetIt.instance.registerSingleton(pipeline);
}
```

## 4. 启动屏障实现

### 4.1 带进度通知的屏障

```dart
class StartupBarrier {
  final StartupPipeline _pipeline;
  final ValueNotifier<double> progressNotifier;

  StartupBarrier(this._pipeline)
      : progressNotifier = ValueNotifier(0.0);

  /// 等待所有必要数据就绪
  Future<StartupReport> waitForReady() async {
    final totalTasks = _pipeline.totalTaskCount;
    var completedTasks = 0;

    // 监听进度
    _pipeline.onTaskCompleted.listen((_) {
      completedTasks++;
      progressNotifier.value = completedTasks / totalTasks;
    });

    final report = await _pipeline.run();

    // 确保进度最终为 1.0
    progressNotifier.value = 1.0;
    return report;
  }
}
```

### 4.2 启动画面集成

```dart
class SplashScreen extends StatefulWidget {
  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  late final StartupBarrier _barrier;
  late final AnimationController _progressController;

  @override
  void initState() {
    super.initState();
    _barrier = GetIt.instance<StartupBarrier>();
    _progressController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );

    _runStartup();
  }

  Future<void> _runStartup() async {
    // 监听进度
    _barrier.progressNotifier.addListener(() {
      _progressController.value = _barrier.progressNotifier.value;
    });

    // 等待启动完成
    final report = await _barrier.waitForReady();

    if (mounted) {
      // 分析启动性能
      Analytics.recordStartup(report);

      // 导航到主页面
      _navigateToHome();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        // Logo
        Image.asset('assets/logo.png', width: 120),
        const SizedBox(height: 24),
        // 进度条
        AnimatedBuilder(
          animation: _progressController,
          builder: (context, child) => LinearProgressIndicator(
            value: _progressController.value,
          ),
        ),
        const SizedBox(height: 8),
        // 版本号
        Text('v${AppVersion.current}'),
      ],
    );
  }
}
```

## 5. 主入口集成

```dart
void main() async {
  // 1. 启动屏障
  final startup = AppStartup();
  await startup.initialize();

  // 2. runApp
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => startup.authNotifier),
        ChangeNotifierProvider(create: (_) => startup.configStore),
        ChangeNotifierProvider(create: (_) => startup.userStore),
      ],
      child: const JoyMiniApp(),
    ),
  );
}
```

## 6. 性能指标

### 6.1 并行 vs 串行对比

```
串行启动：
  init_logger(200ms) → crash(100ms) → auto_login(800ms) → 
  hydrate_user(300ms) → hydrate_wallet(300ms) → 
  remote_config(500ms) → prefetch_home(600ms)
  = 2800ms 总耗时

并行启动（AppStartup）：
  phase 1: [init_logger + crash]         = 200ms (并行)
  phase 2: [auto_login]                  = 800ms
  phase 3: [hydrate_user + wallet + cfg] = 500ms (并行)
  phase 4: [prefetch_home]               = 600ms
  = 2100ms 总耗时（优化 25%）

+ runApp 提前：数据加载与 Flutter Engine 初始化重叠
  = 实际感知延迟 < 800ms
```

### 6.2 启动报告

```dart
class StartupReport {
  final Map<String, Duration> phases = {};
  final List<TaskResult> results = [];
  Duration totalDuration = Duration.zero;

  void addPhase(String name, Duration duration, List<TaskResult> taskResults) {
    phases[name] = duration;
    results.addAll(taskResults);
  }

  int get successCount => results.where((r) => r.isSuccess).length;
  int get failureCount => results.where((r) => !r.isSuccess).length;
  double get successRate => results.isEmpty
      ? 1.0
      : successCount / results.length;
}
```

## 7. 错误处理与降级

| 场景 | 处理方式 | 用户体验 |
|------|----------|----------|
| Token 过期 | 自动清除→未登录状态 | 显示登录页面 |
| 远程配置加载失败 | 使用本地缓存配置 | 功能不变 |
| 钱包加载失败 | 显示余额加载中 | 交易功能受限 |
| 预加载超时 | 忽略该任务 | 页面进入后自行加载 |

```dart
class StartupErrorHandler {
  static void handle(TaskResult result, BuildContext context) {
    if (result.isSuccess) return;

    final error = result.error;
    if (error is TokenExpiredException) {
      // 静默处理：清除 token，用户未登录体验
      GetIt.instance<AuthNotifier>().forceLogout();
      return;
    }

    if (error is TimeoutException) {
      // 超时不阻断启动
      Logger.warning('[Startup] Timeout: ${result.taskName}');
      return;
    }

    // 无法恢复的错误 → 上报并显示错误页
    Crashlytics.recordError(error, StackTrace.current);
    Navigator.pushReplacementNamed(context, '/error',
      arguments: StartupErrorScreen(result),
    );
  }
}
```

## 8. 总结

| 方面 | AppStartup 预热 | 传统懒加载 |
|------|----------------|-----------|
| 首帧时间 | 略长（等待关键数据） | 快（空数据渲染） |
| 首帧可用性 | ✅ 数据就绪，直接交互 | ❌ 骨架屏，加载中 |
| 并行度 | 多阶段并行 | 通常串行 |
| 错误恢复 | 分阶段降级策略 | 页面级错误处理 |
| 启动耗时 | 2-3s（含数据加载） | 1s + 3s 页面加载 |
| 用户感知 | 2-3s → 可用 | 1s → 3s 转圈 |

**核心思想**：将网络请求从"进入页面后"提前到"runApp 之前"，利用启动画面 2-3 秒的"天然等待期"完成数据预加载，实现首帧即可用。

---

**下一篇预告**: [F10 — BaseModalConfig + RadixSheet + RadixModal] — 弹窗体系架构
