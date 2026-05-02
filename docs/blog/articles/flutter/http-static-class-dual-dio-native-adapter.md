---
title: "Http Static Class: Dual Dio + NativeAdapter — Three-Mode Request Architecture"
description: "Analysis of a Flutter HTTP client architecture based on a static Http class with dual Dio instances (public + authenticated) and a NativeAdapter for platform-specific transport, covering token management, error normalization, and testing."
slug: http-static-class-dual-dio-native-adapter
tags: [Flutter, Dio, HTTP, Networking, Mobile]
---

## 1. Overview

Mobile applications must handle network requests across different environments (development, test, production) while supporting token refresh, request/response logging, error handling, and cache control. This article explores a Flutter HTTP client architecture based on a static **`Http` class**, **dual Dio instances**, and a **NativeAdapter** for platform-specific transport.

| Component | Role |
|-----------|------|
| **`Http` Static Class** | Class-level singleton global entry point for all API calls |
| **Dual Dio Instances** | One `Dio` for public endpoints, one for authenticated endpoints |
| **NativeAdapter** | Platform-specific HTTP transport layer (Android/iOS using dart:io, supports background requests) |
| **Interceptors** | Token injection, 401 refresh, logging, error normalization |

---

## 2. Dual Dio Architecture

### 2.1 Why Two Instances?

A single `Dio` instance with conditional logic would work, but dual instances provide cleaner separation:

| Instance | Base URL | Interceptors | Use Cases |
|----------|----------|--------------|----------|
| `_publicDio` | `https://api.example.com/public` | Logging, caching | Articles, banners, categories |
| `_authDio` | `https://api.example.com/api` | Token injection, 401 refresh, logging | User profile, wallet, orders |

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

### 2.2 Initialization

Called once in `main()`, before `runApp()`:

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

## 3. Auth Interceptor — Token Injection

### 3.1 Implementation

The auth interceptor reads the current access token from the storage singleton and injects it as a Bearer token:

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

### 3.2 401 Refresh Interceptor

When a 401 response occurs, the interceptor attempts to refresh the token, then retries the failed request:

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

**Key Pattern:** The `_isRefreshing` flag prevents concurrent refresh calls — if multiple requests return 401 simultaneously, only one refresh is triggered, and the rest queue up to retry after the refresh completes.

---

## 4. NativeAdapter — Platform-Specific Transport

### 4.1 The Problem

Dio's default `HttpClientAdapter` works on all platforms, but some scenarios in Flutter require:

- **Background requests** on iOS (NSURLSession background configuration)
- **Certificate pinning** for security
- **Proxy configuration** for debugging
- **Connection keep-alive** tuning for battery optimization

### 4.2 Implementation

`NativeAdapter` wraps the platform-specific HTTP client:

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

### 4.3 Using NativeAdapter with Dio

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

## 5. Public API Methods

The `Http` static class exposes type-safe, concise methods:

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

### 5.1 Response Handling

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

## 6. Error Normalization

All errors — network failures, timeouts, server errors, business errors — are normalized into a single `ApiResponse` type:

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

## 7. Usage Examples

### 7.1 Public Endpoint (No Auth Required)

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

### 7.2 Authenticated Endpoint

```dart
final response = await Http.post<Order>(
  '/orders',
  data: orderData.toJson(),
  authenticated: true,
  fromJson: (json) => Order.fromJson(json),
);
```

### 7.3 File Upload

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

## 8. Testing Strategy

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

### 8.2 Token Refresh Integration Test

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

## 9. Production Readiness Checklist

- [ ] **Certificate Pinning** — Use `NativeAdapter` with `SecurityContext` for certificate pinning against MITM attacks
- [ ] **Retry Strategy** — Add retry interceptor (e.g., 3 exponential backoff retries for idempotent GET requests)
- [ ] **Timeout Tuning** — WiFi `connectTimeout: 15s`, Mobile data `connectTimeout: 30s`; adjust based on user network quality
- [ ] **Logging** — Enable verbose logging in debug mode; disable in release builds to avoid leaking sensitive data
- [ ] **Cache Support** — Add `CacheInterceptor` using `dio_cache_interceptor` package for public GET requests
- [ ] **Background Requests** — On iOS, configure `HttpClientAdapter` with `backgroundSessionConfiguration` for uploads/downloads that need to continue after app backgrounding
- [ ] **Error Tracking** — Send `DioException` to Sentry/Crashlytics with request details (path, method, status code) for debugging

---

## 10. Summary

The `Http` static class with dual Dio instances provides:

- **Separation of Concerns** — Public and authenticated endpoints have independent interceptors and base URLs
- **Automatic Token Management** — 401 interceptor handles refresh transparently using the single-flight pattern
- **Native Platform Transport** — `NativeAdapter` supports certificate pinning, background requests, and proxy configuration
- **Unified Error Handling** — All errors normalized into `ApiResponse<T>` with user-friendly messages
- **Concise API** — Static methods with generics keep call sites clean and type-safe
