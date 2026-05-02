# ErrorStrategy 5 种策略 + 可配置决策表 — 应用级错误处理框架

> **Article F15** | **Difficulty:** ⭐⭐⭐⭐ | **Source:** `joy_mini_app/lib/core/error/`

## 1. 为什么需要 ErrorStrategy？

移动应用面临的错误类型多种多样，统一处理方式不可行：

| 错误类型 | 示例 | 用户期望 |
|----------|------|----------|
| **网络断开** | `SocketException: No route to host` | 显示离线提示，按钮变灰 |
| **Token 过期** | `401 Unauthorized` | 静默刷新 Token，无感知 |
| **余额不足** | `400 Insufficient balance` | 显示具体错误，引导充值 |
| **服务器错误** | `500 Internal Server Error` | 显示"稍后重试"，自动重试 |
| **表单验证** | `400 Validation failed` | 字段级错误提示 |
| **数据为空** | `404 Not found` | 显示空状态，不弹错误 |

**ErrorStrategy** 抽象出 **5 种策略**，通过可配置的 **决策表** 匹配错误→策略。

## 2. 五策略模型

```dart
/// 错误处理策略
enum ErrorStrategy {
  /// 1. 静默处理 — 不通知用户，后台恢复
  silent,

  /// 2. 提示 — 显示 Toast/SnackBar
  toast,

  /// 3. 重试 — 显示重试按钮，用户点击重试
  retry,

  /// 4. 降级 — 显示降级 UI，功能受限但可用
  degrade,

  /// 5. 阻断 — 显示错误页面，阻止继续操作
  block,
}
```

### 2.1 策略详解

| 策略 | 触发条件 | 用户可见 | 行为 |
|------|----------|----------|------|
| **silent** | Token 刷新、后台同步、日志上报 | ❌ 无感知 | 记录日志，继续执行 |
| **toast** | 表单验证失败、操作失败 | ✅ 短暂提示 | 显示错误消息 3s |
| **retry** | 网络超时、上传失败 | ✅ 操作按钮 | 显示"重试"按钮+错误描述 |
| **degrade** | 某个模块不可用、功能降级 | ✅ 功能受限 | 显示降级提示 + 替代方案 |
| **block** | 认证过期、非法操作、版本强制更新 | ✅ 全屏阻断 | 显示错误页，阻止使用 |

## 3. 决策表引擎

### 3.1 规则定义

```dart
class ErrorRule {
  /// 匹配条件
  final bool Function(Object error, StackTrace? stack) matcher;

  /// 应用策略
  final ErrorStrategy strategy;

  /// 用户可见的消息
  final String? message;

  /// 是否记录到 Crashlytics
  final bool report;

  /// 重试配置（仅 retry 策略）
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

### 3.2 决策表

```dart
class ErrorDecisionTable {
  final List<ErrorRule> _rules = [];

  ErrorDecisionTable() {
    _buildDefaultRules();
  }

