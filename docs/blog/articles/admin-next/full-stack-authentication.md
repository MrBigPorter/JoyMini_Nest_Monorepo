---
title: "全栈认证体系——API JWT 双密钥 + Flutter AuthNotifier + admin-next Edge Middleware + Cookie 守卫"
slug: "full-stack-authentication"
date: "2026-05-03"
description: "追踪认证 Token 在三端的完整生命周期：API 签发与验证（Passport JWT + 双密钥策略）→ Flutter 安全存储与状态机刷新 → admin-next Edge Middleware Cookie 路由守卫与 HTTP 拦截器自动刷新"
tags: ["admin-next", "Flutter", "NestJS", "authentication", "JWT", "middleware", "Edge Runtime", "token-refresh", "httpOnly-cookie"]
---

# 全栈认证体系——API JWT 双密钥 + Flutter AuthNotifier + admin-next Edge Middleware + Cookie 守卫

## 1. 架构全景

本平台的认证体系横跨三个完全不同的运行时环境：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  API (NestJS — Server)                                                   │
│                                                                          │
│  POST /auth/login ──► JWT 签发 (dual-secret)                            │
│  ├─ Client:  JWT_SECRET       ──► { sub, role, type:'client' }          │
│  └─ Admin:   ADMIN_JWT_SECRET ──► { sub, role, type:'admin', username } │
│                                                                          │
│  @UseGuards(JwtAuthGuard) ──► Passport JWT Strategy                      │
│  ├─ secretOrKeyProvider ──► 动态选密钥                                   │
│  ├─ validate() ──► { id, userId, role, type } → request.user           │
│  └─ OptionalJwtAuthGuard ──► 匿名请求放行 (null user)                   │
│                                                                          │
│  @UseGuards(AdminJwtAuthGuard) ──► Admin API 手工验签                    │
│  └─ 直接用 jsonwebtoken.verify() — 不依赖 Passport                      │
└─────────────────────────────────────────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────────┐
│ Flutter App       │ │ admin-next   │ │ Admin Flutter (future)│
│                   │ │ (Next.js)    │ │                       │
│ AuthNotifier      │ │ Middleware   │ │ AdminJwtAuthGuard     │
│ StateNotifier     │ │ Edge Runtime │ │                       │
│ ├─ login()        │ │ Cookie Guard │ │                       │
│ ├─ logout()       │ │              │ │                       │
│ ├─ updateTokens() │ │ HttpClient   │ │                       │
│ └─ initialTokens  │ │ 401 → Refresh│ │                       │
│                   │ │ → Retry      │ │                       │
│ TokenStorage      │ │              │ │                       │
│ ├─ SecureStorage  │ │ auth_token   │ │                       │
│ └─ SharedPrefs(Web)│ │ (httpOnly)  │ │                       │
└──────────────────┘ └──────────────┘ └──────────────────────┘
```

本文追踪 JWT Token 从 **签发 → 传输 → 存储 → 验证 → 刷新** 的完整生命周期。

---

## 2. API 层——JWT 签发与双密钥策略

### 2.1 签发 Token（Client vs Admin）

API 在登录时使用两个不同的密钥签发 Token：

| Token 类型 | 密钥 | Payload `type` | 用途 |
|-----------|------|---------------|------|
| Client Token | `JWT_SECRET` | `'client'` | Flutter App 用户 |
| Admin Token | `ADMIN_JWT_SECRET` | `'admin'` | admin-next 后台管理员 |

这种设计确保即使 client 密钥泄露，攻击者也无法伪造 admin Token 访问后台接口。

### 2.2 Passport JWT Strategy——动态密钥选择

[`JwtStrategy`](../../apps/api/src/common/jwt/jwt.strategy.ts) 的核心是 `secretOrKeyProvider`——在验证时**动态选择密钥**：

```typescript
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const options = {
      secretOrKeyProvider: (_request, rawJwtToken, done) => {
        // 先 decode（不验证签名）读取 type 字段
        const payload = jsonwebtoken.decode(rawJwtToken) as {
          type?: string;
        } | null;

        // 根据 type 选择密钥
        const secret =
          payload?.type === 'admin'
            ? process.env.ADMIN_JWT_SECRET || 'please_change_me_very_secret'
            : process.env.JWT_SECRET || 'please_change_me_very_secret';

        done(null, secret);
      },
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
    };
    super(options);
  }

  validate(payload: JwtPayload) {
    // 将 payload 映射到 request.user
    return {
      id: payload.sub,
      userId: payload.sub,
      role: payload.role ?? '',
      type: payload.type ?? '',
    };
  }
}
```

**安全要点**：`jsonwebtoken.decode()` **不验证签名**，仅读取 `type` 字段以选择正确的密钥。即使攻击者在 client token 中伪造 `type: 'admin'`，后续 `verify()` 仍会用 `JWT_SECRET` 验签，因无法伪造 `ADMIN_JWT_SECRET` 的签名而失败。

### 2.3 三个 Guard——三种授权策略

| Guard | 用途 | 行为 |
|-------|------|------|
| [`JwtAuthGuard`](../../apps/api/src/common/jwt/jwt.guard.ts) | 普通 API | 必须携带有效 Token，否则 401 |
| [`OptionalJwtAuthGuard`](../../apps/api/src/common/jwt/option-jwt.guard.ts) | 匿名接口 | 无 Token 时 `user = null`，不报错 |
| [`AdminJwtAuthGuard`](../../apps/api/src/admin/auth/admin-jwt-auth.guard.ts) | Admin API | 手工 `jsonwebtoken.verify()`，不依赖 Passport |

`OptionalJwtAuthGuard` 通过重写 `handleRequest` 实现：

```typescript
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(err, user, info, context, status): TUser | null {
    // 验证失败 → 返回 null，不抛异常
    if (err || !user) {
      return null;
    }
    return user;
  }
}
```

这用于需要可选身份的场景，如 FCM 设备注册（[`NotificationController`](../../apps/api/src/client/notification/notification.controller.ts:14)）。

### 2.4 AdminJwtAuthGuard——手工验签

Admin API 使用独立的 [`AdminJwtAuthGuard`](../../apps/api/src/admin/auth/admin-jwt-auth.guard.ts)：

```typescript
@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    const secret =
      process.env.ADMIN_JWT_SECRET ||
      process.env.JWT_SECRET ||
      'please_change_me_very_secret';

    try {
      const payload = jwt.verify(token, secret) as AdminJwtPayload;
      request.user = {
        id: payload.sub,
        userId: payload.sub,
        role: toStringOrEmpty(payload.role),
        type: toStringOrEmpty(payload.type),
        username: toStringOrEmpty(payload.username),
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired admin token');
    }
    return true;
  }
}
```

为什么不直接复用 Passport JwtStrategy？因为 Admin API 不依赖 `@nestjs/passport` 模块即可独立验证，减少模块间耦合。

---

## 3. Flutter 端——AuthNotifier 认证状态机

Flutter 侧的认证独立文章 [`auth-notifier-token-storage-auth-state-machine.md`](../flutter/auth-notifier-token-storage-auth-state-machine.md) 已有深入分析。本文仅从**跨平台集成**视角梳理关键设计。

### 3.1 AuthState——不可变状态

[`AuthState`](../../JoyMini_Flutter_App/lib/core/store/auth/auth_state.dart) 是纯数据类：

```dart
class AuthState {
  final String? accessToken;
  final String? refreshToken;
  final bool isAuthenticated;

