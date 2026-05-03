---
title: 'UnifiedInterceptor：错误策略分发 + 单飞 Token 刷新'
slug: unified-interceptor-error-strategy-token-refresh
tags: Flutter, Dio, Interceptor, TokenRefresh, ErrorHandling
description: UnifiedInterceptor 是一个 Dio HTTP 拦截器，作为 Flutter 应用中所有 HTTP 通信的中枢神经系统，处理设备指纹注入、错误策略分发、单飞 Token 刷新和服务器时间同步。
---

# UnifiedInterceptor：错误策略分发 + 单飞 Token 刷新

## 1. 背景

[`UnifiedInterceptor`](JoyMini_Flutter_App/lib/core/network/unified_interceptor.dart) 是一个 Dio 拦截器，作为 Flutter 应用中所有 HTTP 通信的中枢神经系统。它继承 `QueuedInterceptor`（确保请求顺序）并处理三个生命周期钩子：请求注入、响应分发和错误策略解析。

该拦截器解决四个关键问题：

| 关注点 | 机制 |
|--------|------|
| **设备指纹** | 在每个请求中注入 `x-device-id`、`x-device-model`、`x-platform` 头 |
| **错误策略分发** | 将 HTTP 状态码和业务错误码映射到 5 种以上可执行策略 |
| **单飞 Token 刷新** | 同一时间只有一个刷新请求——并发的 401 请求共享一个 Completer |
| **服务器时间同步** | 从 `x-server-time` 响应头校准本地时钟 |

---

## 2. 请求拦截：设备指纹注入

每个出站请求自动注入设备标识头：

```dart
@override
void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
  final fingerprint = DeviceUtils.getFingerprint();
  
  options.headers.addAll({
    'x-device-id': fingerprint.deviceId,
    'x-device-model': fingerprint.deviceModel,
    'x-platform': fingerprint.platform,
  });
  
  handler.next(options);
}
```

这使得后端能够：
- 跟踪设备级活动模式
- 检测设备黑名单（`deviceBanned` 事件）
- 强制设备信任级别（`deviceNotTrusted`）
- 识别异常访问模式

指纹由 [`DeviceUtils`](JoyMini_Flutter_App/lib/utils/device_utils.dart) 生成，具有平台特定实现：

| 平台 | 设备 ID 来源 | 型号来源 |
|------|-------------|---------|
| iOS | `FlutterUdid.consistentUdid` | `IosDeviceInfo.utsname.machine` |
| Android | `FlutterUdid.consistentUdid` | `AndroidDeviceInfo.brand/model` |
| Web | SharedPreferences 持久化 UUID | `webBrowserInfo` |

---

## 3. 错误策略分发

`UnifiedInterceptor` 的核心是其 `onError` 处理器，它将 HTTP 状态码映射到特定策略处理器：

```dart
@override
void onError(DioException err, ErrorInterceptorHandler handler) {
  // Server time calibration (every response)
  ServerTimeHelper.updateOffset(err.response?.headers.value('x-server-time'));
  
  switch (err.response?.statusCode) {
    case 401:
      return _handleUnauthorized(err, handler);   // Single-flight token refresh
    case 403:
      return _handleForbidden(err, handler);       // Permission denied
    case 429:
      return _handleRateLimited(err, handler);     // Rate limit wait
    case >= 500:
      return _handleServerError(err, handler);     // Server error
    default:
      return _handleNetworkError(err, handler);    // Network error
  }
}
```

### 3.1 响应拦截：从业务码解析错误策略

除了 HTTP 状态码，拦截器还会检查响应体中的业务错误码，从 5 种策略中选择：

