---
title: 'Http 静态类：双 Dio + NativeAdapter——三模式请求架构'
description: 深入分析基于静态 Http 类的 Flutter HTTP 客户端架构，包含双 Dio 实例（公开 + 认证）和 NativeAdapter 平台特定传输层，涵盖 Token 管理、错误归一化和测试策略。
slug: http-static-class-dual-dio-native-adapter
tags: Flutter, Dio, HTTP, Networking, Mobile
---

## 1. 概述

移动应用必须在不同环境（开发、测试、生产）下处理网络请求，同时支持 Token 刷新、请求/响应日志、错误处理和缓存控制。本文探讨一种基于静态 **`Http` 类**、**双 Dio 实例**和 **NativeAdapter** 平台特定传输层的 Flutter HTTP 客户端架构。

| 组件 | 职责 |
|------|------|
| **`Http` 静态类** | 类级单例，所有 API 调用的全局入口点 |
| **双 Dio 实例** | 一个 `Dio` 用于公开端点，一个用于认证端点 |
| **NativeAdapter** | 平台特定 HTTP 传输层（Android/iOS 使用 dart:io，支持后台请求） |
| **拦截器** | Token 注入、401 刷新、日志、错误归一化 |

---

## 2. 双 Dio 架构

### 2.1 为什么需要两个实例？

单个 `Dio` 实例配合条件逻辑也能工作，但双实例提供了更清晰的分离：

| 实例 | Base URL | 拦截器 | 使用场景 |
|------|----------|--------|---------|
| `_publicDio` | `https://api.example.com/public` | 日志、缓存 | 文章、横幅、分类 |
| `_authDio` | `https://api.example.com/api` | Token 注入、401 刷新、日志 | 用户资料、钱包、订单 |

```dart
class Http {
  static late final Dio _publicDio;
  static late final Dio _authDio;

  static void init({
    required String publicBaseUrl,
    required String authBaseUrl,
    required Duration connectTimeout,
    required Duration receiveTimeout,
    String Function()? getAccessToken,
    Future<String?> Function()? onTokenRefresh,
  }) {
    _publicDio = _createDio(publicBaseUrl, connectTimeout, receiveTimeout)
      ..interceptors.addAll([
        _createLogInterceptor(),
        _createCacheInterceptor(),
      ]);

    _authDio = _createDio(authBaseUrl, connectTimeout, receiveTimeout)
      ..interceptors.addAll([
        _createAuthInterceptor(getAccessToken!),
        _createRefreshInterceptor(onTokenRefresh!),
        _createLogInterceptor(),
        _createErrorInterceptor(),
      ]);
  }

  static Dio _createDio(String baseUrl, Duration connect, Duration receive) {
    return Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: connect,
      receiveTimeout: receive,
      headers: {'Content-Type': 'application/json'},
    ));
  }
}
```

### 2.2 初始化

在 `main()` 中调用一次，在 `runApp()` 之前：

```dart
void main() {
  Http.init(
    publicBaseUrl: Config.publicApiBaseUrl,
    authBaseUrl: Config.authApiBaseUrl,
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 15),
    getAccessToken: () => TokenStorage.accessToken,
    onTokenRefresh: AuthService.refreshToken,
  );
  runApp(const LuckyApp());
}
```

---

## 3. Auth 拦截器——Token 注入

### 3.1 实现

Auth 拦截器从存储单例中读取当前访问 Token，并将其作为 Bearer Token 注入：

```dart
Interceptor _createAuthInterceptor(String Function() getAccessToken) {
  return InterceptorsWrapper(
    onRequest: (options, handler) {
      final token = getAccessToken();
      if (token != null) {
        options.headers['Authorization'] = 'Bearer $token';
      }
      handler.next(options);
    },
  );
}
```

### 3.2 401 刷新拦截器

当收到 401 响应时，拦截器尝试刷新 Token，然后重试失败的请求：

```dart
Interceptor _createRefreshInterceptor(
  Future<String?> Function() onTokenRefresh,
) {
  final _retryCount = 0;  // Per-request counter

  return InterceptorsWrapper(
    onError: (error, handler) async {
      if (error.response?.statusCode != 401) {
        return handler.next(error);
      }

      // Avoid infinite refresh loops
      if (_isRefreshing) {
        // Queue the request, retry after refresh completes
        _pendingRequests.add(() => handler.resolve(await _retry(error.requestOptions)));
        return;
      }

      _isRefreshing = true;
      try {
        final newToken = await onTokenRefresh();
        if (newToken != null) {
          _isRefreshing = false;
          // Retry all queued requests with the new token
          error.requestOptions.headers['Authorization'] = 'Bearer $newToken';
          handler.resolve(await _retry(error.requestOptions));
        }
      } catch {
        _isRefreshing = false;
        handler.next(error);
      }
    },
  );
}
```

