---
title: "Pipeline Runner: Sequential Execution Pattern — Reliable Async Pipeline Architecture"
description: "Analysis of the Pipeline Runner pattern for executing multi-step async operations with sequential ordering, per-step retry strategies, timeouts, error boundaries, and built-in observability."
slug: pipeline-runner-sequential-execution
tags: [Flutter, Architecture, Pipeline, Async, ErrorHandling]
---

## 1. Problem Context

In mobile applications, many operations require **executing multiple async steps in sequence**, with clear error handling strategies when any step fails:

| Scenario | Step Chain | Failure Handling |
|------|--------|----------|
| **User Registration** | Verify phone → Create account → Init wallet → Send welcome message | Any step fails → roll back created resources |
| **Order Payment** | Check inventory → Lock price → Deduct balance → Create order → Send notification | Insufficient inventory → abort; deduction fails → retry |
| **Image Upload** | Compress → Generate blurhash → Upload to S3 → Update database record | Compression fails → skip blurhash; upload fails → retry 3 times |

**Pipeline Runner** abstracts the sequential execution pattern, solving:

1. **Sequential Orchestration**: Steps execute in declared order, with previous step output serving as next step input
2. **Error Boundaries**: Each step can define independent retry strategy and timeout
3. **Graceful Abort**: When a critical step fails, skip subsequent dependent steps
4. **Observability**: Per-step duration, success/failure counts automatically collected

## 2. Core Architecture

### 2.1 PipelineStep Abstraction

```dart
/// Base class for pipeline steps
abstract class PipelineStep<TInput, TOutput> {
  /// Step name (for logging and monitoring)
  String get name;

  /// Whether this step is critical (failure aborts the entire pipeline)
  bool get isCritical => false;

  /// Maximum retry attempts
  int get maxRetries => 0;

  /// Retry interval (milliseconds)
  int get retryDelayMs => 500;

  /// Timeout (milliseconds), 0 = no timeout
  int get timeoutMs => 0;

  /// Execute the step
  Future<TOutput> execute(TInput input);
}
```

### 2.2 PipelineContext — Shared Data Between Steps

```dart
class PipelineContext {
  final Map<String, dynamic> _data = {};
  final List<PipelineEvent> _events = [];

  /// Store step output
  void set<T>(String key, T value) {
    _data[key] = value;
  }

  /// Read step output
  T? get<T>(String key) => _data[key] as T?;

  /// Record event (for monitoring)
  void recordEvent(PipelineEvent event) {
    _events.add(event);
  }

  /// Get execution report
  PipelineReport toReport() => PipelineReport(
    totalSteps: _events.length,
    duration: _calculateDuration(),
    events: List.unmodifiable(_events),
    hasErrors: _events.any((e) => e is PipelineErrorEvent),
  );
}
```

### 2.3 PipelineRunner — Execution Engine

```dart
class PipelineRunner {
  final Logger _logger = Logger('Pipeline');

  /// Run an ordered set of steps
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
        // Timeout wrapper
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

## 3. Retry Strategy

### 3.1 Execution with Retry

```dart
Future<dynamic> _handleStepError(
  PipelineStep step,
  Object error,
  StackTrace stackTrace,
  PipelineContext context,
) async {
  if (step.maxRetries <= 0) return false;

  // Non-retryable error types
  if (error is PipelineNonRetryableException) return false;

  for (var attempt = 1; attempt <= step.maxRetries; attempt++) {
    try {
      await Future.delayed(
        Duration(milliseconds: step.retryDelayMs * attempt), // Backoff
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

### 3.2 Configurable Backoff Strategy

```dart
enum BackoffStrategy {
  fixed,       // Fixed interval
  linear,      // Linear increase
  exponential, // Exponential backoff
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

## 4. Practical Examples

### 4.1 Registration Pipeline

```dart
class RegistrationPipeline {
  PipelineRunner get _runner => PipelineRunner();

  Future<PipelineReport> run(RegistrationRequest request) async {
    final context = PipelineContext();

    return _runner.run(
      steps: [
        // Step 1: Verify phone number
        _VerifyPhoneStep(),
        // Step 2: Create account (critical)
        _CreateAccountStep(isCritical: true),
        // Step 3: Initialize wallet (critical)
        _InitWalletStep(isCritical: true),
        // Step 4: Send welcome message (non-critical, failure is ignorable)
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

### 4.2 Image Upload Pipeline

```dart
class ImageUploadPipeline {
  Future<PipelineReport> run(File image) async {
    return PipelineRunner().run(
      steps: [
        CompressImageStep(maxRetries: 2),
        GenerateBlurhashStep(
          isCritical: false, // Failure does not block upload
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

## 5. Observability Integration

### 5.1 Event Type Hierarchy

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

### 5.2 Monitoring Integration

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

## 6. Comparison with Other Patterns

| Pattern | Orchestration | Error Handling | Use Case |
|------|----------|----------|----------|
| **Pipeline Runner** | Explicit step list | Per-step independent strategy | Multi-step business processes |
| **Completer + Future** | Chained `.then()` | Global catch | Simple 2-3 steps |
| **Stream** | Event-driven | StreamController | Unknown step count |
| **Bloc** | State machine | State transitions | UI state management |

## 7. Best Practices

1. **Right-Sized Step Granularity**: Each step should do one thing — not too fine (avoiding excessive context switching) nor too coarse (avoiding difficult error localization)
2. **Critical Steps First**: Place `isCritical: true` steps early to fail fast and minimize resource waste
3. **Always Set Timeouts**: Network/IO steps must set `timeoutMs`
4. **Non-Critical Step Tolerance**: Set `isCritical: false` for logging, analytics, cache warming, etc.
5. **Minimal Context**: Pass only necessary data to avoid giant context objects
