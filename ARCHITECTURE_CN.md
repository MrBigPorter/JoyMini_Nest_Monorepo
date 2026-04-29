# Lucky Monorepo · 架构设计与运行原理（架构师级）

---

## 0. 总览（Monorepo 与领域边界）

- 仓库模式：Yarn Workspaces + Turborepo
  - apps/\*：可运行应用
    - apps/api：NestJS 后端 API
    - apps/web：Next.js Web 前端
  - packages/\*：共享库与配置
    - packages/shared：类型/常量/工具函数与契约（DTO/Response 类型）
    - packages/\*-config：工程配置（eslint、tsconfig 等）
- 架构风格：
  - 前后端分离，契约统一（shared 包导出公共类型/DTO）
  - 基于 Turbo 的任务编排与缓存（本地/可接入远程）
  - 基于环境变量的配置分层（.env、本地与生产差异）

依赖方向（禁止反向依赖）：

```
packages/shared  →  apps/api
                 →  apps/web

packages/*-config → apps/* 与 packages/*
```

---

## 1. 技术栈选择与取舍

- 工程与包管理
  - Yarn 4（Plug'n'Play 可选，当前走 nodeLinker=default 更稳）
  - Turborepo（任务并行、缓存、Filter 精确选择）
- 后端 API
  - NestJS（结构化、DI、模块化、生态完善）
  - 数据层：PostgreSQL + Prisma ORM（类型安全、迁移体系）
  - 文档：OpenAPI/Swagger 自动生成
  - 安全：helmet、CORS、throttler、DTO 校验
- 前端 Web
  - Next.js（SSR/SSG/ISR/CSR 按需选择）
  - API 调用：基于 fetch/axios 封装 + shared 中的类型
  - 性能：按页面分层渲染、路由级缓存、边缘/CDN 友好
- 语言与规范
  - TypeScript 全仓
  - ESLint/Prettier 统一风格

---

## 2. 模块边界与目录说明

```
root
├─ apps/
│  ├─ api/                # Nest API 服务
│  ├─ admin-next/         # 管理后台 (Next.js 15)
│  ├─ admin-blog/         # 博客 CMS 管理端 (Next.js 15)
│  ├─ frontend-blog/      # 公共博客前端 (Next.js + Capacitor)
│  └─ liveness-web/       # 活体检测 (Vite + React)
└─ packages/
   ├─ shared/             # 公共类型与工具
   ├─ eslint-config/      # 统一 lint 配置（可选）
   └─ typescript-config/  # 统一 tsconfig（可选）
```

- shared 只放“无副作用”的纯类型/纯函数/常量/协议，不依赖 runtime 服务
- apps/_ 可以依赖 packages/_，反之不允许

---

## 3. 后端（NestJS）架构与运行原理

### 3.1 模块化与依赖注入（DI）

- 每个领域一个 Module，包含 Controller/Service/DTO，按需引入到 AppModule
- Nest 通过反射与元数据（reflect-metadata）实现 DI
- 生命周期：
  - Bootstrap → 创建应用实例（Express）
  - 中间件/全局管道/拦截器/过滤器挂载
  - 模块初始化（Module lifecycle）

### 3.2 请求处理流水线

```
Client → HTTP → Express → Nest Route → Pipes(Validation) → Guards(Auth) → Interceptors(logging/cache)
      → Controller → Service → Repository/Prisma → DB
                                   ↓
                        Exception Filter (统一错误)
```

- 全局 ValidationPipe：class-validator + class-transformer，自动验证 DTO
- Guards（可选）：基于 JWT/Session 权限
- Interceptors：日志记录、响应封装、缓存（如基于 Redis 的 cache interceptor）
- Exception Filter：统一错误码与可观测性

### 3.3 数据访问与事务

- Prisma Client 负责类型安全的数据访问
- 迁移：`prisma migrate dev|deploy`，schema.prisma 为单一真相源
- 事务：`prisma.$transaction`，注意长事务与热点表
- 索引策略：在 schema 中维护，定期 EXPLAIN 分析慢查询

### 3.4 配置管理

- @nestjs/config 读取 .env，提供 ConfigService
- 分层：默认值（代码） < 环境变量（.env/.secrets） < 部署平台注入
- 强类型：为关键配置提供类型守卫与解析（number/boolean）

### 3.5 API 文档与版本化

- @nestjs/swagger 自动生成 OpenAPI，挂载 /docs
- 版本管理：推荐 URL 前缀 v1/v2 或基于 Header；Controller 上使用 Versioning

### 3.6 安全与稳健性

- HTTP 安全：helmet、CORS 白名单、rate limit（@nestjs/throttler）
- 输入输出：DTO 校验与输出整形（class-transformer）
- 敏感信息：不写入日志；Mask 中间件；生产关闭详细错误栈
- 健康检查：/health（数据库连通性、依赖探测）

### 3.7 可扩展能力（规划）

- 缓存：Redis 作为查询缓存/会话/分布式锁
- 事件与异步：BullMQ（Redis）或基于队列（SQS/RabbitMQ）
- 审计日志：领域事件 + Append-only 存储
- 多租户：在请求上下文中注入租户标识，Prisma 层做隔离

---

## 4. 前端（Next.js）架构与运行原理

### 4.1 渲染模式选择

- SSG：静态可缓存页面（营销页/固定内容）
- ISR：增量再生成，兼顾动态与缓存
- SSR：对 SEO/实时性要求高的页面
- CSR：交互密集型页面/后台