**关键模式：** `_isRefreshing` 标志防止并发刷新调用——如果多个请求同时返回 401，只触发一次刷新，其余请求排队等待刷新完成后重试。

---

## 4. NativeAdapter——平台特定传输

### 4.1 问题

Dio 默认的 `HttpClientAdapter` 在所有平台上都能工作，但 Flutter 中的某些场景需要：

- iOS 上的**后台请求**（NSURLSession background configuration）
- **证书绑定**（Certificate Pinning）用于安全
- **代理配置**用于调试
- **连接保活**调优以优化电池

### 4.2 实现

`NativeAdapter` 封装了平台特定的 HTTP 客户端：

```dart
class NativeAdapter extends HttpClientAdapter {
  final http.Client _client;

  NativeAdapter({Duration? timeout}) 
    : _client = http.Client();  // dart:io HttpClient

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final uri = options.uri;
    final request = http.MultipartRequest(options.method, uri)
      ..headers.addAll(options.headers)
      ..followRedirects = options.followRedirects
      ..maxRedirects = options.maxRedirects;

    if (requestStream != null) {
      request.bodyBytes = await requestStream.toBytes();
    }

    final streamedResponse = await _client.send(request);
    final responseBytes = await streamedResponse.stream.toBytes();

    return ResponseBody.fromBytes(
      responseBytes,
      streamedResponse.statusCode,
      headers: streamedResponse.headers,
    );
  }

  @override
  void close() => _client.close();
}
```

### 4.3 在 Dio 中使用 NativeAdapter

```dart
static Dio _createDio(/* ... */) {
  final dio = Dio(BaseOptions(/* ... */));
  
  // Use NativeAdapter for platform-specific features
  dio.httpClientAdapter = NativeAdapter(
    timeout: const Duration(seconds: 30),
  );
  
  return dio;
}
```

---

## 5. 公开 API 方法

`Http` 静态类暴露类型安全、简洁的方法：

```dart
// GET
static Future<ApiResponse<T>> get<T>(
  String path, {
  Map<String, dynamic>? queryParams,
  bool authenticated = false,
  T Function(dynamic json)? fromJson,
}) async {
  final dio = authenticated ? _authDio : _publicDio;
  try {
    final response = await dio.get(
      path,
      queryParameters: queryParams,
    );
    return _handleResponse<T>(response, fromJson);
  } on DioException catch (e) {
    return _handleError<T>(e);
  }
}

// POST
static Future<ApiResponse<T>> post<T>(
  String path, {
  dynamic data,
  bool authenticated = false,
  T Function(dynamic json)? fromJson,
}) async {
  final dio = authenticated ? _authDio : _publicDio;
  try {
    final response = await dio.post(path, data: data);
    return _handleResponse<T>(response, fromJson);
  } on DioException catch (e) {
    return _handleError<T>(e);
  }
}

// PUT, PATCH, DELETE — same pattern
```

### 5.1 响应处理

```dart
static ApiResponse<T> _handleResponse<T>(
  Response<dynamic> response,
  T Function(dynamic)? fromJson,
) {
  final body = response.data;

  // Standard API envelope format: { code, message, data }
  if (body is Map && body.containsKey('code') && body.containsKey('data')) {
    if (body['code'] != 0) {
      return ApiResponse.error(body['message'] ?? 'Unknown error');
    }
    final data = body['data'];
    if (fromJson != null && data != null) {
      return ApiResponse.success(fromJson(data));
    }
    return ApiResponse.success(data as T);
  }

  // Non-envelope response
  if (fromJson != null) {
    return ApiResponse.success(fromJson(body));
  }
  return ApiResponse.success(body as T);
}
```

---

## 6. 错误归一化

所有错误——网络故障、超时、服务器错误、业务错误——都被归一化为统一的 `ApiResponse` 类型：

```dart
class ApiResponse<T> {
  final T? data;
  final String? error;
  final bool isSuccess;

  ApiResponse.success(this.data)
    : error = null,
      isSuccess = true;

  ApiResponse.error(this.error)
    : data = null,
      isSuccess = false;
}
```

