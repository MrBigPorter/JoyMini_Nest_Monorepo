---
title: "ErrorStrategy: 5 Strategies + Configurable Decision Table — Application-Level Error Handling Framework"
slug: error-strategy-decision-table
tags: Flutter, ErrorHandling, Architecture, Dart, StateMachine
description: An application-level error handling framework with 5 configurable strategies (silent, toast, retry, degrade, block) and a decision table engine for Flutter apps.
---

# ErrorStrategy: 5 Strategies + Configurable Decision Table — Application-Level Error Handling Framework

## 1. Why ErrorStrategy?

Mobile applications face a wide variety of error types — a one-size-fits-all approach does not work:

| Error Type | Example | User Expectation |
|----------|------|----------|
| **Network disconnected** | `SocketException: No route to host` | Show offline notice, gray out button |
| **Token expired** | `401 Unauthorized` | Silently refresh token, transparent |
| **Insufficient balance** | `400 Insufficient balance` | Show specific error, guide to top up |
| **Server error** | `500 Internal Server Error` | Show "retry later", auto-retry |
| **Form validation** | `400 Validation failed` | Field-level error hints |
| **Empty data** | `404 Not found` | Show empty state, no error toast |

**ErrorStrategy** abstracts **5 strategies**, matched via a configurable **decision table** that maps errors → strategies.

## 2. Five Strategy Model

```dart
/// Error handling strategy
enum ErrorStrategy {
  /// 1. Silent — do not notify user, recover in background
  silent,

  /// 2. Toast — display Toast/SnackBar
  toast,

  /// 3. Retry — show retry button, user clicks to retry
  retry,

  /// 4. Degrade — show degraded UI, limited functionality but usable
  degrade,

  /// 5. Block — show error page, prevent further operation
  block,
}
```

### 2.1 Strategy Details

| Strategy | Trigger Condition | User Visible | Behavior |
|------|----------|----------|------|
| **silent** | Token refresh, background sync, log upload | ❌ Transparent | Log, continue execution |
| **toast** | Form validation failure, operation failure | ✅ Brief notification | Show error message for 3s |
| **retry** | Network timeout, upload failure | ✅ Action button | Show "Retry" button + error description |
| **degrade** | Module unavailable, feature degraded | ✅ Limited functionality | Show degrade notice + alternative |
| **block** | Auth expired, illegal operation, forced update | ✅ Full-screen block | Show error page, prevent use |

## 3. Decision Table Engine

### 3.1 Rule Definition

```dart
class ErrorRule {
  /// Match conditions
  final bool Function(Object error, StackTrace? stack) matcher;

  /// Applied strategy
  final ErrorStrategy strategy;

  /// User-visible message
  final String? message;

  /// Whether to report to Crashlytics
  final bool report;

  /// Retry configuration (only for retry strategy)
  final RetryConfig? retryConfig;

  const ErrorRule({
    required this.matcher,
    required this.strategy,
    this.message,
    this.report = false,
    this.retryConfig,
  });
}
```

### 3.2 Decision Table

