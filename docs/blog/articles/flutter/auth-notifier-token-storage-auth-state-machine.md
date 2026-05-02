# AuthNotifier + TokenStorage：Flutter 认证状态机

> **读者对象：** Flutter 移动端工程师  
> **标签：** `#Flutter` `#Auth` `#StateManagement` `#Token` `#ChangeNotifier`  
> **难度：** 中级  
> **预估阅读时间：** ~20 分钟

---

## 1. 概述

移动端认证面临独特的挑战：令牌必须在应用重启后持久保留、过期时无缝刷新，并且 UI 必须即时响应认证状态变化。本文分析一个 `AuthNotifier` + `TokenStorage` 架构，实现了一个健壮的认证状态机。

| 组件 | 文件 | 角色 |
|-----------|------|------|
| **AuthNotifier** | `auth_notifier.dart` | 管理认证状态转换的 ChangeNotifier |
| **TokenStorage** | `token_storage.dart` | 封装 FlutterSecureStorage 用于持久化令牌 |
| **SecureStorage** | `flutter_secure_storage` | 加密键值存储（Keychain/Keystore） |

---

## 2. 认证状态机

### 2.1 状态

```
┌──────────┐    ┌──────────┐    ┌──────────────┐
│  初始状态  │───→│  检查中   │───→│  已认证       │
└──────────┘    └──────────┘    └──────────────┘
                       │                │
                       │                │
                       ▼                ▼
                ┌──────────┐    ┌──────────────┐
                │  未认证   │    │  Token 过期   │
                └──────────┘    └──────────────┘
                                       │
                                       │ （刷新）
                                       ▼
                                ┌──────────────┐
                                │  刷新中       │──→ 已认证
                                └──────────────┘
```

### 2.2 实现

```dart
enum AuthStatus {
  initial,
  checking,
  authenticated,
  unauthenticated,
  tokenExpired,
  refreshing,
}

class AuthNotifier extends ChangeNotifier {
  AuthStatus _status = AuthStatus.initial;
  User? _user;
  String? _accessToken;
  String? _refreshToken;
  String? _error;

  AuthStatus get status => _status;
  User? get user => _user;
  String? get accessToken => _accessToken;
  String? get error => _error;
  bool get isAuthenticated => _status == AuthStatus.authenticated;
  bool get isLoading => _status == AuthStatus.checking || _status == AuthStatus.refreshing;

  final TokenStorage _tokenStorage;
  final AuthApi _authApi;

  AuthNotifier({
    required TokenStorage tokenStorage,
    required AuthApi authApi,
  })  : _tokenStorage = tokenStorage,
        _authApi = authApi;
}
```

### 2.3 应用启动 — 检查存储的令牌

```dart
Future<void> checkAuthStatus() async {
  _status = AuthStatus.checking;
  notifyListeners();

  try {
    final accessToken = await _tokenStorage.getAccessToken();
    final refreshToken = await _tokenStorage.getRefreshToken();

    if (accessToken == null || refreshToken == null) {
      _status = AuthStatus.unauthenticated;
      notifyListeners();
      return;
    }

    // 尝试刷新令牌以验证存储的令牌
    _accessToken = accessToken;
    _refreshToken = refreshToken;

    final result = await _authApi.refreshToken(refreshToken);
    if (result.isSuccess) {
      _accessToken = result.data!.accessToken;
      _refreshToken = result.data!.refreshToken;
      await _tokenStorage.saveTokens(_accessToken!, _refreshToken!);
      _user = result.data!.user;
      _status = AuthStatus.authenticated;
    } else {
      // 令牌过期且刷新失败
      await _tokenStorage.clearAll();
      _status = AuthStatus.unauthenticated;
    }
  } catch (e) {
    // 启动时网络错误——静默重试
    _status = AuthStatus.unauthenticated;
  }

  notifyListeners();
}
```

### 2.4 登录

