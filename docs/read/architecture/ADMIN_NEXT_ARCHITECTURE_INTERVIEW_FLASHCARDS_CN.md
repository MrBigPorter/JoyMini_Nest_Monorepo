# Admin Next 问答闪卡（Q/A 速记版）

> 用途：前 15 分钟速记、技术问答演练、复盘  
> 项目：`apps/admin-next`

---

## A. 基础定位类

### Q1：这个项目是什么类型？

**A：** 电商后台前端，基于 Next.js 15 App Router，包含运营管理和实时客服两大类能力，不是纯 CRUD 后台。

关键词：`App Router` `中后台` `实时客服`

### Q2：为什么用 Next.js，不是纯 React SPA？

**A：** 需要 SSR 首屏、middleware 鉴权、分组布局和服务端取数。后台虽然以交互为主，但 Dashboard/Analytics 场景适合混合渲染。

关键词：`SSR` `middleware` `Hybrid`

---

## B. 架构设计类

### Q3：路由与导航如何统一？

**A：** 用 `routes/index.ts` 作为注册中心，Sidebar、QuickNav、Dashboard metadata 都从这里取，减少 magic string 和重复配置。

关键词：`single source` `routes registry` `减少重复`

### Q4：认证边界怎么分层？

**A：**

- `middleware.ts`：页面准入（未登录跳转）
- `useAuthStore.ts`：客户端认证态
- `api/http.ts`：请求层 token 注入与 401 处理

关键词：`页面鉴权` `状态鉴权` `请求鉴权`

### Q5：为什么同时有 `serverFetch` 和 Axios？

**A：** 服务端和客户端需求不同。Server Component 用 `serverFetch`（读 Cookie），客户端高交互用 Axios（拦截器、重试、toast）。

关键词：`双通道` `RSC` `拦截器`

### Q6：数据请求为什么没全量 React Query？

**A：** 项目处于演进态。新页面（如 Dashboard）已接 React Query + HydrationBoundary，历史页面仍有 `ahooks/useRequest`，后续逐步统一。

关键词：`演进式重构` `历史包袱` `渐进统一`

---

## C. 能力亮点类

### Q7：项目里最复杂的模块是什么？

**A：** IM 客服台（`CustomerServiceDesk.tsx` + `useChatSocket.ts`），涉及实时消息、会话列表同步、撤回、会话状态与多渠道协作。

关键词：`Socket.IO` `实时同步` `多状态`

### Q8：SSR 在这个项目有什么具体落地？

**A：** Dashboard/Analytics 的统计数据走服务端取数，Dashboard 列表通过 `HydrationBoundary` 注水到客户端，兼顾首屏和交互。

关键词：`serverGet` `dehydrate` `首屏稳定`

### Q9：主题和多语言怎么做的？

**A：** `useAppStore`（zustand persist）管理 `theme/lang`，首屏用 inline script 先加 class，避免 FOUC；文案走 `TRANSLATIONS`。

关键词：`zustand persist` `FOUC` `TRANSLATIONS`

---

## D. 工程质量类

### Q10：项目测试体系是什么？

**A：**

- 单测：Vitest + RTL + jsdom
- E2E：Playwright（setup 登录 + 路由 warmup）

关键词：`Vitest` `Playwright` `warmup`

### Q11：当前最大的技术债是什么？

**A：** 构建门禁较宽松（`ignoreBuildErrors` / `ignoreDuringBuilds`），会导致类型问题延后暴露；其次是请求层双栈并存。

关键词：`门禁` `类型债` `双栈`

### Q12：你会优先做哪些优化？

**A：**

1. 恢复构建门禁并清类型债
2. 统一 E2E fixtures 导入规范
3. 拆分超大页面（客服台）
4. 统一数据层范式

关键词：`P0 收敛` `一致性` `可维护性`

---

## E. 场景追问（进阶）

### Q13：如果管理员并发很高，客服台先优化哪块？

**A：** 先拆分状态与渲染边界，减少整页重渲染；其次做消息虚拟列表与增量更新；最后优化 Socket 事件粒度与回压策略。

关键词：`渲染边界` `虚拟列表` `事件粒度`

### Q14：如果让你做“路由治理”，你会怎么做？

**A：**

- 路由路径规范化（已做：customer-service、act-sections、payment-channels）
- 旧路由统一 redirect（保兼容）
- routes 注册中心 + 测试断言持续约束

关键词：`规范化` `兼容跳转` `持续约束`

### Q15：如何向官证明你理解“架构”，不只是会写页面？

**A：** 讲清楚“分层边界 + 技术取舍 + 风险治理”：

- 为什么双通道请求
- 为什么 middleware + store 双层鉴权
- 为什么先收敛门禁再扩功能

关键词：`边界` `取舍` `治理`

---

## 一句话背诵版

`admin-next` 的价值在于把中后台的核心能力串起来了：混合渲染、统一鉴权、路由中心化、实时客服和自动化测试；下一步重点是工程一致性收敛，而不是继续堆技术栈。