```dart
class ErrorDecisionTable {
  final List<ErrorRule> _rules = [];

  ErrorDecisionTable() {
    _buildDefaultRules();
  }

  void _buildDefaultRules() {
    // ---- silent strategy ----

    add(ErrorRule(
      matcher: (e, _) => e is TokenExpiredException,
      strategy: ErrorStrategy.silent,
      report: false,
    ));

    add(ErrorRule(
      matcher: (e, _) => e is DioException && e.type == DioExceptionType.cancel,
      strategy: ErrorStrategy.silent,
      report: false,
    ));

    // ---- toast strategy ----

    add(ErrorRule(
      matcher: (e, _) => e is BadRequestException,
      strategy: ErrorStrategy.toast,
      message: 'Invalid request, please check your input',
    ));

    add(ErrorRule(
      matcher: (e, _) => e is ValidationException,
      strategy: ErrorStrategy.toast,
    ));

    // ---- retry strategy ----

    add(ErrorRule(
      matcher: (e, _) => e is NetworkException,
      strategy: ErrorStrategy.retry,
      message: 'Network connection lost. Please try again.',
      retryConfig: RetryConfig(maxRetries: 3),
      report: true,
    ));

    add(ErrorRule(
      matcher: (e, _) => e is TimeoutException,
      strategy: ErrorStrategy.retry,
      message: 'Request timed out. Please try again.',
      retryConfig: RetryConfig(maxRetries: 2, strategy: BackoffStrategy.exponential),
    ));

    // ---- degrade strategy ----

    add(ErrorRule(
      matcher: (e, _) => e is ServiceUnavailableException,
      strategy: ErrorStrategy.degrade,
      message: 'This feature is temporarily unavailable',
      report: true,
    ));

    add(ErrorRule(
      matcher: (e, _) => e is FeatureDisabledException,
      strategy: ErrorStrategy.degrade,
      message: 'This feature is not available in your region',
    ));

    // ---- block strategy ----

    add(ErrorRule(
      matcher: (e, _) => e is ForcedUpdateException,
      strategy: ErrorStrategy.block,
      message: 'Please update the app to continue',
      report: true,
    ));

    add(ErrorRule(
      matcher: (e, str) => e is UnauthorizedException &&
          str?.toString().contains('account_disabled') == true,
      strategy: ErrorStrategy.block,
      message: 'Your account has been disabled',
      report: true,
    ));
  }

  /// Add custom rule
  void add(ErrorRule rule) => _rules.add(rule);

  /// Match decision
  ErrorDecision decide(Object error, [StackTrace? stack]) {
    for (final rule in _rules) {
      if (rule.matcher(error, stack)) {
        return ErrorDecision(
          strategy: rule.strategy,
          message: rule.message ?? _defaultMessage(error),
          report: rule.report,
          retryConfig: rule.retryConfig,
        );
      }
    }

    // Default: toast
    return ErrorDecision(
      strategy: ErrorStrategy.toast,
      message: _defaultMessage(error),
      report: true,
    );
  }

  String _defaultMessage(Object error) {
    if (error is ApiException) return error.message;
    if (error is DioException) return _dioMessage(error);
    return 'An unexpected error occurred';
  }
}

class ErrorDecision {
  final ErrorStrategy strategy;
  final String message;
  final bool report;
  final RetryConfig? retryConfig;

  const ErrorDecision({
    required this.strategy,
    required this.message,
    this.report = false,
    this.retryConfig,
  });
}
```

## 4. Strategy Executor

```dart
class ErrorStrategyExecutor {
  final ErrorDecisionTable _table;
  final BuildContext _context;

  ErrorStrategyExecutor(this._context)
      : _table = ErrorDecisionTable();

  /// Execute error handling
  Future<void> execute(Object error, [StackTrace? stack]) async {
    final decision = _table.decide(error, stack);

    // Report
    if (decision.report) {
      await _reportError(error, stack, decision);
    }

    // Execute strategy
    switch (decision.strategy) {
      case ErrorStrategy.silent:
        await _executeSilent(error);
      case ErrorStrategy.toast:
        await _executeToast(decision);
      case ErrorStrategy.retry:
        await _executeRetry(decision);
      case ErrorStrategy.degrade:
        await _executeDegrade(decision);
      case ErrorStrategy.block:
        await _executeBlock(decision);
    }
  }

  Future<void> _executeSilent(Object error) async {
    // Log only, no UI feedback
    Logger.warning('[ErrorStrategy] Silent: $error');
  }

  Future<void> _executeToast(ErrorDecision decision) async {
    ScaffoldMessenger.of(_context).showSnackBar(
      SnackBar(
        content: Text(decision.message),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 3),
      ),
    );
  }

  Future<void> _executeRetry(ErrorDecision decision) async {
    showAdaptiveDialog(
      context: _context,
      builder: (ctx) => AlertDialog(
        title: const Text('Error'),
        content: Text(decision.message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              // Trigger retry (via callback or event)
              _retrySubject.add(decision);
            },
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Future<void> _executeDegrade(ErrorDecision decision) async {
    // Show degrade banner
    _degradeBanner = DegradeBanner(
      message: decision.message,
      onDismiss: () => _hideDegradeBanner(),
    );
  }

  Future<void> _executeBlock(ErrorDecision decision) async {
    Navigator.of(_context).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) => ErrorBlockScreen(
          message: decision.message,
          isFatal: true,
        ),
      ),
      (route) => false,
    );
  }

  Future<void> _reportError(
    Object error,
    StackTrace? stack,
    ErrorDecision decision,
  ) async {
    await Crashlytics.instance.recordError(error, stack,
      reason: 'ErrorStrategy: ${decision.strategy.name}',
    );
  }
}
```

