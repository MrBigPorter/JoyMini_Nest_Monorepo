# GoRouter 路由系统：30+ 路由、ShellRoute 与 RouteAuthConfig

> **目标读者：** Flutter 移动端工程师
> **标签：** `#Flutter` `#GoRouter` `#Routing` `#Navigation` `#Auth`
> **难度：** 中级
> **预计阅读时间：** 25 分钟

---

## 1. 概述

一个拥有 30+ 页面的生产级 Flutter 应用需要一个**声明式**、**类型安全**的路由系统，支持：

- **Shell 路由** — 持久化 UI（底部导航栏、顶栏）
- **认证守卫** — 将未登录用户重定向到登录页
- **深度链接** — 推送通知和 OAuth 回调
- **嵌套导航** — 标签页内的独立导航
- **路由转场动画** — 滑动、淡入、无动画

本文探讨一个基于 GoRouter 的路由架构，包含 30+ 路由定义、用于底部导航的 `ShellRoute` 以及用于按路由配置认证需求的 `RouteAuthConfig`。

---

## 2. 架构总览

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

## 3. GoRouter 设置

### 3.1 路由配置

```dart
class AppRouter {
  static final GoRouter router = GoRouter(
    initialLocation: '/home',
    debugLogDiagnostics: kDebugMode,
    redirect: _authGuard,
    routes: [
      // 公开路由（无底部导航栏）
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

      // 主应用路由（带底部导航栏）
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) {
          return BottomNavShell(navigationShell: navigationShell);
        },
        branches: [
          // Tab 0：首页
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

          // Tab 1：发现
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/explore',
                builder: (context, state) => const ExploreScreen(),
              ),
            ],
          ),

          // Tab 2：订单
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

          // Tab 3：个人中心
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

      // 顶级路由（全屏，无底部导航栏）
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

### 3.2 RouteAuthConfig — 按路由配置认证需求

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

GoRouter 的 `redirect` 回调是实现认证检查的理想位置——它在每次导航之前运行：

```dart
static Future<String?> _authGuard(BuildContext context, GoRouterState state) async {
  final authNotifier = context.read<AuthNotifier>();
  final location = state.matchedLocation;

  // 查找匹配的路由配置
  final config = RouteAuthConfig.routeConfigs.entries.firstWhere(
    (e) => _matchesRoute(location, e.key),
    orElse: () => MapEntry(location, const RouteAuthConfig()),
  ).value;

  // 未认证 → 重定向到登录
  if (config.requireAuth && !authNotifier.isAuthenticated) {
    return '/login?redirect=$location';
  }

  // 需要 KYC 但未验证 → 重定向到 KYC
  if (config.requireKyc && !authNotifier.isKycVerified) {
    return '/profile/kyc';
  }

  // 角色限制
  if (config.allowedRoles.isNotEmpty &&
      !config.allowedRoles.contains(authNotifier.user?.role)) {
    return '/home';  // 重定向到首页而不是显示禁止访问页面
  }

  // 已登录用户在登录页 → 重定向到首页
  if (location == '/login' && authNotifier.isAuthenticated) {
    return '/home';
  }

  return null;  // 允许导航
}

static bool _matchesRoute(String location, String pattern) {
  // 简单模式匹配：'/chat/:conversationId' → '/chat/abc123'
  final locationParts = location.split('/');
  final patternParts = pattern.split('/');

  if (locationParts.length != patternParts.length) return false;

  for (int i = 0; i < locationParts.length; i++) {
    if (patternParts[i].startsWith(':')) continue;  // 动态段
    if (patternParts[i] != locationParts[i]) return false;
  }
  return true;
}
```

### 4.2 登录后重定向

`redirect` 查询参数保留了用户原本的目标页面：

```dart
// 登录页读取 redirect 参数
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
          LuckyNavItem(icon: Icons.home, label: '首页'),
          LuckyNavItem(icon: Icons.explore, label: '发现'),
          LuckyNavItem(icon: Icons.receipt, label: '订单'),
          LuckyNavItem(icon: Icons.person, label: '我的'),
        ],
      ),
    );
  }
}
```

### 5.2 AuthShell

对于公开路由（登录、注册），使用一个没有底部导航栏的简单壳：

```dart
class AuthShell extends StatelessWidget {
  final StatefulNavigationShell navigationShell;

