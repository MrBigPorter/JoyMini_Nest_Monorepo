# Deep Link OAuth + GlobalOAuthHandler — 统一认证入口架构

> **Article F8** | **Difficulty:** ⭐⭐⭐⭐ | **Source:** `joy_mini_app/lib/core/deep_link/`, `joy_mini_app/lib/core/oauth/`

## 1. 问题空间

移动应用面临两种外部入口的认证需求：

| 入口类型 | 示例 | 挑战 |
|----------|------|------|
| **Deep Link** | `joymini://payment?orderId=xxx` | 用户可能未登录，需登录后继续 |
| **Universal Link** | `https://joymini.app/oauth/callback` | 跨应用跳转，状态保持 |
| **OAuth 回调** | Google/Facebook/Apple 登录返回 | 多 provider 统一处理 |

**GlobalOAuthHandler** 将这些入口统一为一个抽象层：

```
[External Link]
      ↓
DeepLinkParser.parse(url)
      ↓
RouteIdentifier.identify(parsed)
      ↓
AuthGuard.check(route)
  ├── 已登录 → GlobalOAuthHandler.handle(route)
  └── 未登录 → AuthNotifier → login → GlobalOAuthHandler.handle(route)
```

## 2. Deep Link 解析引擎

### 2.1 URL 解析

```dart
class DeepLinkParser {
  static DeepLinkResult? parse(Uri uri) {
    // 自定义 scheme: joymini://path?params
    if (uri.scheme == 'joymini') {
      return _parseCustomScheme(uri);
    }

    // Universal Link: https://joymini.app/path
    if (uri.host == 'joymini.app') {
      return _parseUniversalLink(uri);
    }

    // Firebase Dynamic Link
    if (uri.queryParameters.containsKey('deep_link_id')) {
      return _parseDynamicLink(uri);
    }

    return null;
  }

  static DeepLinkResult? _parseCustomScheme(Uri uri) {
    final path = uri.path; // e.g., /payment, /oauth/callback
    final params = uri.queryParameters;

    return DeepLinkResult(
      source: DeepLinkSource.customScheme,
      route: path,
      params: params,
      raw: uri,
    );
  }

  static DeepLinkResult? _parseUniversalLink(Uri uri) {
    // /api/oauth/callback?provider=google&code=xxx
    final segments = uri.pathSegments;
    if (segments.length >= 3 &&
        segments[0] == 'api' &&
        segments[1] == 'oauth') {
      return DeepLinkResult(
        source: DeepLinkSource.universalLink,
        route: '/oauth/${segments[2]}',
        params: uri.queryParameters,
        raw: uri,
      );
    }
    return null;
  }
}
```

### 2.2 DeepLinkResult 模型

```dart
class DeepLinkResult {
  final DeepLinkSource source;
  final String route;
  final Map<String, String> params;
  final Uri raw;

  const DeepLinkResult({
    required this.source,
    required this.route,
    required this.params,
    required this.raw,
  });

  /// 是否需要认证
  bool get requiresAuth => switch (route) {
    '/payment'        => true,
    '/profile'        => true,
    '/group/:id'      => true,
    '/oauth/callback' => false, // OAuth 本身就是认证
    _                 => false,
  };

  /// 从 params 中安全读取参数
  T? param<T>(String key) {
    final value = params[key];
    if (value == null) return null;
    return switch (T) {
      int => int.tryParse(value) as T?,
      String => value as T?,
      _ => value as T?,
    };
  }
}
```

## 3. GlobalOAuthHandler — 统一处理中心

### 3.1 架构设计

```dart
class GlobalOAuthHandler {
  final DeepLinkParser _parser;
  final RouteIdentifier _router;
  final AuthNotifier _authNotifier;
  final GoRouter _goRouter;
  final Logger _logger = Logger('OAuthHandler');

  GlobalOAuthHandler({
    required DeepLinkParser parser,
    required RouteIdentifier router,
    required AuthNotifier authNotifier,
    required GoRouter goRouter,
  })  : _parser = parser,
        _router = router,
        _authNotifier = authNotifier,
        _goRouter = goRouter;

  /// 处理 incoming link（从 AppDelegate / WidgetsBinding 调用）
  Future<void> handleIncomingLink(Uri uri) async {
    _logger.info('[OAuthHandler] Incoming: $uri');

    final parsed = _parser.parse(uri);
    if (parsed == null) {
      _logger.warning('[OAuthHandler] Unrecognized URI: $uri');
      return;
    }

    final route = _router.identify(parsed);
    if (route == null) {
      _logger.warning('[OAuthHandler] No matching route: ${parsed.route}');
      return;
    }

    // 认证检查
    if (parsed.requiresAuth && !_authNotifier.isAuthenticated) {
      _logger.info('[OAuthHandler] Auth required, deferring until login');
      await _authNotifier.deferUntilAuthenticated(
        onAuthenticated: () => _navigate(route, parsed),
      );
      return;
    }

    await _navigate(route, parsed);
  }

  Future<void> _navigate(
    IdentifiedRoute route,
    DeepLinkResult link,
  ) async {
    // 构建 GoRouter location
    final location = route.buildLocation(link.params);
    await _goRouter.push(location);
  }
}
```

