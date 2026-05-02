# UnifiedInterceptor：错误策略分发 + 单飞令牌刷新

> **目标读者：** Flutter 移动端工程师
> **标签：** `#Flutter` `#Dio` `#Interceptor` `#TokenRefresh` `#ErrorHandling`
> **难度：** 高级
> **预计阅读时间：** 15 分钟

---

## 概述

[`UnifiedInterceptor`](JoyMini_Flutter_App/lib/core/network/unified_interceptor.dart) 是一个 Dio 拦截器，作为 Flutter 应用中所有 HTTP 通信的中枢神经系统。它继承自 `QueuedInterceptor`（确保请求顺序），并处理三个生命周期钩子：请求注入、响应分发和错误策略解析。

该拦截器解决四个关键问题：

| 关注点 | 机制 |
|---------|-----------|
| **设备指纹** | 在每个请求中注入 `x-device-id`、`x-device-model`、`x-platform` 头信息 |
| **错误策略分发** | 将 HTTP 状态码和业务错误码映射到 5+ 种可执行策略 |
| **单飞令牌刷新** | 一次只进行一次刷新——并发的 401 请求共享同一个 Completer |
| **服务器时间同步** | 从 `x-server-time` 响应头校准本地时钟 |

---

## 1. 请求拦截：设备指纹注入

每个发出的请求自动注入设备标识头信息：

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
- 跟踪设备级别的活动模式
- 检测设备黑名单（`deviceBanned` 事件）
- 执行设备信任级别（`deviceNotTrusted`）
- 识别异常访问模式

指纹由 [`DeviceUtils`](JoyMini_Flutter_App/lib/utils/device_utils.dart) 生成，具有平台特定的实现：

| 平台 | 设备 ID 来源 | 型号来源 |
|----------|-----------------|--------------|
| iOS | `FlutterUdid.consistentUdid` | `IosDeviceInfo.utsname.machine` |
| Android | `FlutterUdid.consistentUdid` | `AndroidDeviceInfo.brand/model` |
| Web | SharedPreferences 持久化 UUID | `webBrowserInfo` |

---

## 2. 错误策略分发

`UnifiedInterceptor` 的核心是 `onError` 处理器，它将 HTTP 状态码映射到特定策略的处理器：

```dart
@override
void onError(DioException err, ErrorInterceptorHandler handler) {
  // 服务器时间校准（每个响应）
  ServerTimeHelper.updateOffset(err.response?.headers.value('x-server-time'));
  
  switch (err.response?.statusCode) {
    case 401:
      return _handleUnauthorized(err, handler);   // 单飞令牌刷新
    case 403:
      return _handleForbidden(err, handler);       // 权限拒绝
    case 429:
      return _handleRateLimited(err, handler);     // 限流等待
    case >= 500:
      return _handleServerError(err, handler);     // 服务器错误
    default:
      return _handleNetworkError(err, handler);    // 网络错误
  }
}
```

### 响应拦截：从业务码解析错误策略

除了 HTTP 状态码外，拦截器还会检查响应体中的业务错误码，从 5 种策略中选择：

```dart
@override
void onResponse(Response response, ResponseInterceptorHandler handler) {
  ServerTimeHelper.updateOffset(response.headers.value('x-server-time'));
  
  final body = response.data;
  final code = body['code'];  // 业务错误码
  
  if (code == 10000) {
    // 策略：成功 — 解包数据负载
    response.data = body['data'];
    handler.next(response);
    return;
  }
  
  // 从错误配置表中解析策略
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
      RadixToast.show(body['message'] ?? '未知错误');
      handler.reject(DioException(...));
  }
}
```

### 错误策略决策表

策略从 [`error_config.dart`](JoyMini_Flutter_App/lib/core/network/error_config.dart) 中的静态配置表解析：

| 业务码 | 策略 | 操作 |
|-------------|----------|--------|
| `10000` | `success` | 解包 `response.data` |
| 任何令牌错误 | `refresh` | 单飞令牌刷新 + 重试 |
| `92001` | `redirect` | 导航到设置页面 |
| `93001` | `redirect` | 导航到 KYC 认证 |
| `18023` | `redirect` | 导航到手机绑定 |
| `deviceBlacklisted` | `security` | 锁定应用，触发 deviceBanned |
| `deviceNotTrusted` | `security` | 锁定应用，触发 deviceBanned |
| 未匹配 | `toast` | 显示错误提示 |

解析优先级为：
1. `successCodes`（码 10000）→ 解包
2. `tokenErrorCodes` → 刷新
3. 在 `_strategyMap` 中查找 → 重定向或安全
4. 未匹配 → 提示

---

## 3. 单飞令牌刷新

最具架构意义的特性是单飞令牌刷新模式。当多个请求同时返回 401 时，只会发起一次刷新请求——其他所有请求等待相同的结果：