  const AuthState({
    this.accessToken,
    this.refreshToken,
    this.isAuthenticated = false,
  });

  factory AuthState.initial() => AuthState(
    accessToken: null, refreshToken: null, isAuthenticated: false,
  );

  AuthState copyWith({...}) { /* 不可变更新 */ }
}
```

### 3.2 AuthNotifier——状态机

[`AuthNotifier`](../../JoyMini_Flutter_App/lib/core/store/auth/auth_notifier.dart) 管理认证的完整生命周期：

```dart
class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this.ref, this.storage, String? initialAccess, String? initialRefresh)
    : super(AuthState(
        accessToken: initialAccess,
        refreshToken: initialRefresh,
        isAuthenticated: initialAccess != null,
      )) {
    // 构造函数中：如果已有 accessToken，立即设置 HTTP header
    if (initialAccess != null && initialAccess.isNotEmpty) {
      Http.setToken(initialAccess);
    }
  }

  /// 登录
  Future<void> login(String access, String? refresh, {bool navigate = true}) async {
    Http.setToken(access);           // 1. 设置 HTTP 请求头
    await storage.save(access, refresh); // 2. 持久化到 SecureStorage
    state = state.copyWith(          // 3. 更新状态 → UI 响应
      accessToken: access,
      refreshToken: refresh,
      isAuthenticated: true,
    );
    if (navigate) {
      Future.microtask(() => appRouter.go('/home')); // 4. 导航
    }
    // 5. 并行获取用户信息 + 钱包余额
    Future.wait([
      ref.read(userProvider.notifier).fetchProfile(),
      ref.read(walletProvider.notifier).fetchBalance(),
    ]);
  }

  /// Token 刷新（由 HTTP 拦截器调用）
  void updateTokens(String access, String? refresh) {
    state = state.copyWith(
      accessToken: access,
      refreshToken: refresh,
      isAuthenticated: true,
    );
  }

  /// 退出登录
  Future<void> logout() async {
    await storage.clear();             // 1. 清除持久化
    await Http.clearToken();           // 2. 清除 HTTP header
    await LocalDatabaseService.close();// 3. 关闭本地数据库
    state = AuthState.initial();        // 4. 重置状态
    Future.microtask(() => appRouter.go('/home')); // 5. 导航
  }
}
```

**关键设计决策**：

1. **构造函数中设置 HTTP header**：确保 App 冷启动恢复 Token 后，后续请求立即携带认证信息
2. **`initialTokensProvider`**：启动时通过 `Provider` 注入初始 Token，解耦存储与状态机
3. **`login()` 中的 `Future.wait`**：并行获取 Profile + Wallet，不阻塞 UI
4. **`logout()` 的清理顺序**：先清存储 → 再清 HTTP → 再关 DB → 最后改状态

### 3.3 Token 存储——双后端适配

[`TokenStorage`](../../JoyMini_Flutter_App/lib/core/store/token/token_storage.dart) 是抽象接口：

```dart
abstract class TokenStorage {
  Future<void> save(String access, String? refresh);
  Future<(String? access, String? refresh)> read();
  Future<void> clear();
}
```

两个实现：

| 平台 | 实现 | 后端 |
|------|------|------|
| 移动端 (iOS/Android) | [`SecureTokenStorage`](../../JoyMini_Flutter_App/lib/core/store/token/secure_token_storage.dart) | `FlutterSecureStorage`（Keychain / Keystore） |
| Web | [`WebSharedPreferencesStorage`](../../JoyMini_Flutter_App/lib/core/store/token/web_shared_preferences_storage.dart) | `SharedPreferences` |

`authProvider` 在初始化时读取存储，将 Token 注入 `AuthNotifier`：

```dart
// auth_provider.dart
final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  final storage = ref.watch(tokenStorageProvider);
  final (initialAccess, initialRefresh) = ref.read(initialTokensProvider);
  return AuthNotifier(ref, storage, initialAccess, initialRefresh);
});
```

---

## 4. admin-next 端——Edge Middleware Cookie 守卫

### 4.1 Middleware 架构

[`middleware.ts`](../../apps/admin-next/src/middleware.ts) 在 Next.js Edge Runtime 运行（Cloudflare Workers），是**服务端第一道认证屏障**：

```
请求进入 → Edge Middleware
            │
            ├─ 静态资源 (_next/*, favicon, icon) → NextResponse.next()
            │
            ├─ 读取 auth_token Cookie
            │    ├─ 无 Token → 检查路径
            │    │    ├─ 公开路径 → 放行
            │    │    └─ 受保护路径 → 302 → /login
            │    │
            │    └─ 有 Token → decode JWT payload
            │         ├─ 过期/无效 → clearAuthCookie() → 302 → /login
            │         └─ 有效 → 检查路径
            │              ├─ /login → 302 → /（防重复登录）
            │              ├─ 公开路径 → 302 → /（已登录不显示公开页）
            │              └─ 受保护路径 → 放行
            │
            └─ 设置 x-pathname header → 传递给 Server Component
```

Edge Runtime 的优势：在请求到达后端之前拦截，零服务器延迟。

### 4.2 公开路径与受保护路径

```typescript
const PUBLIC_PATHS = ['/login', '/register-apply', '/privacy-policy'];
```

**路由守卫矩阵**：

| 状态 | 访问 `/login` | 访问受保护页面 | 访问其他公开页 |
|------|--------------|---------------|--------------|
| 无 Token | ✅ 放行（清理脏 cookie） | ❌ → `/login` | ✅ 放行 |
| Token 有效 | ❌ → `/` | ✅ 放行 | ❌ → `/` |
| Token 过期 | ✅ 放行（清理 cookie） | ❌ → `/login`（清理） | ✅ 放行（清理） |

### 4.3 JWT 过期检查——纯客户端解码

Middleware 在 Edge Runtime 执行，无法访问 API 数据库，因此采用**纯前端 JWT 解码检查**：

```typescript
function decodeJwtPayload(token: string): { exp?: number } | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;

  try {
    // Base64url → Base64 → atob → JSON.parse
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '=',
    );
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isJwtExpiredOrMalformed(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now;
}
```

**安全考虑**：这只是**客户端缓存层的预检**，真正的 Token 验证在 API 层由 Passport JwtStrategy 完成。Middleware 的过期检查仅用于决定是否显示登录页，防止无效请求到达后端。

### 4.4 Cookie 清理策略

`clearAuthCookie()` 处理多域名场景：

```typescript
function clearAuthCookie(request: NextRequest, response: NextResponse) {
  const hostname = request.nextUrl.hostname;
  const configuredDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  const domains = new Set<string | null>([null]);

  if (configuredDomain) domains.add(configuredDomain);
  if (hostname.endsWith('joyminis.com')) domains.add('.joyminis.com');

  for (const domain of domains) {
    response.cookies.set('auth_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/',
      maxAge: 0,           // 立即过期
      ...(domain ? { domain } : {}),
    });
  }
}
```

需要清理多个 domain 的原因是：不同子域名（admin.joyminis.com、app.joyminis.com）可能共享同一个 cookie domain `.joyminis.com`，退出登录时必须清除所有关联的 cookie。

### 4.5 与 HttpClient 的配合

Middleware 只是**路由级守卫**，真正的 Token 管理由 [`HttpClient`](../../apps/admin-next/src/api/http.ts) 完成：

- `getToken()` / `getRefreshToken()` — 从 Cookie 读取
- `setAuthTokens()` — 写回 Cookie（httpOnly）
- `handle401AndRetry()` — 收到 401 后尝试 refresh → 重试
- `refreshAccessToken()` — 调用 refresh API 获取新 Token

```
Admin 操作 → HttpClient 请求
    │
    ├─ 200 → 正常返回
    │
    └─ 401 → handleUnauthorized()
         ├─ 尝试 refreshAccessToken()
         │    ├─ 成功 → 更新 cookie → 重试原请求
         │    └─ 失败 → clearAuthCookie() → 跳转 /login
         └─ 取消刷新锁（单飞模式）
```

`refreshAccessToken()` 的**单飞模式**（同一时间只有一个 refresh 请求在途）确保多个并发请求不会导致多次 refresh：

```typescript
private async refreshAccessToken(): Promise<string | null> {
  this.refreshPromise = (async () => {
    // ... 调用 refresh API
    const newAccess = res.data.accessToken;
    this.setAuthTokens(newAccess, res.data.refreshToken);
    return newAccess;
  })();

  return this.refreshPromise;
}
```

---

## 5. 跨平台 Token 流程对比

### 5.1 登录流程

| 步骤 | Flutter | admin-next |
|------|---------|-----------|
| 1 | 用户输入凭证 | 管理员输入凭证 |
| 2 | `POST /auth/login` → 获取 Token | `POST /admin/auth/login` → 获取 Token |
| 3 | `Http.setToken(access)` — 设置 Axios header | `setAuthTokens(access, refresh)` — 设置 httpOnly cookie |
| 4 | `storage.save(access, refresh)` — SecureStorage | Cookie 自动持久化（浏览器） |
| 5 | `state = authenticated` — Riverpod 状态更新 | Middleware 下次请求自动识别 |
| 6 | `appRouter.go('/home')` — 导航 | 页面重定向到 `/` |
| 7 | 并行 fetchProfile + fetchBalance | 使用 Server Component 获取数据 |

### 5.2 Token 刷新流程

| 步骤 | Flutter | admin-next |
|------|---------|-----------|
| 1 | HTTP 请求收到 401 | HTTP 请求收到 401 |
| 2 | `handle401AndRetry()` 触发 | `handleUnauthorized()` 触发 |
| 3 | 调用 refresh API → 获取新 Token | 调用 refresh API → 获取新 Token |
| 4 | `AuthNotifier.updateTokens()` | `setAuthTokens()` — 更新 cookie |
| 5 | 重试原始请求 | 重试原始请求 |
| 6 | 单飞模式（`refreshPromise` 互斥） | 单飞模式（`refreshPromise` 互斥） |

### 5.3 退出登录流程

| 步骤 | Flutter | admin-next |
|------|---------|-----------|
| 1 | `storage.clear()` — 清除 SecureStorage | `clearAuthCookie()` — 清除多域名 cookie |
| 2 | `Http.clearToken()` — 清除 header | HTTP 客户端清除本地 Token 引用 |
| 3 | `LocalDatabaseService.close()` | - |
| 4 | `state = AuthState.initial()` — 重置状态 | Middleware 下次请求时识别无 Token |
| 5 | `appRouter.go('/home')` | 跳转 `/login` |

### 5.4 安全机制对比

| 机制 | Flutter | admin-next |
|------|---------|-----------|
| Token 存储 | `FlutterSecureStorage`（加密 Keychain/Keystore） | httpOnly cookie（不可 JS 读取） |
| 传输层 | `Authorization: Bearer` header | `Cookie: auth_token=...` |
| CSRF 防护 | N/A（移动端不存在） | `sameSite: 'strict'` |
| 过期检查 | API 返回 401 后触发 | Edge Middleware 预检 + API 验证 |
| 多平台 | 移动端 Secure / Web SharedPrefs | Edge Runtime (Cloudflare Workers) |

---

## 6. 双密钥策略——Client vs Admin 隔离

这是本系统最关键的认证架构决策：

```
Client Token (JWT_SECRET)
├─ 签发: POST /auth/login
├─ type: 'client'
├─ 验证: JwtAuthGuard → JwtStrategy (Passport)
└─ 用途: Flutter App API 请求

Admin Token (ADMIN_JWT_SECRET)
├─ 签发: POST /admin/auth/login
├─ type: 'admin', 额外 payload: username
├─ 验证: AdminJwtAuthGuard (手工) 或 JwtStrategy (Passport)
└─ 用途: admin-next 后台 API 请求
```

**为何需要双密钥？**

- **最小权限原则**：Client Token 无法访问 Admin API，即使 client 密钥泄露
- **独立轮换**：可单独轮换 `ADMIN_JWT_SECRET` 不影响普通用户
- **Payload 差异**：Admin Token 携带 `username`，Client Token 不需要
- **Guard 差异**：AdminJwtAuthGuard 还可结合 `RolesGuard` 做细粒度权限

---

## 7. 与 C2 KYC 的认证交叉

KYC 系统（[`full-stack-kyc-verification.md`](./full-stack-kyc-verification.md)）和认证系统存在交叉：

1. **DeviceSecurityGuard**：与 JWT 守卫组合使用，在认证基础上验证设备指纹
2. **KYC 状态路由**：`KycGuard.ensure()` 依赖 `userProvider` 中的 `kycStatus`，而 `userProvider` 依赖 `authProvider` 的认证状态
3. **认证后的数据预热**：`AuthNotifier.login()` 的 `Future.wait` 中并行 fetchProfile，profile 中包含 `kycStatus`

典型的依赖链：
```
authProvider.isAuthenticated === true
    → userProvider.fetchProfile() 可执行
        → profile.kycStatus 可用
            → KycGuard.ensure() 可决策
```

---

## 8. 总结

全栈认证体系的核心设计要点：

1. **双密钥 JWT**：`JWT_SECRET` 与 `ADMIN_JWT_SECRET` 隔离 client 和 admin 认证域
2. **动态密钥选择**：`secretOrKeyProvider` 根据 token `type` 字段选择对应密钥验证
3. **Flutter 状态机**：`AuthNotifier` 管理登录/登出/刷新全生命周期，Token 加密存储在移动端
4. **Edge Middleware**：Next.js Edge Runtime 无服务器预检，httpOnly cookie 防 XSS 窃取
5. **刷新单飞模式**：401 并行请求通过 `refreshPromise` 互斥，确保只刷新一次
6. **三层 Guard**：`JwtAuthGuard`（强制）、`OptionalJwtAuthGuard`（可选）、`AdminJwtAuthGuard`（手工）

### 相关文章

- [`auth-notifier-token-storage-auth-state-machine.md`](../flutter/auth-notifier-token-storage-auth-state-machine.md) — Flutter 端认证状态机深度分析
- [`full-stack-kyc-verification.md`](./full-stack-kyc-verification.md) — C2 全栈 KYC（认证交叉）
- [`end-to-end-push-notification.md`](./end-to-end-push-notification.md) — C1 端到端推送通知
- [`smart-table-generic-data-grid.md`](../admin/smart-table-generic-data-grid.md) — Admin API PermissionsGuard 权限控制
