# Admin Next 技术全景文档

> 适用场景：技术分享 / 答题 / 项目描述 / 团队 Onboarding  
> 范围：`apps/admin-next`（Lucky Nest Monorepo）  
> 更新时间：2026-03-24

---

## 一、项目一句话定位

> 基于 **Next.js 15 App Router** 的电商后台管理平台，采用 **SSR + Client Hybrid** 混合渲染，覆盖用户、订单、营销、财务、系统配置与实时 IM 客服共 **20+ 业务模块**，具备完整的自动化测试与 CI/CD 发布体系。

---

## 二、完整技术栈

### 框架与运行时

| 层次   | 技术       | 版本 | 说明                       |
| ------ | ---------- | ---- | -------------------------- |
| 框架   | Next.js    | 15.x | App Router、Turbopack 开发 |
| 渲染层 | React      | 19.x | RSC + Client Hybrid        |
| 语言   | TypeScript | 5.x  | 全量类型约束               |
| 运行时 | Node.js    | 20.x | standalone 部署            |
| 构建器 | Turbopack  | —    | 开发模式加速               |

### 数据请求层

| 技术                       | 用途                        | 场景                 |
| -------------------------- | --------------------------- | -------------------- |
| `@tanstack/react-query` v5 | 客户端缓存 + 服务端预取注水 | 所有新式页面         |
| `axios`                    | 客户端 HTTP + 拦截器        | 交互操作（增删改）   |
| `serverFetch` (自研)       | Server Component 取数       | SSR 首屏数据         |
| `ahooks/useRequest`        | 旧式客户端请求              | 历史页面（逐步迁移） |
| `socket.io-client`         | 实时通信                    | IM 客服台            |

### 状态管理

| 技术                      | 用途                                            |
| ------------------------- | ----------------------------------------------- |
| `zustand` v4 + persist    | 全局状态（认证 / 主题 / 语言 / Sidebar 折叠态） |
| React Query `QueryClient` | 服务端缓存 + 客户端查询缓存                     |

### UI 与样式

| 技术                       | 说明                                     |
| -------------------------- | ---------------------------------------- |
| Tailwind CSS v4            | 原子化样式                               |
| `@repo/ui` (内部组件库)    | Button / Modal / Form / Table 等基础组件 |
| `framer-motion` v12        | 页面切换动画、Sidebar 过渡               |
| `lucide-react`             | 图标库                                   |
| `recharts`                 | 数据分析图表                             |
| `@tanstack/react-table` v8 | 高性能表格                               |
| `@dnd-kit`                 | 拖拽排序                                 |
| `react-hook-form` + `zod`  | 表单校验（App Router 规范）              |

### 表单规范

```ts
// ✅ 正确：defaultValues 在 useForm，schema 不用 .default() / .transform()
const schema = z.object({ name: z.string(), status: z.number() });
const form = useForm<z.infer<typeof schema>>({
  resolver: zodResolver(schema),
  defaultValues: { name: "", status: 1 },
});
```

### 测试体系

| 技术              | 用途                | 门禁级别                 |
| ----------------- | ------------------- | ------------------------ |
| Vitest v4 + jsdom | 单元测试 + 组件测试 | ✅ 硬门禁（CI 必须通过） |
| Testing Library   | RTL 渲染断言        | ✅ 硬门禁                |
| Playwright v1.58  | E2E 端到端测试      | ⚠️ 软门禁（失败不阻断）  |

### 监控与性能

| 技术                           | 用途                                 |
| ------------------------------ | ------------------------------------ |
| Sentry v10（browser + nextjs） | 生产运行时报错捕获 + Source Map 还原 |
| Lighthouse CI（`@lhci/cli`）   | 每次发布性能回归检测                 |
| `@next/bundle-analyzer`        | Bundle 体积分析                      |

### CI/CD