建议：按路由选择最合适模式，避免全局 SSR 造成成本过高。

### 4.2 数据获取与类型共享

- API Client 统一封装（fetch/axios），在 shared 中约定 Response 类型
- 错误边界与空状态统一组件
- 缓存：SWR/React Query（如采用），与路由缓存策略配合

### 4.3 代码组织

- feature-first 或 route-first 组织方式
- 组件分层：基础组件（UI 库）/业务组件/页面容器
- 性能优化：
  - 按需代码拆分与动态 import
  - 图片与字体优化（Next Image/Font）
  - Edge/Node 运行时区分（若使用 App Router）

---

## 5. 契约与共享（packages/shared）

- 内容：
  - DTO/Response 类型（ApiResponse<T> 等）
  - 业务枚举/常量
  - 纯工具函数（如格式化）
- 准则：
  - 不包含与运行时环境耦合的代码（如 fs/process 侧重逻辑）
  - 对外暴露统一 index.ts 出口

---

## 6. 横切关注点（Cross-cutting Concerns）

### 6.1 日志与可观测性

- 结构化日志（JSON），等级区分（debug/info/warn/error）
- traceId：在请求进入处生成并透传到服务与数据库日志
- 指标：请求时延、错误率、队列堆积、DB 连接用量
- 分布式追踪：可接入 OpenTelemetry（Nest/Next 生态已有方案）

### 6.2 错误模型

- 统一错误响应：`{ code, message, details?, traceId }`
- code 枚举化，可定位到领域与类型（VALIDATION/NOT_FOUND/INTERNAL）

### 6.3 配置与密钥

- .env.example 提供示例，生产使用平台密钥管理（如 KMS/Secrets Manager）
- 不将密钥写入仓库；本地通过 .env 注入

### 6.4 安全基线

- 输入校验、输出脱敏、内容安全策略（CSP）
- 认证授权：后端 Guard + 前端路由守卫（按需）
- 依赖安全：定期升级、开启 Dependabot/renovate（建议）

---

## 7. 构建与交付流水线（CI/CD 蓝图）

```
PR → CI(Lint/TypeCheck/Test/Build) → Preview/Artifacts
→ main 合入 → Build & Publish (容器/静态) → Deploy (API + Web)
→ Smoke Test → 监控告警
```

- 使用 Turborepo 缓存节省时间，CI 任务：
  - yarn install → check-types → lint → test → build
- 发布：
  - API：容器化（多阶段构建）+ 数据库迁移（prisma migrate deploy）
  - Web：静态导出或托管到 Vercel/容器
- 环境：dev/staging/prod 三段，配置隔离

---

## 8. 性能与扩展性策略

- API
  - 数据库：合理索引、分页/游标、N+1 监测
  - 缓存：热点数据使用 Redis+TTL，幂等与失效策略
  - 横向扩展：无状态服务 + 反向代理 + 连接池
- Web
  - 路由级缓存与 ISR
  - 资源体积控制与边缘分发

---

## 9. 测试金字塔与质量门禁

- 单元测试：service/pipe/guard 纯逻辑覆盖
- 集成测试：API 路由 + Prisma test DB（可用 sqlite/容器 Postgres）
- E2E：关键用户路径（登录/下单/支付等）
- 质量门禁：
  - 类型检查必须通过
  - Lint 必须通过
  - 关键覆盖率阈值（按包设定）

---

## 10. 运行手册（要点汇总）

- 开发与发布操作：见 `RUNBOOK.md`
- 数据库迁移：开发用 `migrate dev`，部署用 `migrate deploy`
- Swagger：`/docs`，仅在开发/受限环境开放
- 故障排查：
  - 连接失败 → 检查 DATABASE_URL 与容器状态
  - Swagger 空白 → CORS 与挂载路径

---

## 11. 参考架构图（ASCII）

### 11.1 请求流（后端）

```
[Client]
   |
   v
[API Gateway/NGINX] --(TLS)--> [Nest API]
   |                                |
   |                     [ValidationPipe/Guards]
   |                                |
   |                         [Controller]
   |                                |
   |                         [Service Layer]
   |                                |
   |                         [Prisma Client]
   |                                |
   |                           [Postgres]
   v
[Response] <----- [Interceptors/Error Filters]
```

### 11.2 Monorepo 依赖图

```
packages/shared ─┬─> apps/api
                 └─> apps/web
```

---

## 12. 演进与优化建议（Roadmap）

- 工程治理
  - 引入 Changesets 做版本与变更日志管理（packages/\* 发布）
  - 开启 Turbo 远程缓存（团队/CI 提速）
  - 代码所有权与 CODEOWNERS（按目录划分）
- 后端能力
  - 接入 Redis（缓存/队列），引入 BullMQ 处理异步任务
  - OpenTelemetry/APM 监控（链路追踪 + 指标）
  - API 版本化与弃用策略（Deprecation Header）
- 前端能力
  - App Router（若未使用）与 Server Actions（需评估）
  - 数据层统一（React Query/SWR）并定义缓存失效策略
- 安全与合规
  - CSP/CSRF/JWT 轮换/密码策略
  - 安全扫描与依赖许可审计

---

## 13. 术语与约定

- DTO：数据传输对象，用于请求/响应校验与文档
- Module/Service/Controller：Nest 三层职责
- SSR/SSG/ISR：Next 渲染模式
- 环境命名：dev/staging/prod

---
