# Pipeline Runner 顺序执行模式 — 可靠异步流水线架构

> **Article F7** | **Difficulty:** ⭐⭐⭐ | **Source:** `joy_mini_app/lib/core/pipeline/`

## 1. 问题背景

移动应用中，许多操作需要 **按顺序执行多个异步步骤**，且任意步骤失败时需要明确的错误处理策略：

| 场景 | 步骤链 | 失败处理 |
|------|--------|----------|
| **用户注册** | 验证手机 → 创建账号 → 初始化钱包 → 发送欢迎消息 | 任意步骤失败 → 回滚已创建资源 |
| **下单支付** | 校验库存 → 锁定价格 → 扣减余额 → 创建订单 → 发送通知 | 库存不足 → 中止；扣款失败 → 重试 |
| **图片上传** | 压缩 → 生成 blurhash → 上传 S3 → 更新数据库记录 | 压缩失败 → 跳过模糊图；上传失败 → 重试 3 次 |

**Pipeline Runner** 抽象出有序执行模式，解决：

1. **顺序编排**：步骤按声明顺序执行，前一步输出作为后一步输入
2. **错误边界**：每步可定义独立的重试策略和超时
3. **优雅中止**：关键步骤失败时跳过后续依赖步骤
4. **可观测性**：每步耗时、成功/失败次数自动收集

## 2. 核心架构

### 2.1 PipelineStep 抽象

```dart
/// 流水线步骤基类
abstract class PipelineStep<TInput, TOutput> {
  /// 步骤名称（用于日志和监控）
  String get name;

  /// 是否关键步骤（失败时中止整个 pipeline）
  bool get isCritical => false;

  /// 最大重试次数
  int get maxRetries => 0;

  /// 重试间隔（毫秒）
  int get retryDelayMs => 500;

  /// 超时（毫秒），0 = 不超时
  int get timeoutMs => 0;

  /// 执行步骤
  Future<TOutput> execute(TInput input);
}
```

### 2.2 PipelineContext — 步骤间共享数据

```dart
class PipelineContext {
  final Map<String, dynamic> _data = {};
  final List<PipelineEvent> _events = [];

  /// 存储步骤输出
  void set<T>(String key, T value) {
    _data[key] = value;
  }

  /// 读取步骤输出
  T? get<T>(String key) => _data[key] as T?;

  /// 记录事件（用于监控）
  void recordEvent(PipelineEvent event) {
    _events.add(event);
  }

  /// 获取执行报告
  PipelineReport toReport() => PipelineReport(
    totalSteps: _events.length,
    duration: _calculateDuration(),
    events: List.unmodifiable(_events),
    hasErrors: _events.any((e) => e is PipelineErrorEvent),
  );
}
```

### 2.3 PipelineRunner — 执行引擎

```dart
class PipelineRunner {
  final Logger _logger = Logger('Pipeline');

  /// 运行一组有序步骤
  Future<PipelineReport> run({
    required List<PipelineStep> steps,
    required PipelineContext context,
    dynamic initialInput,
  }) async {
    dynamic currentInput = initialInput;
    final stopwatch = Stopwatch()..start();

    for (final step in steps) {
      final stepTimer = Stopwatch()..start();

      try {
        // 超时包装
        currentInput = await _executeWithTimeout(
          step,
          currentInput,
          context,
        );

        context.recordEvent(PipelineStepEvent(
          stepName: step.name,
          duration: stepTimer.elapsed,
          status: PipelineStatus.success,
        ));

        _logger.info('[Pipeline] ✅ ${step.name} '
            '(${stepTimer.elapsedMilliseconds}ms)');
      } catch (e, stackTrace) {
        final handled = await _handleStepError(
          step, e, stackTrace, context,
        );

        context.recordEvent(PipelineErrorEvent(
          stepName: step.name,
          duration: stepTimer.elapsed,
          error: e,
          isCritical: step.isCritical,
          handled: handled,
        ));

        if (step.isCritical || !handled) {
          _logger.severe('[Pipeline] ❌ ${step.name} failed: $e');
          context.recordEvent(PipelineAbortedEvent(
            failedStep: step.name,
            totalDuration: stopwatch.elapsed,
          ));
          return context.toReport();
        }

        _logger.warning('[Pipeline] ⚠️ ${step.name} error handled: $e');
      }
    }

    stopwatch.stop();
    context.recordEvent(PipelineCompletedEvent(
      totalDuration: stopwatch.elapsed,
    ));

    return context.toReport();
  }

  Future<dynamic> _executeWithTimeout(
    PipelineStep step,
    dynamic input,
    PipelineContext context,
  ) {
    final future = step.execute(input);

    if (step.timeoutMs > 0) {
      return future.timeout(
        Duration(milliseconds: step.timeoutMs),
        onTimeout: () => throw PipelineTimeoutException(step.name),
      );
    }

    return future;
  }
}
```

