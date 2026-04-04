# Lucky Nest Monorepo — Copilot 工作指令

> **重要**: 每次对话先看 `## 🎯 当前任务`，按 Phase 推进，不做计划外的事。

---

## 🎯 当前任务（每次对话从这里开始）

**阶段**: Phase 6 P0 推进中 — SmartTable 读侧缓存契约（单页面优化）  
**上次停留**: 全部 7 个页面缓存契约完成（2026-03-23）  
**立即执行**:

### ✅ 已完成页面（全部 7 个）

| #   | 页面             | 优先级 | 复杂度   | 状态    | 完成日期   |
| --- | ---------------- | ------ | -------- | ------- | ---------- |
| 1   | Operation Logs   | 🟡 中  | ⭐⭐     | ✅ 完成 | 2026-03-23 |
| 2   | Finance          | 🔴 高  | ⭐⭐     | ✅ 完成 | 2026-03-23 |
| 3   | Orders           | 🔴 高  | ⭐⭐⭐   | ✅ 完成 | 2026-03-23 |
| 4   | Users            | 🔴 高  | ⭐⭐⭐   | ✅ 完成 | 2026-03-23 |
| 5   | Products         | 🟡 中  | ⭐⭐⭐⭐ | ✅ 完成 | 2026-03-23 |
| 6   | Payment Channels | 🟡 中  | ⭐⭐     | ✅ 完成 | 2026-03-23 |
| 7   | Groups           | 🟡 中  | ⭐⭐     | ✅ 完成 | 2026-03-23 |

### 📋 Phase 6 P0 验收结果

**✅ 完成目标**：

- 7 个 SmartTable 页面缓存契约全部落地
- 统一读侧契约范式（`*-cache.ts` → `page.tsx` 预取 → Client 消费）
- 85+ Vitest 用例覆盖，所有新式测试通过
- 完整文档沉淀（7 个缓存契约文档 + 6 Q&A 心智模型题）

**代码交付物**：

- 7 个 `*-cache.ts` 读侧契约文件
- 7 个 `page.tsx` Server 预取实现
- 14+ 客户端组件（Client + ListClient）
- 7+ Vitest 测试文件集

**模式沉淀**：

- 缓存契约双向转换（URL ↔ queryKey ↔ requestParams）
- Server 预取 + HydrationBoundary 注水流程
- Client 壳组件 + 列表消费层拆分架构

> 下一步：选择 Phase 7 方向（Lighthouse 性能验收 / 移动端响应式 / 其他工作）
>
> **参考**：所有缓存契约文档统一在 `read/features/` 下

> 方向来源：`read/architecture/NEXT_APP_ROUTER_5TOPICS_PROJECT_OPTIMIZATION_CN.md`（P0 已完成）

---

## 📋 下一阶段候选方向（Phase 7）

根据 RUNBOOK.md 与优先级评估，可选：

| 候选项                     | 说明                            | 优先级 | 预计工作量 |
| -------------------------- | ------------------------------- | ------ | ---------- |
| **Lighthouse 性能验收**    | 验证 LCP < 500ms 目标           | 🔴 高  | 2-3d       |
| **移动端响应式适配**       | Admin 页面在平板/手机上的适配   | 🟡 中  | 3-5d       |
| **批量操作**               | 订单/用户批量状态变更、导出 CSV | 🟡 中  | 3-4d       |
| **国际化完善**             | 新增页面补充 zh 翻译 key        | 🟡 中  | 1-2d       |
| **@lucky/api lint 债清理** | 后端 lint 规范化                | 🟢 低  | 持续       |

> 等待用户指示下一个工作优先级。

---

## ✅ 已完成任务归档

已完成的大型改造（路由清理、Stage 1~6 重构、IM Phase 主线）不再在本文件展开，统一以 `read/` 专题文档和 Git 提交记录为准。

---

## 🛡️ CI / 本地质量闸门（上下文保留，2026-03-20）

- 已完成基线：Husky + `lint-staged` + CI 基线流程已落地（详见 `RUNBOOK.md` 6.3）
- [ ] `@lucky/api` lint debt 规模较大，按模块分批清理后再纳入本地重闸门（`prepush:heavy` 或独立后端检查）
- [ ] 评估将 CI 中 `Lint` 从 `continue-on-error` 收紧为硬性失败门槛，避免 lint 问题继续后移
- [ ] 等 GHA 缓存方案恢复后，重新启用 Yarn / node_modules / Playwright / Turbo 缓存，缩短质量闸门耗时

