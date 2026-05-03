---
title: 'GoRouter 路由系统：30+ 路由、ShellRoute 与 RouteAuthConfig'
description: '构建生产级 GoRouter 导航系统的完整指南，涵盖 30+ 路由定义、StatefulShellRoute 持久化底部导航，以及 RouteAuthConfig 按需认证守卫。'
slug: gorouter-route-system-shell-route-auth
tags: Flutter, GoRouter, Routing, Navigation, Auth
---

## 1. 概述

一个拥有 30+ 页面的生产级 Flutter 应用需要一个**声明式**、**类型安全**的路由系统，支持以下能力：

- **Shell 路由** — 持久化 UI（底部导航栏、顶部栏）
- **认证守卫** — 将未登录用户重定向到登录页
- **深度链接** — 推送通知和 OAuth 回调
- **嵌套导航** — 每个标签页内独立的导航栈
- **路由转场动画** — 滑动、淡入、无动画

本文探讨基于 GoRouter 的路由架构，包含 30+ 路由定义、`ShellRoute` 底部导航实现，以及 `RouteAuthConfig` 按需认证配置方案。

---

## 2. 架构概览

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

## 3. GoRouter 配置

### 3.1 路由配置

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

### 3.2 RouteAuthConfig — 按需认证配置

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

## 4. 认证守卫 — 全局重定向

### 4.1 实现

GoRouter 的 `redirect` 回调是执行认证检查的理想位置——它在每次导航前运行：

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

### 4.2 登录后重定向

`redirect` 查询参数保存用户原始目标地址：

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

## 5. ShellRoute — 持久化底部导航

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

对于公开路由（登录、注册），使用不带底部导航栏的简单 Shell：

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

## 6. 深度链接处理

### 6.1 深度链接配置

GoRouter 原生支持深度链接。在应用清单中配置：

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

### 6.2 深度链接路由定义

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

### 6.3 应用启动时的深度链接处理

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

## 7. 转场动画

使用 `customTransitionBuilder` 为每个路由自定义转场动画：

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

## 8. 从任意位置导航

### 8.1 `context.go` vs `context.push`

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

### 8.2 从非 Widget 代码导航

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

## 9. 路由测试

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

## 10. 生产检查清单

- [ ] **StatefulShellRoute** — 使用 `indexedStack` 变体以保持标签页状态（滚动位置、表单输入）在切换时不被销毁
- [ ] **错误处理** — 为 GoRouter 添加 `errorBuilder` 处理 404 页面：
  ```dart
  errorBuilder: (context, state) => NotFoundScreen(error: state.error),
  ```
- [ ] **URL 策略** — Web 部署使用 `PathUrlStrategy()` 以支持不含 `#` 的干净 URL
- [ ] **懒加载** — 考虑对不常用页面（KYC、管理后台）使用 `deferred as` 导入，减少初始包体积
- [ ] **路由转场** — 大多数路由使用简单转场（淡入/缩放）；模态风格页面使用滑动
- [ ] **分析** — 订阅 GoRouter 的 `routerDelegate` 变更以进行页面浏览追踪

---

## 11. 总结

1. **GoRouter** 配合 30+ 路由提供了声明式、类型安全的导航方案
2. **StatefulShellRoute** 支持持久化底部导航，每个标签页拥有独立的导航栈状态
3. **RouteAuthConfig** 将按需认证需求（登录、KYC、角色）映射到集中式守卫逻辑
4. **认证守卫** 通过 GoRouter 的 `redirect` 回调实现，处理未登录用户重定向并保留目标地址
5. **深度链接** 原生支持 OAuth 回调、推送通知和支付重定向
6. **转场动画** 可通过 `CustomTransitionPage` 为每个路由单独定制
