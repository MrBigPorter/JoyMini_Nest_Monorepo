---
title: "AppStartup: Data Pre-Warming — Multi-Path Data Preloading Barrier on App Launch"
description: "Learn how to preload critical data before runApp() using a phase-based startup pipeline with parallel execution, progress tracking, and graceful degradation, eliminating blank screens and waterfall requests."
slug: app-startup-data-pre-warming
tags: [Flutter, Startup, Performance, Architecture, Preloading, Data Barrier]
---

# AppStartup: Data Pre-Warming — Multi-Path Data Preloading Barrier on App Launch

## 1. Problem Context

Mobile applications face a core contradiction at startup: **user experience delay vs. data readiness dependency**.

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

The traditional approach fires requests one by one after runApp, leading to:
- **Flickering**: skeleton screen → real content → back to skeleton
- **Race conditions**: Page A depends on data from Page B
- **Waterfall requests**: serial execution, blank time = Σ(each request)

**AppStartup** solves this by: **preloading all critical data before runApp()**, so data is ready when the first page renders.

```
[App Launch] → [Startup Preloader] → [Multi-path parallel fetch]
                                         ↓
                                    [Data ready]
                                         ↓
                                    [runApp()] → [First Frame with data]
```

## 2. Core Architecture

### 2.1 AppStartup Class

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

### 2.2 StartupPhase — Phased Execution

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

## 3. Parallel Preloading Strategy

### 3.1 Core Preloading Tasks

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

### 3.2 Preloading Registration

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

## 4. Startup Barrier Implementation

### 4.1 Barrier with Progress Notification

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

### 4.2 Splash Screen Integration

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

## 5. Main Entry Integration

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

## 6. Performance Metrics

### 6.1 Parallel vs. Serial Comparison

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

### 6.2 Startup Report

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

## 7. Error Handling & Degradation

| Scenario | Handling | User Experience |
|----------|----------|-----------------|
| Token expired | Auto-clear → unauthenticated state | Show login page |
| Remote config load failure | Use local cached config | Features unchanged |
| Wallet load failure | Show balance loading | Transaction features limited |
| Preload timeout | Skip the task | Page loads data on its own after entry |

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

## 8. Summary

| Aspect | AppStartup Pre-Warming | Traditional Lazy Loading |
|--------|------------------------|--------------------------|
| Time to first frame | Slightly longer (waits for critical data) | Fast (renders empty data) |
| First frame usability | ✅ Data ready, immediate interaction | ❌ Skeleton screen, loading |
| Parallelism | Multi-phase parallel | Usually serial |
| Error recovery | Per-phase degradation strategy | Page-level error handling |
| Startup duration | 2-3s (includes data loading) | 1s + 3s page loading |
| User perception | 2-3s → usable | 1s → 3s spinner |

**Core idea**: Move network requests from "after page entry" to "before runApp()", leveraging the splash screen's 2-3 second "natural waiting period" to complete data preloading, achieving first-frame readiness.
