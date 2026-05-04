---
title: 'admin-next Server Prefetch + ISR——Server Component 数据获取与增量静态再生'
slug: admin-next-server-prefetch-isr
tags: Next.js, Admin, SSR, ISR, Server Components, Data Fetching, Cache
description: A deep dive into admin-next's server-side data fetching strategy — the serverGet utility for Server Components, ISR revalidation with tags, and Server Actions for cache invalidation.
---

# admin-next Server Prefetch + ISR——Server Component 数据获取与增量静态再生

> **Article A3** — The admin-next project uses Next.js Server Components for server-side data fetching, combining ISR (Incremental Static Regeneration) with `revalidateTag`-based cache invalidation. This article covers the `serverGet` utility, the tag-based cache system, and Server Actions that bridge write operations with cache invalidation.

- **Source**: [`serverFetch.ts`](apps/admin-next/src/lib/serverFetch.ts) (125L), cache modules in [`lib/cache/`](apps/admin-next/src/lib/cache/), revalidate actions in [`lib/actions/`](apps/admin-next/src/lib/actions/)
- **Concepts**: Next.js `fetch` with `next.revalidate`, `revalidateTag`, Server Actions (`'use server'`)
- **Series**: admin-next Architecture Deep Dive

---

## 1. 背景

admin-next 采用 **Next.js App Router** + **Server Components** 架构。在这种架构下，Server Component 是默认渲染方式——组件在服务端运行，直接访问数据库或 API，然后将 HTML 返回给客户端。

与传统 CSR（Client-Side Rendering）相比，Server Component 数据获取面临以下挑战：

| 挑战 | 说明 | 解决方案 |
|------|------|---------|
| **服务端 fetch** | Server Component 不能使用 axios（需 `window` / `localStorage`） | 使用 Node.js 原生 `fetch` |
| **认证** | 服务端无法读取 `localStorage` | 从 HTTP-only Cookie 读取 `auth_token` |
| **网络拓扑** | Docker 部署需内网直达 API | `INTERNAL_API_URL` 优先 |
| **性能** | 每次请求都回源 API 服务器 | ISR + Data Cache |
| **数据新鲜度** | 写操作后需清除缓存 | `revalidateTag` Server Actions |
| **错误降级** | API 不可用不应导致页面崩溃 | 401/403 返回 null |

---

## 2. serverGet——Server Component 专用 GET 工具

[`serverGet`](apps/admin-next/src/lib/serverFetch.ts:53) 是 serverFetch.ts 的核心导出函数，封装了服务端数据获取的完整流程：

```tsx
export async function serverGet<T>(
  path: string,
  params?: ServerFetchParams,
  options?: ServerFetchOptions,
): Promise<T>
```

### 2.1 使用示例

```tsx
// app/dashboard/page.tsx — Server Component
import { serverGet } from '@/lib/serverFetch';

export default async function DashboardPage() {
  const stats = await serverGet<FinanceStatistics>(
    '/v1/admin/finance/statistics',
    { period: 'month' },
    { revalidate: 60, tags: ['dashboard:stats'] },
  );

  return <DashboardClient stats={stats} />;
}
```

### 2.2 三个关键设计

**1. 内网优先的 Base URL**

```tsx
function getBase(): string {
  return (
    process.env.INTERNAL_API_URL ||       // Docker 内网（跳过公网）
    process.env.NEXT_PUBLIC_API_BASE_URL || // 本地开发
    'http://localhost:3000'                // 回退
  );
}
```

在 Docker 部署中，admin-next 和 API 服务在同一网络中，`INTERNAL_API_URL` 允许请求直接走内网，避免公网往返延迟。

**2. HTTP-only Cookie 认证**

```tsx
async function buildHeaders(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
```

`next/headers` 的 `cookies()` 在 Server Component 中可读取 HTTP-only Cookie（由登录流程写入），避免依赖 `localStorage`。

**3. ISR + Data Cache 集成**

```tsx
const revalidate =
  options?.revalidate === false ? 0 : (options?.revalidate ?? 30);
const tags = options?.tags;

const res = await fetch(url.toString(), {
  headers: await buildHeaders(),
  next: { revalidate, ...(tags ? { tags } : {}) },
});
```

`next.revalidate` 控制 ISR 缓存时间（秒），`next.tags` 为响应打标签，供后续 `revalidateTag()` 精准失效。

---

## 3. ISR 缓存策略

admin-next 使用三种缓存粒度：

### 3.1 时间基缓存（revalidate seconds）

```
┌─────────────────────────────────────────┐
│ serverGet('/v1/admin/dashboard/stats',  │
│   {}, { revalidate: 60 })               │
│                                         │
│ 第一次请求 → 请求 API → 缓存 60s         │
│ 60s 内请求 → 返回缓存（无 API 调用）      │
│ 60s 后请求 → 触发后台重新验证               │
└─────────────────────────────────────────┘
```

不同页面的 revalidate 策略：