```dart
@override
void onResponse(Response response, ResponseInterceptorHandler handler) {
  ServerTimeHelper.updateOffset(response.headers.value('x-server-time'));
  
  final body = response.data;
  final code = body['code'];  // Business error code
  
  if (code == 10000) {
    // Strategy: success — unwrap data payload
    response.data = body['data'];
    handler.next(response);
    return;
  }
  
  // Parse strategy from error config table
  final strategy = ErrorStrategy.getStrategy(code);
  
  switch (strategy) {
    case ErrorStrategy.success:
      response.data = body['data'];
      handler.next(response);
    case ErrorStrategy.refresh:
      _handleTokenRefresh(response, handler);
    case ErrorStrategy.security:
      EventBus().emit(GlobalEventType.deviceBanned);
      handler.reject(DioException(...));
    case ErrorStrategy.redirect:
      _handleRedirect(code, response, handler);
    case ErrorStrategy.toast:
      RadixToast.show(body['message'] ?? 'Unknown error');
      handler.reject(DioException(...));
  }
}
```

### 3.2 错误策略决策表

策略从 [`error_config.dart`](JoyMini_Flutter_App/lib/core/network/error_config.dart) 中的静态配置表解析：

| 业务码 | 策略 | 动作 |
|--------|------|------|
| `10000` | `success` | 解包 `response.data` |
| 任意 Token 错误 | `refresh` | 单飞 Token 刷新 + 重试 |
| `92001` | `redirect` | 导航到设置页 |
| `93001` | `redirect` | 导航到 KYC 验证 |
| `18023` | `redirect` | 导航到手机绑定 |
| `deviceBlacklisted` | `security` | 锁定应用，触发 deviceBanned |
| `deviceNotTrusted` | `security` | 锁定应用，触发 deviceBanned |
| 无匹配 | `toast` | 显示错误提示 |

解析优先级为：
1. `successCodes`（码 10000）→ 解包
2. `tokenErrorCodes` → 刷新
3. 在 `_strategyMap` 中查找 → redirect 或 security
4. 无匹配 → toast

---

## 4. 单飞 Token 刷新

最具架构意义的特性是单飞 Token 刷新模式。当多个请求同时返回 401 时，只有一个刷新请求被发起——其他所有请求等待同一个结果：

```dart
Future<void> _handleUnauthorized(
  DioException err,
  ErrorInterceptorHandler handler,
) async {
  // Guard: prevent infinite retry recursion
  if (err.requestOptions.extra['__retryAfterRefresh__'] == true) {
    // Already retried after refresh — no more loops
    handler.reject(err);
    return;
  }
  
  try {
    // Check if refresh is already in progress
    if (Http.refreshingFuture != null) {
      // Wait for ongoing refresh to complete
      await Http.refreshingFuture;
    } else {
      // Start new refresh — create Completer
      final completer = Completer<void>();
      Http.refreshingFuture = completer.future;
      
      try {
        final newToken = await Http.tryRefreshToken();
        Http.tokenCache = newToken;
        
        // Compare with latest token — if changed, another refresh occurred
        if (Http.latestToken != newToken) {
          // Token already updated by another refresh — skip
          return;
        }
        Http.latestToken = newToken;
      } finally {
        Http.refreshingFuture = null;
        if (!completer.isCompleted) completer.complete();
      }
    }
    
    // Retry original request with new token
    err.requestOptions.headers['Authorization'] = 'Bearer ${Http.tokenCache}';
    err.requestOptions.extra['__retryAfterRefresh__'] = true;
    
    final retryResponse = await Http.dio.fetch(err.requestOptions);
    handler.resolve(retryResponse);
  } catch (e) {
    // Refresh failed — redirect to login
    Http.performLogout();
    handler.reject(err);
  }
}
```

### 4.1 竞态条件防护

| 防护 | 实现 |
|------|------|
| **Completer 单飞** | `Http.refreshingFuture`——并发调用者等待同一个 Completer |
| **`__retryAfterRefresh__` 标志** | 防止重试也返回 401 时的无限重试循环 |
| **`latestToken` 比较** | 检测另一个刷新是否已完成并更新了 Token |
| **`navigatingToLogin` 守卫** | 防止多次同时导航到登录页 |

### 4.2 Token 刷新流程

