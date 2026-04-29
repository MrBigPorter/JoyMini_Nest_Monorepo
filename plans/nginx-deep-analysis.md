# Nginx 配置深入分析

## 一、总体架构

### 生产环境 (`nginx.prod.conf`)
- **域名**: `api.joyminis.com`（纯 API，不代理前端）
- **后端**: `backend:3000`（NestJS）
- **配置**: 单 server block，只做 API 网关
- **前端**: admin.joyminis.com / blog-admin.joyminis.com 部署在 Cloudflare Workers

### 开发环境 (`nginx.dev.conf`)
- **域名**: 多域名共用 443（`admin-dev.joyminis.com`, `blog-dev.joyminis.com`, `blog-admin-dev.joyminis.com`, `dev-api.joyminis.com`）
- **后端**: `backend:3000`（NestJS）
- **前端**: 根据 Host 头部映射到不同 Next.js 服务（admin-next:4001 / frontend-blog:4002 / admin-blog:4002）
- 开发环境同时代理前端和后端

---

## 二、CORS 处理对比分析

### 生产环境 `nginx.prod.conf`

有两个 location 块处理 CORS：

**Location 1** (`~ ^/api/v1/(frontend/blog|client/system-config)` —— 公开博客 API):
```nginx
proxy_hide_header Access-Control-Allow-Origin;
proxy_hide_header Access-Control-Allow-Credentials;
add_header Access-Control-Allow-Origin $http_origin always;
add_header Access-Control-Allow-Credentials "true" always;
```
- ✅ 使用 `proxy_hide_header` 隐藏 NestJS 重复头
- ✅ 使用 `$http_origin` 动态回显请求 Origin
- ✅ `always` 参数确保错误响应也带 CORS 头
- ✅ OPTIONS 块内也完整设置了 CORS 头

**Location 2** (`/api/` —— 通用 API):
```nginx
proxy_hide_header Access-Control-Allow-Origin;
proxy_hide_header Access-Control-Allow-Credentials;
add_header Access-Control-Allow-Origin $http_origin always;
add_header Access-Control-Allow-Credentials "true" always;
```
- ✅ 同上，修复完成

**Location 3** (`^~ /auth/` —— OAuth):
```nginx
add_header Access-Control-Allow-Origin '*' always;
```
- ⚠️ 没有 `proxy_hide_header`，但设置了 `*`，且 NestJS enableCors() 没有覆盖 `/auth/` 路由，所以不会重复

### 开发环境 `nginx.dev.conf`

**Location `/api/`**:
```nginx
proxy_hide_header Access-Control-Allow-Origin;
proxy_hide_header Access-Control-Allow-Credentials;

if ($is_options) {
    add_header Access-Control-Allow-Origin 'https://blog-dev.joyminis.com' always;
    ...
}

add_header Access-Control-Allow-Origin 'https://blog-dev.joyminis.com' always;
```
- ✅ `proxy_hide_header` 已修复
- ⚠️ **硬编码 Origin**：`'https://blog-dev.joyminis.com'`，只允许 blog-dev 跨域访问。admin-dev 访问 API 时会被浏览器拦截

---

## 三、安全分析

### ✅ 做得好的
1. **安全探针拦截**（prod 第 77 行）：`.env`, `.git`, `phpinfo` 等常见扫描路径直接 444 静默丢弃
2. **Swagger 白名单**（prod 第 213 行）：生产环境 docs/swagger 只允许白名单 IP
3. **调账接口白名单**（prod 第 202 行）：`/api/v1/admin/finance/adjust` 只允许白名单
4. **SSL 配置**: TLSv1.2 + TLSv1.3，禁用不安全加密套件
5. **安全头**: X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy
6. **限流**: API 限流 20r/s + 公开博客 10r/s，突发限制
7. **Webhook 不限流**: 支付回调不限流，避免被限流丢回调

### ⚠️ 潜在问题

1. **OAuth `/auth/` 的 CORS 过松**:
   ```nginx
   add_header Access-Control-Allow-Origin '*' always;
   ```
   允许所有来源访问 OAuth 端点（虽然 OAuth 本身需要这个）

2. **prod `/auth/` 缺少 `proxy_hide_header`**:
   虽然没出问题（NestJS enableCors() 不覆盖 `/auth/`），但如果以后改动了 NestJS 路由可能导致重复头

3. **开发环境 `Host` 冲突风险**:
   ```nginx
   map $host $next_upstream {
       default                     http://admin-next:4001;
       blog-dev.joyminis.com       http://frontend-blog:4002;
       blog-admin-dev.joyminis.com http://admin-blog:4002;
   }
   ```
   - `dev-api.joyminis.com` 和 `admin-dev.joyminis.com` 都走 default → admin-next:4001
   - `dev.joyminis.com` 也走 default → admin-next:4001
   - 没有独立的 `dev-api` 前端服务

4. **Dev CORS 只允许 blog-dev**:
   ```nginx
   add_header Access-Control-Allow-Origin 'https://blog-dev.joyminis.com' always;
   ```
   如果 admin-dev.joyminis.com 的前端需要调用 dev-api.joyminis.com 的 API，浏览器会拦截

---

## 四、代理行为差异

| 特性 | 生产环境 | 开发环境 |
|------|----------|----------|
| 缓存 | 公开博客 API 有 proxy_cache (60s) | 无缓存 |
| 限流 | 20r/s (API) + 10r/s (公开博客) | 无限流 |
| 超时 | API 600s / 公开博客 30s | 全部 600s |
| Host 传递 | proxy_set_header Host $host | 部分 location 缺失（swagger, auth） |
| WebSocket | socket.io 3600s 超时 | 同左 |
| 前端代理 | 不代理前端 | 代理全部前端 |

---

## 五、当前状态总结

### ✅ 已修复的问题
1. **`x-skip-auth-refresh` 缺失**: 已添加到两个 location 的 `Access-Control-Allow-Headers`
2. **重复 CORS 头**: 已用 `proxy_hide_header` 修复（prod 两个 location + dev 一个 location）
3. **生产登录已验证成功**: blog-admin.joyminis.com 现在可以正常登录

### 🔍 剩余可优化项
1. **Dev CORS 硬编码 Origin**: 建议改成 `$http_origin` 动态回显，或者至少加上 admin-dev 的 Origin
2. **Dev Host 传递不一致**: 部分 location（如 swagger, auth）没有设置 `X-Real-IP` 和 `X-Forwarded-For`
3. **prod `/auth/` 缺少 proxy_hide_header**: 建议加上保持一致
4. **Docker build lockfile 问题**: `make deploy` 时 `yarn install --immutable` 失败