### 3.2 路由识别器

```dart
class RouteIdentifier {
  final Map<String, RouteTemplate> _templates = {
    '/payment': RouteTemplate(
      path: '/payment',
      requiredParams: ['orderId'],
      optionalParams: ['promoCode'],
    ),
    '/oauth/callback': RouteTemplate(
      path: '/oauth/callback',
      requiredParams: ['provider', 'code'],
    ),
    '/group/:id': RouteTemplate(
      path: '/group/:id',
      dynamicSegments: {'id': true},
    ),
    '/profile': RouteTemplate(
      path: '/profile',
      requiredParams: [],
    ),
    '/promotion': RouteTemplate(
      path: '/promotion',
      requiredParams: ['campaignId'],
    ),
  };

  IdentifiedRoute? identify(DeepLinkResult link) {
    final path = link.route;
    final params = link.params;

    // 静态路由匹配
    if (_templates.containsKey(path)) {
      final template = _templates[path]!;
      final missing = template.requiredParams
          .where((k) => !params.containsKey(k))
          .toList();
      if (missing.isNotEmpty) {
        _logger.warning('[RouteIdentifier] Missing params: $missing for $path');
        return null;
      }
      return IdentifiedRoute(
        template: template,
        params: params,
      );
    }

    // 动态路由匹配 (/group/:id → /group/42)
    for (final entry in _templates.entries) {
      if (entry.value.matches(path, params)) {
        return IdentifiedRoute(
          template: entry.value,
          params: params,
        );
      }
    }

    return null;
  }
}
```

### 3.3 延迟认证恢复

当 deep link 需要认证但用户未登录时，需要"记住"目标路由，登录后自动跳转：

```dart
class AuthNotifier {
  Completer<IdentifiedRoute>? _pendingRoute;

  /// 注册延迟路由，认证完成后自动导航
  Future<void> deferUntilAuthenticated({
    required VoidCallback onAuthenticated,
  }) {
    final completer = Completer<void>();
    _pendingRoute = Completer<IdentifiedRoute>();

    // 触发登录流程
    _navigateToLogin();

    return completer.future;
  }

  /// 认证完成后调用
  Future<void> _onAuthenticated() async {
    if (_pendingRoute != null) {
      final route = await _pendingRoute!.future;
      await _globalOAuthHandler.navigateToRoute(route);
      _pendingRoute = null;
    }
  }
}
```

## 4. OAuth Provider 统一层

### 4.1 AbstractOAuthProvider

```dart
abstract class OAuthProvider {
  String get name;

  Future<OAuthResult> signIn();
  Future<void> signOut();
  Future<bool> isSignedIn();
}

class OAuthResult {
  final String provider;
  final String accessToken;
  final String? idToken;
  final String? refreshToken;
  final Map<String, dynamic> userInfo;

  const OAuthResult({...});
}
```

### 4.2 各 Provider 实现

```dart
class GoogleOAuthProvider extends OAuthProvider {
  @override
  String get name => 'google';

  @override
  Future<OAuthResult> signIn() async {
    final googleUser = await GoogleSignIn().signIn();
    final googleAuth = await googleUser!.authentication;

    return OAuthResult(
      provider: 'google',
      accessToken: googleAuth.accessToken!,
      idToken: googleAuth.idToken,
      userInfo: {
        'email': googleUser.email,
        'name': googleUser.displayName,
        'photo': googleUser.photoUrl,
      },
    );
  }
}

class AppleOAuthProvider extends OAuthProvider {
  @override
  String get name => 'apple';

  @override
  Future<OAuthResult> signIn() async {
    final credential = await SignInWithApple.getAppleIDCredential(
      scopes: [
        AppleIDAuthorizationScopes.email,
        AppleIDAuthorizationScopes.fullName,
      ],
    );

    return OAuthResult(
      provider: 'apple',
      accessToken: credential.authorizationCode,
      idToken: credential.identityToken,
      userInfo: {
        'email': credential.email,
        'givenName': credential.givenName,
        'familyName': credential.familyName,
      },
    );
  }
}

class FacebookOAuthProvider extends OAuthProvider {
  @override
  String get name => 'facebook';

  @override
  Future<OAuthResult> signIn() async {
    final result = await FacebookAuth.instance.login(
      permissions: ['public_profile', 'email'],
    );

    return OAuthResult(
      provider: 'facebook',
      accessToken: result.accessToken!.tokenString,
      userInfo: {
        'userId': result.accessToken!.userId,
      },
    );
  }
}
```

### 4.3 Provider 注册中心

```dart
class OAuthProviderRegistry {
  final Map<String, OAuthProvider> _providers = {};

  void register(OAuthProvider provider) {
    _providers[provider.name] = provider;
  }

  OAuthProvider? get(String name) => _providers[name];

  Future<OAuthResult> signInWith(String provider) async {
    final p = _providers[provider];
    if (p == null) throw UnsupportedProviderException(provider);
    return p.signIn();
  }
}
```