  const AuthShell({super.key, required this.navigationShell});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      // 认证页面不需要底部导航栏
    );
  }
}
```

---

## 6. 深度链接处理

### 6.1 深度链接配置

GoRouter 原生支持深度链接。在应用的 manifest 中进行配置：

```xml
<!-- Android：AndroidManifest.xml -->
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="luckyapp" android:host="callback" />
</intent-filter>
```

```xml
<!-- iOS：Info.plist -->
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

### 6.2 深度链接的路由定义

```dart
// OAuth 回调
GoRoute(
  path: '/oauth/callback',
  builder: (context, state) => OAuthCallbackScreen(
    code: state.uri.queryParameters['code']!,
    state: state.uri.queryParameters['state'],
  ),
),

// 支付重定向
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
    final uri = await getInitialUri();  // app_links 包
    if (uri != null) {
      // 解析并导航
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

### 8.1 使用 `context.go` vs `context.push`

```dart
// 替换当前路由（无返回导航）
context.go('/home');

// 推入栈（返回按钮回到上一页）
context.push('/treasure/123');

// 弹出返回
context.pop();

// 导航到某个标签页
final shell = StatefulNavigationShell.of(context);
shell.goBranch(2);  // 切换到订单标签页
```

### 8.2 从非 Widget 代码中导航

```dart
// 从服务/notifier 中
class AuthNotifier extends ChangeNotifier {
  void onLoginSuccess() {
    // 使用全局导航键
    AppRouter.router.go('/home');
  }
}
```

---

## 9. 测试路由

```dart
void main() {
  testWidgets('应将未认证用户重定向到登录页', (tester) async {
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: AppRouter.router,
      ),
    );

    // 尝试导航到个人中心（requireAuth: true）
    AppRouter.router.go('/profile');
    await tester.pumpAndSettle();

    // 应被重定向到 /login
    expect(find.text('Login'), findsOneWidget);
  });

  testWidgets('应在登录后保留 redirect 参数', (tester) async {
    AppRouter.router.go('/orders');
    await tester.pumpAndSettle();

    // 应重定向到 /login?redirect=/orders
    expect(find.text('Login'), findsOneWidget);
    expect(AppRouter.router.state.uri.queryParameters['redirect'], '/orders');
  });

  testWidgets('应能导航到标签分支', (tester) async {
    await tester.pumpWidget(
      MaterialApp.router(routerConfig: AppRouter.router),
    );

    AppRouter.router.go('/home');
    await tester.pumpAndSettle();
    expect(find.text('首页'), findsOneWidget);

    // 点击底部导航
    await tester.tap(find.text('发现'));
    await tester.pumpAndSettle();
    expect(find.text('发现'), findsOneWidget);
  });
}
```

---

## 10. 生产环境检查清单

- [ ] **StatefulShellRoute** — 使用 `indexedStack` 变体以保留标签页状态（滚动位置、表单输入）在标签页切换时不丢失
- [ ] **错误处理** — 为 GoRouter 添加 `errorBuilder` 实现 404 页面：
  ```dart
  errorBuilder: (context, state) => NotFoundScreen(error: state.error),
  ```
- [ ] **URL 策略** — Web 部署使用 `PathUrlStrategy()` 以支持干净的 URL，无需 `#`
- [ ] **懒加载** — 考虑对很少使用的页面（KYC、管理后台）使用 `deferred as` 导入，减少初始包大小
- [ ] **路由转场** — 大多数路由保持简单的转场动画（淡入/缩放）；模态风格的页面使用滑动
- [ ] **分析统计** — 订阅 GoRouter 的 `routerDelegate` 变化以进行页面浏览追踪

---

## 11. 总结

- **GoRouter** 配合 30+ 路由提供声明式、类型安全的导航
- **StatefulShellRoute** 支持持久化底部导航，各标签页状态独立
- **RouteAuthConfig** 将按路由的认证需求（认证、KYC、角色）映射到集中守卫逻辑
- 通过 GoRouter 的 `redirect` 回调实现的 **认证守卫** 处理未认证用户，重定向到登录页并保留目标地址
- **深度链接** 原生支持 OAuth 回调、推送通知和支付重定向
- 可以使用 `CustomTransitionPage` 为每个路由自定义**转场动画**