| 环节          | 工具                 | 说明                                        |
| ------------- | -------------------- | ------------------------------------------- |
| 代码质量门禁  | GitHub Actions CI    | Lint → 类型检查 → 单测 → E2E                |
| 镜像构建      | Docker + GHCR        | `ghcr.io/mrbigporter/lucky-admin-next-prod` |
| 生产发布      | SSH + Docker Compose | VPS Ubuntu 22.04，standalone 镜像           |
| Monorepo 构建 | Turborepo            | 缓存 + 并行编译                             |

---

## 三、架构分层（从下到上）

```
┌─────────────────────────────────────────────────────┐
│  平台层：Next.js 15 + React 19 + Turbopack           │
├─────────────────────────────────────────────────────┤
│  认证 & 路由层：Middleware + App Router              │
│  Cookie 鉴权 → 未登录 302 重定向 → (dashboard) 分组 │
├─────────────────────────────────────────────────────┤
│  布局层：DashboardLayout → Sidebar + Header          │
│  routes/index.ts 路由注册中心驱动 Sidebar / QuickNav │
├─────────────────────────────────────────────────────┤
│  数据访问层（双通道）                                │
│  serverFetch（SSR Cookie）｜Axios（Client 拦截器）   │
├─────────────────────────────────────────────────────┤
│  状态层：Zustand（全局）+ React Query（查询缓存）    │
├─────────────────────────────────────────────────────┤
│  页面层                                              │
│  page.tsx（Server Shell + Suspense + Hydration）     │
│  *Client.tsx（Client 组件，查询消费 + 交互操作）     │
├─────────────────────────────────────────────────────┤
│  质量层：Vitest + Playwright + Sentry + LHCI         │
└─────────────────────────────────────────────────────┘
```

---

## 四、核心设计决策（最重要的点）

### 4.1 为什么不用纯 CSR（Vue SPA / React SPA）？

- Dashboard / Analytics **有首屏稳定性诉求**，SSR 减少 TTFB 不稳定问题
- Middleware 鉴权在服务端运行，**彻底消灭 Auth Flashing**（未登录时看到一闪而过的空白页）
- App Router 分组布局天然适合后台的**多层级布局复用**

### 4.2 为什么请求层是双通道？

```
Server Component：无浏览器环境，不能用 localStorage
  → 使用 serverFetch（读 Cookie，返回 JSON）

Client Component：有拦截器需求（401 重试、Toast、请求去重）
  → 使用 Axios
```

两者互不干扰，由 "在哪运行" 决定走哪条通道。

### 4.3 React Query 的 Hydration 是怎么做的？

```
page.tsx（Server）                    *Client.tsx（Client）
──────────────────                    ───────────────────────
QueryClient.prefetchQuery()           useQuery() 消费预取数据
     ↓ dehydrate()                         ↑
HydrationBoundary state={...}    ──────────┘（注水，跳过首次请求）
```

服务端拉数据 → 序列化成 JSON → 浏览器直接用，**零重复请求**。

### 4.4 认证是怎么分三层的？

| 层次     | 文件              | 职责                                              |
| -------- | ----------------- | ------------------------------------------------- |
| 页面准入 | `middleware.ts`   | 未登录 → 302 `/login`，已登录访问公开页 → 302 `/` |
| 客户端态 | `useAuthStore.ts` | token 存 localStorage + Cookie，登录/登出动作     |
| 请求级别 | `api/http.ts`     | Bearer Token 注入 + 401 自动清态跳登录            |

三层互相配合，任何一层都不单独依赖其他层。

### 4.5 主题无闪烁是怎么做的？

```html
<!-- layout.tsx：在 React Hydration 前先同步读 localStorage，避免 FOUC -->
<script>
  (function () {
    var s = JSON.parse(localStorage.getItem("app-store") || "{}");
    var t = (s.state && s.state.theme) || "dark";
    document.documentElement.classList.add(t);
  })();
</script>
```

在 JS bundle 加载前就完成了主题类名注入，**彻底消灭暗/亮主题切换闪烁**。

---

## 五、功能模块全景（20 个）

