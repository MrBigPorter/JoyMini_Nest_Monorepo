# HyperPush 部署与运维手册

> 涵盖 hyperpush.org / cp.hyperpush.org 的完整架构、部署流程、常见事故处理。
> 基于 2026-06-04 线上事故总结。

---

## 目录

1. [架构总览](#1-架构总览)
2. [域名体系](#2-域名体系)
3. [SSL 证书管理](#3-ssl-证书管理)
4. [Nginx 路由配置](#4-nginx-路由配置)
5. [后端 CORS 配置](#5-后端-cors-配置)
6. [Cloudflare Pages 部署](#6-cloudflare-pages-部署)
7. [CodePush 热更新配置](#7-codepush-热更新配置)
8. [常见事故与解决方案](#8-常见事故与解决方案)
9. [部署检查清单](#9-部署检查清单)

---

## 1. 架构总览

### 1.1 组件关系

```
┌─────────────────────────────────────────────────────────┐
│  Browser (用户浏览器 / React Native App)                  │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│  Cloudflare (CDN / SSL / DNS Proxy)                     │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Pages: hyperpush.org  (SPA 前端)                  │   │
│  │  DNS:   cp.hyperpush.org A → 129.121.97.120       │   │
│  │         (orange cloud / proxied)                  │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│  VPS: nginx (lucky-nginx-prod)                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  server_name: hyperpush.org cp.hyperpush.org      │   │
│  │                                                    │   │
│  │  location /graphql  → host.docker.internal:3002   │   │
│  │  location /api/     → host.docker.internal:3002   │   │
│  │  location /codepush/ → host.docker.internal:3003   │   │
│  │  location /         → host.docker.internal:3002   │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│  Docker Containers                                       │
│  ┌────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ hyperpush- │  │ hyperpush-     │  │ hyperpush-   │  │
│  │ app        │  │ codepush-prod  │  │ db           │  │
│  │ :3002      │  │ :3003          │  │ postgres:16  │  │
│  └────────────┘  └────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 1.2 流量路径详解

| 路径 | 请求 | 处理 |
|------|------|------|
| `https://hyperpush.org/` | SPA 首页 | Cloudflare Pages → 浏览器加载静态资源 |
| `https://hyperpush.org/graphql` | ❌ 已废弃 | Cloudflare Pages 无 Pages Function 会返回 SPA 入口 |
| `https://cp.hyperpush.org/graphql` | GraphQL API | Cloudflare DNS → VPS nginx → `:3002` (hyperpush-app) |
| `https://cp.hyperpush.org/codepush/` | CodePush 管理 | Cloudflare DNS → VPS nginx → `:3003` (codepush-server) |

---

## 2. 域名体系

### 2.1 域名清单

| 域名 | 用途 | DNS 类型 | 目标 |
|------|------|----------|------|
| `hyperpush.org` | SPA 前端 | Cloudflare Pages (自定义域名) | Pages 项目 |
| `cp.hyperpush.org` | API + CodePush 子域名 | A 记录 (橙云) | `129.121.97.120` |

### 2.2 为什么需要独立子域名

**事故回顾：** 最初 `/graphql` 请求通过 Cloudflare Pages Function (`[[catchall]].ts`) 拦截并代理到后端。当 `API_ORIGIN` 环境变量被删除后，Pages Function 失效，GraphQL API 完全不可用。

**解决方案：** 
- Pages Function 本身有局限性——Cloudflare Secrets 需要手动管理，删除后没有自动回退
- 创建一个独立子域名 `cp.hyperpush.org`（code-push 的缩写），通过 Cloudflare DNS 橙云代理直接指向 VPS
- SPA 调用 `https://cp.hyperpush.org/graphql` 而非 `https://hyperpush.org/graphql`

**教训：** Cloudflare Pages 不适合作为 API 代理。API 网关应该使用独立的子域名通过 DNS 解析到后端。

---

## 3. SSL 证书管理

### 3.1 证书架构

本项目使用 **Cloudflare Full (Strict)** SSL 模式。客户端 ↔ Cloudflare 边缘节点之间使用 Cloudflare 的证书加密。Cloudflare ↔ VPS 之间使用**自签名证书**加密。

### 3.2 自签名证书生成

```bash
# 生成 10 年有效期的自签名证书（包含所有域名 SAN）
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /tmp/server.key \
  -out /tmp/server.crt \
  -subj "/CN=api.joyminis.com" \
  -addext "subjectAltName=\
DNS:api.joyminis.com,\
DNS:hyperpush.org,\
DNS:cp.hyperpush.org,\
DNS:tarsierlabs.app,\
DNS:tarsier.joyminis.com,\
DNS:admin.tarsierlabs.app,\
DNS:app.joyminis.com,\
DNS:admin.joyminis.com,\
DNS:*.joyminis.com"

# 上传到 VPS
scp /tmp/server.crt root@129.121.97.120:/opt/lucky/certs/
scp /tmp/server.key root@129.121.97.120:/opt/lucky/certs/

# 重启 nginx 加载新证书
ssh root@129.121.97.120 "docker exec lucky-nginx-prod nginx -s reload"

# 验证新证书
ssh root@129.121.97.120 "docker exec lucky-nginx-prod openssl x509 \
  -in /etc/nginx/certs/server.crt -noout -text | grep -A1 'Subject Alternative Name'"
```

### 3.3 新增域名时的证书更新流程

1. 在 Cloudflare DNS 添加 A 记录（橙云代理）
2. 在 nginx `server_name` 添加新域名
3. 重新生成自签名证书（包含新域名 SAN）
4. 上传到 VPS 并 reload nginx
5. 在 Nginx 对应的 location block 配置 proxy_pass
6. （如需要）更新后端 CORS_ORIGINS

### 3.4 ⚠️ 关于 `init-cert.sh` 的局限性

**问题：** `deploy/init-cert.sh` 脚本在首次申请 Let's Encrypt 证书前会检查 DNS 解析是否指向本服务器 IP。

```bash
# init-cert.sh 的 DNS 检查逻辑
RESOLVED_IP=$(dig +short "$DOMAIN" @1.1.1.1 | tail -1)
SERVER_IP=$(curl -4 -fsSL https://api.ipify.org)
if [ "$RESOLVED_IP" != "$SERVER_IP" ]; then
    echo "❌ DNS 未指向本机！"
    exit 1
fi
```

**当域名开启 Cloudflare 橙云代理时：** DNS 解析返回 Cloudflare 边缘节点 IP（`104.21.x.x`），而不是 VPS IP（`129.121.97.120`）。因此 `init-cert.sh` 的 DNS 检查会失败。

**解决方案：**
- 方案 A：暂时关闭 Cloudflare 橙云（灰色云）→ 等 DNS 传播 → 执行 `init-cert.sh` → 恢复橙云
- 方案 B：直接使用自签名证书（Cloudflare Full 模式兼容自签名证书）
- 方案 C：修改 `init-cert.sh` 跳过 DNS 检查（不推荐，有安全风险）

**当前实践：** 使用方案 B（自签名证书），因为 Cloudflare Full 模式本身不验证上游证书，自签名证书即可满足要求。

---

## 4. Nginx 路由配置

### 4.1 核心配置文件

| 文件 | 用途 |
|------|------|
| [`nginx/conf.d/40-hyperpush.conf`](../nginx/conf.d/40-hyperpush.conf) | hyperpush.org + cp.hyperpush.org |
| [`nginx/conf.d/10-api.conf`](../nginx/conf.d/10-api.conf) | api.joyminis.com |
| [`nginx/conf.d/20-blog.conf`](../nginx/conf.d/20-blog.conf) | blog 相关 |
| [`nginx/conf.d/00-base.conf`](../nginx/conf.d/00-base.conf) | 全局基础配置 |

### 4.2 `40-hyperpush.conf` 配置详解

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name hyperpush.org cp.hyperpush.org;  # ★ 多域名必须在此列出

    ssl_certificate     /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;

    # ★ 路由优先级：location 路径越长优先级越高
    # /codepush/ → /graphql → /api/ → /

    location /codepush/ {
        proxy_pass http://host.docker.internal:3003/;
        # 注意末尾的 / 会剥离 /codepush 前缀
        # 例如 /codepush/v1/version → /v1/version
    }

    location /graphql {
        proxy_pass http://host.docker.internal:3002;
    }

    location /api/ {
        proxy_pass http://host.docker.internal:3002;
    }

    location / {
        proxy_pass http://host.docker.internal:3002;
        # 兜底：所有未匹配的路由都发给 BFF
    }
}
```

### 4.3 部署配置到 VPS

```bash
# 1. 本地修改配置文件
# 2. 上传到 VPS
scp nginx/conf.d/40-hyperpush.conf root@129.121.97.120:/opt/lucky/nginx/conf.d/

# ⚠️ 不要 scp 到 /etc/nginx/conf.d/ - 这是容器内部路径
# 正确的路径是宿主机的挂载卷: /opt/lucky/nginx/conf.d/

# 3. reload nginx
ssh root@129.121.97.120 "docker exec lucky-nginx-prod nginx -s reload"
```

### 4.4 ⚠️ `proxy_pass` 末尾斜杠行为

| `proxy_pass` | 行为 |
|-------------|------|
| `proxy_pass http://upstream:3003/;` | **剥离**匹配的 location 前缀 |
| `proxy_pass http://upstream:3003;` | **保留**完整路径 |

示例：
```nginx
# 请求: /codepush/v1/version
location /codepush/ {
    proxy_pass http://host.docker.internal:3003/;
    # 实际转发: /v1/version（/codepush 被剥离）
}

location /codepush/ {
    proxy_pass http://host.docker.internal:3003;
    # 实际转发: /codepush/v1/version（完整路径保留）
}
```

---

## 5. 后端 CORS 配置

### 5.1 HyperPush 后端 CORS

在 [`../HyperPush/backend/src/main.ts`](../HyperPush/backend/src/main.ts) 中：

```typescript
app.enableCors({
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')  // ★ 逗号分隔多域名
    : process.env.NODE_ENV === 'production'
      ? false
      : ['http://localhost:5173'],
  credentials: true,
});
```

### 5.2 环境变量配置

在 VPS 的 `/opt/hyperpush/.env` 中：

```bash
# ★ 多个域名用逗号分隔，不要加空格
CORS_ORIGINS=https://hyperpush.org,https://cp.hyperpush.org
```

**更新流程：**
```bash
# 1. SSH 到 VPS
ssh root@129.121.97.120

# 2. 编辑 .env
vi /opt/hyperpush/.env

# 3. 重启容器
cd /opt/hyperpush && docker compose -f deploy/compose.prod.yml down
cd /opt/hyperpush && docker compose -f deploy/compose.prod.yml up -d
```

### 5.3 常见 CORS 错误

| 现象 | 原因 | 解决 |
|------|------|------|
| `No 'Access-Control-Allow-Origin' header is present` | CORS_ORIGINS 未包含请求来源域名 | 添加域名到 CORS_ORIGINS |
| 请求成功但浏览器报 CORS 错误 | 预检请求（OPTIONS）未正确处理 | 确认后端正确处理 OPTIONS |
| `CORS error: Redirect is not allowed for a preflight request` | 预检请求被跳转（301） | 检查 nginx HTTP→HTTPS 跳转是否拦截了 OPTIONS |

---

## 6. Cloudflare Pages 部署

### 6.1 当前架构

`hyperpush.org` 托管在 **Cloudflare Pages** 上，作为 SPA 前端。API 请求通过 `cp.hyperpush.org` 子域名直接到达 VPS。

### 6.2 Pages Function 注意事项

**事故回顾：** `functions/graphql/[[catchall]].ts` 曾经拦截 `/graphql` 请求并代理到 `API_ORIGIN`（Cloudflare Secret）。当 Secret 被删除后，Pages Function 无法正常代理，导致 API 中断。

**教训：**
- Cloudflare Pages 不应该作为 API 代理层
- Pages Function 的 Secrets 在 Dashboard 中容易被误删除
- 删除 Pages Function 后需要重新部署 Pages 才能生效

### 6.3 更新 VITE_API_URL

如果前端代码中硬编码了 API URL，需要更新并重新部署：

1. **在 Cloudflare Dashboard** → Pages → hyperpush → Settings → Environment variables
2. 添加或修改变量：`VITE_API_URL = https://cp.hyperpush.org/graphql`
3. **触发重新部署**：Pages → Deployments → 选择最后一次成功部署 → 点击 `⚙️` → Retry deployment

或者通过 Wrangler CLI：
```bash
# 设置环境变量
npx wrangler pages secret put VITE_API_URL --project-name hyperpush

# 触发部署
npx wrangler pages deploy dist/app --project-name hyperpush
```

### 6.4 wrangler.toml 配置

当前配置（`../HyperPush/frontend/wrangler.toml`）：

```toml
name = "hyperpush"
compatibility_date = "2025-05-01"
pages_build_output_dir = "dist/app"
```

**注意：** `vars` 部分已移除，环境变量统一在 Cloudflare Dashboard 管理而非通过 `wrangler.toml`。这样可以避免敏感信息泄露到代码仓库。

---

## 7. CodePush 热更新配置

### 7.1 架构

```
React Native App
  └→ codepush.joyminis.com (旧, 废弃)
      └→ https://cp.hyperpush.org/codepush/ (新)
          └→ VPS nginx location /codepush/
              └→ proxy_pass http://host.docker.internal:3003/
                  └→ hyperpush-codepush-prod (code-push-server)
```

### 7.2 nginx 配置

```nginx
location /codepush/ {
    proxy_pass http://host.docker.internal:3003/;
    # ★ proxy_pass 末尾有 /，会剥离 /codepush 前缀
    # 例如: https://cp.hyperpush.org/codepush/v1/version
    # 实际转发到: http://host.docker.internal:3003/v1/version

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_read_timeout 120s;  # ★ 下载大包时需要较长超时
}
```

### 7.3 React Native App 中的配置

**Android** (`android/app/build.gradle`):
```gradle
// ★ 需要修改的值
resValue "string", "CodePushServerUrl", "https://cp.hyperpush.org/codepush/"
resValue "string", "ServerUrl", "https://cp.hyperpush.org/codepush/"
```

**iOS** (`ios/FrontendBlogMobile/Info.plist`):
```xml
<key>CodePushServerURL</key>
<string>https://cp.hyperpush.org/codepush/</string>
```

### 7.4 验证 CodePush 可用性

```bash
# 测试 CodePush 服务器是否响应
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://cp.hyperpush.org/codepush/

# 期望输出: HTTP 200

# 测试具体 API
curl -s https://cp.hyperpush.org/codepush/v1/version 2>/dev/null | head -5
```

---

## 8. 常见事故与解决方案

### 8.1 事故一：GraphQL API 返回 521

**现象：** `https://hyperpush.org/graphql` 返回 HTTP 521（Cloudflare Web Server Down）

**根因：**
- `hyperpush.org` 是 Cloudflare Pages 自定义域名
- Pages Function `[[catchall]].ts` 拦截 `/graphql` 请求
- 但 `API_ORIGIN` Secret 被删除，Pages Function 无法代理
- 删除 Pages Function 后，Cloudflare Pages 返回 SPA 入口而非 API 响应

**修复：**
1. 创建独立 API 子域名 `cp.hyperpush.org`
2. 配置 nginx 路由 `cp.hyperpush.org/graphql` → 后端
3. 更新 SPA 前端调用 `https://cp.hyperpush.org/graphql`

**预防：**
- Pages Function 不适合作为 API 代理
- API 网关应该使用独立子域名通过 DNS 直接指向后端

### 8.2 事故二：`init-cert.sh` Let's Encrypt 失败

**现象：** `init-cert.sh` 报错 `❌ 未指向本机！请先更新 Cloudflare DNS`

**根因：**
- 所有域名开启了 Cloudflare 橙云代理
- DNS 解析返回 Cloudflare IP（`104.21.x.x`），不是 VPS IP（`129.121.97.120`）
- 脚本的 DNS 检查阻止继续

**修复：**
- 使用自签名证书（Cloudflare Full 模式兼容）
- 重新生成包含所有域名 SAN 的证书
- 上传到 VPS 并 reload nginx

**预防：**
- 理解 Cloudflare 橙云代理的 DNS 行为
- 自签名证书在 Cloudflare Full 模式下完全可用
- `init-cert.sh` 仅适用于 DNS 直连（灰色云）的场景

### 8.3 事故三：scp 到错误的路径

**现象：** `scp ... root@host:/etc/nginx/conf.d/` 报错 `No such file or directory`

**根因：**
- `/etc/nginx/conf.d/` 是 Docker 容器内部的路径
- nginx 容器使用 bind mount 挂载宿主机的 `/opt/lucky/nginx/conf.d/` 到容器内 `/etc/nginx/conf.d/`
- 挂载是 `:ro`（只读），不能通过 `docker cp` 写入

**修复：**
```bash
# ✅ 正确：写入宿主机路径
scp file root@129.121.97.120:/opt/lucky/nginx/conf.d/

# ❌ 错误：写入容器内部路径
scp file root@129.121.97.120:/etc/nginx/conf.d/
```

**预防：**
- 查阅 compose 文件确认挂载卷的宿主机路径
- nginx volume 定义在 `compose.prod.yml` 或有单独的 nginx compose 文件

### 8.4 事故四：更新 CORS 后未重启容器

**现象：** 更新 `/opt/hyperpush/.env` 中的 `CORS_ORIGINS` 后，CORS 仍然报错

**根因：**
- NestJS 在启动时读取 `process.env.CORS_ORIGINS`
- 修改 `.env` 文件后需要重启容器才能生效

**修复：**
```bash
ssh root@129.121.97.120 "cd /opt/hyperpush && docker compose -f deploy/compose.prod.yml restart app"
```

**预防：**
- 修改 `.env` 后总是重启相关容器
- 使用 `docker compose restart` 而非 `docker compose up -d`（更快）

---

## 9. 部署检查清单

### 9.1 新增子域名部署流程

- [ ] 1. Cloudflare DNS 添加 A 记录（橙云代理）
- [ ] 2. 更新自签名证书 SAN（包含新域名）
- [ ] 3. 上传新证书到 VPS `/opt/lucky/certs/`
- [ ] 4. 更新 nginx 配置（`server_name` + `location` block）
- [ ] 5. 上传 nginx 配置到 VPS `/opt/lucky/nginx/conf.d/`
- [ ] 6. reload nginx：`docker exec lucky-nginx-prod nginx -s reload`
- [ ] 7. 验证证书 SAN：`openssl x509 -in server.crt -noout -text | grep -A1 "Subject Alternative Name"`
- [ ] 8. 验证新域名：`curl -s -o /dev/null -w "HTTP %{http_code}\n" https://新域名/path`
- [ ] 9. 更新后端 CORS_ORIGINS（如需）
- [ ] 10. 重启后端容器：`docker compose restart app`

### 9.2 日常运维检查

- [ ] 容器健康：`docker ps --format '{{.Names}} {{.Status}}'`
- [ ] nginx 运行：`docker exec lucky-nginx-prod nginx -t`
- [ ] 证书有效期：`openssl x509 -in server.crt -noout -enddate`
- [ ] 磁盘使用：`df -h`
- [ ] 内存使用：`free -h`

### 9.3 故障排查速查表

| 错误码 | 可能原因 | 排查步骤 |
|--------|---------|---------|
| 521 | Cloudflare 无法连接源站 | 检查 nginx 是否运行；检查防火墙 443 端口 |
| 502 | nginx 无法连接上游 | 检查后端容器是否运行；检查 `host.docker.internal` 是否正确 |
| 504 | 上游超时 | 检查 `proxy_read_timeout` 配置；检查后端响应时间 |
| CORS | 跨域被阻止 | 检查 `CORS_ORIGINS` 配置；检查预检请求 |
| 444 | 被 nginx 安全规则拦截 | 检查 `00-base.conf` 的 scanner 规则 |

---

## 附录

### A. 关键文件索引

| 文件 | 位置 | 说明 |
|------|------|------|
| HyperPush nginx 配置 | [`nginx/conf.d/40-hyperpush.conf`](../nginx/conf.d/40-hyperpush.conf) | hyperpush.org 路由规则 |
| API nginx 配置 | [`nginx/conf.d/10-api.conf`](../nginx/conf.d/10-api.conf) | api.joyminis.com 路由规则 |
| 全局基础配置 | [`nginx/conf.d/00-base.conf`](../nginx/conf.d/00-base.conf) | 限流、gzip、缓存 |
| HyperPush 生产 compose | [`../HyperPush/deploy/compose.prod.yml`](../HyperPush/deploy/compose.prod.yml) | 容器编排 |
| CodePush compose | [`../HyperPush/compose.codepush.yml`](../HyperPush/compose.codepush.yml) | CodePush 容器编排 |
| HyperPush 后端 CORS | [`../HyperPush/backend/src/main.ts`](../HyperPush/backend/src/main.ts) | CORS 配置代码 |
| Wrangler 配置 | [`../HyperPush/frontend/wrangler.toml`](../HyperPush/frontend/wrangler.toml) | Cloudflare Pages 配置 |
| 部署脚本 | [`deploy/deploy.sh`](../deploy/deploy.sh) | 主部署脚本 |
| SSL 申请脚本 | [`deploy/init-cert.sh`](../deploy/init-cert.sh) | Let's Encrypt 首次申请 |
| SSL 续期脚本 | [`deploy/renew-cert.sh`](../deploy/renew-cert.sh) | Let's Encrypt 定时续期 |

### B. 常用命令速查

```bash
# === Nginx ===
# 检查配置语法
docker exec lucky-nginx-prod nginx -t

# 重新加载配置
docker exec lucky-nginx-prod nginx -s reload

# 查看访问日志
docker exec lucky-nginx-prod tail -50 /var/log/nginx/access.log

# === Docker ===
# 重启 hyperpush-app
cd /opt/hyperpush && docker compose -f deploy/compose.prod.yml restart app

# 查看所有容器状态
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

# === SSL ===
# 查看证书 SAN
openssl x509 -in /opt/lucky/certs/server.crt -noout -text | grep -A1 "Subject Alternative Name"

# 查看证书过期时间
openssl x509 -in /opt/lucky/certs/server.crt -noout -enddate

# === 网络 ===
# 测试后端连通性
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://cp.hyperpush.org/graphql \
  -X POST -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}'
```
