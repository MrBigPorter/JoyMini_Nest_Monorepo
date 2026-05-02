---
title: "AuthNotifier + TokenStorage: Flutter Authentication State Machine"
slug: auth-notifier-token-storage-auth-state-machine
tags: Flutter, Auth, StateManagement, Token, ChangeNotifier
description: Implements a robust authentication state machine using AuthNotifier and TokenStorage in Flutter, covering login, token refresh, secure storage, Provider integration, and security best practices.
---

# AuthNotifier + TokenStorage: Flutter Authentication State Machine

## 1. Overview

Mobile authentication faces unique challenges: tokens must persist across app restarts, seamlessly refresh on expiry, and the UI must react instantly to auth state changes. This article analyzes an `AuthNotifier` + `TokenStorage` architecture that implements a robust authentication state machine.

| Component | File | Role |
|-----------|------|------|
| **AuthNotifier** | `auth_notifier.dart` | ChangeNotifier managing auth state transitions |
| **TokenStorage** | `token_storage.dart` | Wraps FlutterSecureStorage for token persistence |
| **SecureStorage** | `flutter_secure_storage` | Encrypted key-value store (Keychain/Keystore) |

---

## 2. Authentication State Machine

### 2.1 States

```
┌──────────┐    ┌──────────┐    ┌────────────────┐
│  Initial  │───→│ Checking  │───→│  Authenticated  │
└──────────┘    └──────────┘    └────────────────┘
                       │                │
                       │                │
                       ▼                ▼
                ┌──────────┐    ┌────────────────┐
                │Unauth'd  │    │ Token Expired   │
                └──────────┘    └────────────────┘
                                       │
                                       │ (Refresh)
                                       ▼
                                ┌──────────────┐
                                │  Refreshing   │──→ Authenticated
                                └──────────────┘
```

### 2.2 Implementation

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

### 2.3 App Startup — Check Stored Tokens

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

    // Attempt to refresh token to validate stored tokens
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
      // Token expired and refresh failed
      await _tokenStorage.clearAll();
      _status = AuthStatus.unauthenticated;
    }
  } catch (e) {
    // Network error on startup — silently retry
    _status = AuthStatus.unauthenticated;
  }

  notifyListeners();
}
```

### 2.4 Login

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
    _error = 'Network error, please try again.';
    notifyListeners();
    return AuthResult.failure(_error!);
  }
}
```

### 2.5 Token Refresh (Called by HTTP Interceptor)

```dart
Future<String?> refreshToken() async {
  if (_refreshToken == null) return null;

  // Prevent concurrent refresh calls
  if (_status == AuthStatus.refreshing) {
    // Wait for the ongoing refresh to complete
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
      // Refresh failed — force logout
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

### 2.6 Logout

```dart
Future<void> logout() async {
  try {
    await _authApi.logout();  // Notify server to invalidate tokens
  } catch (_) {
    // Best effort; still clear local state
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

## 3. TokenStorage — Secure Persistence

### 3.1 Implementation

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

### 3.2 Why FlutterSecureStorage?

| Feature | SharedPreferences | FlutterSecureStorage |
|---------|------------------|---------------------|
| Encryption | No (plaintext) | AES-256 on Android, Keychain on iOS |
| Biometric Lock | No | Optional (Android) |
| Cleared on Uninstall | No | Yes |
| Performance | Fast | Slower (encryption overhead) |
| Use Case | Theme, settings | **Tokens, PII** |

---

## 4. Provider Integration

```dart
// main.dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final storage = FlutterSecureStorage();
  final tokenStorage = TokenStorage(storage);
  final authApi = AuthApi(Http.authDio);
  final authNotifier = AuthNotifier(tokenStorage: tokenStorage, authApi: authApi);

  // Check stored tokens before the first frame
  await authNotifier.checkAuthStatus();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: authNotifier),
        // ... other providers
      ],
      child: const LuckyApp(),
    ),
  );
}
```

---

## 5. UI Binding

### 5.1 Reactive Components

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

### 5.2 Logout Button

```dart
ElevatedButton(
  onPressed: () async {
    await context.read<AuthNotifier>().logout();
    // GoRouter redirect handles navigation to /login
  },
  child: const Text('Logout'),
)
```

---

## 6. Testing

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

    test('initial state is initial', () {
      expect(authNotifier.status, AuthStatus.initial);
      expect(authNotifier.isAuthenticated, false);
    });

    test('should be unauthenticated when no stored tokens', () async {
      when(mockStorage.getAccessToken()).thenAnswer((_) async => null);

      await authNotifier.checkAuthStatus();

      expect(authNotifier.status, AuthStatus.unauthenticated);
    });

    test('should login successfully', () async {
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

## 7. Security Best Practices

| Practice | Implementation |
|----------|---------------|
| **Short-lived access tokens** | 15-minute expiry; reduces token theft window |
| **Long-lived refresh tokens** | 30-day expiry; rotated on each use (rotation in-place) |
| **Secure storage** | FlutterSecureStorage (Keychain/Keystore) |
| **No tokens in SharedPreferences** | SharedPrefs is plaintext; tokens must be encrypted |
| **Biometric lock** | Optional `biometrics: true` for high-value operations (withdrawal) |
| **Logout on 401** | AuthNotifier forces logout if refresh fails |
| **Clear storage on uninstall** | FlutterSecureStorage auto-clears on app deletion |
| **Never log tokens** | Never print/log tokens in release builds |

---

## 8. Summary

- **AuthNotifier** implements a 6-state auth machine: `initial → checking → authenticated/unauthenticated → refreshing/tokenExpired`
- **TokenStorage** wraps `FlutterSecureStorage` for encrypted token persistence
- **Single refresh** prevents concurrent refresh calls, queuing simultaneous 401 requests
- **Startup token check** runs before `runApp()`, displaying the correct initial screen
- **Provider + Consumer binding** makes UI react instantly to auth state changes
- **Best practices**: short-lived access tokens, secure storage, never log tokens, biometric lock for sensitive operations
