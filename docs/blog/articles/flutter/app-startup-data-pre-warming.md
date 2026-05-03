---
title: 'AppStartup：数据预热——应用启动时的多路数据预加载屏障'
description: 学习如何在 runApp() 之前使用基于阶段的启动管道预加载关键数据，支持并行执行、进度跟踪和优雅降级，消除白屏和水瀑请求。
slug: app-startup-data-pre-warming
tags: Flutter, Startup, Performance, Architecture, Preloading, DataBarrier
---

## 1. 背景

移动应用在启动时面临一个核心矛盾：**用户体验延迟 vs. 数据就绪依赖**。

```
Cold Launch Timeline:
[App Launch] → [Flutter Engine Init] → [runApp()] → [First Frame]
                                                         ↓
                                               User sees blank/skeleton screen
                                                         ↓
                                              [Async Data Fetching]
                                                         ↓
                                              [Real UI Rendered]
```

传统方式在 runApp 之后逐个发起请求，导致：
- **闪烁**：骨架屏 → 真实内容 → 回到骨架屏
- **竞态条件**：页面 A 依赖页面 B 的数据
- **水瀑请求**：串行执行，空白时间 = Σ(每个请求)

**AppStartup** 的解决方案：**在 runApp() 之前预加载所有关键数据**，确保首屏渲染时数据已就绪。

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

  /// Startup barrier — runApp after all critical data is ready
  Future<void> initialize() async {
    // Phase 1: Infrastructure
    await _initInfrastructure();

    // Phase 2: Parallel preload
    await _preloadCriticalData();

    // Phase 3: Store hydration
    await _hydrateStores();
  }

  Future<void> _initInfrastructure() async {
    // Initialize Flutter plugins (no need to await, runs in background)
    WidgetsFlutterBinding.ensureInitialized();

    // Initialize logging
    await Logger.init();

    // Initialize Sentry / Crashlytics
    await SentryFlutter.init(
      (options) => options.dsn = _config.sentryDsn,
    );
  }

  Future<void> _preloadCriticalData() async {
    // Execute in parallel, no mutual blocking
    await Future.wait([
      _authNotifier.tryAutoLogin(),       // Token auto-login
      _configStore.fetchRemoteConfig(),    // Remote config
      _userStore.hydrate(),                // User cache
      _walletStore.hydrate(),              // Wallet cache
      _prefetchApiData(),                  // API data warmup
    ], eagerError: false); // Don't block the entire flow on a single failure
  }

  Future<void> _hydrateStores() async {
    // Ensure Provider tree stores are populated
    _authNotifier.setInitialized();
    _configStore.setInitialized();
  }
}
```

### 2.2 StartupPhase——分阶段执行

```dart
enum StartupPhase {
  /// Infrastructure (must succeed)
  infrastructure,

  /// Authentication (must succeed, otherwise redirect to login)
  authentication,

  /// Core data (tolerates failure, graceful degradation)
  coreData,

  /// Warmup data (failure doesn't affect startup)
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

      // Same-phase tasks run in parallel
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
      _logger.warning('[Startup] ${task.name} failed: $e');
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
  bool get isCritical => false; // Crash reporting failure doesn't block startup
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
  bool get isCritical => false; // Not logged in is also allowed to start
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

  /// Wait until all necessary data is ready
  Future<StartupReport> waitForReady() async {
    final totalTasks = _pipeline.totalTaskCount;
    var completedTasks = 0;

    // Listen to progress
    _pipeline.onTaskCompleted.listen((_) {
      completedTasks++;
      progressNotifier.value = completedTasks / totalTasks;
    });

    final report = await _pipeline.run();

    // Ensure progress finalizes at 1.0
    progressNotifier.value = 1.0;
    return report;
  }
}
```

### 4.2 启动屏集成

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
    // Listen to progress
    _barrier.progressNotifier.addListener(() {
      _progressController.value = _barrier.progressNotifier.value;
    });

    // Wait for startup to complete
    final report = await _barrier.waitForReady();

    if (mounted) {
      // Analyze startup performance
      Analytics.recordStartup(report);

      // Navigate to main page
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
        // Progress bar
        AnimatedBuilder(
          animation: _progressController,
          builder: (context, child) => LinearProgressIndicator(
            value: _progressController.value,
          ),
        ),
        const SizedBox(height: 8),
        // Version number
        Text('v${AppVersion.current}'),
      ],
    );
  }
}
```

## 5. 主入口集成

```dart
void main() async {
  // 1. Startup barrier
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
Serial Startup:
  init_logger(200ms) → crash(100ms) → auto_login(800ms) → 
  hydrate_user(300ms) → hydrate_wallet(300ms) → 
  remote_config(500ms) → prefetch_home(600ms)
  = 2800ms total

Parallel Startup (AppStartup):
  phase 1: [init_logger + crash]         = 200ms (parallel)
  phase 2: [auto_login]                  = 800ms
  phase 3: [hydrate_user + wallet + cfg] = 500ms (parallel)
  phase 4: [prefetch_home]               = 600ms
  = 2100ms total (25% improvement)

+ runApp earlier: data loading overlaps with Flutter Engine initialization
  = Actual perceived latency < 800ms
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
|------|---------|---------|
| Token 过期 | 自动清除 → 未认证状态 | 显示登录页 |
| 远程配置加载失败 | 使用本地缓存配置 | 功能不变 |
| 钱包加载失败 | 显示余额加载中 | 交易功能受限 |
| 预加载超时 | 跳过该任务 | 页面进入后自行加载数据 |

```dart
class StartupErrorHandler {
  static void handle(TaskResult result, BuildContext context) {
    if (result.isSuccess) return;

    final error = result.error;
    if (error is TokenExpiredException) {
      // Silent handling: clear token, user experiences unauthenticated flow
      GetIt.instance<AuthNotifier>().forceLogout();
      return;
    }

    if (error is TimeoutException) {
      // Timeout does not block startup
      Logger.warning('[Startup] Timeout: ${result.taskName}');
      return;
    }

    // Unrecoverable error → report and show error screen
    Crashlytics.recordError(error, StackTrace.current);
    Navigator.pushReplacementNamed(context, '/error',
      arguments: StartupErrorScreen(result),
    );
  }
}
```

## 8. 总结

| 维度 | AppStartup 预热 | 传统懒加载 |
|------|----------------|-----------|
| 首帧时间 | 稍长（等待关键数据） | 快（渲染空数据） |
| 首帧可用性 | ✅ 数据就绪，可立即交互 | ❌ 骨架屏，加载中 |
| 并行度 | 多阶段并行 | 通常串行 |
| 错误恢复 | 逐阶段降级策略 | 页面级错误处理 |
| 启动时长 | 2-3s（含数据加载） | 1s + 3s 页面加载 |
| 用户感知 | 2-3s → 可用 | 1s → 3s 转圈 |

**核心思想**：将网络请求从"页面进入后"移到"runApp() 之前"，利用启动屏 2-3 秒的"自然等待期"完成数据预加载，实现首帧即就绪。
