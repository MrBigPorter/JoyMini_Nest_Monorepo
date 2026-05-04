# Nginx 博客文章计划

## 基本信息

| 字段 | 值 |
|------|-----|
| **标题** | Nginx API 网关：从开发多域名到生产级安全与性能的全面实践 |
| **Slug** | nginx-api-gateway-dev-prod |
| **路径** | `docs/blog/articles/devops/nginx-api-gateway-dev-prod.md` |
| **标签** | nginx, devops, api-gateway, reverse-proxy, security, cors |
| **类别** | devops |

## 文章结构

### 1. 背景
- 为什么在这个项目中需要 nginx 作为 API 网关
- 项目架构演进：从单体到多服务（NestJS API + Next.js Admin + Next.js Blog + Flutter App）
- nginx 扮演的角色：反向代理、SSL 终止、限流、缓存、安全网关

### 2. 架构总览
- **Mermaid 系统拓扑图**：Client → nginx → NestJS / Next.js / Static
- 生产环境（`api.joyminis.com`）vs 开发环境（多域名）
- 核心数据流

### 3. 开发环境配置（[`nginx/nginx.dev.conf`](nginx/nginx.dev.conf)）

#### 3.1 多域名路由——`$host` map 模式
```nginx
map $host $next_upstream {
    default                     http://admin-next:4001;
    blog-dev.joyminis.com       http://frontend-blog:4002;
    blog-admin-dev.joyminis.com http://admin-blog:4002;
}
```
- 单个 server 块根据 Host 头分发到不同前端
- 对比传统方案（每个域名一个 server 块）的优劣

#### 3.2 Google OAuth 兼容——COOP/COEP
- `Cross-Origin-Opener-Policy: unsafe-none`
- `Cross-Origin-Embedder-Policy: unsafe-none`
- 为什么 Google OAuth 弹窗需要这两个头
- 为什么只在开发环境设置（生产 OAuth 走 `/auth/` 后端代理）

#### 3.3 Next.js HMR 代理
- `/_next/` 静态资源代理 + WebSocket Upgrade 头
- `proxy_next_upstream` 502/503 容错

#### 3.4 媒体重定向——Cloudflare 图片域名迁移
```
/cdn-cgi/image/...  → 302 → https://img.joyminis.com/...
/uploads/...         → 302 → https://img.joyminis.com/...
```
- 从 API 域名迁移到独立图片域名的历史原因

#### 3.5 Docker 动态 DNS 解析
```nginx
resolver 127.0.0.11 valid=5s ipv6=off;
set $backend_upstream http://backend:3000;
proxy_pass $backend_upstream;
```
- 为什么用变量方式 proxy_pass（避免 nginx 在启动时解析 DNS）
- Docker 内置 DNS 的 valid 配置

### 4. 生产环境配置（[`nginx/nginx.prod.conf`](nginx/nginx.prod.conf)）

#### 4.1 SSL/TLS
- TLSv1.2/TLSv1.3, 密码套件选择, 会话缓存
- HTTP/2 启用

#### 4.2 Gzip 压缩
- 压缩级别 5, 1KB 阈值
- 支持的 MIME 类型

#### 4.3 限流——双区域策略

| 区域 | 速率 | Burst | 适用路径 |
|------|------|-------|----------|
| `api_limit` | 20r/s | 50 | `/api/` 通用 |
| `blog_public_limit` | 10r/s | 20 | `/api/v1/frontend/*`, `/api/v1/client/*` |
| 无限制 | — | — | `payment/webhook/xendit` |

- 为什么 Webhook 需要旁路限流
- `nodelay` 参数的作用

#### 4.4 代理缓存——公开 API
```nginx
proxy_cache_path /var/cache/nginx/public_api... max_size=1g inactive=60m;
proxy_cache_key "$scheme$proxy_host$uri$is_args$args$http_origin";
proxy_cache_valid 200 301 302 304 60s;
```
- `$http_origin` 加入缓存键避免跨域缓存污染
- `Vary: Origin, Accept-Encoding`
- `X-Cache-Status` 调试头

### 5. Bot 与安全探针防御

#### 5.1 444 静默丢弃策略
```nginx
location ~* /(\.env|\.git|\.htaccess|phpinfo\.php|wp-login\.php|...) {
    access_log off;
    return 444;
}
```
- 444 是什么（nginx 特有状态码——直接关闭连接，不返回任何响应）
- 为什么 444 比 403/404 更有效（bot 无法区分是拒绝还是目标不存在）
- 配置更新记录：2026-03-21 新增

#### 5.2 安全响应头
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`

### 6. CORS 双保险模式（重点）

#### 6.1 问题背景
- NestJS 内置 `enableCors()` 在后端正常时返回 CORS 头
- 但后端报错（5xx/timeout）时 NestJS 错误处理管道可能不附加 CORS 头
- 浏览器收到无 CORS 头的 5xx 响应 → 解析为 CORS 错误 → 无法读取真实错误信息

#### 6.2 nginx 层解决方案
```nginx
# 1. 隐藏 NestJS 的 CORS 头，避免重复
proxy_hide_header Access-Control-Allow-Origin;
proxy_hide_header Access-Control-Allow-Credentials;

