---
title: 'CSRF 双中间件保护：智能跳过策略 + Token 双存储'
slug: csrf-double-middleware-protection
description: 基于 NestJS 中间件的 CSRF 防护体系，支持 JWT/Webhook/Auth 路由智能跳过，Cookie + Session 双存储 Token 方案，涵盖 CsrfTokenMiddleware 和 CsrfMiddleware 的双中间件架构。
tags:
  - NestJS
  - CSRF
  - Security
  - Middleware
  - Cookie
  - Session
  - TypeScript
---

# CSRF 双中间件保护：智能跳过策略 + Token 双存储

> 基于 NestJS 中间件的 CSRF 防护体系 — 支持 JWT/Webhook/Auth 路由智能跳过，Cookie + Session 双存储

## Table of Contents

- [1. 概述](#1-概述)
- [2. 双中间件架构](#2-双中间件架构)
  - [2.1 CsrfTokenMiddleware — Token 生成](#21-csrftokenmiddleware--token-生成)
  - [2.2 CsrfMiddleware — Token 验证](#22-csrfmiddleware--token-验证)
- [3. 智能跳过策略](#3-智能跳过策略)
  - [3.1 方法白名单](#31-方法白名单)
  - [3.2 JWT Bearer Token 跳过](#32-jwt-bearer-token-跳过)
  - [3.3 路径白名单](#33-路径白名单)
- [4. Token 验证机制](#4-token-验证机制)
- [5. 双存储策略](#5-双存储策略)
- [6. 注册方式](#6-注册方式)
- [7. 安全分析](#7-安全分析)
- [8. 关键要点](#8-关键要点)

---

## 1. 概述

CSRF（Cross-Site Request Forgery）是一种利用用户已登录身份在第三方网站发起恶意请求的攻击。本项目采用 **同步器 Token 模式（Synchronizer Token Pattern）** — 服务器为每个会话生成唯一 Token，前端在写操作请求中携带该 Token，服务器验证匹配。

与标准 CSRF 实现的关键区别在于 **智能跳过策略**：由于项目同时使用 Session/Cookie 认证和 JWT Bearer Token 认证，中间件需要根据认证方式动态决定是否验证。

```
┌─────────────────────────────────────────────────────────────────┐
│                      CSRF Protection Flow                       │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  GET Request  │───▶│CsrfToken     │───▶│  Set Cookie      │   │
│  │  (页面加载)   │    │Middleware    │    │  + Response Header│   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  POST/PUT/   │───▶│CsrfMiddleware│───▶│ 智能跳过判断      │   │
│  │  PATCH/DELETE│    │(验证)        │    │ → Bearer? 跳过   │   │
│  └──────────────┘    └──────────────┘    │ → Whitelist? 跳过│   │
│                                           │ → 验证 Token     │   │
│                                           └──────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 双中间件架构

CSRF 保护由两个独立的 NestJS 中间件组成，职责分离：

| 中间件 | 职责 | 触发条件 | 操作 |
|--------|------|---------|------|
| [`CsrfTokenMiddleware`](apps/api/src/common/middleware/csrf.middleware.ts:103) | **Token 生成** | GET 请求 | 生成 Token → 设置 Cookie + 响应头 |
| [`CsrfMiddleware`](apps/api/src/common/middleware/csrf.middleware.ts:22) | **Token 验证** | POST/PUT/PATCH/DELETE | 智能跳过判断 → 验证 Token |

### 2.1 CsrfTokenMiddleware — Token 生成

只对 GET 请求生效，为每个需要 CSRF 保护的会话生成 Token：

```typescript
@Injectable()
export class CsrfTokenMiddleware implements NestMiddleware {
  use(req: RequestWithSession, res: Response, next: NextFunction) {
    if (req.method.toUpperCase() !== 'GET') return next();

    let csrfToken = req.cookies?.['csrf_token'] || req.session?.['csrf_token'];

    if (!csrfToken) {
      csrfToken = this.generateCsrfToken();
      
      // 设置到 cookie（前端可读）
      res.cookie('csrf_token', csrfToken, {
        httpOnly: false,     // 前端 JS 需要读取
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',  // 严格同站策略
        maxAge: 24 * 60 * 60 * 1000, // 24h
      });

      // 存储到 session（后端验证用）
      if (req.session) {
        req.session['csrf_token'] = csrfToken;
      }
    }

    // 响应头中附带，方便前端获取
    res.setHeader('X-CSRF-Token', csrfToken);
    next();
  }
}
```

### 2.2 CsrfMiddleware — Token 验证

对写操作请求进行多层过滤后验证 Token：

```typescript
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: RequestWithSession, res: Response, next: NextFunction) {
    // 1. 方法过滤：只验证写操作
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

    // 2. 健康检查跳过
    if (req.path === '/api/health') return next();

    // 3. JWT Bearer → 跳过（JWT 不自动携带）
    if (authHeader?.startsWith('Bearer ')) return next();

    // 4. 路径白名单
    if (path.startsWith('/api/v1/payment/')) return next();
    if (path.startsWith('/api/v1/webhook/')) return next();
    if (path.startsWith('/api/v1/auth/')) return next();
    if (path.startsWith('/api/v1/client/')) return next();
    if (path.startsWith('/api/v1/frontend/')) return next();

    // 5. Token 验证
    const csrfToken = req.headers['x-csrf-token'] || req.body?._csrf;
    if (!csrfToken) throw new ForbiddenException('CSRF token missing');
    // ... 验证格式 + 比对存储值
    next();
  }
}
```

---

## 3. 智能跳过策略

这是本实现最独特的设计。并非所有路由都需要 CSRF 保护，中间件通过多层过滤器决定是否验证。

### 3.1 方法白名单

| HTTP 方法 | CSRF 验证 | 说明 |
|-----------|----------|------|
| GET | ❌ 跳过 | 读取操作不会修改状态 |
| HEAD | ❌ 跳过 | 同 GET |
| OPTIONS | ❌ 跳过 | CORS 预检请求 |
| POST | ✅ **验证** | 写操作 |
| PUT | ✅ **验证** | 写操作 |
| PATCH | ✅ **验证** | 写操作 |
| DELETE | ✅ **验证** | 写操作 |

### 3.2 JWT Bearer Token 跳过

```typescript
const authHeader = req.headers.authorization;
if (authHeader && authHeader.startsWith('Bearer ')) return next();
```

**为什么 JWT 请求不需要 CSRF？**

CSRF 攻击的核心条件是：浏览器**自动携带**认证凭据（如 Cookie）到目标站点。但 JWT Bearer Token 满足 **"不会自动携带"** 条件：

1. JWT 存储在 `Authorization` 头中（非 Cookie）
2. 浏览器不会自动附加 `Authorization` 头
3. 第三方网站无法读取 Token 值来手动附加

因此，任何带有 `Bearer` 头的请求都不受 CSRF 威胁。

### 3.3 路径白名单

| 路径前缀 | 跳过原因 |
|---------|---------|
| `/api/health` | 健康检查，无认证 |
| `/api/v1/payment/` | 支付回调，使用签名验证 |
| `/api/v1/webhook/` | 第三方 Webhook，使用签名验证 |
| `/api/v1/auth/` | 登录/注册/刷新 Token，此时尚无会话 |
| `/api/v1/client/` | Flutter 客户端，始终使用 JWT |
| `/api/v1/frontend/` | 前端博客公开 API，无需认证 |

---

## 4. Token 验证机制

当请求进入验证阶段时，执行以下校验：

```
请求到达 CsrfMiddleware
       │
       ▼
┌─────────────────────────┐
│ 从请求头/体获取 Token    │
│ x-csrf-token | x-xsrf-  │
│ token | body._csrf      │
└───────────┬─────────────┘
            │
       ┌────▼────┐
       │ Token   │ NO ──→ ForbiddenException
       │ 存在?   │       "CSRF token missing"
       └────┬────┘
            │ YES
            ▼
       ┌──────────┐
       │ 64位十六  │ NO ──→ ForbiddenException
       │ 进制?     │       "Invalid CSRF token format"
       └────┬─────┘
            │ YES
            ▼
       ┌──────────┐
       │ Cookie   │ NO ──→ ForbiddenException
       │ 或       │       "No CSRF token found in session"
       │ Session  │
       │ 有值?    │
       └────┬─────┘
            │ YES
            ▼
       ┌──────────┐
       │ 请求值 = │ NO ──→ ForbiddenException
       │ 存储值?  │       "CSRF token mismatch"
       └────┬─────┘
            │ YES
            ▼
          next()
```

Token 格式检验使用正则 `/^[a-f0-9]{64}$/i` — 确保 Token 是 64 位十六进制字符串（32 字节 × 2 字符/字节）。

---

## 5. 双存储策略

Token 同时存储在 **Cookie** 和 **Session** 中，各有用途：

| 存储位置 | 用途 | httpOnly | 说明 |
|---------|------|---------|------|
| Cookie `csrf_token` | 前端读取 | `false` | 前端 JS 读取后放入请求头 |
| Session `csrf_token` | 后端验证 | N/A | 中间件比对请求值与此值 |
| 响应头 `X-CSRF-Token` | 前端备用 | N/A | 可从响应头获取 |

**为什么双存储？**

- **Cookie**：`httpOnly: false` 允许前端 JS 读取，放入 `x-csrf-token` 请求头
- **Session**：服务器端可信存储，用于验证请求携带的 Token 是否匹配
- **`sameSite: 'strict'`**：Cookie 设置了 Strict 同站策略，即使 CSRF Token 泄露，跨站请求也不会携带 Cookie

**为什么不只用 Session？** Session 存储在服务端，前端需要额外 API 调用获取 Token。Cookie 方案前端可直接从 `document.cookie` 读取。

---

## 6. 注册方式

在 NestJS Module 中注册中间件：

```typescript
// app.module.ts 或对应模块
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CsrfTokenMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.GET })
      .apply(CsrfMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
```

`CsrfTokenMiddleware` 只需绑定 GET 路由，`CsrfMiddleware` 需要绑定所有路由（它内部做方法判断）。

---

## 7. 安全分析

| 攻击向量 | 防护机制 | 评级 |
|---------|---------|------|
| 跨站请求伪造 | Token 匹配 + `sameSite: strict` Cookie | ✅ 完整防护 |
| Token 暴力破解 | 64 位十六进制（128 位熵），暴力破解不可行 | ✅ 安全 |
| XSS 窃取 Token | Cookie 非 httpOnly，XSS 后可读取 | ⚠️ 需配合 XSS 防护 |
| Token 重放 | Token 24h 过期，但单次请求后不变更 | ⚠️ 可考虑每次使用后轮换 |
| JWT + CSRF 混合攻击 | Bearer 智能跳过，不存在此风险 | ✅ 安全 |
| Session Fixation | Token 在 Session 建立时生成 | ✅ 安全 |

**已知限制：**

1. **Token 不会单次失效**：标准的 CSRF 防护应在每次使用后轮换 Token，但本实现为了简化前端逻辑，Token 在 24h 有效期内保持不变
2. **Cookie 非 httpOnly**：前端需要读取 Token，所以 `httpOnly: false`。这意味着如果存在 XSS 漏洞，攻击者可读取 Token
3. **无 Session 时的降级**：如果应用未启用 Session 中间件，`req.session` 为 `undefined`，Token 只存储在 Cookie 中

---

## 8. 关键要点

1. **双中间件职责分离**：`CsrfTokenMiddleware`（生成）和 `CsrfMiddleware`（验证）独立运行，各司其职
2. **智能跳过策略**：JWT Bearer Token 请求自动跳过 CSRF 验证 —— 利用 JWT "不自动携带" 的特性消除不必要的验证开销
3. **六层跳过过滤**：方法白名单 → 健康检查 → JWT 检测 → 支付/Webhook → Auth 路由 → 客户端 API，确保只对需要保护的路由执行验证
4. **Cookie + Session 双存储**：前端通过 Cookie 获取 Token，后端通过 Session 验证 Token 一致性
5. **严格 Token 格式验证**：64 位十六进制 + `sameSite: strict` Cookie，双重保障防止绕过
6. **与 XSS 防护协同**：CSRF 防护应与 XSS 防护（如 `XssSanitizePipe`）配合使用，防御链才是完整的