  void _buildDefaultRules() {
    // ---- silent 策略 ----

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

    // ---- toast 策略 ----

    add(ErrorRule(
      matcher: (e, _) => e is BadRequestException,
      strategy: ErrorStrategy.toast,
      message: 'Invalid request, please check your input',
    ));

    add(ErrorRule(
      matcher: (e, _) => e is ValidationException,
      strategy: ErrorStrategy.toast,
    ));

    // ---- retry 策略 ----

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

    // ---- degrade 策略 ----

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

    // ---- block 策略 ----

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

  /// 添加自定义规则
  void add(ErrorRule rule) => _rules.add(rule);

  /// 匹配决策
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

    // 默认：提示
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

## 4. 策略执行器

```dart
class ErrorStrategyExecutor {
  final ErrorDecisionTable _table;
  final BuildContext _context;

  ErrorStrategyExecutor(this._context)
      : _table = ErrorDecisionTable();

  /// 执行错误处理
  Future<void> execute(Object error, [StackTrace? stack]) async {
    final decision = _table.decide(error, stack);

    // 上报
    if (decision.report) {
      await _reportError(error, stack, decision);
    }

    // 执行策略
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
    // 仅记录日志，无 UI 反馈
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
              // 触发重试（通过 callback 或 event）
              _retrySubject.add(decision);
            },
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Future<void> _executeDegrade(ErrorDecision decision) async {
    // 显示降级 banner
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

## 5. 错误分类体系

```dart
/// 基础错误类
sealed class AppException implements Exception {
  final String message;
  final int? code;
  AppException(this.message, {this.code});
}

// ===== 网络层 =====
class NetworkException extends AppException {
  NetworkException([String message = 'Network unavailable'])
      : super(message);
}

class TimeoutException extends AppException {
  TimeoutException([String message = 'Request timed out'])
      : super(message);
}

// ===== API 层 =====
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

// ===== 业务层 =====
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

## 6. HTTP 层集成

```dart
class ErrorInterceptor extends Interceptor {
  final ErrorDecisionTable _table = ErrorDecisionTable();

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final appError = _convertToAppError(err);
    final decision = _table.decide(appError, err.stackTrace);

    if (decision.strategy == ErrorStrategy.silent) {
      // 静默处理，继续传递
      handler.next(err);
      return;
    }

    // 记录到上下文中，由 UI 层消费
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

## 7. 组件层集成：ErrorWidgetBuilder

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
        // 降级横幅
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
        // 降级后的替代 UI
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

## 8. 决策表可视化

```
┌────────────────────────────────────────────────────────────────┐
│                     Error Decision Table                       │
├──────────────────────┬──────────────┬──────────┬───────────────┤
│ Error Type           │ Strategy     │ Message  │ Auto-Report   │
├──────────────────────┼──────────────┼──────────┼───────────────┤
│ TokenExpiredException│ silent       │ —        │ ❌            │
│ DioEx: cancel        │ silent       │ —        │ ❌            │
├──────────────────────┼──────────────┼──────────┼───────────────┤
│ BadRequestException  │ toast        │具体消息   │ ❌            │
│ ValidationException  │ toast        │字段错误   │ ❌            │
│ RateLimitException   │ toast        │"稍后重试" │ ✅            │
├──────────────────────┼──────────────┼──────────┼───────────────┤
│ NetworkException     │ retry        │网络断开   │ ✅            │
│ TimeoutException     │ retry        │超时      │ ❌            │
│ 500 ServerError      │ retry        │服务器错误 │ ✅            │
├──────────────────────┼──────────────┼──────────┼───────────────┤
│ ServiceUnavailableEx │ degrade      │暂不可用   │ ✅            │
│ FeatureDisabledEx    │ degrade      │区域限制   │ ❌            │
├──────────────────────┼──────────────┼──────────┼───────────────┤
│ ForcedUpdateException│ block        │更新 App  │ ✅            │
│ account_disabled     │ block        │账号禁用   │ ✅            │
└──────────────────────┴──────────────┴──────────┴───────────────┘
```

## 9. 测试

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

## 10. 总结

| 策略 | 用户影响 | 典型场景 | 示例代码量 |
|------|----------|----------|-----------|
| **silent** | 无 | Token 刷新、后台同步 | 3 行 |
| **toast** | 短暂提示 | 验证失败、操作错误 | 10 行 |
| **retry** | 用户需操作 | 网络超时、上传失败 | 30 行 |
| **degrade** | 功能受限 | 模块不可用、区域限制 | 50 行 |
| **block** | 阻断使用 | 强制更新、账号禁用 | 40 行 |

**核心思想**：将错误处理从"到处 try-catch"升级为"声明式决策表"，让错误处理可预测、可配置、可测试。

---

**下一篇预告**: [F16 — DeviceFingerprint 设备指纹 + 风控体系] — 移动端设备指纹与风险控制