> 详细命令与排障说明见 `RUNBOOK.md` 6.3；CI 现状以 `.github/workflows/ci.yml` 为准。

---

## 一、项目全景

| 维度           | 详情                                                                           |
| -------------- | ------------------------------------------------------------------------------ |
| **仓库结构**   | Yarn 4 Workspace + Turborepo Monorepo                                          |
| **后端**       | `apps/api` — NestJS + Prisma + PostgreSQL + Redis                              |
| **Admin 前端** | `apps/admin-next` — Next.js 15 (standalone) + React 19 + Tailwind CSS v4       |
| **共享包**     | `packages/ui` (React 组件库), `packages/shared` (工具/常量), `packages/config` |
| **生产服务器** | VPS Ubuntu 22.04, 1 GB RAM, 1 CPU, San Jose CA                                 |
| **生产域名**   | `admin.joyminis.com` / `api.joyminis.com`                                      |
| **开发域名**   | `admin-dev.joyminis.com` / 本地 API `http://localhost:3000`                    |
| **镜像仓库**   | GHCR `ghcr.io/mrbigporter/lucky-{backend,admin-next}-prod`                     |
| **VPS 目录**   | `/opt/lucky`                                                                   |

---

## 二、关键技术约定（违反会报错或出安全问题）

### ⚠️ 表单规范（必须遵守）

- 使用 `react-hook-form` + `zod` + `@hookform/resolvers@5`
- **禁止** Zod schema 用 `.default()` → 改用 `useForm({ defaultValues: {...} })`
- **禁止** Zod schema 用 `.transform()` → 在 submit handler 里手动转换
- 原因: v5 严格类型约束，input/output 类型不一致会报 TS2322

### 后端规范

- Admin 接口路径统一 `/admin/*`，受 `AdminJwtAuthGuard` + `RolesGuard` 保护
- JWT 双密钥: `JWT_SECRET`（客户端）/ `ADMIN_JWT_SECRET`（后台）
- **⚠️ 关键**：Admin 相关模块的 `JwtModule.register({ secret })` 必须使用 `ADMIN_JWT_SECRET || JWT_SECRET`（与 `AuthService.getAdminJwtSecret()` 保持一致），否则签发和验证使用不同密钥会导致 401 Unauthorized
- 新接口必须有对应 TS 类型定义（`src/api/types.ts` 或模块 type 文件）
- 数据库变更走 `prisma migrate dev`，不直接改库
- 环境变量: `deploy/.env.dev` (开发) / `deploy/.env.prod` (生产)
- 超级管理员: `yarn workspace @lucky/api cli:create-admin`

### 前端规范

- 认证 token: `localStorage('auth_token')` + Cookie `auth_token`（middleware 读 Cookie）
- 主题: `useAppStore` zustand/persist, key=`app-store`, 值=`dark`/`light`
- API 地址: 环境变量 `NEXT_PUBLIC_API_BASE_URL`
- 多语言: `useAppStore.lang`，支持 `en`/`zh`，翻译表在 `src/constants.ts`
- 数据请求: `ahooks/useRequest`（当前）/ `@tanstack/react-query`（Phase 2 引入）
- 修改 `packages/ui` → 必须运行 `node packages/ui/scripts/build.js`
- 修改 `packages/shared` → 必须运行 `node packages/shared/scripts/build.js`

### ⚠️ 测试规范（违反会导致 CI 红灯）

> 完整规范见 `read/testing/TESTING_STANDARDS_CN.md`（含调试流程、错误速查表、模板）

**高频禁令（快速记忆）：**

- **禁止同一文件存在两个同名 `describe` 块** → 旧版必须完整删除
- **`React.forwardRef` 在 `vi.mock` 里必须用工厂函数写法并设 `.displayName`**
- **所有 E2E 文件必须从 `'./fixtures'` 导入 `test`**，不能从 `'@playwright/test'`
- **API 签名 / store action 参数改变时，立即同步所有 `toHaveBeenCalledWith` 和 `mockResolvedValue`**
- **文件末尾只允许一个 `\n`**，禁止两个以上空行
- **长函数调用超过 80 字符必须拆行 + trailing comma**

### ⚠️ Monorepo TypeScript 规范（违反会导致 Docker 构建产物路径错误）

