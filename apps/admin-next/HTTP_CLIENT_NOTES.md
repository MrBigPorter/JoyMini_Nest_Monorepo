# Admin-Next HTTP 客户端 — 问题记录与学习笔记

> 记录日期：2026-03-19  
> 涉及文件：`src/api/http.ts` · `src/components/layout/Sidebar.tsx`

---

## 零、`AUTH_COOKIE_DOMAIN` 与 `CORS_ORIGIN`（必须搞清楚）

这两个变量经常被混淆，但职责完全不同：

| 变量                 | 放在哪里                       | 负责什么                                                         | 不对会怎样                                                       |
| -------------------- | ------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `AUTH_COOKIE_DOMAIN` | API 后端环境变量（`apps/api`） | 决定 `Set-Cookie` 的生效域名（浏览器把登录态 Cookie 存到哪个域） | 登录接口成功，但 `admin` 页面不跳首页 / 被 middleware 打回登录页 |
| `CORS_ORIGIN`        | API 后端环境变量（`apps/api`） | 决定哪些前端来源可以跨域调用 API                                 | 浏览器报 CORS 错误或 Axios `ERR_NETWORK`                         |

### 0.1 为什么两个都要配？

Admin 的登录链路是跨子域：

- 前端：`https://admin.joyminis.com`
- API：`https://api.joyminis.com`

登录时前端会调用 API 登录，再调用 `set-cookie` 写入 HTTP-only `auth_token`。

- `CORS_ORIGIN` 解决的是：**这个跨域请求能不能发**。
- `AUTH_COOKIE_DOMAIN` 解决的是：**请求成功后，Cookie 能不能被 admin 域读取**。

只配其一都不够：

- 只配 CORS，不配 Cookie Domain：请求成功，但 Cookie 只在 `api.*` 生效，`admin` middleware 读不到。
- 只配 Cookie Domain，不配 CORS：浏览器跨域直接被拦，登录请求发不出去。

### 0.2 推荐值（生产）

```dotenv
# API 允许 Admin 域跨域
CORS_ORIGIN=https://admin.joyminis.com

# 让 auth_token 在 joyminis.com 所有子域共享
AUTH_COOKIE_DOMAIN=.joyminis.com
```

### 0.3 开发环境建议

本地开发通常是 `localhost`，不要强行写生产域：

- `AUTH_COOKIE_DOMAIN` 在 dev 可不设置（留空）
- `CORS_ORIGIN` 按实际前端地址配置（可逗号分隔多个）

示例：

```dotenv
CORS_ORIGIN=http://localhost:4001,http://127.0.0.1:4001,https://admin-dev.joyminis.com
# AUTH_COOKIE_DOMAIN=   # dev 通常不配
```

### 0.4 典型故障对照

| 现象                                           | 大概率原因                                          |
| ---------------------------------------------- | --------------------------------------------------- |
| 登录接口 `200`，但页面停在登录页不跳转         | `AUTH_COOKIE_DOMAIN` 未配置或不正确                 |
| Console 报 `ERR_NETWORK`，Network 看起来有请求 | Nginx 与后端重复加 CORS 头，或 `CORS_ORIGIN` 不匹配 |
| 打开 `/login` 又被瞬间跳回 `/`（或反复跳）     | Cookie 与 localStorage 状态不一致，登出未清 cookie  |

### 0.5 最小验证（上线后）

1. 看 `set-cookie` 响应头：

- 请求：`POST /api/v1/auth/admin/set-cookie`
- 响应里应有：`Set-Cookie: auth_token=...; Domain=.joyminis.com; ...`

2. 看浏览器 Cookie：

- DevTools → Application → Cookies
- 在 `https://admin.joyminis.com` 下能看到 `auth_token`（HttpOnly）

3. 看 middleware 行为：

- 已登录访问 `/login`，应 302 到 `/`
- 未登录访问受保护页，应 302 到 `/login`

---

## 一、401 登录失效后死循环问题

### 🐛 问题现象

Token 过期后，浏览器控制台不断滚动：

```
[HTTP Request] GET /v1/admin/applications/pending-count
GET https://admin-dev.joyminis.com/api/v1/admin/applications/pending-count 401 (Unauthorized)
Error: Unauthorized
Navigated to https://admin-dev.joyminis.com/   ← 跳了但又回来了
[HTTP Request] GET /v1/admin/applications/pending-count  ← 再次请求
...
```

页面一直在 Dashboard，没有跳去 `/login`，Sidebar 的 60s 轮询不断触发 401。

---

### 🔍 根本原因：Cookie 没有清

**Auth 双层存储架构**