| 数据 | revalidate | 说明 |
|------|-----------|------|
| Dashboard 统计卡片 | 60s | 财务数据，分钟级更新 |
| Dashboard 最近订单 | 30s | 订单列表，秒级更新 |
| 财务统计 | 60s | 与 Dashboard 共享 |
| 用户列表 | 30s | 常规列表页 |
| 分类/标签 | 300s | 低频变更数据 |

### 3.2 标签基缓存（revalidateTag）

对于需要即时刷新（写操作后）的场景，使用标签：

```tsx
// fetch 时打标签
const data = await serverGet('/v1/admin/orders/list', params, {
  revalidate: 30,
  tags: ['orders:list', 'dashboard:orders'],
});
```

```tsx
// 写操作后精准失效
import { revalidateTag } from 'next/cache';
import { ORDERS_LIST_TAG } from '@/lib/cache/orders-cache';

export async function revalidateOrdersList(): Promise<void> {
  revalidateTag(ORDERS_LIST_TAG);   // 'orders:list'
  revalidateTag('dashboard:orders');
}
```

### 3.3 no-store（禁用缓存）

部分场景需要完全禁用缓存（如搜索）：

```tsx
const results = await serverGet('/v1/admin/users/search', { keyword }, {
  revalidate: false,  // 禁用缓存
});
```

此时 `next.revalidate` 设为 `false`，相当于每次都回源。

---

## 4. 缓存标签体系

admin-next 的缓存标签定义在 [`lib/cache/`](apps/admin-next/src/lib/cache/) 目录下，每个业务模块管理自己的标签：

```
lib/cache/
├── finance-cache.ts         # finance, finance:stats, finance:transactions, ...
├── orders-cache.ts          # orders:list
├── address-cache.ts         # address:list
├── admin-users-cache.ts     # admin-users:list
├── banners-cache.ts         # banners:list
├── groups-cache.ts          # groups:list
├── kyc-cache.ts             # kyc:list
├── login-logs-cache.ts      # login-logs:list
├── operation-logs-cache.ts  # operation-logs:list
├── payment-channels-cache.ts
├── products-cache.ts        # products:list
├── users-cache.ts           # users:list
└── notifications-cache.ts   # notifications:list
```

例如，[`finance-cache.ts`](apps/admin-next/src/lib/cache/finance-cache.ts)：

```tsx
export const FINANCE_TAG = 'finance';
export const FINANCE_STATS_TAG = 'finance:stats';
export const FINANCE_TRANSACTIONS_TAG = 'finance:transactions';
export const FINANCE_DEPOSITS_TAG = 'finance:deposits';
export const FINANCE_WITHDRAWALS_TAG = 'finance:withdrawals';
```

这种集中定义方式确保 fetch 和 revalidate 两端使用相同的标签字符串，避免 magic string 不一致。

---

## 5. Server Actions——写操作后的缓存失效

Server Actions（`'use server'`）是 Next.js 提供的服务端函数，可在客户端组件中直接调用。admin-next 使用 Server Actions 在写操作完成后精准失效缓存。

### 5.1 架构流程

```
Client Component                Server Action                    Next.js Cache
───────────────                ─────────────                    ─────────────
                                                          
  用户点击"审核通过"                                              
        │                                                        
        ▼                                                        
  WithdrawAuditModal                                               
        │                                                        
        │ 调用 Server Action                                       
        ├─────────────────────────────────►  revalidateFinance    
        │                                   AfterWithdrawAudit()  
        │                                       │                
        │                                       ├─► revalidateTag('finance')
        │                                       ├─► revalidateTag('finance:stats')
        │                                       └─► revalidateTag('finance:withdrawals')
        │                                                            │
        │  返回成功                                                  │
        │◄────────────────────────────────────                       │
        │                                                            ▼
        │                                                   下次请求 → 回源 API
        │                                                   获取最新数据
```

### 5.2 分层失效策略

[`finance-revalidate.ts`](apps/admin-next/src/lib/actions/finance-revalidate.ts) 展示了分层失效模式：

```tsx
// 统计卡片失效（被多个操作共享）
export async function revalidateFinanceStats(): Promise<void> {
  revalidateTag(FINANCE_TAG);
  revalidateTag(FINANCE_STATS_TAG);
  revalidateTag('dashboard:stats');
}

// 调账：影响统计 + 交易流水
export async function revalidateFinanceAfterAdjust(): Promise<void> {
  await revalidateFinanceStats();
  revalidateTag(FINANCE_TRANSACTIONS_TAG);
}

// 提现审核：影响统计 + 提现列表 + 交易流水
export async function revalidateFinanceAfterWithdrawAudit(): Promise<void> {
  await revalidateFinanceStats();
  revalidateTag(FINANCE_WITHDRAWALS_TAG);
  revalidateTag(FINANCE_TRANSACTIONS_TAG);
}

// 充值同步：影响统计 + 充值列表 + 交易流水
export async function revalidateFinanceAfterRechargeSync(): Promise<void> {
  await revalidateFinanceStats();
  revalidateTag(FINANCE_DEPOSITS_TAG);
  revalidateTag(FINANCE_TRANSACTIONS_TAG);
}
```