| #   | 模块                    | 技术亮点                                  |
| --- | ----------------------- | ----------------------------------------- |
| 1   | 认证（登录 / 登出）     | Admin JWT 独立密钥 + Cookie 双写          |
| 2   | 后台用户管理            | RBAC 权限 + 软删除                        |
| 3   | 角色权限（RBAC）        | 动态权限分配 + Guard 保护                 |
| 4   | 客户端用户 + KYC        | 分页列表 + 状态审核 + 缓存预取            |
| 5   | 收货地址                | 级联地区数据 + 缓存                       |
| 6   | 产品（夺宝）管理        | 多属性 + 素材上传 + 富文本                |
| 7   | 分类管理                | 树形分类                                  |
| 8   | 活动区块（Act Section） | 拖拽排序（@dnd-kit）                      |
| 9   | Banner 管理             | 媒体上传 + 排序                           |
| 10  | 订单管理                | 状态流转 + 搜索 + 缓存预取                |
| 11  | 拼团管理                | 状态追踪 + 缓存                           |
| 12  | 营销 / 优惠券           | 优惠券系统                                |
| 13  | 财务中心                | SSR 统计卡片 + 流水 + 提现                |
| 14  | 支付渠道                | 通道配置 + 费率 + 状态                    |
| 15  | 数据分析                | recharts + async RSC                      |
| 16  | 操作日志                | 安全审计 + 过滤                           |
| 17  | 通知（FCM）             | Firebase Push                             |
| 18  | 地区数据                | 静态数据管理                              |
| 19  | **IM 客服台**           | ⭐ Socket.IO 实时消息 + 会话管理 + 多渠道 |
| 20  | 客服渠道管理            | 渠道配置 + 在线状态                       |

---

## 六、SmartTable + 缓存契约模式（Phase 6 核心成果）

这是 Phase 6 落地的核心工程范式，**7 个页面全部迁移完成**。

### 模式结构

```
*-cache.ts（读侧契约）
  parseXxxSearchParams()    URL string → 类型安全 params
  buildXxxListParams()      params → 请求 body
  xxxListQueryKey()         params → React Query key 数组

page.tsx（Server 预取）
  QueryClient.prefetchQuery()
  HydrationBoundary

*Client.tsx（壳组件）
  useQuery() 消费预取 + 过滤 + 分页

SmartTable.tsx（通用表格组件）
  自动绑定 searchParams → URL sync → 列配置
```

### 完成的 7 个页面

| 页面             | 缓存文件                    |
| ---------------- | --------------------------- |
| Operation Logs   | `operation-logs-cache.ts`   |
| Finance          | `finance-cache.ts`          |
| Orders           | `orders-cache.ts`           |
| Users            | `users-cache.ts`            |
| Products         | `products-cache.ts`         |
| Payment Channels | `payment-channels-cache.ts` |
| Groups           | `groups-cache.ts`           |

---

## 七、性能指标（已测量，2026-03-22）

| 页面          | LCP       | FCP    | TBT  | CLS   |
| ------------- | --------- | ------ | ---- | ----- |
| `/login`      | 1246ms    | 1246ms | 0    | 0.000 |
| `/` Dashboard | **963ms** | 963ms  | 20ms | 0.000 |
| `/analytics`  | 1645ms    | 1645ms | 2ms  | 0.000 |
| `/finance`    | 1506ms    | 1506ms | 0    | 0.000 |
| `/orders`     | 1543ms    | 1543ms | 0    | 0.000 |

**结论**：

- ✅ 所有页面 CLS = 0（Suspense 骨架屏彻底消灭布局偏移）
- ✅ SSR 有效：Dashboard 比 Orders 快 **580ms**
- ✅ 所有页面 TBT < 200ms（JS 不阻塞主线程）
- ✅ 符合 Google CWV 外网标准（LCP < 2.5s）

---

## 八、工程质量保障体系

### CI 流水线（全自动）