## 5. 平台集成

### 5.1 iOS — AppDelegate

```dart
// AppDelegate.swift
@main
class AppDelegate: FlutterAppDelegate {
  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    // 将 URL 传递给 Flutter
    if let controller = window?.rootViewController as? FlutterViewController {
      let channel = FlutterMethodChannel(
        name: "com.joymini/deeplink",
        binaryMessenger: controller.binaryMessenger
      )
      channel.invokeMethod("handleLink", arguments: url.absoluteString)
    }
    return super.application(app, open: url, options: options)
  }
}
```

### 5.2 Android — Activity

```kotlin
class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val data = intent?.data?.toString() ?: return
        MethodChannel(
            flutterEngine?.dartExecutor?.binaryMessenger,
            "com.joymini/deeplink"
        ).invokeMethod("handleLink", data)
    }
}
```

### 5.3 Flutter 侧接收

```dart
class DeepLinkPlatformBridge {
  static const _channel = MethodChannel('com.joymini/deeplink');

  static void init(GlobalOAuthHandler handler) {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'handleLink') {
        final uri = Uri.parse(call.arguments as String);
        await handler.handleIncomingLink(uri);
      }
    });
  }
}
```

## 6. 安全考量

### 6.1 State 参数防 CSRF

```dart
class OAuthStateManager {
  /// 生成一次性 state token
  String generateState() {
    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    return base64UrlEncode(bytes);
  }

  /// 验证回调中的 state 是否匹配
  bool validateState(String receivedState) {
    final stored = _storage.getString('oauth_state');
    _storage.remove('oauth_state'); // 一次性使用
    return stored == receivedState;
  }
}
```

### 6.2 PKCE (Proof Key for Code Exchange)

```dart
class PkceHelper {
  static Future<PkcePair> generate() async {
    final verifier = _generateCodeVerifier();
    final challenge = await _generateCodeChallenge(verifier);
    return PkcePair(verifier: verifier, challenge: challenge);
  }

  static String _generateCodeVerifier() {
    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    return base64Url.encode(bytes)
        .replaceAll('=', '')
        .replaceAll('+', '-')
        .replaceAll('/', '_');
  }

  static Future<String> _generateCodeChallenge(String verifier) async {
    final bytes = utf8.encode(verifier);
    final digest = await sha256.hash(bytes);
    return base64Url.encode(digest)
        .replaceAll('=', '')
        .replaceAll('+', '-')
        .replaceAll('/', '_');
  }
}
```

## 7. 完整数据流

```
User taps "Payment" in email
         ↓
mailto:joymini://payment?orderId=ABC123
         ↓
iOS/Android system → AppDelegate/MainActivity
         ↓
MethodChannel('com.joymini/deeplink')
         ↓
DeepLinkPlatformBridge
         ↓
GlobalOAuthHandler.handleIncomingLink(uri)
         ↓
DeepLinkParser.parse(uri)
  → source: customScheme
  → route: /payment
  → params: {orderId: ABC123}
         ↓
RouteIdentifier.identify(parsed)
  → match: /payment template
  → requiredParams: [orderId] ✓
         ↓
AuthGuard.check(route)
  ├── AuthNotifier.isAuthenticated?
  │   ├── YES → GoRouter.push('/payment?orderId=ABC123')
  │   └── NO  → AuthNotifier.deferUntilAuthenticated()
  │               → LoginPage
  │               → User signs in
  │               → GoRouter.push('/payment?orderId=ABC123')
```

## 8. 测试策略

```dart
void main() {
  group('DeepLinkParser', () {
    test('parses custom scheme', () {
      final uri = Uri.parse('joymini://payment?orderId=123');
      final result = DeepLinkParser.parse(uri);
      expect(result?.route, '/payment');
      expect(result?.param<String>('orderId'), '123');
    });

    test('parses universal link', () {
      final uri = Uri.parse('https://joymini.app/api/oauth/callback'
          '?provider=google&code=abc');
      final result = DeepLinkParser.parse(uri);
      expect(result?.route, '/oauth/callback');
    });
  });

  group('GlobalOAuthHandler', () {
    test('defers navigation when not authenticated', () async {
      final handler = createHandler(isAuthenticated: false);

      await handler.handleIncomingLink(
        Uri.parse('joymini://payment?orderId=123'),
      );

      // 应触发登录流程而非直接导航
      verify(() => authNotifier.deferUntilAuthenticated(any()));
    });

    test('navigates directly when authenticated', () async {
      final handler = createHandler(isAuthenticated: true);

      await handler.handleIncomingLink(
        Uri.parse('joymini://payment?orderId=123'),
      );

      verify(() => goRouter.push('/payment?orderId=123'));
    });
  });
}
```

---

**下一篇预告**: [F9 — AppStartup 数据预热] — 应用启动时的多路数据预加载屏障
