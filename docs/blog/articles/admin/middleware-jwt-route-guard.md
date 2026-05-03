---
title: 'Middleware JWT 路由守卫 — Edge Runtime 下的认证防线'
slug: middleware-jwt-route-guard
tags: Next.js, Admin, Middleware, JWT, Authentication, Edge Runtime, Security, TypeScript
description: 管理后台通过 Edge Runtime 下的 Middleware 实现路由级 JWT 认证守卫，在请求到达页面之前执行服务端验证，构成双层安全防线的第一道屏障。
---

# Middleware JWT 路由守卫 — Edge Runtime 下的认证防线

> **难度**: ⭐⭐⭐⭐  
> **适用场景**: 任何需要服务端路由保护的 Next.js 应用，尤其是部署在 Cloudflare Workers / OpenNext 边缘环境  
> **源码位置**: [`middleware.ts`](../../../../apps/admin-next/src/middleware.ts)

## 一、为什么需要 Middleware 路由守卫？

管理后台的安全防线不能只靠客户端——任何 **client-side only** 的校验都可以被绕过。Middleware 在 **请求到达页面之前** 执行，是服务端第一道防线：

```
用户请求 → [Middleware] → [Page Component / API Route]
                │
         ┌──────┴──────┐
         │ No token    │ Token expired
         ↓             ↓
     redirect /login  clear cookie + redirect
```

### 1.1 双防线架构

| 防线 | 层级 | 位置 | 职责 |
|------|------|------|------|
| **Middleware** | 服务端 Edge | `middleware.ts` | Cookie 中的 `auth_token` JWT 校验 |
| **HttpClient** | 客户端 CSR | [`http.ts`](../../../../apps/admin-next/src/api/http.ts) | 401 拦截 + 单飞 refresh + 重定向 |
| **useAuthStore** | 客户端 CSR | [`useAuthStore.ts`](../../../../apps/admin-next/src/store/useAuthStore.ts) | Zustand 状态同步 + `checkAuth()` 恢复 |

Middleware 解决的是 **页面级访问控制**——未登录用户根本看不到 HTML，而不是等 JS 加载完再跳转。

### 1.2 与 Frontend Blog Middleware 的对比

| 项目 | Frontend Blog | Admin Next |
|------|--------------|------------|
| 中间件路径 | [`frontend-blog/middleware.ts`](../../../../apps/frontend-blog/middleware.ts) | [`admin-next/middleware.ts`](../../../../apps/admin-next/src/middleware.ts) |
| 职责 | i18n 路由重写 + 语言检测 | JWT 认证 + 路由守卫 |
| Cookie | `NEXT_LOCALE` | `auth_token` (httpOnly) |
| 运行时 | Edge | Edge (Cloudflare Workers) |
| 跳转 | `/` ↔ 本地化路径 | `/` ↔ `/login` |

## 二、核心设计

### 2.1 路由分类

Middleware 定义了三种路由类别：

```ts
const PUBLIC_PATHS = ['/login', '/register-apply', '/privacy-policy'];
```

| 类别 | 路径 | 有有效 token | 无 token | token 无效 |
|------|------|-------------|---------|-----------|
| Login | `/login` | → `/` (防止重复登录) | ✅ 放行 | ✅ 放行 + 清理 cookie |
| 公开页 | `/register-apply`, `/privacy-policy` | → `/` | ✅ 放行 | ✅ 放行 + 清理 cookie |
| 受保护 | 其他所有页面 | ✅ 放行 | → `/login` | → `/login` + 清理 cookie |

### 2.2 JWT 解码与过期验证

Middleware 运行在 **Edge Runtime**（Cloudflare Workers），无法使用 `jsonwebtoken` 库（依赖 Node.js crypto）。解决方案：**纯 base64 解码**。

