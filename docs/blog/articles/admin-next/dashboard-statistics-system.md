# 仪表盘 & 数据统计系统：Server Component + Streaming SSR 混合架构

## 1. 架构全景

仪表盘（Dashboard）是该管理后台的首页，采用 **Next.js Server Component + Client Component 混合架构**，在同一个页面中同时使用服务端渲染（无 loading 闪烁）和客户端交互：

```
Dashboard Page (app/(dashboard)/page.tsx) — Server Component
  │
  ├── DashboardHeader (Client Component)
  │   ├── 标题 + 实时日期
  │   └── 刷新按钮 → router.refresh() + queryClient.invalidateQueries()
  │
  ├── <Suspense fallback={<DashboardStatsSkeleton />}>
  │   └── DashboardStats (async Server Component)
  │       ├── serverGet('/v1/admin/finance/statistics')   ← 60s 缓存
  │       └── serverGet('/v1/admin/client-user/list')     ← 300s 缓存
  │
  └── <HydrationBoundary>
      └── DashboardOrdersClient (Client Component)
          └── useQuery('dashboard-orders')  ← TanStack Query, 30s staleTime
```

API 端由 [`StatsController`](apps/api/src/admin/stats/stats.controller.ts) 和 [`StatsService`](apps/api/src/admin/stats/stats.service.ts) 提供两个核心接口：

| 端点 | 方法 | 鉴权 | 功能 |
|------|------|------|------|
| `/v1/admin/stats/overview` | GET | AdminJwtAuthGuard + RolesGuard | 用户/订单/收入/财务总览 |
| `/v1/admin/stats/trend?days=30` | GET | AdminJwtAuthGuard + RolesGuard | 近 N 天订单量 + 用户注册趋势 |

---

## 2. API 层：StatsService

[`StatsService`](apps/api/src/admin/stats/stats.service.ts) 是整个统计系统的核心，包含两个主要方法。

### 2.1 getOverview() — 并行聚合查询

```typescript
async getOverview() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalUsers, newUsersToday, newUsersThisMonth, ...] = await Promise.all([
    // 用户统计
    this.prisma.user.count({ where: { status: 1 } }),
    this.prisma.user.count({ where: { status: 1, createdAt: { gte: todayStart } } }),
    this.prisma.user.count({ where: { status: 1, createdAt: { gte: monthStart } } }),

    // 订单统计
    this.prisma.order.count(),
    this.prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
    this.prisma.order.count({ where: { orderStatus: ORDER_PAID } }),
    this.prisma.order.aggregate({ _sum: { finalAmount: true }, where: { orderStatus: ORDER_PAID } }),

    // 收入统计（今日收入）
    this.prisma.order.aggregate({
      _sum: { finalAmount: true },
      where: { orderStatus: ORDER_PAID, paidAt: { gte: todayStart } },
    }),

    // 财务统计（待审核提现 + 总充值）
    this.prisma.withdrawOrder.count({ where: { withdrawStatus: WITHDRAW_PENDING } }),
    this.prisma.withdrawOrder.aggregate({ _sum: { withdrawAmount: true }, ... }),
    this.prisma.rechargeOrder.aggregate({ _sum: { actualAmount: true }, ... }),
  ]);

  return {
    users:     { total: totalUsers, today: newUsersToday, thisMonth: newUsersThisMonth },
    orders:    { total: totalOrders, today: ordersToday, paid: paidOrders },
    revenue:   { total: ..., today: ... },
    finance:   { totalDeposit: ..., pendingWithdrawCount: ..., pendingWithdrawAmount: ... },
  };
}
```

**设计要点**：

- **11 个并行查询** — 全部通过 `Promise.all` 并发执行，避免串行等待
- **三种 Prisma 查询模式** — `count()` 计数、`aggregate({ _sum })` 聚合求和、`where` 时间范围过滤
- **时间维度** — 每个指标都提供 `total`（全量）、`today`（今日）、`thisMonth`（本月）三个维度
- **状态常量** — 使用 `ORDER_PAID = 2`、`WITHDRAW_PENDING = PENDING_AUDIT = 1`、`RECHARGE_SUCCESS = SUCCESS = 3` 等语义常量

### 2.2 getTrend() — PostgreSQL 原生 SQL

