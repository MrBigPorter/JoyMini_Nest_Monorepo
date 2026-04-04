# serverFetch 指南（Admin Next）

> 文件：`apps/admin-next/src/lib/serverFetch.ts`  
> 适用：`apps/admin-next` 的 Server Component / SSR 取数  
> 结论先行：**是重要基础设施**，不是普通工具函数。

---

## 1. 为什么它很重要

在 `admin-next` 里，`serverFetch.ts` 解决的是“服务端渲染阶段如何安全、稳定、低成本地取数”。

如果没有它，页面很容易出现以下问题：

- Server Component 里误用客户端 Axios / localStorage（直接报错）
- SSR 阶段拿不到登录态，导致服务端请求 401
- 重复写 baseURL、headers、code 判断，逻辑分散
- 缓存策略不统一，性能与数据新鲜度不可控

所以它的重要性是：

- 统一 Server 侧 API 调用入口
- 统一 Cookie 鉴权头注入
- 统一 API 响应码校验
- 统一 revalidate 缓存策略

一句话：`serverFetch.ts` 是 `admin-next` 的 Server Data Access 基座。

---

## 2. 它做了什么（按代码结构看）

### 2.1 `getBase()`：环境优先级

按顺序选 API 基地址：

1. `INTERNAL_API_URL`（容器内网优先）
2. `NEXT_PUBLIC_API_BASE_URL`
3. 默认 `http://localhost:3000`

这让同一套代码在 Docker / 本地都能工作。

### 2.2 `buildHeaders()`：服务端读取 Cookie token

通过 `cookies()` 读取 `auth_token`，构造：

- `Content-Type: application/json`
- `Authorization: Bearer <token>`（有 token 时）

这是 Server Component 场景下的关键：

- 不依赖 localStorage
- 与 middleware 的 Cookie 认证链路一致

### 2.3 `serverGet<T>()`：统一 GET 调用

`serverGet` 封装了：

- query 参数拼接
- `fetch(..., { next: { revalidate } })`
- HTTP 状态校验（非 2xx 抛错）
- 业务 code 校验（仅 `10000/200` 视为成功）

最终返回 `json.data`，让业务层调用更干净。

---

## 3. 与 Axios 的边界（非常关键）

项目同时有：

- `apps/admin-next/src/api/http.ts`（Axios）
- `apps/admin-next/src/lib/serverFetch.ts`

不是重复，而是职责分离：

| 场景                                       | 推荐                        |
| ------------------------------------------ | --------------------------- |
| Server Component / SSR                     | `serverGet`                 |
| Client Component 交互（按钮、表单、轮询）  | Axios API（`api/index.ts`） |
| 需要拦截器、toast、请求去重、refresh token | Axios                       |
| 需要首屏服务端渲染数据                     | `serverGet`                 |

经验法则：

- 在 `app/(dashboard)/**/page.tsx` 和 server component 中优先考虑 `serverGet`
- 在 `views/**` 的客户端交互里用 Axios 封装 API

---

## 4. 对 Next.js 渲染模式的影响

`serverFetch.ts` 内部使用了 `cookies()`，这件事很重要：

- 它会让调用它的取数链路具备“请求时上下文”（用户 Cookie）
- 配合 `revalidate` 形成“动态上下文 + 可控缓存”策略

实践上，这让 `admin-next` 可以做：

- Dashboard/Analytics 的 SSR 首屏
- 客户端组件继续做高交互更新（Hybrid）

所以它不是“纯静态页工具”，而是“服务端认证取数工具”。

---

## 5. 正确用法示例

### 5.1 Server Component（推荐）

```ts
import { serverGet } from "@/lib/serverFetch";

const stats = await serverGet<StatsOverview>("/v1/admin/stats/overview");
```

### 5.2 带查询参数

```ts
const orders = await serverGet("/v1/admin/order/list", {
  page: 1,
  pageSize: 5,
});
```

### 5.3 控制缓存

```ts
// 30s 默认
await serverGet("/v1/admin/finance/statistics");

// 禁用缓存（等同 no-store 语义）
await serverGet("/v1/admin/finance/statistics", undefined, {
  revalidate: false,
});
```