| 存储                          | 用途                                                   |
| ----------------------------- | ------------------------------------------------------ |
| `localStorage.auth_token`     | 客户端 JS 读取，用于请求头 `Authorization: Bearer ...` |
| HTTP-only Cookie `auth_token` | 服务端 `middleware.ts` 读取，决定路由守卫              |

两层都有，但 `handleUnauthorized()` 原始实现**只清了 localStorage，没清 Cookie**：

```typescript
// ❌ 原始代码（有 bug）
private handleUnauthorized() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');
  window.location.href = '/login';   // ← Cookie 还在！
}
```

**死循环路径：**

```
Token 过期
  ↓
Sidebar polling → GET /pending-count → 401
  ↓
handleUnauthorized() → localStorage 清空 → window.location.href = '/login'
  ↓
浏览器发起 /login 请求 → middleware.ts 执行
  ↓
middleware: Cookie 还在 → token 有值 → 302 重定向回 /
  ↓
页面重新加载 Dashboard → Sidebar 挂载 → 60s polling 开始
  ↓
再次 401 → 再次 handleUnauthorized → 无限循环 ♻️
```

**关键代码（middleware.ts）：**

```typescript
// middleware 只检查 Cookie 是否存在，不验证是否有效
const token = request.cookies.get('auth_token')?.value;

if (!token && !isPublicPath) {
  return NextResponse.redirect(new URL('/login', request.url));
}
if (token && isPublicPath) {
  return NextResponse.redirect(new URL('/', request.url)); // ← 有 Cookie → 打回 /
}
```

> **为什么 middleware 不验证 token 有效性？**  
> 验证需要密钥 + 网络调用，Edge Runtime 成本高。通常在 middleware 做"存在性检查"，
> 真正的有效性验证交给 API 层（返回 401 时客户端处理）。这是正常的设计选择，
> 但要求**登出时必须同步清除 Cookie**。

---

### ✅ 解决方案

`handleUnauthorized` 改为 async，先 `await` 清除 Cookie，再跳转：

```typescript
// ✅ 修复后
private async handleUnauthorized() {
  if (this._unauthorizedHandling) return;
  this._unauthorizedHandling = true;

  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');

  if (window.location.pathname !== '/login') {
    this.toastError('Unauthorized, please log in again');

    // ① 先清 Cookie，再跳转
    //    如果先跳转，browser 发 /login 请求时 Cookie 还在，
    //    middleware 会把 /login 重定向回 /，死循环
    await this.instance
      .post('/v1/auth/admin/clear-cookie', {}, {
        headers: { 'x-skip-auth-refresh': '1' },
      })
      .catch(() => {}); // 忽略错误，清不掉也要跳转

    // ② Cookie 已清，middleware 现在会放行 /login
    window.location.href = '/login';
  }

  queueMicrotask(() => {
    this._unauthorizedHandling = false;
  });
}
```

**修复后的路径：**

```
Token 过期
  ↓
handleUnauthorized()
  → 清 localStorage
  → await POST /clear-cookie  ← Cookie 被清除
  → window.location.href = '/login'
  ↓
middleware: Cookie 不存在 → 放行 /login ✅
  ↓
用户看到登录页 ✅
```

---

## 二、`void` vs `await` 在 async 调用中的差别

修复过程中遇到第二个 bug：`handleHttpError` 里用 `void` 调用 `handleUnauthorized`，
导致并发测试中 `window.location.href` 在断言时还没被设置。

### 场景：refresh 请求自身返回 401

```
并发请求 A、B 同时 401
  ↓
都调用 refreshAccessToken()  → 共用同一个 refreshPromise（单飞）
  ↓
refresh API 本身也返回 401
  ↓
error interceptor 调用 handleHttpError(error)
  ↓
handleHttpError: void this.handleUnauthorized()  ← fire-and-forget
  ↓
handleUnauthorized 开始执行但挂起在 await clear-cookie
  ↓
主流程继续: refreshAccessToken catch → 返回 null
  ↓
A、B 得到 null → 分别 await handleUnauthorized()
  ↓
_unauthorizedHandling = true → A、B 的调用直接 return
  ↓
Promise.allSettled 完成，但 window.location.href 还没设置！
  （clear-cookie 还没回来，location 还是原值）
```

### 解决方法：`x-skip-auth-refresh` 请求不再触发 `handleUnauthorized`

Refresh / set-cookie / clear-cookie 这类内部请求使用了 `x-skip-auth-refresh` 头，
它们的 401 由调用方统一处理，`handleHttpError` 里不应再重复触发：

