# 全项目架构全景分析（Monorepo 全栈）

> 用途：全栈技术 / 架构分享 / 项目描述  
> 范围：`lucky_nest_monorepo`（NestJS API + Next.js Admin + 共享包 + 基础设施）  
> 更新：2026-03-24

---

## 一、项目一句话定位

> 基于 **Yarn 4 Workspace + Turborepo** 的全栈 Monorepo：  
> **NestJS API 后台**（REST + WebSocket + 定时任务）× **Next.js 15 Admin 前端**（SSR + Client Hybrid）× **共享包体系** × **Docker 多阶段构建 + GitHub Actions 全自动 CI/CD**，服务于菲律宾电商抽奖平台（拼团 / 支付 / IM 客服）。

---

## 二、Monorepo 全景图

```
lucky_nest_monorepo/
├── apps/
│   ├── api/            NestJS 10 — REST + Socket.IO + BullMQ + Cron
│   └── admin-next/     Next.js 15 — SSR + RSC + React Query + Zustand
│
├── packages/
│   ├── shared/         @lucky/shared — 跨端类型 / 枚举 / 业务常量 / 工具函数
│   ├── ui/             @repo/ui      — React 组件库（Button/Form/Table 等）
│   ├── config/         @repo/config  — 错误码 codegen + ESLint 配置基础
│   └── typescript-config/            — 共享 tsconfig base
│
├── nginx/              Nginx 反向代理（限流 / WebSocket / CORS / Swagger 白名单）
├── deploy/             部署脚本 / 回滚脚本 / 环境变量
├── .github/workflows/  CI（质量门禁）+ Deploy（Backend / Admin / Master）
├── compose.yml         开发环境 Docker Compose
├── compose.prod.yml    生产环境 Docker Compose（内存预算 1GB）
└── Dockerfile.prod     后端三阶段构建（Builder → Pruner → Production Alpine）
```

---

## 三、完整技术栈

### 3.1 基础设施层

| 维度     | 技术                                       | 说明                                         |
| -------- | ------------------------------------------ | -------------------------------------------- |
| 包管理   | Yarn 4 (Corepack)                          | Workspace + PnP/node_modules 混合            |
| 构建编排 | Turborepo                                  | 依赖拓扑排序 + 并行构建 + 增量缓存           |
| 容器     | Docker + Docker Compose                    | 开发/生产双套 Compose                        |
| 生产镜像 | Docker 三阶段（Builder → Pruner → Alpine） | 镜像体积极致压缩                             |
| 镜像仓库 | GHCR（`ghcr.io/mrbigporter/...`）          | GitHub Container Registry                    |
| CI/CD    | GitHub Actions                             | 质量门禁 + 自动部署 + 健康检查 + 自动回滚    |
| 服务器   | VPS Ubuntu 22.04（1GB RAM / 1 CPU）        | San Jose CA                                  |
| 反向代理 | Nginx                                      | HTTPS / WebSocket / 限流 / Swagger IP 白名单 |
| DNS/CDN  | Cloudflare                                 | Admin 前端 DNS 切换 / 证书                   |

### 3.2 后端技术栈（`apps/api`）

| 层次 | 技术                                                    |
| ---- | ------------------------------------------------------- |
| 框架 | NestJS 10 + TypeScript 5                                |
| ORM  | Prisma v6 + PostgreSQL                                  |
| 缓存 | Redis + `cache-manager-redis-yet`                       |
| 队列 | BullMQ                                                  |
| 实时 | Socket.IO（WebSocketGateway）                           |
| 支付 | Xendit SDK（菲律宾充值/代付）                           |
| 认证 | JWT 双密钥 + OAuth（Google/Facebook/Apple） + Email OTP |
| 安全 | Helmet + ThrottlerModule + 设备风控                     |
| 任务 | `@nestjs/schedule` Cron + 分布式锁                      |

### 3.3 前端技术栈（`apps/admin-next`）

