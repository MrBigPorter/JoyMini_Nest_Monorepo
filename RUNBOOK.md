# Lucky Nest 运维手册

> 最后更新：2026-04-03 · 出问题先看 [🚨 故障急救](#-故障急救)

---

## 目录

| 场景                       | 跳转                          |
| -------------------------- | ----------------------------- |
| 出问题了，不知道从哪看     | [🚨 故障急救](#-故障急救)     |
| 我要发布代码               | [🚀 发布](#-发布)             |
| 我要回滚                   | [↩️ 回滚](#️-回滚)            |
| 查日志 / 重启服务 / 看资源 | [🔧 日常运维](#-日常运维)     |
| 本地开发工作流             | [💻 开发工作流](#-开发工作流) |
| 环境变量 / GitHub Secrets  | [📋 配置参考](#-配置参考)     |
| 首次上线 / 创建管理员      | [🆕 首次上线](#-首次上线低频) |

---

## 🔑 关键信息

```
API 健康检查  https://api.joyminis.com/api/v1/health
Admin 入口    https://admin.joyminis.com
VPS           root@<VPS_IP>  →  /opt/lucky

后端容器   lucky-backend-prod
Nginx 容器  lucky-nginx-prod
数据库容器  lucky-db-prod
Redis 容器  lucky-redis-prod
```

---

## 🚨 故障急救

> **先看症状，找到对应命令，复制执行。不要手动改线上配置。**

### 症状速查

| 症状                                              | 直接跳到                                             |
| ------------------------------------------------- | ---------------------------------------------------- |
| API 返回 5xx / 无响应                             | [→ API 不通](#api-不通)                              |
| Admin 登录报 `/v1/...` 路径错                     | [→ API 路径缺 /api](#admin-登录-api-路径缺-api)      |
| 登录显示 200 但报 ERR_NETWORK                     | [→ CORS 问题](#cors-问题)                            |
| 部署后新功能不存在 / 模型 undefined               | [→ Prisma 落后](#prisma-落后)                        |
| 后端容器启动就崩溃                                | [→ 容器启动崩溃](#容器启动崩溃)                      |
| Admin Cloudflare 部署失败                         | [→ Admin 部署失败](#admin-cloudflare-部署失败)       |
| VPS 内存告急                                      | [→ 资源检查](#资源检查)                              |
| 本地 `admin-next` 报 `command not found: next`    | [→ admin-next 卷缓存坏了](#本地-admin-next-启动失败) |
| 代码明明在 main，但线上行为还是旧的               | [→ 后端镜像未更新](#后端镜像未更新)                  |
| `/auth/google/login` 返回 404                     | [→ Nginx 配置未同步](#nginx-配置未同步到-vps)        |
| OAuth 取消后跳转到 `api.joyminis.com/oauth-error` | [→ OAuth 错误重定向](#oauth-错误重定向问题)          |

---

### Nginx 配置未同步到 VPS

**症状**：`https://api.joyminis.com/auth/google/login` 或 OAuth 回调返回 404。

**根因**：`nginx/nginx.prod.conf` 在本地/git 已更新，但 VPS 上还是旧版本。CI 只重启 backend 容器，不自动同步 nginx 配置。

**立即修复（无需等 CI）**：

```bash
# 在本地项目根目录执行，VPS_IP 替换为实际 IP
VPS_IP=<VPS_IP> ./deploy/deploy.sh --sync

# 同步后热重载 nginx（不停服）
ssh root@<VPS_IP> 'docker exec lucky-nginx-prod nginx -t && docker exec lucky-nginx-prod nginx -s reload && echo "✅ nginx reloaded"'
```

**验证**：

```bash
curl -v "https://api.joyminis.com/auth/google/login?state=test&redirect_uri=https://app.joyminis.com/oauth/callback"
# 预期: 302 重定向到 Google OAuth，而非 404
```

**后续**：CI 已更新（`deploy-backend.yml`），后续推送 `nginx/**` 变更会自动同步并 reload。

---

### OAuth 错误重定向问题

**症状**：用户点击 Facebook/Google 登录后选择"取消"，浏览器跳转到：

```
https://api.joyminis.com/oauth-error?code=PROVIDER_ERROR&...#_=_
```

而不是前端登录页 `https://admin.joyminis.com/login?cancelled=true`

**根因**：

1. 后端 `oauth-deeplink.controller.ts` 旧代码使用相对路径 `/oauth-error`，在 API 服务器上解析为 API 域名
2. Facebook/Google 取消授权时返回 `?error=access_denied`，旧代码未检测直接用 `undefined` code 调第三方 API → 报错
3. `#_=_` 是 Facebook 老版 OAuth JS SDK 的历史遗留 fragment

**已修复**（2026-04-04）：

- `facebookCallback` / `googleCallback` 新增 `@Query('error')` 早检测
- 新增 `handleCancelledOAuth()` 方法，优先级：移动端 Deep Link > Web redirectUri > `FRONTEND_URL/login?cancelled`
- `handleOAuthError()` 所有重定向改为绝对 `FRONTEND_URL` 路径
- `.env.dev` 的 `FRONTEND_URL` 改为 `https://dev.joyminis.com`

**立即部署修复**：

```bash
# 1. 确认代码已在 main 分支
git log --oneline -1  # 应该显示最新的 OAuth 修复 commit

# 2. 推送触发 CI/CD（自动构建 + 推送镜像）
git push origin main

# 3. 等待 CI 完成后，SSH 到 VPS 拉取新镜像
ssh root@<VPS_IP>
cd /opt/lucky
docker compose --env-file deploy/.env.prod pull backend
docker compose --env-file deploy/.env.prod up -d backend

# 4. 验证修复（模拟取消回调）
curl -L -v "https://api.joyminis.com/auth/facebook/callback?error=access_denied&error_reason=user_denied&state=xxx"
# 预期：302 重定向到 https://admin.joyminis.com/login?cancelled=true&provider=facebook
```

**测试脚本**：

```bash
# 运行自动化测试（本地）
./scripts/test-oauth-cancel.sh

# 测试生产环境（取消注释脚本中的生产测试部分）
./scripts/test-oauth-cancel.sh -e prod
```

**详细文档**：`docs/read/features/oauth-deep-link/OAUTH_CANCEL_FIX_20260404.md`

---

### API 不通

```bash
# 1. 健康检查
curl -sS https://api.joyminis.com/api/v1/health

# 2. 看容器状态
ssh root@<VPS_IP> 'cd /opt/lucky && docker compose -f compose.prod.yml ps'

# 3. 看后端日志
ssh root@<VPS_IP> 'docker logs --tail=100 lucky-backend-prod'

# 4. 看 Nginx 日志
ssh root@<VPS_IP> 'docker logs --tail=100 lucky-nginx-prod'
```

确认是新版本问题 → 立即回滚：

```bash
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo
yarn rollback:backend
```

---

### Admin 登录 API 路径缺 `/api`

**症状**：登录请求是 `https://api.joyminis.com/v1/auth/...`（缺少 `/api`）

**修复**：

1. GitHub → Settings → Environments → production → Secrets
2. `NEXT_PUBLIC_API_BASE_URL` 必须是：`https://api.joyminis.com/api`（末尾无斜杠，有 `/api`）
3. 改完后必须重新部署 Admin（构建时注入，不重建不生效）

---

### CORS 问题

**症状**：浏览器请求显示 200，但 Axios 报 `ERR_NETWORK`

**确认**：

```bash
curl -s -I -X OPTIONS https://api.joyminis.com/api/v1/auth/admin/login \
  -H "Origin: https://admin.joyminis.com" \
  -H "Access-Control-Request-Method: POST" | grep -i "access-control"
```

输出应只有一个来源（非 `*`）。若有双重 CORS 头，说明 Nginx 多加了头。

**基线**：`nginx/nginx.prod.conf` 的 `location /api/` 不加任何 CORS 头，由 NestJS `main.ts enableCors` 统一处理。

确认 `.env.prod` 包含：

```dotenv
CORS_ORIGIN=https://admin.joyminis.com
AUTH_COOKIE_DOMAIN=.joyminis.com
```

重新应用 Nginx 配置：

```bash
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo
yarn deploy:sync
ssh root@<VPS_IP> \
  'cd /opt/lucky && docker compose -f compose.prod.yml --env-file deploy/.env.prod \
   up -d --no-build --force-recreate --no-deps nginx'
```

---

### Prisma 落后

**症状**：功能异常、新模型返回 undefined，但日志无明显 Error

```bash
# 对比本地迁移列表 vs 生产已跑迁移
ls apps/api/prisma/migrations/

ssh root@<VPS_IP> 'docker exec lucky-backend-prod \
  node -e "
const { PrismaClient } = require(\"/app/apps/api/node_modules/@prisma/client\");
const p = new PrismaClient();
p.\$queryRaw\`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 10\`
  .then(r => r.forEach(m => console.log(m.finished_at, m.migration_name)))
  .finally(() => p.\$disconnect())
"'
```

**修复（三选一）**：

```bash
# 方式一：GitHub Actions → deploy-backend → Run workflow（手动触发，推荐）
# 方式二：手动补跑迁移
ssh root@<VPS_IP> 'docker exec -it lucky-backend-prod sh -lc \
  "./node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma"'
# 方式三：推一个 apps/api 路径下的小改动触发自动部署
```

---

### 后端镜像未更新

**症状**：代码改动已经合并到 `main`，但线上 API 行为还是旧的（比如 Cookie 缺少 `Domain` 属性、接口逻辑没变）。

**根本原因**：`deploy-backend.yml` 只在以下路径有变动时才触发：

```
apps/api/**  |  packages/shared/**  |  packages/config/**
Dockerfile.prod  |  compose.prod.yml  |  .github/workflows/deploy-backend.yml
```

如果本次 PR **只改了 `apps/admin-next/**`\*\*（前端代码、中间件、配置等），  
后端 deploy 就不会跑，即使后端代码早已修好也不会上线。

**诊断：确认容器跑的是不是最新代码**

```bash
# 1. 检查生产容器里某个关键函数的实际实现
ssh root@<VPS_IP> 'docker exec lucky-backend-prod \
  grep -n "domain\|cookieDomain\|buildAdmin" \
  /app/apps/api/dist/admin/auth/auth.controller.js | head -10'

# 2. 用 curl 验证 set-cookie 响应头是否含 Domain=.joyminis.com
#    先登录拿 token（换成真实账号密码）
TOKEN=$(curl -s -X POST https://api.joyminis.com/api/v1/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<admin>","password":"<pass>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['accessToken'])")
curl -sI -X POST https://api.joyminis.com/api/v1/auth/admin/set-cookie \
  -H "Content-Type: application/json" \
  -H "Origin: https://admin.joyminis.com" \
  -d "{\"token\":\"$TOKEN\"}" | grep -i "set-cookie"
# 正确输出应含: Domain=.joyminis.com
```

**修复（手动强制部署后端）**

```bash
# 方式一：GitHub Actions 手动触发（推荐，走完整 CI → GHCR → VPS 流程）
# GitHub → Actions → Deploy Backend → Run workflow → 选 ubuntu-latest → Run

# 方式二：本地构建并直接推到 VPS（无需 GHA，立即生效）
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo
yarn deploy:backend
# 构建完成后手动重启（脚本有时因 admin-next 镜像拉取失败报错，需单独重启）
ssh root@<VPS_IP> \
  'cd /opt/lucky && docker compose -f compose.prod.yml --env-file deploy/.env.prod \
   up -d --no-build --force-recreate --no-deps backend'
```

> ⚠️ **预防措施**：当 `apps/api/**` 有修复合并进 `dev` 但下一个 PR 只改前端时，  
> 合并前在 PR 描述里注明"包含后端修复，需手动触发 deploy-backend"，  
> 或在 PR 里 touch 一个 `apps/api/` 下的注释行强制触发。

---

### 容器启动崩溃

```bash
ssh root@<VPS_IP> 'docker logs --tail=50 lucky-backend-prod'
```

| 日志关键字                            | 原因                 | 解法                                       |
| ------------------------------------- | -------------------- | ------------------------------------------ |
| `prisma/client/runtime` 找不到 binary | Prisma binary 不匹配 | 检查 `schema.prisma` 的 `binaryTargets`    |
| `PrismaClientInitializationError`     | generate 没跑        | 重建镜像（重触发 deploy-backend workflow） |
| `ECONNREFUSED` (db/redis)             | 依赖容器未就绪       | `docker compose ps` 检查 db/redis 状态     |

---

### Admin Cloudflare 部署失败

| 现象                                 | 原因                                 | 解法                               |
| ------------------------------------ | ------------------------------------ | ---------------------------------- |
| `Authentication error [code: 10000]` | CF Token 失效                        | 重新生成 Token，更新 GitHub Secret |
| `quality` job 失败                   | lint/typecheck/单测未过              | 本地修复再推                       |
| `Smoke Check` 失败                   | 部署成功但页面异常                   | 检查 `CF_ADMIN_HEALTHCHECK_URL`    |
| 登录路径变成 `/v1/...`               | `NEXT_PUBLIC_API_BASE_URL` 少 `/api` | 修 Secret → 重新部署               |

---

### 资源检查

```bash
ssh root@<VPS_IP> 'free -h && echo "---" && \
  docker stats --no-stream --format \
    "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}"'
```

> VPS 总 RAM 1 GB，限额：backend 300 MB / postgres 200 MB / redis 150 MB / nginx 30 MB  
> `available` < 150 MB 或 Swap > 500 MB 时需关注

---

### 本地 admin-next 启动失败

**症状**：`command not found: next`

**原因**：`node_modules` 卷缓存损坏，`next` 二进制缺失

```bash
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo
docker rm -f lucky-admin-next-dev
docker volume rm lucky_nest_monorepo_admin_next_nm lucky_nest_monorepo_admin_next_build
docker compose --env-file deploy/.env.dev up -d admin-next
docker compose --env-file deploy/.env.dev logs --no-color --tail=120 admin-next | cat
```

---

## 🚀 发布

### 什么是自动的

| 操作                  | 触发条件                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| ✅ 后端部署 + DB 迁移 | `apps/api/**` / `packages/shared/**` / `Dockerfile.prod` / `compose.prod.yml` 有改动合并到 main |
| ✅ Admin 部署         | `apps/admin-next/**` 有改动合并到 main                                                          |
| ❌ 纯环境变量变更     | 需手动：`yarn deploy:sync` + `yarn deploy:quick`                                                |
| ❌ Seed 数据          | 首次上线手动跑一次                                                                              |
| ❌ TURN 服务器        | VPS 重置后手动恢复                                                                              |

> ⚠️ 只改 `deploy/.env.prod` **不会**触发重建，必须手动同步。
>
> ⚠️ **易踩坑**：后端修复若随"纯前端 PR"合并到 main（PR 里无 `apps/api/**` 变动），  
> `deploy-backend.yml` **不会触发**，生产容器不会更新。  
> 遇到"代码在 main 但线上没生效"→ 参见 [→ 后端镜像未更新](#后端镜像未更新)。

### 手动发布命令

```bash
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo

yarn deploy            # 全量（后端 + Admin VPS fallback）
yarn deploy:backend    # 仅后端
yarn deploy:admin      # 仅 Admin VPS fallback
yarn deploy:sync       # 仅同步配置文件（不重建镜像）
yarn deploy:quick      # 跳过构建，只重启服务
```

### 发布后验收

```bash
# 1. API 健康
curl -sS https://api.joyminis.com/api/v1/health

# 2. 容器状态
ssh root@<VPS_IP> \
  'cd /opt/lucky && docker compose -f compose.prod.yml --env-file deploy/.env.prod ps'

# 3. 后端日志有无 ERROR
ssh root@<VPS_IP> 'docker logs --tail=100 lucky-backend-prod'
```

手动确认：

- [ ] `https://admin.joyminis.com` 可以打开
- [ ] 登录后台正常
- [ ] 至少点开一个后台列表页

### 发布链路全图

```
本地开发
  ├─ [schema 变更]          → prisma migrate dev → 提交迁移文件
  ├─ [packages/shared 变更] → node packages/shared/scripts/build.js
  └─ [packages/ui 变更]     → node packages/ui/scripts/build.js
  ↓
提交 → pre-commit (lint:staged)
  ↓
推到远端 → 开 PR (目标 main)
  ↓
CI 自动跑 (ci.yml)
  ├─ prisma generate
  ├─ turbo check-types   ← 硬门禁
  ├─ admin-next 单测     ← 硬门禁
  ├─ turbo lint          ← 软门禁
  └─ Playwright E2E      ← 软门禁
  ↓
PR 合并到 main
  ├─ apps/api/** 变动    → deploy-backend.yml
  │                          ① docker build → 推 GHCR
  │                          ② SSH → pull 镜像 → migrate deploy → force-recreate
  │                          ③ 健康检查 (90s 超时 → 自动回滚)
  │                          ④ Telegram 战报
  └─ apps/admin-next/** → deploy-admin-cloudflare.yml
                             ① quality (lint+types+单测，全硬门禁)
                             ② build (注入 NEXT_PUBLIC_*)
                             ③ opennextjs-cloudflare deploy
                             ④ Smoke Check → Telegram 战报
```

---

## ↩️ 回滚

### 后端回滚

```bash
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo
yarn rollback:backend
```

> CI 健康检查失败时已**自动回滚**，这是手动兜底。

### 数据库回滚 ⚠️ 高风险

```bash
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo
yarn rollback:db
```

> ❗ 会覆盖当前数据库数据，**只在明确数据事故时执行**。

### Admin Cloudflare DNS 回滚

```bash
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo

# 先 dry-run 确认
export CLOUDFLARE_API_TOKEN="<token>"
export CLOUDFLARE_ZONE_ID="<zone_id>"
export CLOUDFLARE_DNS_RECORD_ID="<record_id>"
export CF_ROLLBACK_TARGET="<target_host_or_ip>"
export CF_ROLLBACK_TYPE="CNAME"   # 或 A
yarn rollback:admin:dns

# 确认输出正确后执行
yarn rollback:admin:dns:execute
```

---

## 🔧 日常运维

### 查看日志

```bash
ssh root@<VPS_IP>
cd /opt/lucky

docker compose -f compose.prod.yml --env-file deploy/.env.prod ps
docker logs --tail=200 lucky-backend-prod
docker logs --tail=200 lucky-nginx-prod
docker logs --tail=200 lucky-db-prod
docker logs --tail=200 lucky-redis-prod
```

### 重启单个服务

```bash
cd /opt/lucky

# 后端
docker compose -f compose.prod.yml --env-file deploy/.env.prod \
  up -d --no-build --force-recreate backend

# Nginx（不影响其他服务）
docker compose -f compose.prod.yml --env-file deploy/.env.prod \
  up -d --no-build --force-recreate --no-deps nginx
```

### 进入数据库（只读）

```bash
ssh root@<VPS_IP>
docker exec -it lucky-db-prod sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

### TURN 服务器恢复（VPS 重置后）

```bash
ssh root@<VPS_IP>
cd /opt/lucky

export TURN_SECRET="与 .env.prod 里相同的值"
export TURN_PUBLIC_IP="<VPS_IP>"
export TURN_DOMAIN="turn.joyminis.com"

bash deploy/install-turn.sh
```

更新 `.env.prod`：

```dotenv
TURN_SECRET=<同上>
TURN_URL=turn:turn.joyminis.com:3478?transport=udp
```

重启后端并验证：

```bash
docker compose -f compose.prod.yml --env-file deploy/.env.prod \
  up -d --no-build --force-recreate backend

ss -lntup | grep 3478
tail -n 100 /var/log/turnserver.log
```

> ⚠️ `turn.joyminis.com` DNS 必须设为 **⬜ 灰云（DNS only）**，走橙云会导致 UDP 3478 失效。

### 备份 / 监控 / 证书

```bash
bash deploy/backup.sh      # 数据库备份
bash deploy/monitor.sh     # 监控脚本
bash deploy/renew-cert.sh  # SSL 证书续期
```

---

## 💻 开发工作流

### 提交前检查

```bash
yarn lint:staged       # 等同 pre-commit，staged 文件走 Prettier + ESLint
yarn prepush:light     # lint + check-types（@repo/ui + @lucky/admin-next）
yarn prepush:heavy     # 上面 + admin-next 单测
yarn prepush:api       # API 专项检查

git push --no-verify   # 紧急情况跳过 hook
```

### Schema 变更流程

```bash
# 1. 改 schema.prisma

# 2. 生成迁移文件
yarn workspace @lucky/api prisma migrate dev --name 描述

# 3. 同步宿主机 IDE 类型（让 IDE / ESLint 看到最新类型）
node apps/api/node_modules/.bin/prisma generate \
  --schema apps/api/prisma/schema.prisma

# 4. 重启后端容器（容器内重跑 generate）
docker compose --env-file deploy/.env.dev up -d backend

# 5. 提交迁移文件
git add apps/api/prisma/
```

### packages 变更后必做

```bash
node packages/shared/scripts/build.js   # 改了 packages/shared
node packages/ui/scripts/build.js       # 改了 packages/ui
```

### 迁移报 P3005

```bash
ssh root@<VPS_IP>
cd /opt/lucky
bash deploy/baseline-db.sh
# 然后重新发布
```

---

## 📋 配置参考

### 生产环境变量（VPS `/opt/lucky/deploy/.env.prod`）

不提交到 Git，模板参考 `deploy/.env.example`

| 分类   | 变量                                                                 |
| ------ | -------------------------------------------------------------------- |
| 数据库 | `DATABASE_URL` `POSTGRES_USER` `POSTGRES_PASSWORD` `POSTGRES_DB`     |
| 缓存   | `REDIS_URL` `REDIS_PASSWORD`                                         |
| JWT    | `JWT_SECRET` `ADMIN_JWT_SECRET`                                      |
| 跨域   | `CORS_ORIGIN` `FRONTEND_URL`                                         |
| Cookie | `AUTH_COOKIE_DOMAIN`（生产用 `.joyminis.com`）                       |
| 第三方 | `FIREBASE_ADMIN_CREDENTIALS` `RESEND_API_KEY` `RECAPTCHA_SECRET_KEY` |
| OAuth  | `GOOGLE_CLIENT_ID`                                                   |
| TURN   | `TURN_URL` `TURN_SECRET`                                             |
| 通知   | `TELEGRAM_TOKEN` `TELEGRAM_CHAT_ID`                                  |

### GitHub Secrets（Settings → Environments → production）

| Secret                                         | 说明                                  |
| ---------------------------------------------- | ------------------------------------- |
| `SSH_HOST` `SSH_USERNAME` `SSH_PRIVATE_KEY`    | SSH 到 VPS                            |
| `VPS_GHCR_PAT`                                 | VPS 登录 GHCR 拉镜像                  |
| `CLOUDFLARE_API_TOKEN` `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Workers 部署               |
| `NEXT_PUBLIC_API_BASE_URL`                     | 必须是 `https://api.joyminis.com/api` |
| `NEXT_PUBLIC_WS_URL`                           | WebSocket 地址                        |
| `CF_ADMIN_HEALTHCHECK_URL`                     | Smoke Check 地址                      |
| `TELEGRAM_TOKEN` `TELEGRAM_CHAT_ID`            | 部署战报通知                          |
| `E2E_ADMIN_PASSWORD`                           | Playwright E2E（可选，未设则跳过）    |

### Cloudflare Token 最小权限

| 类型              | 内容                                 |
| ----------------- | ------------------------------------ |
| Permissions       | `Account > Workers Scripts > Edit`   |
| Permissions       | `Account > Workers Assets > Edit`    |
| Permissions       | `User > User Details > Read`（可选） |
| Account Resources | `Include > All accounts`             |
| Zone Resources    | `Include > All zones`                |

---

## 🆕 首次上线（低频）

### 初始化 VPS

```bash
scp deploy/server-init.sh root@<VPS_IP>:/root/
ssh root@<VPS_IP> 'chmod +x /root/server-init.sh && /root/server-init.sh'
```

### 首次部署

```bash
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo
yarn deploy
```

### 首次 Seed（只执行一次）

```bash
# 先停后端避免争抢连接
docker compose -f compose.prod.yml --env-file deploy/.env.prod stop backend

docker exec -it lucky-backend-prod \
  node /app/apps/api/dist/cli/seed/run-seed.js

# 恢复后端
docker compose -f compose.prod.yml --env-file deploy/.env.prod \
  up -d --no-build backend
```

> ❌ 不要用 `yarn workspace @lucky/api seed`，容器内没有 monorepo 根目录会报错

### 创建 / 重置管理员密码

```bash
ssh root@<VPS_IP>
docker exec -it lucky-backend-prod \
  node /app/apps/api/dist/cli/cli/create-admin.js
```