```ts
function decodeJwtPayload(token: string): { exp?: number } | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;  // 格式校验

  try {
    const base64 = segments[1]
      .replace(/-/g, '+')   // URL-safe base64 → standard base64
      .replace(/_/g, '/');
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '=',
    );
    const json = atob(padded);  // Web API atob — Edge Runtime 支持
    return JSON.parse(json) as { exp?: number };
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

**为什么不用 try/catch 全部包住？** 因为需要区分「格式错误」和「过期」——格式错误强制清 cookie，但过期后会先清 cookie 再跳转。

### 2.3 主流程

[`middleware.ts:68-124`](../../../../apps/admin-next/src/middleware.ts:68) 的主函数是一个清晰的三叉决策树：

```ts
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Step 1: 跳过静态资源
  if (pathname.startsWith('/_next') || /* ... */) {
    return NextResponse.next();
  }

  const token = request.cookies.get('auth_token')?.value ?? null;
  const hasToken = token !== null;
  const isTokenInvalid = hasToken && isJwtExpiredOrMalformed(token);
  const isPublicPath = PUBLIC_PATHS.some((p) => isExactOrSubPath(pathname, p));

  // Step 2: /login 特殊处理
  if (pathname === '/login') {
    if (hasToken && !isTokenInvalid) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    const response = NextResponse.next();
    if (isTokenInvalid) clearAuthCookie(request, response);
    response.headers.set('x-pathname', pathname);
    return response;
  }

  // Step 3: 未登录访问受保护页
  if ((!hasToken || isTokenInvalid) && !isPublicPath) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    if (isTokenInvalid) clearAuthCookie(request, response);
    return response;
  }

  // Step 4: 已登录访问公开页
  if (hasToken && !isTokenInvalid && isPublicPath) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Step 5: 正常放行
  const response = NextResponse.next();
  if (isTokenInvalid) clearAuthCookie(request, response);
  response.headers.set('x-pathname', pathname);
  return response;
}
```

**决策树可视化**：

```
                  ┌─────────────┐
                  │  请求进入   │
                  └──────┬──────┘
                         │
                    ┌────┴────┐
                    │ 静态资源 │──→ NextResponse.next()
                    └────┬────┘
                         │
                    ┌────┴────┐
                 ┌──┤ /login? ├──┐
                 │  └─────────┘  │
            ┌────┴────┐    ┌────┴────┐
            │ 有效token│    │无/无效  │
            │ → /      │    │ → 放行  │
            └──────────┘    └─────────┘
                         │
                    ┌────┴────┐
                    │ 受保护?  │
                    └────┬────┘
                   ┌────┴────┐
                   │   No    │ Yes
                   │         │
              ┌────┴────┐    │
              │已登录?   │    │
              └────┬────┘    │
             ┌────┴────┐    │
             │ Yes→ /  │ No │ → /login
             └─────────┘    │
                         │
                    ┌────┴────┐
                    │ x-pathname│
                    │  → 放行  │
                    └─────────┘