每个写操作只失效受影响的标签，其他缓存保持不变。

### 5.3 Dashboard 专属失效

[`dashboard-revalidate.ts`](apps/admin-next/src/lib/actions/dashboard-revalidate.ts) 处理 Dashboard 页面的缓存失效：

```tsx
export async function revalidateDashboardOrders(): Promise<void> {
  revalidateTag('dashboard:orders');
}

export async function revalidateDashboardStats(): Promise<void> {
  revalidateTag(FINANCE_TAG);
  revalidateTag(FINANCE_STATS_TAG);
  revalidateTag('dashboard:stats');
}
```

---

## 6. 错误处理与降级

### 6.1 401/403 降级

Server Component 中发生 401（未授权）或 403（无权限）时，`serverGet` 返回 `null` 而非抛出异常：

```tsx
if (
  error.message.includes('HTTP 401') ||
  error.message.includes('HTTP 403')
) {
  console.warn(`serverFetch: 401/403 for ${path}, returning null`);
  return null as T;
}
```

页面组件据此做降级渲染：

```tsx
export default async function FinancePage() {
  const stats = await serverGet<FinanceStatistics>('/v1/admin/finance/statistics');

  if (!stats) {
    return <div className="p-6 text-gray-500">请先登录</div>;
  }

  return <FinanceClient stats={stats} />;
}
```

### 6.2 其他错误透传

非 401/403 的错误（网络错误、500 等）会抛出异常，由 Next.js 的 `error.tsx` 错误边界统一处理：

```tsx
try {
  // ...fetch logic
} catch (error) {
  if (error instanceof Error) {
    if (!error.message.includes('HTTP 401') && !error.message.includes('HTTP 403')) {
      console.error(`serverFetch error for ${path}:`, error.message);
    }
  }
  throw error; // 让 error.tsx 处理
}
```

---

## 7. Sentry 可观测性集成

每次 `serverGet` 调用都会被 Sentry span 包裹，用于性能监控：

```tsx
return withAppSpan(
  {
    name: SENTRY_SPAN_NAME.SERVER_FETCH_REQUEST,  // 'admin.ssr.fetch.server_request'
    op: SENTRY_SPAN_OP.HTTP_CLIENT,               // 'http.client'
    attributes: {
      [SENTRY_SPAN_ATTR_KEY.HTTP_METHOD]: 'GET',
      [SENTRY_SPAN_ATTR_KEY.HTTP_ROUTE]: path,
      [SENTRY_SPAN_ATTR_KEY.FETCH_REVALIDATE]: revalidate,
    },
  },
  async () => { /* fetch logic */ },
);
```

这使得每个 SSR 请求的 API 调用链在 Sentry 中可见，便于定位性能瓶颈。

---

## 8. 与客户端 HttpClient 的对比

| 维度 | serverGet（服务端） | http.get（客户端） |
|------|-------------------|-------------------|
| 运行环境 | Server Component | Browser |
| HTTP 客户端 | Node.js `fetch` | axios |
| 认证方式 | HTTP-only Cookie | localStorage Bearer Token |
| 缓存 | ISR Data Cache（`next.revalidate`） | React Query / SWR |
| 重试 | 无（由上游处理） | 指数退避重试（3 次） |
| 超时 | 5s（SSR 环境） | 30s |
| 错误处理 | 401/403 返回 null | 401 → Token 刷新 / 登出 |
| 追踪 | Sentry SSR span | Sentry HTTP client span |

---

## 9. 总结

| 概念 | 实现 | 关键文件 |
|------|------|---------|
| Server Component 数据获取 | `serverGet` 封装 Node.js fetch | [`serverFetch.ts`](apps/admin-next/src/lib/serverFetch.ts) |
| ISR 缓存 | `next.revalidate` + `next.tags` | 各 page.tsx |
| 缓存标签 | 集中定义常量 | [`lib/cache/*.ts`](apps/admin-next/src/lib/cache/) |
| 写后失效 | `revalidateTag` Server Actions | [`lib/actions/*.ts`](apps/admin-next/src/lib/actions/) |
| 可观测性 | Sentry span 包裹 | [`sentry-span.ts`](apps/admin-next/src/lib/sentry-span.ts) |
| 错误降级 | 401/403 返回 null 而非抛错 | [`serverFetch.ts`](apps/admin-next/src/lib/serverFetch.ts) |

### 相关文章

- [`admin-next HttpClient`](docs/blog/articles/admin/http-client-auth-refresh-retry.md) — 客户端数据获取与 401 自动刷新
- [`Sentry 可观测性体系`](docs/blog/articles/admin/sentry-observability-span-utils.md) — SSR span 与性能监控
- [`admin-next 安全工具链`](docs/blog/articles/admin-next/security-utils-zod-pii-xss.md) — 服务端数据安全处理