```
git push / PR → GitHub Actions
  ├── Lint（continue-on-error，软门禁）
  ├── TypeScript 类型检查（硬门禁）
  ├── Vitest 单测（硬门禁）
  ├── E2E Playwright（软门禁，需 secret）
  └── Lighthouse CI（性能回归检测）
```

### 本地质量闸门

```
git commit → lint-staged（prettier + eslint + 禁止 console.log）
git push   → prepush（tsc + vitest）
```

### 测试覆盖（截至 2026-03-24）

- **Vitest 单测**：85+ 用例，覆盖所有缓存契约、核心组件、视图组件
- **Playwright E2E**：覆盖登录 / 核心 CRUD 流程

---

## 九、标准答案（可直接背）

### Q1：这个项目用 Next.js 15 的哪些新特性？

> App Router 分组路由、React Server Component + Suspense Streaming、HydrationBoundary 服务端预取注水、Edge Middleware Cookie 鉴权、generateMetadata 动态 SEO、robots.ts + sitemap.ts 自动生成。

### Q2：SSR 和 CSR 在你的项目里怎么分工？

> Dashboard/Analytics 统计卡片走 Server Component 直出 HTML，交互列表（搜索/分页/操作）保留 Client Component；用 HydrationBoundary 衔接两者，首屏数据不重复请求。

### Q3：React Query 的 HydrationBoundary 怎么用？

> 服务端 `QueryClient.prefetchQuery()` 拉数据，`dehydrate()` 序列化后包在 `HydrationBoundary state={dehydratedState}` 里传给客户端；客户端的 `useQuery()` 初始化时直接从 Boundary 注水，首次请求被完全跳过。

### Q4：项目里 Zod 和 react-hook-form 怎么配合？

> Schema 只做类型校验，不加 `.default()` 和 `.transform()`（v5 严格模式下两者会导致 TS2322）；默认值统一在 `useForm({ defaultValues: {...} })` 里设，类型转换在 `onSubmit` handler 里手动做。

### Q5：Sentry + Lighthouse CI 是怎么运作的？

> Sentry SDK 集成三层（browser / server / edge），生产构建时上传 Source Map，报错在 Sentry 后台可直接定位到源码行；Lighthouse CI 在每次 git push 时自动跑 5 个页面的性能指标，LCP/TBT/CLS 超阈值直接在 PR 标红。

### Q6：最复杂的技术挑战是什么？

> IM 客服台：Socket.IO 实时消息 + 会话列表增量更新 + 消息撤回同步 + 多客服渠道协作，需要在单页面管理多个异步状态流，同时保证 React 渲染边界不污染无关组件。

---

## 十、描述模板

### 版本 A（标准型，适合大多数 JD）

> 主导基于 Next.js 15 App Router 的电商后台前端建设，覆盖 20+ 业务模块；落地 SSR + Client Hybrid 渲染（Dashboard LCP 963ms，较纯 CSR 提升 37%）、React Query HydrationBoundary 服务端预取、Edge Middleware 统一认证守卫及 Socket.IO 实时 IM 客服台；建立 Vitest + Playwright 自动化测试体系（85+ 用例），整合 Sentry 监控与 Lighthouse CI 性能持续检测。

### 版本 B（偏架构决策，适合高级工程师/架构师岗）

> 在 Yarn 4 + Turborepo Monorepo 中，主导 `admin-next` 从"把 Next.js 当 CRA 使用"到标准 App Router 混合渲染架构的 6-Stage 完整升级：建立 routes 注册中心统一路由/导航/SEO、serverFetch + Axios 双通道数据访问、SmartTable + 缓存契约范式（7 页面迁移）及三层鉴权边界（Middleware / Zustand / Axios 拦截器）；推动工程门禁（CI 类型检查 + Vitest 硬门禁）并完成 Lighthouse + Sentry 可观测性接入。

### 版本 C（偏量化结果，适合管理岗 / ToB 产品岗）