| 层次 | 技术                                        |
| ---- | ------------------------------------------- |
| 框架 | Next.js 15 + React 19（App Router）         |
| 渲染 | RSC + Client Hybrid + HydrationBoundary     |
| 请求 | React Query v5（预取注水）+ Axios（拦截器） |
| 状态 | Zustand v4 + persist                        |
| 样式 | Tailwind CSS v4                             |
| 表单 | react-hook-form + zod                       |
| 实时 | Socket.IO Client（IM 客服台）               |
| 测试 | Vitest + Testing Library + Playwright       |
| 监控 | Sentry v10 + Lighthouse CI                  |

### 3.4 共享包

| 包名            | 内容                                                                                      | 消费者           |
| --------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| `@lucky/shared` | 枚举（ORDER_STATUS / WITHDRAW_STATUS 等）、业务常量、TimeHelper、OrderNoHelper、RBAC 配置 | API + Admin-next |
| `@repo/ui`      | Button / Form / Table / Modal 等 React 组件                                               | Admin-next       |
| `@repo/config`  | 错误码 codegen（Google Sheets → `error-codes.gen.ts`）、ESLint 基础配置                   | API              |

---

## 四、全链路请求流

```
浏览器 / 移动端
    │ HTTPS 443
    ▼
Nginx（api.joyminis.com / admin.joyminis.com）
    ├── /api/* → 限流（20r/s/IP，burst=50）→ backend:3000（NestJS）
    ├── /socket.io/* → WebSocket 长连接 → backend:3000
    └── /* → admin-next:4000（Next.js standalone SSR）
            ├── Server Component → serverFetch（Cookie）→ /api/* → NestJS
            └── Client Component → Axios（Bearer Token）→ /api/* → NestJS

NestJS 处理链
    requestId 中间件（tid）
    → AdminJwtAuthGuard / JwtAuthGuard（双密钥验签）
    → RolesGuard（RBAC）
    → DeviceSecurityGuard（设备风控）
    → ValidationPipe（DTO 白名单）
    → Controller → Service → Prisma（PostgreSQL）
    → ResponseWrapInterceptor（统一响应壳）
    → AllExceptionsFilter（异常兜底）
    → 返回 { code, data, tid, message }
```

---

## 五、共享包的双向契约

`@lucky/shared` 是前后端唯一的"契约层"：

```typescript
// packages/shared/src/types/order.ts
export enum ORDER_STATUS {
  PENDING = 1,
  COMPLETED = 2,
  WAIT_DELIVERY = 3,
  // ...
}

// apps/api 使用：开奖后更新订单状态
await db.order.update({ data: { orderStatus: ORDER_STATUS.WAIT_DELIVERY } });

// apps/admin-next 使用：前端渲染订单状态标签
const label = ORDER_STATUS_LABELS[order.orderStatus];
```

**关键构建约定**：

- 修改 `packages/shared` → 必须 `node packages/shared/scripts/build.js` 重建 `dist/`
- `tsconfig.json` 中 paths 指向 `dist/`（不是 `src/`），否则 TypeScript 把源文件纳入 API 编译，导致 rootDir 偏移，产物变成 `dist/apps/api/src/main.js`（曾发生过的线上事故）

---

## 六、Docker 三阶段构建（后端）

```dockerfile
# Stage 1: Builder — 安装依赖 + 编译
#   yarn workspaces focus @lucky/api（跳过前端依赖）
#   prisma generate → shared build → nest build → cli build

# Stage 2: Pruner — 裁剪 node_modules
#   删除：构建工具（webpack/tsc/eslint）
#   删除：前端框架（react/next/tailwind/zustand/tanstack）
#   删除：跨平台二进制（sharp darwin/win32/linux-x64）
#   保留：运行时最小集合

# Stage 3: Production — Alpine 最终镜像
#   node:20-alpine（比 bullseye 小 ~60%）
#   只 COPY 编译产物（dist/）+ 裁剪后的 node_modules
#   内存限制：NODE_OPTIONS=--max-old-space-size=256
```