```

### 2.4 多域名 Cookie 清理

`clearAuthCookie` 函数处理了一个常见但容易被忽略的边界：**多域名 cookie 清理**。

```ts
function clearAuthCookie(request: NextRequest, response: NextResponse) {
  const hostname = request.nextUrl.hostname;
  const configuredDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  const domains = new Set<string | null>([null]);  // null = 当前域名

  if (configuredDomain) {
    domains.add(configuredDomain);
  }
  if (hostname.endsWith('joyminis.com')) {
    domains.add('.joyminis.com');  // 通配子域名
  }

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

**为什么需要多域名清理？**

1. `null`（无 domain）— 清除 `joyminis.com` 域上的 cookie
2. `AUTH_COOKIE_DOMAIN` — 自定义配置，通常是 `.joyminis.com`
3. `.joyminis.com` — 通配符，清除 `admin.joyminis.com`、`blog.joyminis.com` 等子域名的 cookie

不这样做的话，用户从 `admin.joyminis.com` 退出后，`blog.joyminis.com` 的 `auth_token` cookie 仍然有效。

### 2.5 `x-pathname` 头传递

Middleware 在 `NextResponse` 中设置 `x-pathname` 请求头：

```ts
response.headers.set('x-pathname', pathname);
```

这个头在客户端通过 `useAuthStore` 的 `checkAuth()` 读取，用于：

- 登录后恢复到原来要访问的页面（而不是固定跳首页）
- SSR 期间也保持路径感知

## 三、与客户端认证的衔接

### 3.1 双层 Token 存储

```
┌──────────────────────────────────────────────────┐
│                   Middleware                      │
│  读取: request.cookies.get('auth_token')          │
│  写入: response.cookies.set('auth_token', ...)    │
│  校验: 解码 JWT payload → 检查 exp                │
└──────────────────────────────────────────────────┘
                        ▲ HTTP only, Secure
                        │
┌──────────────────────────────────────────────────┐
│                useAuthStore (Zustand)             │
│  读取: localStorage.getItem('auth_token')         │
│  写入: localStorage.setItem('auth_token', token)  │
│  校验: checkAuth() → 拦截器 401 -> refresh        │
│         logout() → 清理两端                       │
└──────────────────────────────────────────────────┘
```

**同步点**：当用户通过 `login()` 登录时：

```ts
// useAuthStore
login: async (token, role, userInfo, refreshToken) => {
  localStorage.setItem('auth_token', token);     // 客户端存储
  await authApi.setCookie(token);                 // 服务端 Cookie (httpOnly)
  set({ isAuthenticated: true, token, ... });
};
```

`authApi.setCookie(token)` 调用后端 API 设置 httpOnly cookie，这样后续页面刷新的请求会自动携带 token。

### 3.2 退出时的三路清理

[`useAuthStore.logout()`](../../../../apps/admin-next/src/store/useAuthStore.ts:67) 执行：

```ts
logout: async () => {
  await Promise.allSettled([
    authApi.logout(),          // 1. 后端清理 refresh token
    authApi.clearCookie(),     // 2. 后端清理 httpOnly cookie
  ]);
  // 3. 前端清理
  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');
  sessionStorage.removeItem('csrf_token');
  set({ isAuthenticated: false, token: null, ... });
  window.location.replace('/login');
};
```

同时 Middleware 的 `clearAuthCookie` 在检测到无效 token 时也会主动清理。**三路清理确保没有残留**。

## 四、Edge Runtime 兼容性

### 4.1 可用的 Web API

Middleware 部署在 **Cloudflare Workers Edge Runtime**，与 Node.js 不同的 API 限制：

| API | 可用性 | 在 middleware.ts 中的使用 |
|-----|--------|------------------------|
| `atob` / `btoa` | ✅ Edge 原生 | base64 解码 JWT payload |
| `crypto.subtle` | ✅ | — |
| `TextEncoder` / `TextDecoder` | ✅ | — |
| `Buffer` | ❌ Node only | 用 `atob` + `replace` 替代 |
| `jsonwebtoken` | ❌ Node only | 手动 base64 解码 |
| `fs` / `path` | ❌ Node only | — |

### 4.2 Config Matcher

```ts
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

这个 matcher 确保 Middleware **只处理页面路由**，跳过：

- `/_next/static/*` — 静态构建产物
- `/_next/image/*` — 图片优化
- `/favicon.ico` — favicon

所有其他路径（包括 API routes、页面路由）都经过 Middleware。这也意味着 **API routes 也会受到保护**——这是一个安全特性，防止未认证请求直接打到 API 层。

## 五、边界情况与测试

### 5.1 状态表

| 场景 | token 状态 | 当前路径 | 期望行为 |
|------|-----------|---------|---------|
| 首次访问 | 无 | `/users` | 302 → `/login` |
| 已登录刷新 | 有效 | `/users` | 200 ✅ |
| token 过期 | 无效 | `/users` | 302 → `/login` + 清理 cookie |
| 已登录访问登录页 | 有效 | `/login` | 302 → `/` |
| 无 token 访问登录页 | 无 | `/login` | 200 ✅ |
| 过期 token 访问登录页 | 无效 | `/login` | 200 + 清理 cookie |
| 访问公开页 | 有效 | `/register-apply` | 302 → `/` |
| 静态资源 | 任意 | `/_next/static/...` | 200 ✅ (跳过) |

### 5.2 测试策略

[`middleware.test.ts`](../../../../apps/admin-next/src/__tests__/middleware.test.ts) 覆盖了所有状态组合：

```ts
// 典型测试用例
it('redirects to login when no token', async () => {
  const req = new NextRequest(new URL('http://localhost:3000/users'));
  const res = await middleware(req);
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('http://localhost:3000/login');
});

it('allows public paths without token', async () => {
  const req = new NextRequest(new URL('http://localhost:3000/login'));
  const res = await middleware(req);
  expect(res.status).toBe(200);
});
```

### 5.3 时序边界

| 场景 | 时序问题 | 解决方案 |
|------|---------|---------|
| 登录后立刻刷新 | Cookie 尚未到达浏览器 | login() 先写 localStorage，Middleware 检查 cookie 失败 → 跳转 login → checkAuth() 从 localStorage 恢复 |
| 多 tab 同时过期 | 多个 tab 同时触发 refresh | HttpClient 的 `refreshPromise` 单飞模式 |
| 并发登出 | `Promise.allSettled` 确保即使 API 失败也清理本地 | `finally` 块无条件清理 |

## 六、总结

[`middleware.ts`](../../../../apps/admin-next/src/middleware.ts) 只有 **129 行**，但解决了管理后台安全的核心问题：

| 机制 | 实现 | 作用 |
|------|------|------|
| `decodeJwtPayload` | 纯 base64 解码 | Edge Runtime 兼容 |
| `isJwtExpiredOrMalformed` | 检查 exp 字段 | 防止过期 token |
| `clearAuthCookie` | 多域名删除 | 跨子域名安全退出 |
| `x-pathname` | 请求头传递 | 登录后路径恢复 |
| 三叉决策树 | `if-else` 全覆盖 | 4 种路径类型正确处理 |

**关键原则**：Middleware 不做复杂的权限校验（角色、资源级别由后端 Guard 负责），它只回答一个问题——**"这个请求有没有有效的登录 token？"** 保持简单、快速、可测试。

---

**相关阅读**：

- [A6: Zustand 认证存储 + SSR Hydration 双策略](./zustand-auth-store-ssr-hydration.md) — 客户端认证状态管理
- [A4: HttpClient 请求层 — 双环境配置 + 单飞 Token 刷新](./http-client-auth-refresh-retry.md) — 401 拦截与 Token 刷新
- [A2: useChatSocket — Admin 客服实时通信](./use-chat-socket-realtime-customer-service.md) — WebSocket 实时通信
