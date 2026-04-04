# Lucky Nest Monorepo — 项目全貌文档（小白版）

> **目标读者**：刚接手项目、对 Monorepo / Docker / CI/CD 不熟悉的开发者  
> **核心理念**：每个技术选择背后都有一个"被解决的问题"。看到某个配置不理解，先问"它在解决什么"，比直接背配置有效得多。

---

## 目录

1. [整体架构：为什么用 Monorepo？](#一整体架构为什么用-monorepo)
2. [前端（admin-next）：为什么从 React SPA 迁移到 Next.js？](#二前端admin-next为什么从-react-spa-迁移到-nextjs)
3. [HTTP 请求层：为什么封装一个 HttpClient 类？](#三http-请求层为什么封装一个-httpclient-类)
4. [状态管理：为什么用 Zustand？](#四状态管理为什么用-zustand)
5. [后端（api）：为什么 Prisma + NestJS？](#五后端api为什么-prisma--nestjs)
6. [Docker 策略：为什么要两个 compose 文件？](#六docker-策略为什么要两个-compose-文件)
7. [CI/CD：代码怎么从本地到服务器？](#七cicd代码怎么从本地到服务器)
8. [测试策略：为什么要两套测试？](#八测试策略为什么要两套测试)
9. [超级管理员创建：为什么用 CLI？](#九超级管理员创建为什么用-cli)
10. [本地开发快速上手](#十本地开发快速上手)
11. [常见问题 FAQ](#十一常见问题-faq)

---

## 一、整体架构：为什么用 Monorepo？

```
lucky_nest_monorepo/
├── apps/
│   ├── admin-next/      ← 后台管理系统（Next.js）
│   ├── api/             ← 后端 API（NestJS + Prisma）
│   └── liveness-web/    ← 活体检测前端（Vite）
├── packages/
│   ├── shared/          ← 公共工具函数（前后端共用）
│   ├── ui/              ← 公共 UI 组件库
│   ├── config/          ← 公共配置
│   ├── eslint-config/   ← 统一 ESLint 规则
│   └── typescript-config/ ← 统一 TS 配置
├── compose.yml          ← 本地开发 Docker 配置
└── compose.prod.yml     ← 生产环境 Docker 配置
```

### 问题背景

之前每个 app 都是独立仓库，`shared` 里的工具函数改了要同步到四个地方，很容易忘；ESLint 规则各自一套，代码风格混乱。

### 为什么选择 Monorepo

所有代码放一个仓库，改一次 `packages/shared`，所有 app 立刻同步。  
用 [Turborepo](https://turbo.build/) 管理构建，只重新构建"真正改了"的包，大幅节省 CI 时间。

### 包管理器：Yarn 4（PnP → node_modules 模式）

Yarn 4 默认用 PnP（Plug'n'Play），不生成 `node_modules/`，速度快，**但**很多工具（Next.js、Prisma、NestJS）不兼容 PnP。

**解决方案**：在 `.yarnrc.yml` 里设置：

```yaml
nodeLinker: node-modules
```

退回经典 `node_modules` 模式，兼容性第一，速度是次要的。

---

## 二、前端（admin-next）：为什么从 React SPA 迁移到 Next.js？

### 背景问题

原项目是纯 React（Vite 打包），部署到 Cloudflare Pages 没有问题，但：

1. 想要 SSR / App Router 经验积累
2. Cloudflare Pages 原生支持 Next.js 静态导出，免费且 CDN 全球分发
3. Next.js 的文件路由比手动配 React Router 更清晰

### 关键决策 1：`output: 'export'`（静态导出）

```typescript
// next.config.ts
const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // 仅生产环境开启静态导出
  ...(isProd ? { output: "export" } : {}),
};
```

**为什么这样配**：

- Next.js 默认需要一个 Node.js 服务器运行（用于 SSR），但 Cloudflare Pages 只支持静态文件
- `output: 'export'` 让 Next.js 在构建时生成纯 HTML/CSS/JS，部署时不需要服务器
- **代价**：生产环境没有 Server-Side Rendering，没有 API Routes，类似普通 SPA
- **开发时不加这个**，因为要用 `middleware.ts` 做服务端认证跳转

### 关键决策 2：双重认证守卫

**问题**：`output: 'export'` 生产模式下，Next.js Middleware **完全不执行**（没有服务器来运行它）。

**解决方案**：两层保护同时存在，各自负责不同场景：

```
中间件 (middleware.ts)     → 仅开发环境生效，服务端拦截未授权请求
DashboardLayout.tsx        → 客户端 Auth Guard，生产/开发都生效
```

```typescript
// src/components/layout/DashboardLayout.tsx
useEffect(() => {
  checkAuth(); // 读 localStorage 里的 token
  setAuthChecked(true);
}, [checkAuth]);

useEffect(() => {
  if (authChecked && !isAuthenticated) {
    router.replace("/login"); // 没登录 → 踢回去
  }
}, [authChecked, isAuthenticated, router]);
```

**为什么要 loading 状态**：

```typescript
// 等待 auth 检查完毕，避免闪屏
if (!authChecked || !isAuthenticated) {
  return <div className="animate-spin" />;  // 显示转圈
}
```

> 不加这个，页面会先闪一下"未登录时应该看到的内容"再跳转，用户体验很差（俗称"闪屏"）。

### 关键决策 3：`dynamic(..., { ssr: false })`

```typescript
// src/app/(dashboard)/layout.tsx
const DashboardClientShell = dynamic(
  () => import("@/components/layout/DashboardLayout"),
  { ssr: false }, // 关键：禁用服务端渲染
);
```

**为什么关闭 SSR**：

> Admin 系统大量使用 `localStorage`、`document.cookie`、`window.location`。  
> 这些 Browser API 在 Node.js（服务端渲染时）根本不存在，会直接报错。  
> 加 `ssr: false` 告诉 Next.js：这个组件只在浏览器里运行，服务端跳过渲染。

### 关键决策 4：`optimizePackageImports`（加速冷启动）

```typescript
// next.config.ts
experimental: {
  optimizePackageImports: [
    '@repo/ui',
    'lucide-react',
    'recharts',
    'framer-motion',
    // ...
  ],
},
```

**为什么需要这个**：

> `@repo/ui` 是一个"桶文件"（barrel export），`import { Button } from '@repo/ui'`  
> 实际上加载了整个 UI 库，包括你没用到的 `QuillEditor`、`recharts` 等重型依赖。  
> `optimizePackageImports` 让 Turbopack 只编译你真正 import 的那几个组件。  
> **效果：冷启动从 1186 秒降到约 10 秒。**

---

## 三、HTTP 请求层：为什么封装一个 `HttpClient` 类？

### 问题

直接用 `axios.get('/api/...')` 有什么问题？

- 每个请求都要手动加 `Authorization: Bearer token`
- 每个请求都要手动处理 401（未登录）跳转
- 错误提示逻辑写了几十遍，难以维护
- 重复请求没有防抖

### 封装后统一处理

```typescript
// src/api/http.ts
class HttpClient {
  // 请求拦截器：自动注入 token、语言头、去重检查
  // 响应拦截器：统一处理业务错误、弹 Toast、401 自动跳登录
}
```

### 重要细节：为什么用 `useToastStore.getState()` 而不是 `useToastStore()`？

```typescript
// ❌ 错误写法 — 会在运行时报错
private toastError(message: string) {
  const { addToast } = useToastStore();  // Hook 只能在 React 组件里调用！
}

// ✅ 正确写法
private toastError(message: string) {
  const { addToast } = useToastStore.getState();  // 在组件外访问 store
  addToast('error', message);
}
```

> `useToastStore()` 是 React Hook，React 规定 Hook 只能在函数组件或自定义 Hook 里调用。  
> `HttpClient` 是一个普通 JS 类，不是 React 组件。  
> Zustand 提供 `.getState()` 方法，专门用于"在组件外访问 store"。

### 请求去重

```typescript
private requestQueue = new Set<string>();

// 每个请求有唯一 key：method + url + params + data
private genKey(config: AxiosRequestConfig) {
  return `${config.method}-${config.url}-${JSON.stringify(config.params)}-${JSON.stringify(config.data)}`;
}
```

> 防止用户快速双击按钮，发出两个相同请求导致数据重复提交。

---

## 四、状态管理：为什么用 Zustand？

项目里有三个 Store：

| Store           | 存什么                    | 为什么单独拆出来                                |
| --------------- | ------------------------- | ----------------------------------------------- |
| `useAuthStore`  | token、是否登录、用户角色 | 全局共享，Header/Sidebar/Guard 都要读           |
| `useToastStore` | 全局消息提示列表          | HTTP 层（非组件）需要触发，只能用 `.getState()` |
| `useAppStore`   | 语言设置（i18n）          | 全局共享，切换语言后所有文字刷新                |

### 为什么不用 Redux？

> Zustand 更轻量，写法简单，没有 action/reducer 样板代码。  
> Admin 系统复杂度不需要 Redux 的严格单向数据流。

### Token 存储策略：LocalStorage + Cookie 双写

```typescript
// src/store/useAuthStore.ts
login: (token, role = 'admin') => {
  localStorage.setItem('auth_token', token);           // 客户端读取
  document.cookie = `auth_token=${token}; path=/`;    // middleware 读取
  set({ isAuthenticated: true, token, userRole: role });
},
```

**为什么要存两个地方**：

- `localStorage` → 客户端 JS 读取（DashboardLayout Auth Guard 用）
- `Cookie` → 服务端 `middleware.ts` 读取（开发环境服务端拦截用）

---

## 五、后端（api）：为什么 Prisma + NestJS？

### 为什么 Prisma？

数据库有 40+ 张表。手写 SQL 很容易出错（比如字段改名了，SQL 不会报错，要等运行时才发现）。  
Prisma 的 `schema.prisma` 是**单一数据源**：

```
改 schema → 生成迁移文件 → TypeScript 类型自动更新 → 编译时就能发现字段不匹配
```

### 迁移（migrate）工作流

```bash
# 开发环境：创建新迁移 + 直接应用
npx prisma migrate dev --name add_user_avatar

# 生产环境：只运行未执行的迁移（不破坏已有数据）
npx prisma migrate deploy
```

### 曾遇到的坑：`P3005 — database schema is not empty`

**错误背景**：生产数据库已经有表了，但 Prisma 的迁移历史不存在（第一次部署），  
Prisma 以为是全新数据库，想从头创建，发现表已存在就报错。

**解决方案（Baseline）**：

```bash
# 告诉 Prisma：把所有历史迁移标记为"已完成"，不要重新执行
npx prisma migrate resolve --applied "20240101_init"
```

> 类比：就像告诉新来的会计"之前的账本你不用对，从今天开始接手就好"。

### 为什么后端打包用 Webpack 而不是 esbuild/swc？

NestJS 官方默认 Webpack，已经优化了：

- 把整个项目打包成单文件 `dist/main.js`（部署简单）
- Tree-shaking 去掉未使用的依赖（减小体积）
- 支持 Prisma 这类有特殊 native 二进制的包

---

## 六、Docker 策略：为什么要两个 compose 文件？

|            | `compose.yml`（开发）  | `compose.prod.yml`（生产）          |
| ---------- | ---------------------- | ----------------------------------- |
| 用途       | 本地开发               | 生产服务器（1GB VPS）               |
| 前端       | 在 Docker 内热更新运行 | 不在 Docker，部署到 Cloudflare      |
| 镜像来源   | 本地 `docker build`    | 从 GHCR 拉取（GitHub Actions 构建） |
| 内存限制   | 无限制                 | Backend ≤300MB（防 OOM）            |
| 数据持久化 | 挂载本地目录（卷）     | Docker named volume                 |

### 为什么 1GB 服务器要限制内存？

```yaml
# compose.prod.yml
deploy:
  resources:
    limits:
      memory: 300M # 超过 300MB 直接 OOM Kill 这个容器
```

**内存预算（1GB 服务器）**：

```
OS + Docker:   ~130 MB
Backend:       ≤300 MB
PostgreSQL:    ≤200 MB
Redis:         ≤150 MB（maxmemory 128MB）
Nginx:         ≤30 MB
────────────────────────
小计:          ~810 MB
Swap（硬盘）:  +1 GB（兜底峰值）
```

> 宁可让某个容器被 Kill（然后自动重启），也不能让整个系统 OOM 崩溃。

### 为什么要 Swap？

> 1GB 实体 RAM 是硬上限。Swap 把硬盘当临时内存，速度慢但能防止偶发峰值（比如 Prisma 迁移时内存突增）直接 OOM。

### 开发镜像 vs 生产镜像的区别

```
开发镜像（Dockerfile.dev）:
  - 挂载源码目录（热更新）
  - 安装所有 devDependencies
  - 启动 ts-node / nest start:dev（实时编译）

生产镜像（Dockerfile.prod）:
  - 只安装 dependencies（去掉 devDeps，减小体积）
  - 先 build 出 dist/
  - 只运行编译后的 JS（node dist/main.js）
  - 多阶段构建：构建环境和运行环境分离
```

---

## 七、CI/CD：代码怎么从本地到服务器？

### 完整流程图

```
你写代码
    │
    ▼
git push main
    │
    ▼
GitHub Actions 自动触发
    │
    ├──▶ CI 检查（ci.yml）─────────────────────────────────
    │        │                                              │
    │        ├── Lint（代码风格检查）                      │
    │        ├── TypeScript 类型检查                       │
    │        ├── 单元测试（Vitest）— 必须通过              │
    │        └── E2E 测试（Playwright）— 可选              │
    │                                                       │
    ├──▶ 前端部署（deploy-admin.yml）                      │
    │        │                                              │
    │        ├── Next.js build（生成静态文件 → out/）      │
    │        └── wrangler deploy → Cloudflare Pages        │
    │                                                       │
    └──▶ 后端部署（deploy-backend.yml）                    │
             │                                              │
             ├── Docker build（打包镜像）                  │
             ├── 推送到 GHCR（GitHub 容器仓库）            │
             └── SSH 到 VPS:                               │
                   ├── 拉取新镜像                          │
                   ├── 临时容器跑 prisma migrate deploy    │
                   ├── 重启后端容器                        │
                   ├── 健康检查（等最多 90s）              │
                   └── 失败 → 自动回滚旧镜像  ────────────┘
```

### 为什么分成三个 workflow 文件？

`deploy-master.yml` 是**主控开关**，可以手动选择只部署前端或只部署后端：

```yaml
# GitHub Actions 界面手动触发时会出现勾选框
inputs:
  deploy_admin: # 勾 ✓ 才部署前端（Cloudflare）
  deploy_api: # 勾 ✓ 才部署后端（VPS）
```

**实用场景**：只改了前端样式 → 不想触发后端重启（重启时在线用户会断线 1-2 秒）。

### 为什么要健康检查 + 自动回滚？

```bash
# deploy-backend.yml
for i in $(seq 1 30); do
  if docker exec lucky-backend-prod wget -qO- http://localhost:3000/api/v1/health; then
    HEALTHY=true; break
  fi
  sleep 3  # 最多等 90 秒
done

if [ "$HEALTHY" = false ]; then
  echo "❌ 部署失败，自动回滚..."
  docker compose up -d --image "$PREV_IMAGE"  # 换回旧镜像
  exit 1
fi
```

> **无回滚的风险**：部署了有 Bug 的版本 → 服务宕机 → 用户看到 502 → 你手动上服务器排查 → 10 分钟后恢复。  
> **有回滚的效果**：部署失败 90 秒后自动恢复旧版本，用户最多感知到 2 分钟异常。

### 为什么镜像推到 GHCR 而不是直接在服务器上构建？

1GB RAM 服务器**构建时会 OOM**（Node.js 编译需要 1-2GB 内存峰值）。  
在 GitHub Actions（免费 Runner，2 核 7GB）上构建，把构建好的镜像传给服务器，服务器只负责运行。

### GitHub Secrets 配置清单

| Secret 名称                | 用途                | 在哪里用                      |
| -------------------------- | ------------------- | ----------------------------- |
| `SSH_HOST`                 | VPS IP 地址         | deploy-backend.yml SSH 连接   |
| `SSH_USERNAME`             | VPS 登录用户名      | deploy-backend.yml SSH 连接   |
| `SSH_PRIVATE_KEY`          | SSH 私钥            | deploy-backend.yml SSH 连接   |
| `VPS_GHCR_PAT`             | GHCR 读取权限 Token | VPS 拉取镜像                  |
| `CLOUDFLARE_API_TOKEN`     | Cloudflare API      | deploy-admin.yml 部署到 Pages |
| `CLOUDFLARE_ACCOUNT_ID`    | Cloudflare 账号 ID  | deploy-admin.yml 部署到 Pages |
| `NEXT_PUBLIC_API_BASE_URL` | 前端 API 地址       | Next.js build 时注入          |
| `TELEGRAM_TOKEN`           | Telegram Bot Token  | 部署通知                      |
| `TELEGRAM_CHAT_ID`         | Telegram 频道 ID    | 部署通知                      |

---

## 八、测试策略：为什么要两套测试？

### 测试金字塔

```
       ▲
      / \
     /E2E\        ← 少量，覆盖核心用户流程（慢，但最真实）
    /─────\
   / 单元测试 \    ← 大量，覆盖组件逻辑（快，但需要 mock）
  /───────────\
```

### 单元测试（Vitest + Testing Library）

**文件位置**：`src/__tests__/views/Dashboard.test.tsx`

**测什么**：单个组件的渲染逻辑，不需要真实 API、不需要浏览器

```typescript
// API 全部 mock 掉，不发真实请求
vi.mock('@/api', () => ({
  financeApi: { getStatistics: vi.fn() },
  orderApi: { getList: vi.fn() },
}));

// 造假数据
mockUseRequest.mockReturnValueOnce(makeUseRequest({ totalDeposit: '12500.00' }));

// 只测组件逻辑
it('renders finance stats correctly', () => {
  render(<Dashboard />);
  expect(screen.getByText('12500.00')).toBeInTheDocument();
});
```

**为什么要 mock API**：

> 单元测试要"快"且"稳定"。真实 API 可能网络慢、数据库没数据、第三方服务宕机，导致测试随机失败（俗称"flaky tests"）。  
> Mock 就是造一个假的 API，让测试只关注"组件逻辑"本身，与外部依赖解耦。

### E2E 测试（Playwright）

**文件位置**：`src/__e2e__/auth.spec.ts`

**测什么**：完整的用户操作流程，真实浏览器 + 真实 API（或 Mock 服务）

```typescript
test("正确登录后跳转到 Dashboard", async ({ page }) => {
  await page.goto("/login/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("correct-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  // 等待页面跳转到 Dashboard
  await expect(page.locator("h1")).toContainText("Dashboard");
});
```

**为什么还要 E2E**：

> 单元测试各个组件都通过了，不代表"连起来"也能正常工作。  
> 比如：登录按钮单元测试通过，但 Auth Store 的 token 存储逻辑有 Bug，导致每次刷新都要重新登录。  
> E2E 模拟真实用户操作，发现组件"集成"时的问题。

### 覆盖的测试文件清单

| 测试文件             | 覆盖内容             |
| -------------------- | -------------------- |
| `auth.spec.ts`       | 登录/登出/未授权跳转 |
| `dashboard.spec.ts`  | Dashboard 数据展示   |
| `users.spec.ts`      | 用户列表/搜索/分页   |
| `orders.spec.ts`     | 订单管理             |
| `products.spec.ts`   | 商品管理             |
| `categories.spec.ts` | 分类管理             |
| `banners.spec.ts`    | Banner 管理          |
| `marketing.spec.ts`  | 优惠券/营销          |
| `finance.spec.ts`    | 财务数据             |
| `navigation.spec.ts` | 侧边栏导航           |

---

## 九、超级管理员创建：为什么用 CLI？

### 问题背景

服务器第一次部署，数据库是空的，没有管理员账号，怎么登录后台？

### 方案对比

| 方案                                  | 问题                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| 硬编码默认账号（如 `admin/admin123`） | **安全漏洞**，生产环境密码容易泄漏                          |
| 直接写 SQL 插数据                     | 密码需要手动 bcrypt 加密，步骤繁琐容易出错                  |
| 环境变量预设密码                      | 密码明文存在 `.env` 文件，权限管理困难                      |
| **CLI 交互式创建**                    | ✅ 安全、简单、参考 Django `manage.py createsuperuser` 惯例 |

### 用法

```bash
# 生产服务器（第一次部署后执行一次）
docker exec -it lucky-backend-prod node apps/api/dist/scripts/cli/create-admin.js

# 本地开发
yarn workspace @lucky/api create-admin
```

```
Lucky Admin — 超级管理员创建工具
=========================================
用户名 (Username): admin
邮箱 (Email): admin@example.com
密码 (Password): ****
确认密码: ****

✅ 管理员 "admin" 创建成功！
```

### 为什么只需要运行一次？

CLI 内部会检查用户名是否已存在，防止重复创建：

```typescript
const existing = await db.adminUser.findUnique({ where: { username } });
if (existing) {
  console.log("❌ 该用户名已存在");
  process.exit(1);
}
```

---

## 十、本地开发快速上手

### 前置条件

- Node.js 20+
- Docker Desktop（已启动）
- Yarn（通过 `corepack enable` 安装）
- `mkcert`（本地 HTTPS 证书，用于 `admin-dev.joyminis.com`）

### 步骤

```bash
# ① 克隆代码
git clone https://github.com/your-org/lucky_nest_monorepo.git
cd lucky_nest_monorepo

# ② 初始化（创建 .env 软链接 → deploy/.env.dev）
make setup

# ③ 复制环境变量模板并填入真实值
cp deploy/.env.dev.example deploy/.env.dev
# 编辑 deploy/.env.dev，填入：
#   DATABASE_URL, REDIS_URL, JWT_SECRET 等

# ④ 启动全套环境（DB + Redis + Backend + Nginx）
make up
# 等价于: docker compose --env-file deploy/.env.dev up -d --build
# 首次启动较慢（需要拉取镜像 + 安装依赖），约 3-5 分钟

# ⑤ 首次运行数据库迁移
make migrate
# 等价于: docker exec lucky-backend-dev yarn workspace @lucky/api pr:dev

# ⑥ 创建超级管理员账号
yarn workspace @lucky/api create-admin

# ⑦ 打开浏览器
# 后台管理: https://admin-dev.joyminis.com
# API 文档: http://localhost:3000/api/v1/docs
```

### 常用开发命令

```bash
# 查看所有服务日志
make logs

# 查看单个服务日志
make log s=backend

# 进入后端容器
make exec-api

# 重启所有服务
make restart

# 运行单元测试
yarn workspace @lucky/admin-next test

# 运行 E2E 测试（需要服务在运行中）
yarn workspace @lucky/admin-next test:e2e

# 运行 lint 修复
yarn workspace @lucky/admin-next lint:fix
```

---

## 十一、常见问题 FAQ

---

**Q：改了 `packages/shared` 但前端没生效？**

A：需要重新构建 shared：

```bash
node packages/shared/scripts/build.js
```

**为什么**：`shared` 是预编译的 ESM 包（`dist/` 目录），改源码后要手动触发构建。  
`make up` 启动时会自动构建，但手动修改后需要手动触发。

---

**Q：本地启动报 `Cannot find module '@lucky/shared'`？**

A：shared 还没构建，运行上面的命令。或者重新 `make up`（会自动构建所有包）。

---

**Q：Prisma 报 `Environment variable not found: DATABASE_URL`？**

A：有两种可能：

1. `.env` 软链接没创建 → 运行 `make setup`
2. `deploy/.env.dev` 里没有 `DATABASE_URL` → 检查文件内容

```bash
# 检查软链接
ls -la .env
# 应该显示: .env -> deploy/.env.dev

# 检查变量
grep DATABASE_URL deploy/.env.dev
```

---

**Q：前端 `http.ts` 里为什么用 `useToastStore.getState()` 而不是 `useToastStore()`？**

A：React Hook 只能在 React 函数组件或自定义 Hook 里调用。  
`HttpClient` 是一个普通 JS 类，不是 React 组件，不能用 Hook。  
Zustand 的 `.getState()` 是"在组件外访问 store"的标准方法。

---

**Q：为什么 `next.config.ts` 里有那么多 `optimizePackageImports`？**

A：这些都是"桶文件"（barrel export）包，一个 `import` 会拉进来几百个文件。  
`optimizePackageImports` 让 Turbopack 做 tree-shaking，只编译你实际用到的导出。  
冷启动从 **1186 秒降到约 10 秒**，是最重要的性能优化之一。

---

**Q：为什么生产构建用 `output: 'export'` 而不是正常的 Next.js 服务器？**

A：Cloudflare Pages 不支持运行 Node.js 服务器，只能托管静态文件。  
`output: 'export'` 把 Next.js 编译成静态 HTML/CSS/JS，完全兼容。  
Admin 系统不需要 SEO，不需要服务端渲染，静态导出完全够用。  
优点：免费、全球 CDN、零运维。

---

**Q：部署失败 / 502 错误，怎么排查？**

```bash
# 1. 查看后端容器状态
docker ps -a | grep lucky-backend-prod

# 2. 查看后端日志（最近 100 行）
docker logs --tail=100 lucky-backend-prod

# 3. 手动健康检查
docker exec lucky-backend-prod wget -qO- http://localhost:3000/api/v1/health

# 4. 查看 Nginx 日志
docker logs --tail=50 lucky-nginx-prod
```

---

**Q：如何只重启后端而不重启数据库？**

```bash
# 生产环境
cd /opt/lucky
docker compose -f compose.prod.yml --env-file deploy/.env.prod restart backend

# 本地开发
docker compose restart backend
```

---

**Q：`REDIS_PASSWORD` variable is not set 警告？**

A：这只是警告，不是错误。开发环境 Redis 没有密码，Docker Compose 读取到空值时会提示。  
确认 `deploy/.env.dev` 里有 `REDIS_PASSWORD=`（空值）即可，不影响使用。

---

## 附录：核心技术栈

| 层级        | 技术                     | 选择原因                                |
| ----------- | ------------------------ | --------------------------------------- |
| 前端框架    | Next.js 15 (App Router)  | 文件路由、静态导出、Cloudflare 兼容     |
| 前端状态    | Zustand                  | 轻量，支持组件外访问                    |
| HTTP 客户端 | Axios + 自定义封装       | 拦截器统一处理 token/错误               |
| UI 组件     | Radix UI + Tailwind CSS  | 可访问性好，样式灵活                    |
| 图表        | Recharts                 | React 生态，轻量                        |
| 后端框架    | NestJS                   | TypeScript 原生，模块化，适合中大型 API |
| ORM         | Prisma                   | 类型安全，迁移管理完善                  |
| 数据库      | PostgreSQL               | 稳定，功能完整                          |
| 缓存        | Redis                    | Session/队列/限流                       |
| 容器化      | Docker + Docker Compose  | 环境一致性，一键启动                    |
| CI/CD       | GitHub Actions           | 免费，与仓库集成                        |
| 前端部署    | Cloudflare Pages         | 免费 CDN，全球加速                      |
| 后端部署    | VPS (1GB RAM) + GHCR     | 成本低，镜像化部署                      |
| 单元测试    | Vitest + Testing Library | Vite 生态，速度快                       |
| E2E 测试    | Playwright               | 跨浏览器，API 强大                      |
| Monorepo    | Turborepo + Yarn 4       | 增量构建，包共享                        |