> **亮点**：三阶段构建中的 Pruner Stage 是专门为 1GB VPS 设计的"内存极限压缩"手段，在不影响运行时功能的前提下把 Docker 层从 ~1.2GB 压缩到 ~350MB。

---

## 七、CI/CD 完整流程

### 7.1 质量门禁（每次 PR / push main）

```
git push / PR
  ├── Job 1: check（Ubuntu-latest）
  │   ├── yarn install --immutable（严格 lockfile）
  │   ├── prisma generate（避免类型检查时报缺失）
  │   ├── turbo lint（软门禁，continue-on-error）
  │   ├── turbo check-types（硬门禁）
  │   └── vitest admin-next（硬门禁，85+ 用例）
  │
  └── Job 2: e2e（依赖 Job 1）
      ├── 检查 E2E_ADMIN_PASSWORD secret 是否存在
      ├── 构建 shared + ui + admin-next
      ├── 启动 mock API server（Node.js 内置 http）
      ├── 启动 Next.js standalone server
      └── playwright e2e（软门禁，上传 Artifacts）
```

### 7.2 自动部署（push main，路径过滤）

```
后端部署（apps/api/** 有变更时）：
  Job build → Docker Buildx → 推送 GHCR latest
  Job deploy：
    ├── SSH 同步部署脚本到 VPS
    ├── docker pull 新镜像
    ├── ⚡ 独立容器跑 prisma migrate deploy（不影响正在运行的后端！）
    ├── docker compose up --force-recreate backend
    ├── 健康检查（最多等 90s，每 3s 轮询 /api/v1/health）
    ├── ❌ 失败 → 自动回滚到旧镜像（保存了旧 SHA）
    └── 📱 Telegram 战报通知（成功/失败均推送）

前端部署（apps/admin-next/** 有变更时）：
  同上流程，构建 Next.js standalone 镜像 → GHCR → VPS
```

### 7.3 本地质量闸门

```
git commit → lint-staged（prettier + eslint + 禁止 console.log）
git push   → prepush（tsc --noEmit + vitest）
```

---

## 八、生产环境内存预算（1GB VPS 设计约束）

| 服务              | 内存上限   | 说明                       |
| ----------------- | ---------- | -------------------------- |
| OS + Docker       | ~130MB     | Ubuntu 22.04 基础开销      |
| Backend（NestJS） | ≤300MB     | `--max-old-space-size=256` |
| PostgreSQL        | ≤200MB     | `shared_buffers=128MB`     |
| Redis             | ≤150MB     | `maxmemory 128mb`          |
| Nginx             | ≤30MB      | —                          |
| Swap 兜底         | 1GB        | 防 OOM 杀进程              |
| **合计**          | **~810MB** | 留有余量                   |

> **亮点**：这是典型的"资源极限设计"——在 1GB RAM 限制下，通过 Docker 内存 `limit`、Node.js 堆限制、Redis maxmemory、PostgreSQL shared_buffers 四层约束，确保服务器不会因 OOM 自动重启。

---

## 九、Nginx 关键设计

```nginx
# 1. API 限流：20r/s/IP，burst=50（对抗爬虫/暴力攻击）
limit_req zone=api_limit burst=50 nodelay;

# 2. CORS 完全由 NestJS 处理，Nginx 不加任何 CORS 头
#    原因：双重 CORS 头会导致浏览器拒绝（不能同时有 * 和具体域名）

# 3. WebSocket：proxy_http_version 1.1 + Upgrade/Connection 头
location ^~ /socket.io/ {
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;  # Socket 长连接不超时
}

# 4. Swagger 生产白名单（管理员 IP 才能访问 /docs）
location ~ ^/(docs|swagger-ui|api-json) {
    include /etc/nginx/conf.d/whitelist.conf;
    deny all;
}

# 5. 财务调账接口额外 IP 白名单（双重防护）
location = /api/v1/admin/finance/adjust {
    include /etc/nginx/conf.d/whitelist.conf;
    deny all;
}
```