> 独立完成电商后台全前端建设（Next.js 15，20+ 模块）；通过 SSR 优化将 Dashboard 首屏时间降低 37%；建立完整 CI/CD 质量闸门（代码提交自动检查 + 单测硬门禁 + E2E 软门禁），将线上问题平均发现时间从人工排查缩短至 Sentry 自动告警；支撑 IM 实时客服、订单管理、财务结算等核心业务模块稳定运营。

---

## 十一、技术分享主题建议

以下主题都有实际代码支撑，适合内部分享或对外技术交流：

| 主题                                        | 难度     | 对应代码                                       |
| ------------------------------------------- | -------- | ---------------------------------------------- |
| Next.js App Router SSR + Hydration 实战     | ⭐⭐⭐   | `app/(dashboard)/*/page.tsx` + `*-cache.ts`    |
| React Query 服务端预取注水完整流程          | ⭐⭐⭐   | `HydrationBoundary` + `prefetchQuery`          |
| Edge Middleware 鉴权：消灭 Auth Flashing    | ⭐⭐     | `middleware.ts`                                |
| Zod + react-hook-form v7/v5 踩坑全记录      | ⭐⭐     | 各 Modal 表单组件                              |
| Socket.IO 在 React 中的状态管理模式         | ⭐⭐⭐⭐ | `CustomerServiceDesk.tsx` + `useChatSocket.ts` |
| Vitest 测试 React Query 组件完整姿势        | ⭐⭐     | `src/__tests__/views/`                         |
| Lighthouse CI 接入 + Sentry Source Map 实战 | ⭐⭐     | `lighthouserc.js` + `sentry.*.config.ts`       |
| Monorepo tsconfig 规范：避免 dist 路径错乱  | ⭐⭐⭐   | `tsconfig.build.json` + 事故复盘               |

---

## 十三、大厂级深度理论题（SSR 核心命脉）

> 以下 5 道题来自大厂实际，结合本项目真实实现，每题附 ❓ 心智模型提问 + ✅ 本项目实际对应。

---

### 题 1：RSC 与传统 SSR 的本质区别 ⭐⭐⭐⭐

**问法**：Server Components 和 Pages Router 里 `getServerSideProps` 的渲染产物、Bundle 体积有什么本质区别？

**标准答案**：

| 维度          | 传统 SSR（getServerSideProps）          | RSC（App Router Server Component）   |
| ------------- | --------------------------------------- | ------------------------------------ |
| 渲染产物      | HTML 字符串                             | RSC Payload（JSON 结构树）           |
| 客户端 Bundle | **必须包含该组件 JS**（用于 Hydration） | **完全不包含**（代码只在服务端运行） |
| 三方库体积    | 庞大依赖随 Bundle 发往浏览器            | 重型依赖留在服务端，客户端零负担     |
| Hydration     | 必须，浏览器再执行一遍 JS               | 不需要（Server Component 无交互）    |

**本项目对应**：

```
page.tsx（Server Component）
  ├── QueryClient.prefetchQuery()  ← 服务端直连 API，代码不进 Bundle
  ├── HydrationBoundary            ← 序列化 RSC Payload 传给客户端
  └── <Suspense fallback={<Skeleton/>}>
        <*Client />                 ← 只有这部分进 Client Bundle
```

> ❓ **心智模型提问**：如果把 `page.tsx` 里的 `serverFetch` 放到 Client Component 里，会发生什么？  
> ✅ 服务端数据请求变成客户端请求：① 会有首屏数据空白（TTFB 后才触发请求）；② `serverFetch` 依赖的 Cookie 鉴权在浏览器端拿不到；③ 如果引用了 `server-only` 库，构建直接报错。

---

### 题 2：Edge 计算与包体积极限压榨 ⭐⭐⭐

**问法**：把 Next.js 部署到 Cloudflare Workers 遇到 3MB Bundle 限制，从架构角度怎么解决？

**标准答案**：

1. **切换 Runtime**：在路由级别声明 `export const runtime = 'edge'`，强制剥离 Node.js 原生依赖
2. **剔除 WASM / 原生绑定**：移除 `.wasm` 文件和 C++ 绑定库，改用轻量替代
3. **分离构建目标**：轻量展示页 → Edge；重型管理后台 → Node.js 容器

