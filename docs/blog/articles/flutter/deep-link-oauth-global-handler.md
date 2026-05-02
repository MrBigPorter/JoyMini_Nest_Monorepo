---
title: "Deep Link OAuth + GlobalOAuthHandler: Unified Authentication Entry Architecture"
description: "A comprehensive architecture for handling deep links, universal links, and OAuth callbacks in Flutter, with a unified handler that manages authentication gating, route resolution, and deferred navigation."
slug: deep-link-oauth-global-handler
tags: [Flutter, Deep Link, OAuth, Authentication, Routing, Security]
---

# Deep Link OAuth + GlobalOAuthHandler: Unified Authentication Entry Architecture

## 1. Problem Space

Mobile applications face authentication challenges from two types of external entry points:

| Entry Type | Example | Challenge |
|------------|---------|-----------|
| **Deep Link** | `joymini://payment?orderId=xxx` | User may not be logged in; must continue after login |
| **Universal Link** | `https://joymini.app/oauth/callback` | Cross-app navigation, state preservation |
| **OAuth Callback** | Google / Facebook / Apple login return | Multiple providers, unified handling |

**GlobalOAuthHandler** unifies these entry points into a single abstraction layer:

```
[External Link]
      ↓
DeepLinkParser.parse(url)
      ↓
RouteIdentifier.identify(parsed)
      ↓
AuthGuard.check(route)
  ├── Authenticated → GlobalOAuthHandler.handle(route)
  └── Unauthenticated → AuthNotifier → login → GlobalOAuthHandler.handle(route)
```

## 2. Deep Link Parsing Engine

### 2.1 URL Parsing

```dart
class DeepLinkParser {
  static DeepLinkResult? parse(Uri uri) {
    // Custom scheme: joymini://path?params
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

### 2.2 DeepLinkResult Model

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

  /// Whether authentication is required
  bool get requiresAuth => switch (route) {
    '/payment'        => true,
    '/profile'        => true,
    '/group/:id'      => true,
    '/oauth/callback' => false, // OAuth itself is authentication
    _                 => false,
  };

  /// Safely read a parameter from params
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

## 3. GlobalOAuthHandler — Unified Processing Hub

### 3.1 Architecture Design

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

  /// Handle incoming link (called from AppDelegate / WidgetsBinding)
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

    // Auth check
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
    // Build GoRouter location
    final location = route.buildLocation(link.params);
    await _goRouter.push(location);
  }
}
```

### 3.2 Route Identifier

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

    // Static route matching
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

    // Dynamic route matching (/group/:id → /group/42)
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

### 3.3 Deferred Authentication Recovery

When a deep link requires authentication but the user is not logged in, the system needs to "remember" the target route and auto-navigate after login:

```dart
class AuthNotifier {
  Completer<IdentifiedRoute>? _pendingRoute;

  /// Register a deferred route; auto-navigate after authentication completes
  Future<void> deferUntilAuthenticated({
    required VoidCallback onAuthenticated,
  }) {
    final completer = Completer<void>();
    _pendingRoute = Completer<IdentifiedRoute>();

    // Trigger login flow
    _navigateToLogin();

    return completer.future;
  }

  /// Called after authentication completes
  Future<void> _onAuthenticated() async {
    if (_pendingRoute != null) {
      final route = await _pendingRoute!.future;
      await _globalOAuthHandler.navigateToRoute(route);
      _pendingRoute = null;
    }
  }
}
```

## 4. OAuth Provider Abstraction Layer

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

### 4.2 Provider Implementations

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

### 4.3 Provider Registry

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

## 5. Platform Integration

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
    // Pass the URL to Flutter
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

### 5.3 Flutter Side Reception

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

## 6. Security Considerations

### 6.1 State Parameter for CSRF Protection

```dart
class OAuthStateManager {
  /// Generate a one-time state token
  String generateState() {
    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    return base64UrlEncode(bytes);
  }

  /// Verify the received state matches the stored one
  bool validateState(String receivedState) {
    final stored = _storage.getString('oauth_state');
    _storage.remove('oauth_state'); // Single use
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

## 7. Complete Data Flow

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

## 8. Testing Strategy

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

      // Should trigger login flow rather than direct navigation
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