---

## 6. Do / Don’t

### Do

- 在 Server Component 中统一使用 `serverGet`
- 明确传入泛型，保证类型可读性
- 对关键页面设置合适 `revalidate`
- 在业务层 catch 后做可视化降级（空态/重试）

### Don’t

- 不要在 Server Component 里用 `localStorage`
- 不要在服务端直接复用客户端 Axios 实例
- 不要每个页面自己拼 Authorization 头
- 不要忽略 API `code` 校验

---

## 7. 速记（可直接说）

> 我们把服务端取数统一收口到 `serverFetch.ts`。它负责读取 HTTP-only Cookie 注入鉴权头、处理环境 baseURL、统一业务 code 校验和 revalidate 缓存策略。这样 Server Component 可以稳定做 SSR，而客户端继续用 Axios 处理交互请求，形成清晰的双通道数据访问架构。

---

## 8. 你现在可以怎么判断“该不该用它”

满足以下任一条件，就优先 `serverGet`：

- 页面是 Server Component
- 需要首屏 SSR 数据
- 需要在服务端携带当前登录态（Cookie token）

否则（交互动作、表单提交、客户端轮询）优先走 Axios API。

---

## 9. 关联文件索引

- `apps/admin-next/src/lib/serverFetch.ts`
- `apps/admin-next/src/api/http.ts`
- `apps/admin-next/src/api/index.ts`
- `apps/admin-next/src/components/dashboard/DashboardStats.tsx`
- `apps/admin-next/src/components/analytics/AnalyticsOverview.tsx`
- `apps/admin-next/src/app/(dashboard)/page.tsx`

---

## 10. 2 小时带读计划（只会 Client 的快速上手）

> 目标：2 小时内建立 SSR/Hybrid 最小闭环认知，能独立判断页面该走 `serverGet` 还是 Axios。

### 任务清单（按顺序）

- [ ] **0-20 分钟**：精读 `apps/admin-next/src/lib/serverFetch.ts`（`getBase` / `buildHeaders` / `serverGet` / `revalidate`）
- [ ] **20-40 分钟**：阅读 `apps/admin-next/src/middleware.ts` 与 `apps/admin-next/src/app/(dashboard)/layout.tsx`，画出 Cookie 鉴权链路
- [ ] **40-80 分钟**：拆 `apps/admin-next/src/app/(dashboard)/page.tsx` + `components/dashboard/*`，标注 Server/Client 边界
- [ ] **80-110 分钟**：拆 `apps/admin-next/src/app/(dashboard)/analytics/page.tsx` + `components/analytics/*`，理解首屏 SSR + 交互 CSR
- [ ] **110-120 分钟**：完成自测题并写 1 页结论（你自己的渲染模式决策标准）

### 自测题（答对 6/8 视为过关）

1. `serverFetch.ts` 统一了哪四类问题？
2. 为什么 Server Component 不能直接复用客户端 Axios 实例？
3. 为什么 `cookies()` 会影响取数链路的“动态上下文”？
4. `serverGet` 的 HTTP 成功但 `code != 10000/200` 时为何仍要抛错？
5. middleware 与 `serverGet` 在鉴权链路里各自职责是什么？
6. Dashboard 中哪些块更适合 SSR，哪些块更适合 CSR？
7. Analytics 页为什么通常是 Hybrid，而不是全 SSR/全 CSR？
8. 任选 `users` 或 `support-channels` 页面，给出你的渲染模式选择与 3 条依据。

### 复盘模板（建议照抄）

```md
# SSR 学习复盘（admin-next）

## 我确认掌握

- serverFetch 的职责边界：
- middleware 的职责边界：
- serverGet vs Axios 选择标准：

## 我对 1 个真实页面的判断

- 页面：
- 渲染模式（SSR/CSR/Hybrid）：
- 理由（至少 3 条）：

## 下一步实践

- 我准备先改造/优化的页面：
- 验证方式（首屏、交互、错误处理）：
```
