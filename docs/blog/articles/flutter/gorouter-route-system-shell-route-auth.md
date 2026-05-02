---
title: "GoRouter Route System: 30+ Routes, ShellRoute, and RouteAuthConfig"
description: "A comprehensive guide to building a production-grade GoRouter navigation system with 30+ routes, StatefulShellRoute for persistent bottom navigation, and RouteAuthConfig for per-route authentication guarding."
slug: gorouter-route-system-shell-route-auth
tags: [Flutter, GoRouter, Routing, Navigation, Auth]
---

# GoRouter Route System: 30+ Routes, ShellRoute, and RouteAuthConfig

## 1. Overview

A production-grade Flutter application with 30+ pages requires a **declarative**, **type-safe** routing system that supports:

- **Shell routes** — persistent UI (bottom navigation bar, top bar)
- **Auth guards** — redirect unauthenticated users to the login page
- **Deep links** — push notifications and OAuth callbacks
- **Nested navigation** — independent navigation within each tab
- **Route transition animations** — slide, fade, no animation

This article explores a GoRouter-based routing architecture with 30+ route definitions, `ShellRoute` for bottom navigation, and `RouteAuthConfig` for per-route authentication requirements.

---

## 2. Architecture Overview

```
MaterialApp.router
  └── GoRouter
        ├── ShellRoute (AuthCheck)
        │     ├── /login         → LoginScreen
        │     ├── /register      → RegisterScreen
        │     ├── /forgot-password → ForgotPasswordScreen
        │     └── /oauth/callback → OAuthCallbackScreen
        │
        ├── ShellRoute (BottomNavShell)
        │     ├── /home          → HomeScreen
        │     ├── /explore       → ExploreScreen
        │     ├── /orders        → OrdersScreen
        │     ├── /profile       → ProfileScreen
        │     │     ├── /profile/edit      → EditProfileScreen
        │     │     ├── /profile/settings  → SettingsScreen
        │     │     └── /profile/wallet    → WalletScreen
        │
        ├── /treasure/:id        → TreasureDetailScreen
        ├── /group/:id           → GroupDetailScreen
        ├── /checkout            → CheckoutScreen
        ├── /payment/callback    → PaymentCallbackScreen
        ├── /chat/:conversationId → ChatScreen
        └── /call/:roomId        → CallScreen
```

---

## 3. GoRouter Setup

### 3.1 Route Configuration

```dart
class AppRouter {
  static final GoRouter router = GoRouter(
    initialLocation: '/home',
    debugLogDiagnostics: kDebugMode,
    redirect: _authGuard,
    routes: [
      // Public routes (no bottom navigation bar)
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) {
          return AuthShell(navigationShell: navigationShell);
        },
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/login',
                builder: (context, state) => const LoginScreen(),
              ),
              GoRoute(
                path: '/register',
                builder: (context, state) => const RegisterScreen(),
              ),
            ],
          ),
        ],
      ),

      // Main app routes (with bottom navigation bar)
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) {
          return BottomNavShell(navigationShell: navigationShell);
        },
        branches: [
          // Tab 0: Home
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/home',
                builder: (context, state) => const HomeScreen(),
                routes: [
                  GoRoute(
                    path: 'treasure/:id',
                    builder: (context, state) => TreasureDetailScreen(
                      id: state.pathParameters['id']!,
                    ),
                  ),
                ],
              ),
            ],
          ),

          // Tab 1: Explore
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/explore',
                builder: (context, state) => const ExploreScreen(),
              ),
            ],
          ),

          // Tab 2: Orders
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/orders',
                builder: (context, state) => const OrdersScreen(),
                routes: [
                  GoRoute(
                    path: ':orderId',
                    builder: (context, state) => OrderDetailScreen(
                      orderId: state.pathParameters['orderId']!,
                    ),
                  ),
                ],
              ),
            ],
          ),

          // Tab 3: Profile
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/profile',
                builder: (context, state) => const ProfileScreen(),
                routes: [
                  GoRoute(path: 'edit', builder: (_, __) => const EditProfileScreen()),
                  GoRoute(path: 'settings', builder: (_, __) => const SettingsScreen()),
                  GoRoute(path: 'wallet', builder: (_, __) => const WalletScreen()),
                  GoRoute(path: 'kyc', builder: (_, __) => const KycScreen()),
                ],
              ),
            ],
          ),
        ],
      ),

      // Top-level routes (full-screen, no bottom navigation bar)
      GoRoute(
        path: '/checkout',
        builder: (context, state) => const CheckoutScreen(),
      ),
      GoRoute(
        path: '/chat/:conversationId',
        builder: (context, state) => ChatScreen(
          conversationId: state.pathParameters['conversationId']!,
        ),
      ),
      GoRoute(
        path: '/call/:roomId',
        builder: (context, state) => CallScreen(
          roomId: state.pathParameters['roomId']!,
        ),
      ),
      GoRoute(
        path: '/payment/callback',
        builder: (context, state) => PaymentCallbackScreen(
          queryParams: state.uri.queryParameters,
        ),
      ),
    ],
  );
}
```