```typescript
private handleHttpError(error: any) {
  if (error.response) {
    const { status } = error.response;
    if (status === 401) {
      // 内部请求（refresh / set-cookie / clear-cookie）不重复触发登出
      if (!error.config?.headers?.['x-skip-auth-refresh']) {
        void this.handleUnauthorized();
      }
      return;
    }
    // ...
  }
}
```

---

## 三、业务 code:401 重试后仍 401 → 无限 refresh 循环

成功拦截器（HTTP 200 但业务 code=401）原先没有 `_retry` 保护：

```typescript
// ❌ 原始代码
if (data.code === 401) {
  return this.handle401AndRetry(config); // 没检查 _retry！
}

// 如果 refresh 成功，retry 后后端仍返回业务 401（如权限不足）
// → 再次进入这里 → 再次 refresh → 无限循环
```

```typescript
// ✅ 修复后
if (data.code === 401) {
  const retryConfig = res.config as InternalAxiosRequestConfig & {
    _retry?: boolean;
  };
  if (retryConfig._retry) {
    // 已重试过，直接登出，不再 refresh
    await this.handleUnauthorized();
    return Promise.reject(data);
  }
  return this.handle401AndRetry(retryConfig);
}
```

---

## 四、Sidebar polling 优化

```typescript
// ✅ 优化后
const { data: pendingData } = useRequest(() => applicationApi.pendingCount(), {
  pollingInterval: 60_000,
  pollingWhenHidden: false, // 切后台时暂停，避免不必要的请求
  onError: () => {
    // 静默处理：401 已由 http 层统一跳转，这里不再弹 toast
  },
});
```

---

## 五、知识点总结

### 为什么 middleware 不验证 token？

| 方案                            | 优点                 | 缺点                              |
| ------------------------------- | -------------------- | --------------------------------- |
| middleware 只检查 Cookie 存在性 | 极快，无网络开销     | 需要客户端主动清 Cookie           |
| middleware 验证 token 签名      | 更安全，不依赖客户端 | 需要访问密钥，Edge Runtime 有限制 |
| middleware 调用 API 验证        | 最准确               | 每次路由都多一次 API 调用，延迟高 |

本项目选方案一，**副作用是登出必须清 Cookie**（包括 token 过期强制登出场景）。

### `await` 的时机很重要

```typescript
// async 函数里，await 之前的代码是同步的
async function handleUnauthorized() {
  flag = true; // 同步执行
  queueMicrotask(reset); // 注册微任务（同步注册，但稍后执行）
  await asyncCall(); // ← 挂起，控制权交出
  // ... 这之后的代码，要等 asyncCall 完成才继续
}
```

`queueMicrotask` 注册的回调在**当前微任务队列清空后立即执行**，远早于 `asyncCall` 完成。
所以如果把 flag 重置放在 `queueMicrotask` 里，并发调用者在 `asyncCall` 期间就能看到 flag = false，
保护失效。

**正确做法**：把 `queueMicrotask` 放在函数最末尾（`await` 完成之后），
或者用 `finally` 块：

```typescript
async function handleUnauthorized() {
  flag = true;
  try {
    await asyncCall();
    doWork();
  } finally {
    queueMicrotask(() => {
      flag = false;
    });
  }
}
```

### `x-skip-auth-refresh` 的约定

项目约定：refresh / set-cookie / clear-cookie 这三个接口调用时加 `x-skip-auth-refresh: '1'` 头，
HTTP 客户端看到这个头，在 **请求拦截器** 里不注入 token，在 **错误拦截器** 里不触发 refresh/登出，
避免无限递归。

```
普通请求 → 401 → handle401AndRetry → 调用 refresh（带 skip 头）→ 失败 → handleUnauthorized → 登出
                                           ↑
                           skip 头阻止这里再次触发 handle401AndRetry
```

---

## 六、测试要点

`handleUnauthorized` 改为 async 后，所有触发它的测试都需要 mock `clear-cookie` 端点，
否则测试中的网络请求会 bypass（`onUnhandledRequest: 'bypass'`），
`clear-cookie` 报网络错误，但 `.catch(() => {})` 吞掉错误，测试仍能通过——
只是不够严谨。最好显式 mock：

```typescript
server.use(
  mswHttp.post('http://localhost/api/v1/auth/admin/clear-cookie', () =>
    HttpResponse.json({ code: 10000, message: 'ok', data: { ok: true } }),
  ),
);
```

受影响的测试场景：

- 业务 code=401（无 refresh token）
- HTTP 401（无 refresh token）
- 并发 401 + refresh 失败
- refresh 成功但 retry 仍返回业务 401