---

## 十、跨端共享带来的工程化挑战

### 挑战 1：tsconfig paths 陷阱（曾导致线上事故）

**现象**：某次部署后，`dist/main.js` 变成了 `dist/apps/api/src/main.js`，容器启动失败。

**根因**：`paths` 里把 `@lucky/shared` 指向了 `.ts` 源文件 → TypeScript 把源文件纳入编译 → `rootDir` 被推断到 monorepo 根目录 → 所有输出路径嵌套。

**修复与预防**：

```jsonc
// ❌ 错误：指向 .ts 源码
"@lucky/shared": ["../../packages/shared/src/index.ts"]

// ✅ 正确：指向 dist/ 声明文件
"@lucky/shared": ["../../packages/shared/dist/index"]
```

### 挑战 2：修改 shared 后双端同步

```bash
# 修改 packages/shared/src/** 后必须重建 dist/
node packages/shared/scripts/build.js

# 否则：
# API：IDE 看到的类型是旧版（误导开发）
# admin-next：transpilePackages 会用旧 dist/ 构建
```

### 挑战 3：Prisma v6 在 Alpine + ARM 容器的兼容性

```prisma
// schema.prisma 必须保留这 4 个 target
binaryTargets = [
  "native",
  "debian-openssl-3.0.x",      // CI Ubuntu
  "linux-musl-openssl-3.0.x",  // 生产 Alpine
  "linux-arm64-openssl-1.1.x"  // Apple Silicon Docker
]
```

---

## 十一、核心亮点总结（可用）

| 维度                 | 亮点                                                | 技术                                         |
| -------------------- | --------------------------------------------------- | -------------------------------------------- |
| **Monorepo 工程化**  | 共享包双向类型契约、Turborepo 拓扑构建              | Yarn 4 + Turborepo + `@lucky/shared`         |
| **极限容器优化**     | 三阶段构建 + Pruner 层裁剪，镜像 1.2GB→350MB        | Docker multi-stage + Alpine                  |
| **零停机部署**       | 数据库迁移在独立容器执行，健康检查失败自动回滚      | GitHub Actions + SSH + Docker                |
| **1GB VPS 生产稳定** | 四层内存约束，服务互不 OOM                          | Docker limits + NODE_OPTIONS + PG/Redis 配置 |
| **全链路可观测**     | tid 追踪 + Sentry 源码还原 + Lighthouse CI 性能     | requestId + Sentry + LHCI                    |
| **双域安全隔离**     | Admin/Client 独立 JWT Secret，设备风控 24h 冷却     | NestJS Guards + Redis                        |
| **SSR 性能**         | HydrationBoundary 服务端预取，Dashboard LCP 963ms   | React Query + Next.js RSC                    |
| **并发安全**         | Lua 原子解锁分布式锁，@DistributedLock AOP 装饰器   | Redis + 装饰器模式                           |
| **实时稳定**         | IM 大群熔断（>500人 O(1) 广播），EventEmitter2 解耦 | Socket.IO + EventEmitter2                    |
| **错误码自动化**     | Google Sheets → codegen，前后端零手动同步           | Node.js codegen                              |

---

## 十二、全栈综合题

### Q1：这个 Monorepo 的 `@lucky/shared` 是如何做到前后端类型安全的？

> `packages/shared` 编写 TypeScript 源码 → `tsc` 编译到 `dist/`（含 `.d.ts`）→  
> API（`tsconfig.paths` 指向 `dist/`）和 Admin-next（`transpilePackages`）都消费同一份类型。  
> 关键约束：`paths` 必须指向 `dist/` 不能指向 `src/`，否则 TypeScript 把源文件纳入 API 编译，导致 rootDir 推断错误（这是我们踩过的线上事故）。

### Q2：生产部署如何做到"数据库迁移失败不影响正在运行的服务"？