```dart
static ApiResponse<T> _handleError<T>(DioException e) {
  switch (e.type) {
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
      return ApiResponse.error('Connection timed out. Please check your network.');
    case DioExceptionType.connectionError:
      return ApiResponse.error('No network connection.');
    case DioExceptionType.badResponse:
      final statusCode = e.response?.statusCode;
      final message = e.response?.data?['message'] ?? _httpStatusMessage(statusCode);
      return ApiResponse.error(message);
    case DioExceptionType.cancel:
      return ApiResponse.error('Request cancelled.');
    default:
      return ApiResponse.error('An unexpected error occurred.');
  }
}

static String _httpStatusMessage(int? code) {
  switch (code) {
    case 400: return 'Invalid request.';
    case 401: return 'Session expired, please log in again.';
    case 403: return 'Access denied.';
    case 404: return 'Resource not found.';
    case 500: return 'Server error, please try again later.';
    default: return 'Error ($code), please retry.';
  }
}
```

---

## 7. 使用示例

### 7.1 公开端点（无需认证）

```dart
final response = await Http.get<List<Article>>(
  '/articles',
  queryParams: {'page': '1', 'limit': '20'},
  fromJson: (json) => (json as List).map((e) => Article.fromJson(e)).toList(),
);

if (response.isSuccess) {
  setState(() => articles = response.data!);
} else {
  showSnackBar(response.error!);
}
```

### 7.2 认证端点

```dart
final response = await Http.post<Order>(
  '/orders',
  data: orderData.toJson(),
  authenticated: true,
  fromJson: (json) => Order.fromJson(json),
);
```

### 7.3 文件上传

```dart
static Future<ApiResponse<String>> uploadFile(File file) async {
  final formData = FormData.fromMap({
    'file': await MultipartFile.fromFile(file.path, filename: file.name),
  });
  try {
    final response = await _authDio.post('/upload', data: formData);
    return _handleResponse<String>(response, (json) => json['url'] as String);
  } on DioException catch (e) {
    return _handleError(e);
  }
}
```

---

## 8. 测试策略

### 8.1 Mock Dio

```dart
@GenerateMocks([Dio])
void main() {
  group('Http.get', () {
    test('should return data on success', () async {
      when(mockDio.get('/test')).thenAnswer((_) async => Response(
        data: {'code': 0, 'data': 'hello'},
        statusCode: 200,
        requestOptions: RequestOptions(path: '/test'),
      ));

      final result = await Http.get<String>('/test');
      expect(result.isSuccess, true);
      expect(result.data, 'hello');
    });

    test('should return error on network failure', () async {
      when(mockDio.get('/test')).thenThrow(DioException(
        type: DioExceptionType.connectionError,
        requestOptions: RequestOptions(path: '/test'),
      ));

      final result = await Http.get<String>('/test');
      expect(result.isSuccess, false);
      expect(result.error, contains('No network connection'));
    });
  });
}
```

### 8.2 Token 刷新集成测试

```dart
test('should refresh token and retry on 401', () async {
  final refreshCalled = false;
  Http.init(
    publicBaseUrl: 'https://api.test.com',
    authBaseUrl: 'https://api.test.com',
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 10),
    getAccessToken: () => 'expired-token',
    onTokenRefresh: () async {
      refreshCalled = true;
      return 'new-token';
    },
  );

  // First call returns 401, refresh succeeds, second call succeeds
  // ...
  expect(refreshCalled, true);
});
```

---

## 9. 生产就绪检查清单

- [ ] **证书绑定**——使用 `NativeAdapter` 配合 `SecurityContext` 实现证书绑定，防范 MITM 攻击
- [ ] **重试策略**——添加重试拦截器（例如，对幂等 GET 请求进行 3 次指数退避重试）
- [ ] **超时调优**——WiFi `connectTimeout: 15s`，移动数据 `connectTimeout: 30s`；根据用户网络质量调整
- [ ] **日志**——调试模式启用详细日志；发布版本禁用，避免泄露敏感数据
- [ ] **缓存支持**——使用 `dio_cache_interceptor` 包为公开 GET 请求添加 `CacheInterceptor`
- [ ] **后台请求**——在 iOS 上，为需要在应用进入后台后继续的上传/下载配置 `HttpClientAdapter` 的 `backgroundSessionConfiguration`
- [ ] **错误追踪**——将 `DioException` 发送到 Sentry/Crashlytics，附带请求详情（路径、方法、状态码）用于调试

---

## 10. 总结

1. **关注点分离**——公开端点和认证端点拥有独立的拦截器和 Base URL。
2. **自动 Token 管理**——401 拦截器使用单飞模式透明地处理 Token 刷新。
3. **原生平台传输**——`NativeAdapter` 支持证书绑定、后台请求和代理配置。
4. **统一错误处理**——所有错误归一化为 `ApiResponse<T>`，提供用户友好的错误消息。
5. **简洁的 API**——带泛型的静态方法保持调用点整洁且类型安全。