## 5. Error Classification System

```dart
/// Base error class
sealed class AppException implements Exception {
  final String message;
  final int? code;
  AppException(this.message, {this.code});
}

// ===== Network layer =====
class NetworkException extends AppException {
  NetworkException([String message = 'Network unavailable'])
      : super(message);
}

class TimeoutException extends AppException {
  TimeoutException([String message = 'Request timed out'])
      : super(message);
}

// ===== API layer =====
class ApiException extends AppException {
  final int statusCode;
  ApiException(this.statusCode, super.message);
}

class UnauthorizedException extends ApiException {
  UnauthorizedException([String message = 'Unauthorized'])
      : super(401, message);
}

class BadRequestException extends ApiException {
  BadRequestException(String message) : super(400, message);
}

class ForbiddenException extends ApiException {
  ForbiddenException([String message = 'Forbidden'])
      : super(403, message);
}

class NotFoundException extends ApiException {
  NotFoundException([String message = 'Resource not found'])
      : super(404, message);
}

class ConflictException extends ApiException {
  ConflictException(String message) : super(409, message);
}

class ValidationException extends ApiException {
  final Map<String, String> fieldErrors;

  ValidationException(super.message, {this.fieldErrors = const {}})
      : super(422);
}

class RateLimitException extends ApiException {
  final int retryAfterSeconds;
  RateLimitException(this.retryAfterSeconds)
      : super(429, 'Too many requests');
}

class ServerErrorException extends ApiException {
  ServerErrorException([String message = 'Internal server error'])
      : super(500, message);
}

class ServiceUnavailableException extends ApiException {
  ServiceUnavailableException([String message = 'Service unavailable'])
      : super(503, message);
}

// ===== Business layer =====
class InsufficientBalanceException extends AppException {
  InsufficientBalanceException()
      : super('Insufficient balance');
}

class TokenExpiredException extends AppException {
  TokenExpiredException() : super('Token expired');
}

class ForcedUpdateException extends AppException {
  final String newVersion;
  ForcedUpdateException(this.newVersion)
      : super('App update required');
}

class FeatureDisabledException extends AppException {
  FeatureDisabledException(String feature)
      : super('$feature is disabled');
}
```

## 6. HTTP Layer Integration

```dart
class ErrorInterceptor extends Interceptor {
  final ErrorDecisionTable _table = ErrorDecisionTable();

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final appError = _convertToAppError(err);
    final decision = _table.decide(appError, err.stackTrace);

    if (decision.strategy == ErrorStrategy.silent) {
      // Silent handling, continue passing
      handler.next(err);
      return;
    }

    // Record in context, consumed by UI layer
    ErrorContext.current?.addError(decision);

    handler.next(err);
  }

  AppException _convertToAppError(DioException err) {
    if (err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.receiveTimeout) {
      return TimeoutException();
    }

    if (err.type == DioExceptionType.connectionError) {
      return NetworkException();
    }

    if (err.response != null) {
      final statusCode = err.response!.statusCode ?? 0;
      final message = err.response!.data?['message'] as String? ?? '';

      return switch (statusCode) {
        400 => BadRequestException(message),
        401 => UnauthorizedException(message),
        403 => ForbiddenException(message),
        404 => NotFoundException(message),
        409 => ConflictException(message),
        422 => ValidationException(
          message,
          fieldErrors: _parseFieldErrors(err.response!.data),
        ),
        429 => RateLimitException(
          _parseRetryAfter(err.response!.headers),
        ),
        500 => ServerErrorException(message),
        503 => ServiceUnavailableException(message),
        _   => ApiException(statusCode, message),
      };
    }

    return ApiException(0, err.message ?? 'Unknown error');
  }
}
```

## 7. Component Layer Integration: ErrorWidgetBuilder