```dart
Future<void> _handleUnauthorized(
  DioException err,
  ErrorInterceptorHandler handler,
) async {
  // 守卫：防止无限递归重试
  if (err.requestOptions.extra['__retryAfterRefresh__'] == true) {
    // 刷新后已重试过 — 不再循环
    handler.reject(err);
    return;
  }
  
  try {
    // 检查刷新是否已在进行中
    if (Http.refreshingFuture != null) {
      // 等待正在进行的刷新完成
      await Http.refreshingFuture;
    } else {
      // 开始新的刷新 — 创建 Completer
      final completer = Completer<void>();
      Http.refreshingFuture = completer.future;
      
      try {
        final newToken = await Http.tryRefreshToken();
        Http.tokenCache = newToken;
        
        // 与最新令牌比较 — 如果已变化，说明另一个刷新已发生
        if (Http.latestToken != newToken) {
          // 令牌已被另一个刷新更新 — 跳过
          return;
        }
        Http.latestToken = newToken;
      } finally {
        Http.refreshingFuture = null;
        if (!completer.isCompleted) completer.complete();
      }
    }
    
    // 使用新令牌重试原始请求
    err.requestOptions.headers['Authorization'] = 'Bearer ${Http.tokenCache}';
    err.requestOptions.extra['__retryAfterRefresh__'] = true;
    
    final retryResponse = await Http.dio.fetch(err.requestOptions);
    handler.resolve(retryResponse);
  } catch (e) {
    // 刷新失败 — 重定向到登录
    Http.performLogout();
    handler.reject(err);
  }
}
```

### 竞态条件保护

| 保护机制 | 实现方式 |
|------------|-----------|
| **Completer 单飞** | `Http.refreshingFuture` — 并发的调用者等待相同的 Completer |
| **`__retryAfterRefresh__` 标志** | 防止重试也返回 401 时陷入无限重试循环 |
| **`latestToken` 比较** | 检测另一个刷新是否已完成并更新了令牌 |
| **`navigatingToLogin` 守卫** | 防止多次同时导航到登录页 |

### 令牌刷新流程

```
多个 401 同时到达
         │
         ▼
┌─────────────────────────────────────┐
│  请求 A 首先到达                      │
│  → 检查 refreshingFuture（null）     │
│  → 创建 Completer                    │
│  → 设置 Http.refreshingFuture        │
│  → 调用 tryRefreshToken()            │
└─────────────────────────────────────┘
         │
         ▼ (刷新进行中)
┌─────────────────────────────────────┐
│  请求 B、C、D 到达                    │
│  → 检查 refreshingFuture（存在）      │
│  → 等待相同的 Completer               │
│  → 等待刷新完成                       │
└─────────────────────────────────────┘
         │
         ▼ (刷新完成)
┌─────────────────────────────────────┐
│  所有 4 个请求使用新令牌并行重试       │
│  → __retryAfterRefresh__ = true      │
│  → 如果仍有 401，不再重试              │
└─────────────────────────────────────┘
```

---

## 4. 服务器时间校准

每个响应（成功或错误）都会通过 `x-server-time` 头触发服务器时间校准：

```dart
ServerTimeHelper.updateOffset(err.response?.headers.value('x-server-time'));
ServerTimeHelper.updateOffset(response.headers.value('x-server-time'));
```

这会更新 [`ServerTimeHelper`](JoyMini_Flutter_App/lib/utils/time/server_time_helper.dart) 使用的本地时钟偏移量，这对于以下功能至关重要：

- **倒计时器** — 与服务器的绝对时间同步
- **KYC 会话过期** — 无论设备时钟漂移如何，超时时间一致
- **事件时序** — 准确显示服务器端时间戳

---

## 5. 僵尸回调保护

对于长期存在的拦截器，一个关键问题是回调在 widget/页面被销毁后触发：

```dart
// 在 GlobalHandler 或消费 widget 中
UnifiedInterceptor.onTokenInvalid = () {
  if (!mounted) return;  // 僵尸守卫
  // 处理令牌失效
};

UnifiedInterceptor.onTokenRefresh = (newToken) {
  if (!mounted) return;  // 僵尸守卫
  // 用新令牌更新 UI
};
```

拦截器本身不持有 widget 引用——相反，它暴露静态回调槽位（`onTokenInvalid`、`onTokenRefresh`），widget 可以注册到这些槽位中。这些槽位在启动引导期间在 [`AppBootstrap.setupInterceptors()`](JoyMini_Flutter_App/lib/app/bootstrap.dart) 中设置。

---

## 6. 与系统其他部分的集成

```
Http（静态类）
  ├─ _dio（主 Dio）←── UnifiedInterceptor
  │   ├─ 头信息注入（设备指纹）
  │   ├─ 错误策略分发
  │   └─ 单飞刷新
  │
  ├─ _rawDio（刷新专用）←── 无拦截器
  │   └─ 用于令牌刷新本身
  │      （防止无限拦截器循环）
  │
  ├─ tokenCache / refreshingFuture / navigatingToLogin
  │   └─ 与拦截器共享的公开静态状态
  │
  └─ tryRefreshToken() / performLogout()
      └─ 由拦截器调用的桥接方法
```

双 Dio 架构（参见 [Http 静态类 + 双 Dio + Native Adapter](http-static-class-dual-dio-native-adapter.md)）确保刷新请求本身不会触发拦截器的 401 处理器，防止无限递归。

---

## 关键要点

1. **`QueuedInterceptor`** 确保请求顺序——对单飞刷新模式正确工作至关重要。
2. **5 种错误策略**（`success` / `refresh` / `redirect` / `security` / `toast`）处理从成功解包到安全锁定的完整 API 响应谱系。
3. **单飞令牌刷新**使用 `Completer` 模式——并发的 401 请求共享一个刷新请求，然后全部使用新令牌并行重试。
4. **三重竞态保护**（`__retryAfterRefresh__` 标志、`latestToken` 比较、`navigatingToLogin` 守卫）防止无限循环和重复导航。
5. **每个请求的设备指纹注入**使后端风险控制无需修改每个 API 端点。
6. **每个响应中的服务器时间校准**通过 `x-server-time` 头信息保持本地时间同步，用于倒计时和过期判断。
7. **通过 `mounted` 检查实现的僵尸回调保护**防止页面销毁后的回调导致崩溃。
