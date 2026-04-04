# Orders 页 Server 预取 + Hydration + Tag 失效方案（Phase 6 P0）

> 日期：2026-03-23  
> 范围：`apps/admin-next/src/app/(dashboard)/orders/*` 与跨页订单缓存协同

---

## 问题陈述

### Q1：Orders 页为什么要做 Server 预取 + Hydration？

**现状问题**：

- 首屏数据只能在客户端拿，首次渲染等待更长
- URL 参数变化虽然可驱动查询，但首屏无法复用服务端数据
- 与 Dashboard 的最近订单缓存标签不统一，跨页一致性靠手工刷新

**答案**：

- 在 `orders/page.tsx` 用 `QueryClient.prefetchQuery` + `HydrationBoundary` 预取首屏订单
- `OrdersClient` 统一改成 `useQuery` 消费 hydrated 缓存
- 通过统一标签 `orders:list` 串起 Orders 页与 Dashboard 最近订单

---

## 实现方案

### 1) Server 预取 + Hydration

- 文件：`apps/admin-next/src/app/(dashboard)/orders/page.tsx`
- 动作：
  - 解析 `searchParams`（page/pageSize/keyword/orderStatus）
  - `prefetchQuery` 请求 `/v1/admin/order/list`
  - `HydrationBoundary` 包裹 `OrdersClient`

### 2) 查询参数与 Query Key 归一化

- 文件：`apps/admin-next/src/lib/cache/orders-cache.ts`
- 提供能力：
  - `parseOrdersSearchParams`（Server）
  - `parseOrdersUrlSearchParams`（Client）
  - `buildOrdersListParams`
  - `ordersListQueryKey`
  - 常量 `ORDERS_LIST_TAG = 'orders:list'`

### 3) 跨页缓存协同（revalidateTag）

- 文件：`apps/admin-next/src/lib/actions/orders-revalidate.ts`
- 方法：`revalidateOrdersList()`
  - `revalidateTag('orders:list')`
  - `revalidateTag('dashboard:orders')`

写操作接入点：

- `apps/admin-next/src/components/orders/OrdersClient.tsx`
  - 更新状态 / 删除订单成功后：`await refetch()` + `void revalidateOrdersList()`

Dashboard 协同：

- 文件：`apps/admin-next/src/app/(dashboard)/page.tsx`
- 最近订单预取 tags 增加 `orders:list`，确保 Orders 写操作可精准联动 Dashboard

---

## 缓存契约（当前版本）

| 数据                     | revalidate | tags                              |
| ------------------------ | ---------- | --------------------------------- |
| Orders 列表（Orders 页） | 30s        | `orders:list`, `dashboard:orders` |
| Dashboard 最近订单       | 30s        | `dashboard:orders`, `orders:list` |

说明：

- `orders:list` 是订单域统一标签
- `dashboard:orders` 是 Dashboard 视图标签
- 写后同时失效两者，跨页保持可预期一致性

---

## 验证结果

- `check-types`：通过
- `lint`：通过
- `vitest`：31 files / 183 tests 通过

---

## 心智模型提问

### Q：什么时候应该用“统一业务 tag”（`orders:list`），什么时候只用“页面 tag”（`dashboard:orders`）？

**答案**：

- 只影响单页视图时，用页面 tag（失效范围最小）
- 影响同一业务实体的多页视图时，用业务 tag（避免跨页不一致）
- 实践上可双标签并存：业务 tag 保一致，页面 tag 保精细控制