### 3.2 RouteAuthConfig — Per-Route Authentication Requirements

```dart
class RouteAuthConfig {
  final bool requireAuth;
  final bool requireKyc;
  final List<UserRole> allowedRoles;

  const RouteAuthConfig({
    this.requireAuth = false,
    this.requireKyc = false,
    this.allowedRoles = const [],
  });

  static const Map<String, RouteAuthConfig> routeConfigs = {
    '/login': RouteAuthConfig(),
    '/register': RouteAuthConfig(),
    '/home': RouteAuthConfig(),
    '/explore': RouteAuthConfig(),
    '/profile': RouteAuthConfig(requireAuth: true),
    '/profile/edit': RouteAuthConfig(requireAuth: true),
    '/profile/wallet': RouteAuthConfig(requireAuth: true, requireKyc: true),
    '/checkout': RouteAuthConfig(requireAuth: true, requireKyc: true),
    '/orders': RouteAuthConfig(requireAuth: true),
    '/chat/:conversationId': RouteAuthConfig(requireAuth: true),
    '/call/:roomId': RouteAuthConfig(requireAuth: true, requireKyc: true),
    '/admin': RouteAuthConfig(requireAuth: true, allowedRoles: [UserRole.admin]),
  };
}
```

---

## 4. Auth Guard — Global Redirect

### 4.1 Implementation

GoRouter's `redirect` callback is the ideal place for auth checks — it runs before every navigation:

```dart
static Future<String?> _authGuard(BuildContext context, GoRouterState state) async {
  final authNotifier = context.read<AuthNotifier>();
  final location = state.matchedLocation;

  // Find matching route config
  final config = RouteAuthConfig.routeConfigs.entries.firstWhere(
    (e) => _matchesRoute(location, e.key),
    orElse: () => MapEntry(location, const RouteAuthConfig()),
  ).value;

  // Unauthenticated → redirect to login
  if (config.requireAuth && !authNotifier.isAuthenticated) {
    return '/login?redirect=$location';
  }

  // Requires KYC but not verified → redirect to KYC
  if (config.requireKyc && !authNotifier.isKycVerified) {
    return '/profile/kyc';
  }

  // Role restriction
  if (config.allowedRoles.isNotEmpty &&
      !config.allowedRoles.contains(authNotifier.user?.role)) {
    return '/home';  // Redirect to home instead of showing forbidden page
  }

  // Authenticated user on login page → redirect to home
  if (location == '/login' && authNotifier.isAuthenticated) {
    return '/home';
  }

  return null;  // Allow navigation
}

static bool _matchesRoute(String location, String pattern) {
  // Simple pattern matching: '/chat/:conversationId' → '/chat/abc123'
  final locationParts = location.split('/');
  final patternParts = pattern.split('/');

  if (locationParts.length != patternParts.length) return false;

  for (int i = 0; i < locationParts.length; i++) {
    if (patternParts[i].startsWith(':')) continue;  // Dynamic segment
    if (patternParts[i] != locationParts[i]) return false;
  }
  return true;
}
```

### 4.2 Post-Login Redirect

The `redirect` query parameter preserves the user's original destination:

```dart
// Login page reads the redirect parameter
class LoginScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final redirect = GoRouterState.of(context).uri.queryParameters['redirect'];

    return LoginForm(
      onSuccess: () {
        if (redirect != null && redirect.isNotEmpty) {
          context.go(redirect);
        } else {
          context.go('/home');
        }
      },
    );
  }
}
```

---

## 5. ShellRoute — Persistent Bottom Navigation

### 5.1 BottomNavShell

```dart
class BottomNavShell extends StatelessWidget {
  final StatefulNavigationShell navigationShell;

  const BottomNavShell({super.key, required this.navigationShell});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: LuckyBottomNav(
        currentIndex: navigationShell.currentIndex,
        onTap: (index) {
          navigationShell.goBranch(
            index,
            initialLocation: index == navigationShell.currentIndex,
          );
        },
        items: const [
          LuckyNavItem(icon: Icons.home, label: 'Home'),
          LuckyNavItem(icon: Icons.explore, label: 'Explore'),
          LuckyNavItem(icon: Icons.receipt, label: 'Orders'),
          LuckyNavItem(icon: Icons.person, label: 'Profile'),
        ],
      ),
    );
  }
}
```

### 5.2 AuthShell

For public routes (login, register), a simple shell without the bottom navigation bar:

```dart
class AuthShell extends StatelessWidget {
  final StatefulNavigationShell navigationShell;

  const AuthShell({super.key, required this.navigationShell});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      // Auth pages do not need a bottom navigation bar
    );
  }
}
```

---

## 6. Deep Link Handling

### 6.1 Deep Link Configuration

GoRouter supports deep links natively. Configure them in the app manifest:

```xml
<!-- Android: AndroidManifest.xml -->
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="luckyapp" android:host="callback" />
</intent-filter>
```