> 事故记录：2026-03-21，`dist/main.js` 变成 `dist/apps/api/src/main.js`，容器启动失败  
> 详细复盘见 `read/devops/DEPLOY_INCIDENT_20260321_CN.md`（问题 6c/rootDir 章节）

**核心规则（必须记住）：**

- **`paths` 里的跨包引用必须指向 `dist/`（`.d.ts`），不能指向 `src/`（`.ts`）**
- `.ts` 源文件被 `paths` 引用 → TypeScript 把它纳入编译输出 → `rootDir` 被推断到 monorepo 根 → 所有输出路径错误嵌套

```jsonc
// ❌ 错误：指向 .ts 源码，会导致 rootDir 推断偏移
"@lucky/shared": ["../../packages/shared/src/index.ts"]

// ✅ 正确：指向 dist/ 声明文件，只用于类型检查，不影响编译输出
"@lucky/shared": ["../../packages/shared/dist/index"]
```

**`tsconfig.build.json` 必须只含 `src/`：**

```jsonc
// apps/api/tsconfig.build.json — nest build 专用
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "declaration": false },
  "include": ["src/**/*"], // ← 只编译 src/，不能有 scripts/
  "exclude": ["node_modules", "dist", "test", "scripts", "**/*.spec.ts"],
}
// tsconfig.json 保留 scripts/ 供 check-types / IDE 使用（--noEmit 不受 rootDir 影响）
```

**症状速查（发现这些立即检查 tsconfig）：**

| 症状                        | 根因                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `dist/apps/api/src/main.js` | `paths` 指向 `.ts`，rootDir 推断到 monorepo 根                      |
| `dist/src/main.js`          | `tsconfig.build.json` 包含了 `scripts/`，rootDir 推断到 `apps/api/` |
| `dist/main.js` ✅           | 正确，`tsconfig.build.json` 只含 `src/`                             |

**修改 `packages/shared` 后的必要操作（保持 `dist/` 最新）：**

```bash
node packages/shared/scripts/build.js   # 重建 dist/，IDE 和 API 的类型才同步
```

### ⚠️ Prisma v6 规范（违反会导致容器崩溃或大量 TS 报错）

> 事故记录：2026-03-17，Apple Silicon Docker 容器启动崩溃 + 187 个 TS 错误  
> 详细复盘见 `read/devops/PRISMA_V6_MIGRATION_CN.md`

**引擎 binary（必须保持，否则容器启动崩溃）**

- `binaryTargets` 必须包含 `"linux-arm64-openssl-1.1.x"`（base image = `node:20-bullseye-slim`，OpenSSL 1.1.x）
- 当前正确值：`["native", "debian-openssl-3.0.x", "linux-musl-openssl-3.0.x", "linux-arm64-openssl-1.1.x"]`
- **禁止** 为 `apps/api/node_modules` 单独添加 Docker 卷 → 会导致 Prisma generated client 为空，所有模型类型消失

**Prisma v6 API 变更（用 v5 写法会报 TS 错误）**

| v5 写法 ❌                             | v6 正确写法 ✅                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `Prisma.LogDefinition`                 | 本地定义等价类型（见 `prisma.service.ts`）                                       |
| `$queryRawUnsafe<T>(...)`              | `await $queryRawUnsafe(...)` 后再 `as T`                                         |
| `Prisma.PrismaClientKnownRequestError` | `import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'` |
| `catch (e: any)` + `e.message`         | `catch (e: unknown)` + `e instanceof Error ? e.message : String(e)`              |
| JSON 字段写 `null`                     | `Prisma.JsonNull`（nullable JSON 字段不接受 JS 原生 null）                       |

**修改 `schema.prisma` 后的必要操作**

```bash
# 1. 宿主机重新 generate（IDE 和 ESLint 才能看到新类型，否则大量假报错）
node apps/api/node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma
# 2. 重启容器（让 prestart:dev 在容器内也重新 generate）
docker compose --env-file deploy/.env.dev up -d backend
```

### CI/CD 文件速查

| 文件                                            | 触发           | 作用                             |
| ----------------------------------------------- | -------------- | -------------------------------- |
| `.github/workflows/ci.yml`                      | PR / push main | Lint + 类型检查 + 单元测试 + E2E |
| `.github/workflows/deploy-backend.yml`          | push main      | 后端镜像 → GHCR → VPS            |
| `.github/workflows/deploy-admin-cloudflare.yml` | push main/test | Admin → Cloudflare Workers       |
| `.github/workflows/deploy-master.yml`           | 手动触发       | 全量部署                         |