> CI/CD 流程中，数据库迁移通过一个**独立临时容器**执行：  
> `docker run --rm --network $NETWORK --env-file .env.prod $IMAGE prisma migrate deploy`  
> 临时容器与正在运行的 backend 容器完全独立。迁移失败 → 容器退出，旧 backend 继续运行；迁移成功 → 再 `up --force-recreate` 换入新 backend。

### Q3：1GB VPS 如何保证四个服务不互相 OOM？

> 四层约束：
>
> 1. Docker Compose `deploy.resources.limits.memory`（容器级）
> 2. `NODE_OPTIONS=--max-old-space-size=256`（Node.js 堆级）
> 3. Redis `maxmemory 128mb` + LRU 淘汰（Redis 级）
> 4. PostgreSQL `shared_buffers=128MB`（PG 级）  
>    加上 1GB Swap 兜底，确保任何单服务 OOM 时会被 Docker 重启而非拖垮整机。

### Q4：部署失败如何自动回滚？

> CI/CD 在启动新容器前，先 `docker inspect` 记录**旧容器的镜像 SHA**。  
> 新容器启动后轮询 `/api/v1/health` 最多 90s：
>
> - 通过 → 继续，清理旧镜像
> - 超时 → 用记录的旧 SHA `docker compose up --force-recreate`，自动回滚  
>   整个过程无需人工介入，失败后 Telegram 推送告警。

### Q5：Nginx 为什么不加 CORS 头，让 NestJS 来处理？

> 如果 Nginx 和 NestJS 同时设置了 CORS 头，响应会包含**重复的 `Access-Control-Allow-Origin`**（比如同时有 `*` 和具体域名）。浏览器会拒绝这种响应（违反 CORS 规范）。  
> 正确做法：CORS 由 NestJS `enableCors({ origin: whitelist, credentials: true })` 统一管理，Nginx 只做代理，`proxy_pass_header` 不干涉 CORS 头。

### Q6：为什么用 Turborepo，而不是直接 `yarn workspaces`？

> `yarn workspaces` 只解决依赖提升，不解决构建顺序和缓存。  
> Turborepo 的核心价值：
>
> 1. **拓扑排序**：`check-types` 依赖 `^build`，自动保证 `shared` 先构建再检查 API
> 2. **增量缓存**：代码未变时命中 `.turbo` 缓存，跳过重复构建
> 3. **并行执行**：无依赖关系的包并行构建（lint + test 同时跑）  
>    这在 Monorepo 中能把 CI 时间从串行的 10min 压缩到 3-4min。

### Q7：IM 消息架构为什么要用 EventEmitter2 中间层，不直接在 ChatService 里调 Socket？

> 直接调用会造成**双向依赖**：ChatService 依赖 EventsGateway，而 Gateway 可能依赖 ChatService（推送时需要查用户信息）。EventEmitter2 打破这个环：  
> `ChatService → emit('message.created') → SocketListener（@OnEvent）→ EventsGateway.dispatch()`  
> 好处：① ChatService 单测不需要 Mock Socket；② SocketListener 可以独立扩展；③ 未来加 Push 通知也只需在 Listener 里添加，不改 ChatService。

---

## 十三、描述模板

### 全栈版（推荐，覆盖度最广）

> 独立主导基于 **Yarn 4 + Turborepo Monorepo** 的全栈电商平台建设：
>
> - **后端**（NestJS 10 + Prisma v6 + PostgreSQL + Redis）：设计 Admin/Client 双域 JWT 隔离认证、OAuth 三端自研 Provider；落地 Redis 分布式锁（Lua 原子解锁 + AOP 装饰器）解决提现并发超额；实现 Socket.IO + EventEmitter2 解耦 IM 架构（大群熔断防雪崩）；接入 Xendit 支付网关；错误码由 Google Sheets 自动生成同步前后端
> - **前端**（Next.js 15 App Router + React Query v5 + Zustand）：落地 SSR + HydrationBoundary 服务端预取（Dashboard LCP 963ms）、Edge Middleware Cookie 鉴权；完成 7 个页面 SmartTable 缓存契约迁移；建立 Vitest（85+ 用例）+ Playwright E2E 测试体系；接入 Sentry + Lighthouse CI 可观测性
> - **工程化**：Docker 三阶段构建（Pruner 层裁剪，镜像 1.2GB→350MB）；GitHub Actions 全自动 CI/CD（健康检查 + 自动回滚 + Telegram 通知）；1GB VPS 四层内存约束保障多服务稳定运营