# 2. nginx 无条件添加 CORS 头（无论后端返回什么）
add_header Access-Control-Allow-Origin $http_origin always;
add_header Access-Control-Allow-Credentials "true" always;
```

#### 6.3 `add_header` scoping 陷阱
- nginx 中 `if` 块内的 `add_header` 会替换父块的 `add_header`
- OPTIONS 预检请求的处理：必须在 `if` 块内重新声明所有头
- **Mermaid 流程图**：正常请求 vs OPTIONS 的 header 处理流

### 7. 请求路由深度解析

#### 7.1 路由匹配顺序表

| 优先级 | Location | 用途 | 限流 | 缓存 | 超时 |
|--------|----------|------|------|------|------|
| 1 | Bot scanner paths | 安全拦截 | — | — | — |
| 2 | `= /share.html` | 分享页 | — | — | 默认 |
| 3 | `^~ /.well-known/` | 应用关联文件 | — | — | — |
| 4 | `~ payment/webhook/xendit` | 支付回调 | 无 | — | 默认 |
| 5 | `^~ /api/v1/frontend/blog` | 博客公开 API | 10r/s | 60s | 30s |
| 6 | `= /api/v1/admin/finance/adjust` | 财务调账 | — | — | 600s |
| 7 | `~ /docs, /swagger-ui` | Swagger 文档 | — | — | 默认 |
| 8 | `/api/` | 通用 API | 20r/s | — | 600s |
| 9 | `^~ /auth/` | OAuth 代理 | — | — | 600s |
| 10 | `^~ /socket.io/` | WebSocket | — | — | 3600s |

#### 7.2 OAuth 代理——URI 重写
- `/auth/xxx` → `/api/v1/auth/xxx`（追加全局前缀 + 版本号）
- 保持 `$request_uri` 保证回调参数不丢

#### 7.3 静态文件服务——`.well-known/`
- `assetlinks.json`（Android App Links）
- `apple-app-site-association`（iOS Universal Links）
- CORS `*` 允许——系统浏览器需要跨域读取这些文件

### 8. 生产 vs 开发配置对比

| 维度 | 开发 | 生产 |
|------|------|------|
| 域名 | 多域名（5 个 server_name） | 单一 `api.joyminis.com` |
| SSL | 自签名证书 | 正式证书 |
| 限流 | 无 | 双区域限流 |
| 缓存 | 无 | 代理缓存 1 分钟 |
| CORS | 固定来源 `blog-dev.joyminis.com` | 动态 `$http_origin` |
| Body 限制 | 500M | 50M |
| 安全头 | COOP/COEP + 基本 | 完整安全头 + Bot 拦截 |
| 前端代理 | Next.js HMR + WebSocket | 无（前端独立部署） |
| 媒体 | 302 → img.joyminis.com | 已下线（注释保留） |
| 404 | 默认 | 白名单 deny all |
| DNS | Docker resolver + 变量 | 静态 upstream |

### 9. 部署与实践

- Docker Compose 集成（`compose.prod.yml` → luck-nginx-prod）
- GitHub Actions 部署流程
- Nginx 配置检查（`nginx -t`）
- 日志查看（`docker logs --tail=50 lucky-nginx-prod`）

### 10. 踩坑总结

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| CORS 头重复 | NestJS `enableCors()` + nginx `add_header` | `proxy_hide_header` 隐藏后端 CORS |
| OPTIONS 丢失 CORS 头 | `if` 块中 `add_header` 替换父块 | 在 `if` 内重新声明所有头 |
| Docker DNS 解析失败 | `proxy_pass` 使用域名在启动时解析 | 改用变量 + `resolver` |
| 缓存服务错误 CORS | 缓存命中后返回原始 CORS 头 | `$http_origin` 加入缓存键 |
| Webhook 被限流 | 限流区域包含所有 `/api/` | 独立 location 提前匹配 |

### 11. 总结
- nginx 配置演进的关键决策总结
- 核心模式提炼：CORS 双保险、限流分层、`add_header` 陷阱
- 相关文档链接

## Mermaid 图

1. **系统架构拓扑** — 展示 client → nginx → 各上游服务
2. **请求路由决策树** — 匹配各 location 的顺序
3. **CORS 双保险流程图** — 正常响应 vs 错误响应 vs OPTIONS 的头处理

## Todo

- [ ] 阅读并分析 `nginx/nginx.prod.conf`（326 行）
- [ ] 阅读并分析 `nginx/nginx.dev.conf`（230 行）
- [ ] 阅读 `nginx/whitelist.conf`
- [ ] 参考现有 devops 文章风格
- [ ] 撰写文章正文
- [ ] 插入 Mermaid 图
- [ ] 更新 `writing-progress-analysis.md`