### 本地开发

```bash
make up    # 启动所有容器
make logs  # 查看日志
make down  # 停止容器
# 重建 admin-next（依赖变化时）:
docker rm -f lucky-admin-next-dev
docker volume rm lucky_nest_monorepo_admin_next_build lucky_nest_monorepo_admin_next_nm
docker compose --env-file deploy/.env.dev up -d admin-next
```

---

## 三、迭代与功能归档

历史 Phase 与功能清单已全部完成，不再在本文件重复维护；请直接查看 `read/` 下对应文档与 Git 记录。

---

## 六、已知风险

| 问题                                            | 级别  | 状态                                            |
| ----------------------------------------------- | ----- | ----------------------------------------------- |
| VPS 1GB RAM，Docker 镜像过多可能 OOM            | 🔴 高 | 已用 Alpine + standalone 优化，持续监控         |
| CI 缓存已禁用（GHA 存储不足），每次全量安装慢   | 🟢 低 | 待迁移 Docker Hub 后重启缓存                    |
| `@lucky/api` lint debt 较大，暂未纳入本地重闸门 | 🟡 中 | 分模块清理中（见「CI / 本地质量闸门」未完成项） |

---

## 七、工作原则（每次对话必须遵守）

1. **先看 `🎯 当前任务` → 确认 Phase → 再动手**，不做 Phase 之外的事
2. **每完成一个 checkbox 立即更新本文件**（`[ ]` → `[x]`），保持进度同步
3. **每次开始新任务前，先做"问题陈述"**：
   - 阐述 `这次要解决什么问题`（背景、痛点、现状不清）
   - 明确 `目标`（完成哪些 checkbox、交付什么物）
   - 标注 `范围`（仅限哪些模块/页面、不涉及什么）
   - 定义 `输出物`（表格/文档/指标等）
   - 列举 `不做什么`（避免范围蔓延）
   - 等用户确认无误再开始
4. **AI协作开发必须遵守对应技术栈的工作流程**：
   - Flutter项目：查阅 `docs/flutter/AI_COLLABORATION_WORKFLOW.md`
   - Next.js项目：查阅 `docs/nextjs/AI_COLLABORATION_WORKFLOW.md`
   - NestJS项目：查阅 `docs/nestjs/AI_COLLABORATION_WORKFLOW.md`

5. **命令执行前必须查阅对应速查表**：
   - Flutter命令：`docs/flutter/FLUTTER_COMMANDS_CHEATSHEET.md`
   - Next.js命令：`docs/nextjs/COMMANDS_CHEATSHEET.md`
   - NestJS命令：`docs/nestjs/COMMANDS_CHEATSHEET.md`

6. 修改 `packages/ui` → 必须 `node packages/ui/scripts/build.js`
7. 修改 `packages/shared` → 必须 `node packages/shared/scripts/build.js`
8. Zod schema **禁止** `.default()` 和 `.transform()`（见技术约定）
9. 生产部署前检查 `deploy/.env.prod` 包含所有必需变量
10. 数据库变更必须通过 `prisma migrate dev` 生成迁移文件
11. 新增 API 接口必须有 TS 类型定义（`src/api/types.ts` 或模块 type 文件）
12. **新增 Prisma 模型后，本地必须重启 backend 容器**（`docker compose --env-file deploy/.env.dev up -d backend`）让 `prestart:dev` 重跑 `prisma generate`；生产走 CI/CD 重建镜像自动处理
13. 修改 `schema.prisma` 后，**必须在宿主机跑一次** `node apps/api/node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma`（让 IDE / ESLint 看到最新类型，否则会出现大量假报错）
14. 每次遇到**核心技术点**或**高现实约束技术点**（如线上事故、性能瓶颈、部署兼容、类型系统陷阱），必须同步做两件事：
    - 记录文档（`read/` 对应专题或 `RUNBOOK.md` 补充「现象/根因/修复/预防」）
    - 提出至少 1 个「心智模型提问」（为什么会这样、边界条件是什么、下次如何更早发现）并写入该文档，沉淀可复用排障框架。
15. **语言规范**：默认使用中文（必要时英文），**禁止输出韩文（韩语字符）**；若误用，立即改回中文并继续。