### 后端聚焦版

> 基于 **NestJS 10 + Prisma v6 + Redis + Socket.IO** 构建电商后台 API（20+ 模块）；设计 Admin/Client 双域 JWT 物理隔离认证体系，集成 Google/Facebook/Apple OAuth 及 Email OTP；落地 Redis 分布式锁（Lua 原子解锁 + AOP 装饰器）防并发超额；实现加权密码学安全开奖（crypto.randomInt + 事务幂等）；设计 IM 大群熔断架构（>500 人 O(1) 广播）；通过 Docker 三阶段构建 + GitHub Actions 自动部署（健康检查 + 自动回滚），在 1GB VPS 上稳定运行多服务。

### 前端聚焦版

> 基于 **Next.js 15 App Router + React 19** 构建电商后台管理平台（20+ 模块）；落地 SSR + RSC + HydrationBoundary 混合渲染（Dashboard LCP 963ms，CLS=0）；设计 SmartTable + 缓存契约范式（7 页面迁移，URL ↔ queryKey ↔ 请求参数双向同步）；集成 Socket.IO 实时 IM 客服台；建立三层鉴权（Middleware Cookie + Zustand + Axios 拦截器）；接入 Sentry 源码还原监控 + Lighthouse CI 性能回归检测；Vitest 85+ 用例 + Playwright E2E 全自动质量门禁。

---

## 十四、技术分享主题建议

| 主题                                             | 时长  | 核心代码/文档                              |
| ------------------------------------------------ | ----- | ------------------------------------------ |
| Monorepo 从 0 到 1：Yarn 4 + Turborepo 最佳实践  | 30min | `turbo.json` + `packages/shared`           |
| Docker 三阶段构建：把 1.2GB 后端镜像压缩到 350MB | 20min | `Dockerfile.prod` Pruner Stage             |
| NestJS 分布式锁 AOP 装饰器设计                   | 20min | `distributed-lock.decorator.ts`            |
| Next.js 15 HydrationBoundary 服务端预取全流程    | 25min | `*-cache.ts` + `page.tsx`                  |
| 1GB VPS 上跑 4 个 Docker 服务：内存预算设计实战  | 15min | `compose.prod.yml`                         |
| GitHub Actions 自动化部署：健康检查 + 自动回滚   | 20min | `deploy-backend.yml`                       |
| Socket.IO IM 架构：EventEmitter2 解耦 + 大群熔断 | 25min | `events.gateway.ts` + `socket.listener.ts` |

---

## 十五、相关文档快查

| 文档                                               | 内容                            |
| -------------------------------------------------- | ------------------------------- |
| `read/architecture/ADMIN_NEXT_TECH_OVERVIEW_CN.md` | 前端完整技术栈 + 题 + 模板      |
| `read/architecture/NESTJS_API_ARCHITECTURE_CN.md`  | 后端完整技术栈 + 题 + 模板      |
| `read/devops/DEPLOY_INCIDENT_20260321_CN.md`       | tsconfig rootDir 偏移事故复盘   |
| `read/devops/PRISMA_V6_MIGRATION_CN.md`            | Prisma v6 Alpine 容器崩溃复盘   |
| `read/devops/LHCI_SENTRY_SETUP_CN.md`              | Lighthouse CI + Sentry 接入指南 |
| `read/testing/TESTING_STANDARDS_CN.md`             | 测试规范（高频禁令 + 速查表）   |
| `RUNBOOK.md`                                       | 本地开发命令 / 生产排障 SOP     |