```dart
Future<AuthResult> login(String phone, String password) async {
  _status = AuthStatus.checking;
  _error = null;
  notifyListeners();

  try {
    final result = await _authApi.login(phone, password);

    if (result.isSuccess) {
      _accessToken = result.data!.accessToken;
      _refreshToken = result.data!.refreshToken;
      _user = result.data!.user;

      await _tokenStorage.saveTokens(_accessToken!, _refreshToken!);
      await _tokenStorage.saveUser(_user!);

      _status = AuthStatus.authenticated;
      notifyListeners();
      return AuthResult.success();
    } else {
      _status = AuthStatus.unauthenticated;
      _error = result.error;
      notifyListeners();
      return AuthResult.failure(result.error!);
    }
  } catch (e) {
    _status = AuthStatus.unauthenticated;
    _error = '网络错误，请重试。';
    notifyListeners();
    return AuthResult.failure(_error!);
  }
}
```

### 2.5 令牌刷新（由 HTTP 拦截器调用）

```dart
Future<String?> refreshToken() async {
  if (_refreshToken == null) return null;

  // 防止并发刷新调用
  if (_status == AuthStatus.refreshing) {
    // 等待正在进行的刷新完成
    await _refreshCompleter?.future;
    return _accessToken;
  }

  _status = AuthStatus.refreshing;
  _refreshCompleter = Completer<String?>();
  notifyListeners();

  try {
    final result = await _authApi.refreshToken(_refreshToken!);

    if (result.isSuccess) {
      _accessToken = result.data!.accessToken;
      _refreshToken = result.data!.refreshToken;
      await _tokenStorage.saveTokens(_accessToken!, _refreshToken!);
      _status = AuthStatus.authenticated;
      _refreshCompleter!.complete(_accessToken);
      notifyListeners();
      return _accessToken;
    } else {
      // 刷新失败——强制登出
      await logout();
      _refreshCompleter!.complete(null);
      return null;
    }
  } catch (e) {
    _refreshCompleter!.complete(null);
    _status = AuthStatus.tokenExpired;
    notifyListeners();
    return null;
  }
}
```

### 2.6 登出

```dart
Future<void> logout() async {
  try {
    await _authApi.logout();  // 通知服务端使令牌失效
  } catch (_) {
    // 尽力而为；仍然清除本地状态
  }

  await _tokenStorage.clearAll();
  _accessToken = null;
  _refreshToken = null;
  _user = null;
  _status = AuthStatus.unauthenticated;
  _error = null;
  notifyListeners();
}
```

---

## 3. TokenStorage — 安全持久化

### 3.1 实现

```dart
class TokenStorage {
  static const _accessTokenKey = 'access_token';
  static const _refreshTokenKey = 'refresh_token';
  static const _userKey = 'user_data';

  final FlutterSecureStorage _storage;

  TokenStorage(this._storage);

  Future<void> saveTokens(String accessToken, String refreshToken) async {
    await Future.wait([
      _storage.write(key: _accessTokenKey, value: accessToken),
      _storage.write(key: _refreshTokenKey, value: refreshToken),
    ]);
  }

  Future<String?> getAccessToken() async {
    return _storage.read(key: _accessTokenKey);
  }

  Future<String?> getRefreshToken() async {
    return _storage.read(key: _refreshTokenKey);
  }

  Future<void> saveUser(User user) async {
    final json = jsonEncode(user.toJson());
    await _storage.write(key: _userKey, value: json);
  }

  Future<User?> getUser() async {
    final json = await _storage.read(key: _userKey);
    if (json == null) return null;
    return User.fromJson(jsonDecode(json));
  }

  Future<void> clearAll() async {
    await _storage.deleteAll();
  }
}
```

### 3.2 为什么选择 FlutterSecureStorage？

| 特性 | SharedPreferences | FlutterSecureStorage |
|---------|------------------|---------------------|
| 加密 | 否（明文） | Android 上 AES-256，iOS 上 Keychain |
| 生物识别锁 | 否 | 可选（Android） |
| 卸载时清除 | 否 | 是 |
| 性能 | 快速 | 稍慢（加密开销） |
| 用途 | 主题、设置 | **令牌、PII** |

---

## 4. Provider 集成