```xml
<!-- iOS: Info.plist -->
<key>FlutterDeepLinkingEnabled</key>
<true/>
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>luckyapp</string></array>
  </dict>
</array>
```

### 6.2 Deep Link Route Definitions

```dart
// OAuth callback
GoRoute(
  path: '/oauth/callback',
  builder: (context, state) => OAuthCallbackScreen(
    code: state.uri.queryParameters['code']!,
    state: state.uri.queryParameters['state'],
  ),
),

// Payment redirect
GoRoute(
  path: '/payment/callback',
  builder: (context, state) => PaymentCallbackScreen(
    invoiceId: state.uri.queryParameters['invoice_id'],
    status: state.uri.queryParameters['status'],
  ),
),
```

### 6.3 Deep Link Handling at App Startup

```dart
class AppStartup {
  static Future<void> handleLaunchUri() async {
    final uri = await getInitialUri();  // app_links package
    if (uri != null) {
      // Parse and navigate
      if (uri.pathSegments.contains('reset-password')) {
        final token = uri.queryParameters['token'];
        AppRouter.router.go('/reset-password', extra: token);
      }
    }
  }
}
```

---

## 7. Transition Animations

Use `customTransitionBuilder` to customize transition animations per route:

```dart
GoRoute(
  path: '/chat/:conversationId',
  pageBuilder: (context, state) {
    return CustomTransitionPage(
      key: state.pageKey,
      child: ChatScreen(conversationId: state.pathParameters['conversationId']!),
      transitionsBuilder: (context, animation, secondaryAnimation, child) {
        return SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(1.0, 0.0),
            end: Offset.zero,
          ).animate(animation),
          child: child,
        );
      },
    );
  },
),
```

---

## 8. Navigating from Anywhere

### 8.1 Using `context.go` vs `context.push`

```dart
// Replace current route (no back navigation)
context.go('/home');

// Push onto stack (back button returns to previous page)
context.push('/treasure/123');

// Pop back
context.pop();

// Navigate to a specific tab
final shell = StatefulNavigationShell.of(context);
shell.goBranch(2);  // Switch to orders tab
```

### 8.2 Navigating from Non-Widget Code

```dart
// From a service / notifier
class AuthNotifier extends ChangeNotifier {
  void onLoginSuccess() {
    // Use the global navigation key
    AppRouter.router.go('/home');
  }
}
```

---

## 9. Testing Routes

```dart
void main() {
  testWidgets('redirects unauthenticated users to login', (tester) async {
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: AppRouter.router,
      ),
    );

    // Try navigating to profile (requireAuth: true)
    AppRouter.router.go('/profile');
    await tester.pumpAndSettle();

    // Should be redirected to /login
    expect(find.text('Login'), findsOneWidget);
  });

  testWidgets('preserves redirect parameter after login', (tester) async {
    AppRouter.router.go('/orders');
    await tester.pumpAndSettle();

    // Should redirect to /login?redirect=/orders
    expect(find.text('Login'), findsOneWidget);
    expect(AppRouter.router.state.uri.queryParameters['redirect'], '/orders');
  });

  testWidgets('navigates to tab branches', (tester) async {
    await tester.pumpWidget(
      MaterialApp.router(routerConfig: AppRouter.router),
    );

    AppRouter.router.go('/home');
    await tester.pumpAndSettle();
    expect(find.text('Home'), findsOneWidget);

    // Tap bottom navigation
    await tester.tap(find.text('Explore'));
    await tester.pumpAndSettle();
    expect(find.text('Explore'), findsOneWidget);
  });
}
```

---

## 10. Production Checklist

- [ ] **StatefulShellRoute** — Use the `indexedStack` variant to preserve tab state (scroll position, form input) when switching tabs
- [ ] **Error handling** — Add an `errorBuilder` to GoRouter for 404 pages:
  ```dart
  errorBuilder: (context, state) => NotFoundScreen(error: state.error),
  ```
- [ ] **URL strategy** — Use `PathUrlStrategy()` for web deployment to support clean URLs without `#`
- [ ] **Lazy loading** — Consider using `deferred as` imports for rarely used pages (KYC, admin) to reduce initial bundle size
- [ ] **Route transitions** — Keep simple transitions (fade/scale) for most routes; use slide for modal-style pages
- [ ] **Analytics** — Subscribe to GoRouter's `routerDelegate` changes for page view tracking

---

## 11. Summary

- **GoRouter** with 30+ routes provides declarative, type-safe navigation
- **StatefulShellRoute** supports persistent bottom navigation with independent tab state
- **RouteAuthConfig** maps per-route auth requirements (auth, KYC, role) to centralized guard logic
- The **auth guard** implemented via GoRouter's `redirect` callback handles unauthenticated users, redirecting to login while preserving the destination
- **Deep links** are natively supported for OAuth callbacks, push notifications, and payment redirects
- **Transition animations** can be customized per route using `CustomTransitionPage`