```dart
class ErrorWidgetBuilder extends StatelessWidget {
  final ErrorStrategy strategy;
  final String message;
  final VoidCallback? onRetry;

  factory ErrorWidgetBuilder.fromDecision(
    ErrorDecision decision, {
    VoidCallback? onRetry,
  }) {
    return ErrorWidgetBuilder(
      strategy: decision.strategy,
      message: decision.message,
      onRetry: onRetry,
    );
  }

  @override
  Widget build(BuildContext context) {
    return switch (strategy) {
      ErrorStrategy.retry    => _buildRetryWidget(),
      ErrorStrategy.degrade  => _buildDegradeWidget(),
      ErrorStrategy.block    => _buildBlockWidget(),
      _                      => const SizedBox.shrink(),
    };
  }

  Widget _buildRetryWidget() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.cloud_off, size: 64, color: Colors.grey[400]),
          const SizedBox(height: 16),
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _buildDegradeWidget() {
    return Column(
      children: [
        // Degrade banner
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(8),
          color: Colors.orange[50],
          child: Row(
            children: [
              Icon(Icons.warning_amber, color: Colors.orange[700]),
              const SizedBox(width: 8),
              Expanded(child: Text(message)),
            ],
          ),
        ),
        // Fallback UI after degradation
        _buildFallbackContent(),
      ],
    );
  }

  Widget _buildBlockWidget() {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, size: 80, color: Colors.red[300]),
            const SizedBox(height: 24),
            Text(message, style: const TextStyle(fontSize: 18)),
            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: () => _openAppStore(),
              child: const Text('Update Now'),
            ),
          ],
        ),
      ),
    );
  }
}
```

## 8. Decision Table Visualization

```
┌────────────────────────────────────────────────────────────────┐
│                     Error Decision Table                       │
├──────────────────────┬──────────────┬──────────┬───────────────┤
│ Error Type           │ Strategy     │ Message  │ Auto-Report   │
├──────────────────────┼──────────────┼──────────┼───────────────┤
│ TokenExpiredException│ silent       │ —        │ ❌            │
│ DioEx: cancel        │ silent       │ —        │ ❌            │
├──────────────────────┼──────────────┼──────────┼───────────────┤
│ BadRequestException  │ toast        │Specific   │ ❌            │
│ ValidationException  │ toast        │Field error│ ❌            │
│ RateLimitException   │ toast        │"Retry"    │ ✅            │
├──────────────────────┼──────────────┼──────────┼───────────────┤
│ NetworkException     │ retry        │Disconnect │ ✅            │
│ TimeoutException     │ retry        │Timeout   │ ❌            │
│ 500 ServerError      │ retry        │Server err│ ✅            │
├──────────────────────┼──────────────┼──────────┼───────────────┤
│ ServiceUnavailableEx │ degrade      │Unavailabl│ ✅            │
│ FeatureDisabledEx    │ degrade      │Region    │ ❌            │
├──────────────────────┼──────────────┼──────────┼───────────────┤
│ ForcedUpdateException│ block        │Update    │ ✅            │
│ account_disabled     │ block        │Disabled  │ ✅            │
└──────────────────────┴──────────────┴──────────┴───────────────┘
```

## 9. Testing

```dart
void main() {
  group('ErrorDecisionTable', () {
    final table = ErrorDecisionTable();

    test('silent for TokenExpiredException', () {
      final decision = table.decide(TokenExpiredException());
      expect(decision.strategy, ErrorStrategy.silent);
    });

    test('retry for NetworkException', () {
      final decision = table.decide(NetworkException());
      expect(decision.strategy, ErrorStrategy.retry);
      expect(decision.retryConfig?.maxRetries, 3);
    });

    test('block for ForcedUpdateException', () {
      final decision = table.decide(ForcedUpdateException('2.0.0'));
      expect(decision.strategy, ErrorStrategy.block);
    });

    test('defaults to toast for unknown errors', () {
      final decision = table.decide(StateError('weird'));
      expect(decision.strategy, ErrorStrategy.toast);
    });
  });
}
```

## 10. Summary

| Strategy | User Impact | Typical Scenario | Example Code Size |
|------|----------|----------|-----------|
| **silent** | None | Token refresh, background sync | 3 lines |
| **toast** | Brief notification | Validation failure, operation error | 10 lines |
| **retry** | User action required | Network timeout, upload failure | 30 lines |
| **degrade** | Limited functionality | Module unavailable, region restriction | 50 lines |
| **block** | Blocks usage | Forced update, account disabled | 40 lines |

**Core idea**: upgrade error handling from "try-catch everywhere" to a "declarative decision table", making error handling predictable, configurable, and testable.