```dart
// main.dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final storage = FlutterSecureStorage();
  final tokenStorage = TokenStorage(storage);
  final authApi = AuthApi(Http.authDio);
  final authNotifier = AuthNotifier(tokenStorage: tokenStorage, authApi: authApi);

  // 在第一帧之前检查存储的令牌
  await authNotifier.checkAuthStatus();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: authNotifier),
        // ... 其他 provider
      ],
      child: const LuckyApp(),
    ),
  );
}
```

---

## 5. UI 绑定

### 5.1 响应式组件

```dart
class AuthConsumer extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Consumer<AuthNotifier>(
      builder: (context, auth, _) {
        switch (auth.status) {
          case AuthStatus.initial:
          case AuthStatus.checking:
            return const SplashScreen();
          case AuthStatus.authenticated:
            return const MainApp();
          case AuthStatus.unauthenticated:
          case AuthStatus.tokenExpired:
            return const AuthScreen();
          case AuthStatus.refreshing:
            return const RefreshOverlay(child: MainApp());
        }
      },
    );
  }
}
```

### 5.2 登出按钮

```dart
ElevatedButton(
  onPressed: () async {
    await context.read<AuthNotifier>().logout();
    // GoRouter 重定向处理导航到 /login
  },
  child: const Text('登出'),
)
```

---

## 6. 测试

```dart
void main() {
  group('AuthNotifier', () {
    late MockTokenStorage mockStorage;
    late MockAuthApi mockApi;
    late AuthNotifier authNotifier;

    setUp(() {
      mockStorage = MockTokenStorage();
      mockApi = MockAuthApi();
      authNotifier = AuthNotifier(tokenStorage: mockStorage, authApi: mockApi);
    });

    test('初始状态为 initial', () {
      expect(authNotifier.status, AuthStatus.initial);
      expect(authNotifier.isAuthenticated, false);
    });

    test('无存储令牌时应进入未认证状态', () async {
      when(mockStorage.getAccessToken()).thenAnswer((_) async => null);

      await authNotifier.checkAuthStatus();

      expect(authNotifier.status, AuthStatus.unauthenticated);
    });

    test('应成功登录', () async {
      when(mockApi.login('09170000000', 'password')).thenAnswer((_) async =>
        ApiResponse.success(AuthTokens(
          accessToken: 'access',
          refreshToken: 'refresh',
          user: User(id: '1', name: 'Test'),
        )),
      );

      final result = await authNotifier.login('09170000000', 'password');

      expect(result.isSuccess, true);
      expect(authNotifier.isAuthenticated, true);
      expect(authNotifier.accessToken, 'access');
    });
  });
}
```

---

## 7. 安全最佳实践

| 实践 | 实现 |
|----------|---------------|
| **短期访问令牌** | 15 分钟过期；减少令牌被盗的窗口期 |
| **长期刷新令牌** | 30 天过期；每次使用时轮换（原地轮换） |
| **安全存储** | FlutterSecureStorage（Keychain/Keystore） |
| **令牌不在 SharedPreferences 中** | SharedPrefs 是明文；令牌必须加密 |
| **生物识别锁** | 高价值操作（提现）可选 `biometrics: true` |
| **401 时登出** | 如果刷新失败，AuthNotifier 强制登出 |
| **卸载时清除存储** | 应用删除时 FlutterSecureStorage 自动清除 |
| **不记录令牌** | 绝不在发布版本中打印/记录令牌 |

---

## 8. 总结

- **AuthNotifier** 实现了一个 6 状态认证机：`initial → checking → authenticated/unauthenticated → refreshing/tokenExpired`
- **TokenStorage** 封装 `FlutterSecureStorage` 用于加密令牌持久化
- **单次刷新** 防止并发刷新调用，将同时到达的 401 请求排队
- **启动时令牌检查** 在 `runApp()` 之前运行，显示正确的初始屏幕
- **Provider + Consumer 绑定** 使 UI 即时响应认证状态变化
- **最佳实践**：短期访问令牌、安全存储、不记录令牌、敏感操作使用生物识别锁