## 3. 重试策略

### 3.1 带重试的执行

```dart
Future<dynamic> _handleStepError(
  PipelineStep step,
  Object error,
  StackTrace stackTrace,
  PipelineContext context,
) async {
  if (step.maxRetries <= 0) return false;

  // 不可重试的错误类型
  if (error is PipelineNonRetryableException) return false;

  for (var attempt = 1; attempt <= step.maxRetries; attempt++) {
    try {
      await Future.delayed(
        Duration(milliseconds: step.retryDelayMs * attempt), // 退避
      );

      _logger.info('[Pipeline] 🔄 ${step.name} retry $attempt'
          '/${step.maxRetries}');

      return await step.execute(context.get('_lastInput'));
    } catch (retryError) {
      if (attempt == step.maxRetries) return false;
    }
  }

  return false;
}
```

### 3.2 可配置退避策略

```dart
enum BackoffStrategy {
  fixed,       // 固定间隔
  linear,      // 线性递增
  exponential, // 指数退避
}

class RetryConfig {
  final int maxRetries;
  final int baseDelayMs;
  final BackoffStrategy strategy;

  const RetryConfig({
    this.maxRetries = 3,
    this.baseDelayMs = 1000,
    this.strategy = BackoffStrategy.exponential,
  });

  Duration getDelay(int attempt) {
    return switch (strategy) {
      BackoffStrategy.fixed =>
        Duration(milliseconds: baseDelayMs),
      BackoffStrategy.linear =>
        Duration(milliseconds: baseDelayMs * attempt),
      BackoffStrategy.exponential =>
        Duration(milliseconds: baseDelayMs * (1 << attempt)),
    };
  }
}
```

## 4. 实战示例

### 4.1 注册流水线

```dart
class RegistrationPipeline {
  PipelineRunner get _runner => PipelineRunner();

  Future<PipelineReport> run(RegistrationRequest request) async {
    final context = PipelineContext();

    return _runner.run(
      steps: [
        // Step 1: 验证手机号
        _VerifyPhoneStep(),
        // Step 2: 创建账号（关键）
        _CreateAccountStep(isCritical: true),
        // Step 3: 初始化钱包（关键）
        _InitWalletStep(isCritical: true),
        // Step 4: 发送欢迎消息（非关键，失败可忽略）
        _SendWelcomeStep(maxRetries: 1),
      ],
      context: context,
      initialInput: request,
    );
  }
}

class _VerifyPhoneStep extends PipelineStep<RegistrationRequest, bool> {
  @override
  String get name => 'verify_phone';

  @override
  int get timeoutMs => 5000;

  @override
  Future<bool> execute(RegistrationRequest input) async {
    final result = await authService.verifySmsCode(
      input.phone,
      input.code,
    );
    if (!result.isValid) {
      throw PipelineNonRetryableException('Invalid verification code');
    }
    return true;
  }
}

class _CreateAccountStep extends PipelineStep<bool, User> {
  @override
  String get name => 'create_account';

  @override
  int get maxRetries => 2;

  @override
  Future<User> execute(bool input) async {
    return authService.createUser();
  }
}

class _InitWalletStep extends PipelineStep<User, Wallet> {
  @override
  String get name => 'init_wallet';

  @override
  Future<Wallet> execute(User user) async {
    return walletService.createWallet(user.id);
  }
}
```