**本项目决策**：

> 本项目部署在 VPS Docker（Node.js standalone），**不走 Edge**，因此无此限制。但这个决策本身就值得聊：管理后台有 Prisma、Socket.IO、重型监控 SDK，天然不适合 Edge，选对部署目标本身是架构能力体现。

> ❓ **心智模型提问**：什么样的页面适合走 Edge Runtime？  
> ✅ 无 Node.js 原生 API 依赖、无 WASM、无重型三方库、逻辑简单的展示/重定向页（如 Landing Page、A/B 测试分发、geo-aware 重定向）。本项目的 `middleware.ts` 本质上就运行在 Edge-like 的 Next.js Middleware 层。

---

### 题 3：Hydration 黑科技 — 服务端数据如何无缝衔接客户端 ⭐⭐⭐⭐

**问法**：SSR 阶段已请求过一次 API，客户端接管后如何配合 React Query 做到"无缝衔接"且不重复请求？

**本项目标准流程**：

```typescript
// ① Server：page.tsx
const queryClient = new QueryClient();
await queryClient.prefetchQuery({
  queryKey: ordersListQueryKey(params),
  queryFn: () => serverFetch('/admin/orders', params),
});
const dehydratedState = dehydrate(queryClient);

// ② 传递给客户端
return (
  <HydrationBoundary state={dehydratedState}>
    <OrdersClient searchParams={searchParams} />
  </HydrationBoundary>
);

// ③ Client：OrdersClient.tsx
const { data } = useQuery({
  queryKey: ordersListQueryKey(params),
  queryFn: () => fetchOrders(params),
  // 首次直接从 Boundary 注水，跳过网络请求
});
```

**核心机制**：

- `dehydrate()` → 服务端缓存序列化成 JSON 塞入 HTML
- `HydrationBoundary` → 客户端 React Query 初始化时自动从中读取（注水）
- `queryKey` 必须完全匹配 → 两端 queryKey 用同一 `*-cache.ts` 函数生成，保证一致性

> ❓ **心智模型提问**：如果 Server 和 Client 的 `queryKey` 不一致会发生什么？  
> ✅ 注水失败，客户端找不到匹配的缓存，会重新发起一次网络请求，退化成普通 CSR，但不会报错（静默降级）。这也是为什么本项目把 `queryKey` 生成函数抽到 `*-cache.ts` 统一管理，服务端/客户端都 import 同一个函数。

---

### 题 4：Next.js App Router 的"三层缓存"迷宫 ⭐⭐⭐⭐

**问法**：简述 Request Memoization、Data Cache 和 Full Route Cache 的区别，后台更新数据后如何精准让缓存失效？

**三层缓存对比**：

| 缓存层              | 级别       | 作用域                    | 清除方式                               |
| ------------------- | ---------- | ------------------------- | -------------------------------------- |
| Request Memoization | React 层   | 单次渲染生命周期内        | 渲染结束自动销毁                       |
| Data Cache          | Next.js 层 | 跨请求持久化（磁盘/内存） | `revalidateTag()` / `revalidatePath()` |
| Full Route Cache    | 构建层     | Build time 静态化         | `revalidatePath()` / 重新构建          |

**本项目缓存策略**：

```typescript
// finance-stats-cache.ts：统计卡片数据，带 tag + 1h 重验证
export const fetchFinanceStats = () =>
  serverFetch('/admin/finance/stats', {}, {
    next: { tags: ['finance:stats'], revalidate: 3600 }
  });

// Server Action：管理员操作后精准清除
import { revalidateTag } from 'next/cache';
export async function updateOrderAction(...) {
  await apiCall(...);
  revalidateTag('orders:list');  // 精准击穿，不影响其他页面缓存
}
```

