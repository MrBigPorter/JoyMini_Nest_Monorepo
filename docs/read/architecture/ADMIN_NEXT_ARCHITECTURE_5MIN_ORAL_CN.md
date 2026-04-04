# Admin Next 架构 5 分钟口述稿

> 用途：5 分钟技术介绍，内部分享快讲  
> 项目：`apps/admin-next`  
> 建议讲法：按“定位 -> 架构 -> 亮点 -> 风险 -> 规划”顺序

---

## 0:00 - 0:30 项目定位

`admin-next` 是 Lucky Nest Monorepo 下的电商后台前端，基于 Next.js 15 App Router，覆盖用户、订单、营销、财务、系统配置和客服 IM。它不是纯 CRUD 台，而是带实时客服能力的中后台平台。

---

## 0:30 - 2:00 架构主线（分层讲）

### 1) 平台层

- `apps/admin-next/package.json`
- `apps/admin-next/next.config.ts`

核心点：Next.js 15 + React 19 + standalone 部署 + Turbopack 开发。

### 2) 路由与认证层

- `apps/admin-next/src/app/(dashboard)/layout.tsx`
- `apps/admin-next/src/routes/index.ts`
- `apps/admin-next/src/middleware.ts`

核心点：

- Dashboard 页面统一受保护
- middleware 读 Cookie 做服务端重定向
- routes 注册中心统一驱动 Sidebar/标题/导航

### 3) 数据访问层（双通道）

- 客户端：`apps/admin-next/src/api/http.ts` + `apps/admin-next/src/api/index.ts`
- 服务端：`apps/admin-next/src/lib/serverFetch.ts`

核心点：

- Server Component 用 `serverFetch`（Cookie token）
- Client 交互用 Axios（拦截器、401、去重、toast）

### 4) 状态与 UI 壳层

- `apps/admin-next/src/store/useAuthStore.ts`
- `apps/admin-next/src/store/useAppStore.ts`
- `apps/admin-next/src/components/layout/*`

核心点：Zustand 管理认证、主题、语言、Sidebar 折叠态。

---

## 2:00 - 3:00 技术亮点（重点）

### 亮点 A：SSR + Client Hybrid

- `apps/admin-next/src/app/(dashboard)/page.tsx`
- `apps/admin-next/src/components/dashboard/DashboardStats.tsx`
- `apps/admin-next/src/components/dashboard/DashboardOrdersClient.tsx`

首屏统计用 SSR，交互列表保留客户端更新。

### 亮点 B：路由注册中心

- `apps/admin-next/src/routes/index.ts`

Sidebar、QuickNav、metadata 标题统一由 routes 驱动，避免多处写死。

### 亮点 C：实时客服

- `apps/admin-next/src/views/CustomerServiceDesk.tsx`
- `apps/admin-next/src/hooks/useChatSocket.ts`

支持会话实时刷新、消息/撤回同步、客服状态指示。

---

## 3:00 - 4:00 风险与技术债（体现架构判断）

1. 构建门禁偏宽松

- `next.config.ts` 中 `typescript.ignoreBuildErrors`、`eslint.ignoreDuringBuilds` 为 true。

2. 请求层处于过渡态

- `ahooks/useRequest` 与 React Query 共存，缓存策略不完全统一。

3. 个别页面复杂度过高

- `CustomerServiceDesk.tsx` 体量大，后续应拆分模块和 hook。

4. E2E 规范尚未全量统一

- 项目要求从 `./fixtures` 导入 test，但仍有历史 spec 直接用 `@playwright/test`。

---

## 4:00 - 5:00 下一步优化路线

### P0（优先）

- 恢复构建门禁（逐步收敛 TS/ESLint 错误）
- 统一 E2E fixtures 导入规范
- 修已知类型债（如页面组件 props 漂移）

### P1（中期）

- 逐步统一数据层范式（减少双请求栈）
- 拆分 IM 客服台大页面

### P2（体验）

- QuickNav 升级命令面板
- Sidebar 交互细节优化

---

## 收尾一句（可直接背）

这个项目最大的价值不在“页面多”，而在于它已经形成了中后台平台的核心能力：混合渲染、统一鉴权、实时客服、测试体系和路由中心化。下一阶段重点是工程一致性收敛，而不是盲目加新技术。