```typescript
async getTrend(days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days + 1);
  cutoff.setHours(0, 0, 0, 0);

  const [orderTrend, userTrend] = await Promise.all([
    // 订单日趋势：使用 TO_CHAR 按 Asia/Manila 时区聚合
    this.prisma.$queryRaw<Array<{ date: string; count: bigint; revenue: string }>>`
      SELECT
        TO_CHAR(created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date,
        COUNT(*)::text AS count,
        COALESCE(SUM(CASE WHEN order_status = 2 THEN final_amount ELSE 0 END), 0)::text AS revenue
      FROM orders
      WHERE created_at >= ${cutoff}
      GROUP BY date ORDER BY date ASC
    `,
    // 用户注册趋势
    this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
      SELECT
        TO_CHAR(created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date,
        COUNT(*)::text AS count
      FROM users WHERE created_at >= ${cutoff} AND status = 1
      GROUP BY date ORDER BY date ASC
    `,
  ]);

  return {
    orders: orderTrend.map(r => ({ date: r.date, count: Number(r.count), revenue: r.revenue })),
    users:  userTrend.map(r => ({ date: r.date, count: Number(r.count) })),
  };
}
```

**关键设计细节**：

| 设计 | 说明 |
|------|------|
| **原生 SQL** | 使用 `$queryRaw` 而非 Prisma 标准 API，因为需要 `TO_CHAR` + 时区转换等 PostgreSQL 专有函数 |
| **时区硬编码** | `AT TIME ZONE 'Asia/Manila'` 确保按菲律宾时间聚合，避免服务器时区差异导致的数据偏差 |
| **BigInt 转换** | PostgreSQL COUNT 返回 `bigint`，通过 `Number(r.count)` 转换为 JS number |
| **`COALESCE` + `CASE WHEN`** | 在 SQL 层面完成条件求和，只统计已支付的订单（`order_status = 2`）的收入 |

---

## 3. Controller 层

[`StatsController`](apps/api/src/admin/stats/stats.controller.ts) 非常简单，仅做参数转发和鉴权：

```typescript
@Controller('admin/stats')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('overview')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getOverview() {
    return this.statsService.getOverview();
  }

  @Get('trend')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getTrend(@Query('days') days?: string) {
    const d = days ? parseInt(days, 10) : 30;
    return this.statsService.getTrend(isNaN(d) ? 30 : d);
  }
}
```

两个端点均需要 `SUPER_ADMIN` 或 `ADMIN` 角色，通过 `AdminJwtAuthGuard` + `RolesGuard` 双重守卫保护。

---

## 4. Dashboard 页面 (Server Component)

[`page.tsx`](apps/admin-next/src/app/(dashboard)/page.tsx) 是整个仪表盘的入口，它本身是一个 Server Component，不包含任何客户端 JavaScript：

```typescript
export default async function DashboardPage() {
  // 1. 从 cookie 读取 locale
  const cookieStore = await cookies();
  const locale = cookieStore.get('app_locale')?.value as Locale || DEFAULT_LOCALE;

  // 2. 服务端预取最近 5 笔订单
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: ['dashboard-orders'],
    queryFn: () => serverGet<PaginatedResponse<Order>>(
      '/v1/admin/order/list',
      { page: 1, pageSize: 5 },
      { revalidate: 30, tags: ['dashboard:orders', ORDERS_LIST_TAG] },
    ),
  });

  return (
    <div className="space-y-6">
      <DashboardHeader />                                       {/* Client Component */}
      <Suspense fallback={<DashboardStatsSkeleton />}>          {/* Streaming SSR */}
        <DashboardStats locale={locale} />                       {/* async Server Component */}
      </Suspense>
      <HydrationBoundary state={dehydrate(queryClient)}>        {/* 预取数据注入 */}
        <DashboardOrdersClient />                                {/* Client Component */}
      </HydrationBoundary>
    </div>
  );
}
```

**核心架构决策**：

| 层次 | 组件类型 | 渲染时机 | 数据源 |
|------|---------|---------|--------|
| 统计卡片 | async Server Component | SSR 流式 | 服务端 `serverGet()` + HTTP GET |
| 订单列表 | Client Component + TanStack Query | CSR + Hydration | 服务端预取 + 客户端 useQuery |
| 顶部 Header | Client Component | CSR | 无数据依赖 |

---

## 5. Server Component：DashboardStats

[`DashboardStats`](apps/admin-next/src/components/dashboard/DashboardStats.tsx) 是一个 **async Server Component**，在服务端直接 fetch 数据，零 JavaScript 发送到客户端：

```typescript
export async function DashboardStats({ locale }: { locale?: Locale }) {
  const t = await getTranslations();

  const [finance, usersRes] = await withSsrSpan(
    SENTRY_SPAN_NAME.DASHBOARD_STATS_FETCH,
    { [SENTRY_SPAN_ATTR_KEY.APP_SECTION]: 'dashboard' },
    async () => Promise.all([
      serverGet<FinanceStatistics>('/v1/admin/finance/statistics', undefined, {
        revalidate: 60,
        tags: ['dashboard:stats', FINANCE_TAG, FINANCE_STATS_TAG],
      }).catch(() => null),
      serverGet<PaginatedResponse<ClientUserListItem>>(
        '/v1/admin/client-user/list',
        { page: 1, pageSize: 1 },
        { revalidate: 300, tags: ['dashboard:stats', 'admin:users'] },
      ).catch(() => null),
    ]),
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      <StatCard title={t('dashboard_totalDeposits')} value={...} icon={<DollarSign />} ... />
      <StatCard title={t('dashboard_totalWithdrawals')} value={...} icon={<DollarSign />} ... />
      <StatCard title={t('dashboard_pendingWithdrawals')} value={...} icon={<Clock />} ... />
      <StatCard title={t('dashboard_totalUsers')} value={totalUsers.toLocaleString()} icon={<Users />} ... />
    </div>
  );
}
```

**设计要点**：

1. **`server-only` 标记** — 文件顶部 `import 'server-only'` 确保该组件不会被意外导入到客户端代码中
2. **并行 fetch** — `Promise.all` 同时拉取财务统计和用户数据，任一失败通过 `.catch(() => null)` 优雅降级
3. **缓存策略** — 财务数据 60s 缓存，用户数据 300s 缓存，通过 `revalidate` + `tags` 支持 On-Demand Revalidation
4. **Sentry 监控** — `withSsrSpan` 包裹整个 fetch 过程，方便追踪服务端渲染性能
5. **Streaming SSR** — 被 `<Suspense>` 包裹，统计卡片可以独立于页面其他部分流式渲染

### Suspense Fallback

[`DashboardStatsSkeleton`](apps/admin-next/src/components/dashboard/DashboardStatsSkeleton.tsx) 在统计卡片加载完成前显示骨架屏：

```tsx
export function DashboardStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <div className="h-11 w-11 rounded-xl bg-gray-100 dark:bg-white/10 animate-pulse" />
          <div className="mt-4 h-8 w-28 rounded-lg bg-gray-100 dark:bg-white/10 animate-pulse" />
          <div className="mt-2 h-4 w-20 rounded bg-gray-100 dark:bg-white/10 animate-pulse" />
        </Card>
      ))}
    </div>
  );
}
```

---

## 6. Client Component：DashboardOrdersClient

[`DashboardOrdersClient`](apps/admin-next/src/components/dashboard/DashboardOrdersClient.tsx) 使用 TanStack Query 管理订单列表的状态：

```typescript
export function DashboardOrdersClient() {
  const { t } = useTranslation();
  const { data: ordersRes, isLoading } = useQuery({
    queryKey: ['dashboard-orders'],
    queryFn: () => orderApi.getList({ page: 1, pageSize: 5 }),
    staleTime: 30_000,       // 30s 内不重新请求
    gcTime: 5 * 60 * 1000,   // 5min 后从内存清理
    refetchOnWindowFocus: true,
  });
}
```

**数据流**：

1. **首次加载** — `page.tsx` 通过 `prefetchQuery` + `HydrationBoundary` 注入服务端预取数据，用户看到的是 SSR 渲染的完整表格
2. **客户端交互** — 用户点击刷新时，`DashboardHeader` 调用 `queryClient.invalidateQueries({ queryKey: ['dashboard-orders'] })`，触发 TanStack Query 重新拉取
3. **窗口聚焦刷新** — `refetchOnWindowFocus: true` 确保用户切回标签页时自动获取最新数据

**订单状态映射**：

```typescript
const getOrderStatus = (status: number) => {
  const statusMap: Record<number, { label: string; color: BadgeColor }> = {
    1: { label: t('dashboard_orderStatusPending'), color: 'yellow' },
    2: { label: t('dashboard_orderStatusPaid'), color: 'green' },
    3: { label: t('dashboard_orderStatusCancelled'), color: 'gray' },
    4: { label: t('dashboard_orderStatusRefunded'), color: 'red' },
  };
  return statusMap[status] ?? { label: t('dashboard_orderStatusUnknown'), color: 'gray' };
};
```

---

## 7. Client Component：DashboardHeader

[`DashboardHeader`](apps/admin-next/src/components/dashboard/DashboardHeader.tsx) 实现了 **双重刷新机制**：

```typescript
const handleRefresh = async () => {
  setRefreshing(true);
  router.refresh();                                    // 刷新 Server Components
  await queryClient.invalidateQueries({                 // 刷新 Client 数据
    queryKey: ['dashboard-orders'],
  });
  setRefreshing(false);
};
```

| 方法 | 作用 | 目标 |
|------|------|------|
| `router.refresh()` | 重新渲染 Server Components | 统计卡片（DashboardStats） |
| `queryClient.invalidateQueries()` | 使 TanStack Query 缓存失效 | 订单列表（DashboardOrdersClient） |

这种设计确保点击一次刷新按钮，页面上所有数据源都能同步更新。

---

## 8. 旧版 Dashboard（参考）

项目中还存在一个旧版 [`Dashboard.tsx`](apps/admin-next/src/views/Dashboard.tsx)，是纯 Client Component 实现，使用 `ahooks` 的 `useRequest`：

```typescript
export const Dashboard: React.FC = () => {
  const { data: finance, loading: financeLoading, refresh } = useRequest(
    financeApi.getStatistics, { cacheKey: 'dashboard-finance' }
  );
  const { data: ordersRes, loading: ordersLoading } = useRequest(
    () => orderApi.getList({ page: 1, pageSize: 5 }),
    { cacheKey: 'dashboard-orders' }
  );
  // ...
};
```

旧版通过 `ahooks` 的 `cacheKey` 实现请求级别的缓存去重。新版使用 Server Component + TanStack Query 的混合架构取代了它，核心改进包括：

| 维度 | 旧版（useRequest） | 新版（Server Component + TanStack Query） |
|------|-------------------|------------------------------------------|
| 首次加载 | CSR → loading → 数据 | SSR 直接渲染，零 loading 闪烁 |
| 统计卡片 | 需要 loading 状态 | Suspense Streaming，渐进式渲染 |
| 缓存 | ahooks cacheKey（内存） | HTTP Cache Tags + TanStack Query |
| 刷新 | 仅刷新 RSC 或仅刷新客户端 | 双重刷新机制 |

---

## 9. 数据流与缓存策略总结

```
请求链路                    缓存层级                         失效方式
───────────────────────────────────────────────────────────────
DashboardStats (Server)      HTTP Cache (revalidate: 60s)     tag-based revalidation
   │                              │
   └── finance/statistics ────────┘ (FINANCE_TAG + FINANCE_STATS_TAG)
   └── client-user/list  ────────┘ (admin:users)

DashboardOrdersClient (Client)  TanStack Query (staleTime: 30s)  invalidateQueries
   │
   └── order/list ─────────────── (dashboard:orders + ORDERS_LIST_TAG)
```

整个仪表盘的性能优化策略：

1. **SSR 直接渲染** — 统计卡片是 Server Component，首屏渲染无客户端 JavaScript 等待
2. **Streaming SSR** — `<Suspense>` 使统计卡片可以独立流式渲染，不阻塞页面其他部分
3. **Hydration 预取** — 订单数据通过 `prefetchQuery` + `HydrationBoundary` 在服务端预取，客户端 hydrate 时直接使用
4. **并行请求** — API 端 Promise.all 并发 11 个查询，前端 Promise.all 并发 2 个 fetch
5. **智能缓存** — 不同数据配置不同的缓存时间（财务 60s，用户 300s，订单 30s staleTime）
6. **优雅降级** — 任一 API 请求失败不会导致整个页面崩溃，`catch(() => null)` 提供 fallback 展示