> ❓ **心智模型提问**：如果不加 `revalidateTag`，管理员更新订单状态后，列表页还是旧数据，多久会自动刷新？  
> ✅ 取决于 `revalidate` 时间。如果设了 `revalidate: 60`，最长 60s 后自然过期重取。如果没设（默认无限期缓存），页面永远不会自动刷新，必须手动 `revalidateTag` 或重新部署。这是 Server Action 必须触发 `revalidateTag` 的根本原因。

---

### 题 5：服务端组件的安全护城河 — server-only ⭐⭐⭐

**问法**：如果不小心在 Client Component 里 import 了包含数据库密码的工具类，会导致密钥泄露吗？企业级如何物理隔绝？

**标准答案**：

不加防护的情况下，**极有可能泄露**。构建工具会顺着依赖树把包含密钥的代码打包进 Client Bundle 发给浏览器。

**防御方案 — `server-only` 包**：

```typescript
// lib/server-auth.ts（包含敏感逻辑）
import "server-only"; // ← 一行声明

export const getAdminToken = () => process.env.ADMIN_JWT_SECRET;
// 任何 'use client' 组件 import 此文件 → 构建阶段直接报错
```

**本项目实践**：

- `serverFetch.ts` 包含 Cookie 读取和 API 密钥注入，**仅在 Server Component / Route Handler 中调用**
- 所有含 `ADMIN_JWT_SECRET`、`DATABASE_URL` 的逻辑全部在 Server 侧，Client 只拿到脱敏数据

> ❓ **心智模型提问**：`server-only` 是 Next.js 独有的吗？它的原理是什么？  
> ✅ 是 npm 上的独立包。原理很简单：包的 `index.js` 只有在 server 环境才能正常 import，在 browser/client bundle 中引用时打包器（Webpack/Turbopack）会抛致命错误。它是纯工程防呆，不涉及运行时逻辑。

---

### 题 1-5 对项目的优化启示

| 题目           | 本项目现状                                      | 优化方向                                            |
| -------------- | ----------------------------------------------- | --------------------------------------------------- |
| RSC 产物       | Server Component 已拆分，Client Bundle 控制良好 | 持续检查 `use client` 边界，避免意外扩大            |
| Edge 部署      | VPS Node.js，不受 Edge 限制                     | Middleware 已是轻量逻辑，符合 Edge 最佳实践         |
| Hydration 衔接 | 7 个页面已落地缓存契约，queryKey 统一管理       | ✅ 完成，模式已固化                                 |
| 三层缓存       | `revalidateTag` 已在 Server Action 中使用       | 补全统计类页面的 `revalidate` 时间窗口              |
| server-only    | serverFetch 只在 Server 侧调用                  | 可进一步在敏感文件顶部显式加 `import 'server-only'` |

---

## 十二、相关文档联读

| 文档                                                                   | 内容                            |
| ---------------------------------------------------------------------- | ------------------------------- |
| `read/architecture/ADMIN_NEXT_SSR_CSR_REVIEW_CN.md`                    | 6-Stage 重构全过程与架构评审    |
| `read/architecture/ADMIN_NEXT_ARCHITECTURE_INTERVIEW_CN.md`            | 高频问题 + 模板                 |
| `read/architecture/ADMIN_NEXT_ARCHITECTURE_5MIN_ORAL_CN.md`            | 5 分钟口述稿（开场）            |
| `read/architecture/ADMIN_NEXT_ARCHITECTURE_INTERVIEW_FLASHCARDS_CN.md` | 闪卡速记（前 15 分钟）          |
| `read/performance/PERFORMANCE_LIGHTHOUSE_CN.md`                        | Lighthouse 性能验收结果         |
| `read/performance/NEXT_SSR_SEO_CRAWLER_MASTER_GUIDE_CN.md`             | SEO + 爬虫全链路实战            |
| `read/devops/LHCI_SENTRY_SETUP_CN.md`                                  | Lighthouse CI + Sentry 接入指南 |
| `read/testing/TESTING_STANDARDS_CN.md`                                 | 测试规范（高频禁令 + 速查表）   |
| `read/features/FEATURES_CN.md`                                         | 20 个功能模块详细文档           |