```
Multiple 401s arrive concurrently
         │
         ▼
┌─────────────────────────────────────┐
│  Request A arrives first             │
│  → Check refreshingFuture (null)    │
│  → Create Completer                  │
│  → Set Http.refreshingFuture         │
│  → Call tryRefreshToken()            │
└─────────────────────────────────────┘
         │
         ▼ (Refresh in progress)
┌─────────────────────────────────────┐
│  Requests B, C, D arrive            │
│  → Check refreshingFuture (exists)  │
│  → Await the same Completer         │
│  → Wait for refresh to finish       │
└─────────────────────────────────────┘
         │
         ▼ (Refresh complete)
┌─────────────────────────────────────┐
│  All 4 requests retry in parallel   │
│  with new token                     │
│  → __retryAfterRefresh__ = true     │
│  → If still 401, no further retries │
└─────────────────────────────────────┘
```

---

## 5. 服务器时间校准

每个响应（成功或错误）都通过 `x-server-time` 头触发服务器时间校准：

```dart
ServerTimeHelper.updateOffset(err.response?.headers.value('x-server-time'));
ServerTimeHelper.updateOffset(response.headers.value('x-server-time'));
```

这会更新 [`ServerTimeHelper`](JoyMini_Flutter_App/lib/utils/time/server_time_helper.dart) 使用的本地时钟偏移，这对于以下场景至关重要：

- **倒计时器**——与服务器绝对时间同步
- **KYC 会话过期**——无论设备时钟漂移如何，超时一致
- **事件计时**——准确显示服务器端时间戳

---

## 6. 僵尸回调保护

长生命周期拦截器的一个关键问题是回调在 widget/页面被销毁后触发：

```dart
// In GlobalHandler or consuming widget
UnifiedInterceptor.onTokenInvalid = () {
  if (!mounted) return;  // Zombie guard
  // Handle token invalidation
};

UnifiedInterceptor.onTokenRefresh = (newToken) {
  if (!mounted) return;  // Zombie guard
  // Update UI with new token
};
```

拦截器本身不持有 widget 引用——而是暴露静态回调插槽（`onTokenInvalid`、`onTokenRefresh`），widget 可以注册到这些插槽上。这些插槽在启动引导期间在 [`AppBootstrap.setupInterceptors()`](JoyMini_Flutter_App/lib/app/bootstrap.dart) 中设置。

---

## 7. 系统集成

```
Http (Static Class)
  ├─ _dio (Main Dio) ←── UnifiedInterceptor
  │   ├─ Header injection (device fingerprint)
  │   ├─ Error strategy dispatch
  │   └─ Single-flight refresh
  │
  ├─ _rawDio (Refresh-Only) ←── No interceptor
  │   └─ Used exclusively for token refresh itself
  │      (Prevents infinite interceptor loop)
  │
  ├─ tokenCache / refreshingFuture / navigatingToLogin
  │   └─ Shared static state with interceptor
  │
  └─ tryRefreshToken() / performLogout()
      └─ Bridge methods invoked by the interceptor
```

双 Dio 架构（参见 [Http 静态类 + 双 Dio + Native Adapter](http-static-class-dual-dio-native-adapter.md)）确保刷新请求本身不会触发拦截器的 401 处理器，防止无限递归。

---

## 8. 总结

1. **`QueuedInterceptor`** 确保请求顺序——对单飞刷新模式的正确运行至关重要。
2. **5 种错误策略**（`success` / `refresh` / `redirect` / `security` / `toast`）覆盖了从成功解包到安全锁定的完整 API 响应谱。
3. **单飞 Token 刷新**使用 `Completer` 模式——并发的 401 请求共享一个刷新请求，然后全部使用新 Token 并行重试。
4. **三重竞态防护**（`__retryAfterRefresh__` 标志、`latestToken` 比较、`navigatingToLogin` 守卫）防止无限循环和重复导航。
5. **每次请求的设备指纹注入**使后端风险控制无需修改单个 API 端点。
6. **每次响应的服务器时间校准**通过 `x-server-time` 头保持本地时间同步，用于倒计时和过期判断。
7. **通过 `mounted` 检查的僵尸回调保护**防止页面销毁后回调触发导致的崩溃。