### 4.2 图片上传流水线

```dart
class ImageUploadPipeline {
  Future<PipelineReport> run(File image) async {
    return PipelineRunner().run(
      steps: [
        CompressImageStep(maxRetries: 2),
        GenerateBlurhashStep(
          isCritical: false, // 失败不阻断上传
        ),
        UploadToS3Step(
          isCritical: true,
          maxRetries: 3,
          timeoutMs: 30000,
        ),
        UpdateDatabaseStep(isCritical: true),
      ],
      context: PipelineContext(),
      initialInput: image,
    );
  }
}

class CompressImageStep extends PipelineStep<File, CompressedImage> {
  @override
  String get name => 'compress_image';

  @override
  int get maxRetries => 2;

  @override
  Future<CompressedImage> execute(File input) async {
    final compressed = await ImageCompressor.compress(
      input,
      quality: 80,
      maxWidth: 1920,
    );
    return CompressedImage(
      bytes: compressed,
      originalName: input.path.split('/').last,
    );
  }
}
```

## 5. 可观测性集成

### 5.1 事件类型体系

```dart
sealed class PipelineEvent {
  final DateTime timestamp;
  final String stepName;
  final Duration duration;

  PipelineEvent({
    required this.stepName,
    required this.duration,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

class PipelineStepEvent extends PipelineEvent {
  final PipelineStatus status;
  PipelineStepEvent({...});
}

class PipelineErrorEvent extends PipelineEvent {
  final Object error;
  final bool isCritical;
  final bool handled;
  PipelineErrorEvent({...});
}

class PipelineAbortedEvent extends PipelineEvent {
  final String failedStep;
  final Duration totalDuration;
  PipelineAbortedEvent({...});
}

class PipelineCompletedEvent extends PipelineEvent {
  final Duration totalDuration;
  PipelineCompletedEvent({...});
}
```

### 5.2 监控集成

```dart
class PipelineMonitor {
  void onPipelineCompleted(PipelineReport report) {
    // Sentry / Firebase Analytics
    recordMetric('pipeline_duration_ms', report.totalDuration);
    recordMetric('pipeline_steps', report.totalSteps);

    if (report.hasErrors) {
      recordError('pipeline_partial_failure', report);
    }
  }

  void onStepCompleted(PipelineStepEvent event) {
    recordMetric('step_${event.stepName}_ms', event.duration);
  }
}
```

## 6. 与其他模式的对比

| 模式 | 编排方式 | 错误处理 | 适用场景 |
|------|----------|----------|----------|
| **Pipeline Runner** | 显式步骤列表 | 每步独立策略 | 多步骤业务流程 |
| **Completer + Future** | 链式 `.then()` | 全局 catch | 简单 2-3 步 |
| **Stream** | 事件驱动 | StreamController | 不确定步骤数 |
| **Bloc** | 状态机 | 状态转移 | UI 状态管理 |

## 7. 最佳实践

1. **步骤粒度适中**：每步做一件事，不要太细（避免过多上下文切换）也不要太粗（避免错误定位困难）
2. **关键步骤前置**：将 `isCritical: true` 的步骤尽量靠前，快速失败减少资源浪费
3. **超时必有兜底**：涉及网络/IO 的步骤必须设置 `timeoutMs`
4. **非关键步骤容错**：如日志、分析、缓存预热等设置 `isCritical: false`
5. **上下文最小化**：只传递必要数据，避免巨型 context 对象

---

**下一篇预告**: [F8 — Deep Link OAuth + GlobalOAuthHandler] — 深度链接与 OAuth 统一处理
