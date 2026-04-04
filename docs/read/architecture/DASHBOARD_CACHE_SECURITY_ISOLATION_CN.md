# Dashboard 缓存一致性与安全隔离方案（Phase 6 P0）

> 日期：2026-03-23  
> 范围：`apps/admin-next` Dashboard 试点页（`/`）

---

## 1. 背景与目标

Dashboard 已完成 SSR + Hydration 改造，但此前缺少两类工程化收口：

1. 缓存策略未显式化（`revalidate/tags` 依赖默认值，难以解释与维护）
2. 后台写操作后没有精准失效（需要等缓存自然过期）

本次目标：

- 为 Dashboard 关键 fetch 定义一致性等级与缓存策略
- 接入写后失效（`revalidateTag`）
- 补齐服务端敏感模块隔离（`server-only`）

---

## 2. 关键 fetch 清单与一致性等级

| 数据源   | API                                            | 位置                                           | 一致性等级 | 说明                       |
| -------- | ---------------------------------------------- | ---------------------------------------------- | ---------- | -------------------------- |
| 财务统计 | `/v1/admin/finance/statistics`                 | `DashboardStats`（Server）                     | 分钟级 🟢  | 聚合类统计，可容忍短时陈旧 |
| 用户总数 | `/v1/admin/client-user/list?page=1&pageSize=1` | `DashboardStats`（Server）                     | 分钟级 🟢  | 总量指标变化慢             |
| 最近订单 | `/v1/admin/order/list?page=1&pageSize=5`       | `DashboardPage` 预取 + `DashboardOrdersClient` | 秒级 🟡    | 用户可感知变化较快         |

---

## 3. 缓存策略矩阵（已落地）

| API                | `revalidate` | `tags`                               | 备注                        |
| ------------------ | ------------ | ------------------------------------ | --------------------------- |
| finance statistics | `60`         | `['dashboard:stats', 'finance']`     | Dashboard 卡片 + 财务域共享 |
| client-user list   | `300`        | `['dashboard:stats', 'admin:users']` | 统计用途，5 分钟可接受      |
| order list         | `30`         | `['dashboard:orders']`               | 与 `useQuery` 秒级体验对齐  |

实现位置：

- `src/lib/serverFetch.ts`：新增 `ServerFetchOptions.tags?: string[]`
- `src/components/dashboard/DashboardStats.tsx`：显式 `revalidate + tags`
- `src/app/(dashboard)/page.tsx`：订单预取显式 `revalidate + tags`

---

## 4. 写后失效映射（已落地）

新增 Server Actions：`src/lib/actions/dashboard-revalidate.ts`

- `revalidateDashboardOrders()` → `revalidateTag('dashboard:orders')`
- `revalidateDashboardStats()` → `revalidateTag('finance')` + `revalidateTag('dashboard:stats')`

写操作接入点：

| 写操作              | 文件                                       | 调用失效                      |
| ------------------- | ------------------------------------------ | ----------------------------- |
| 订单状态更新 / 删除 | `src/components/orders/OrdersClient.tsx`   | `revalidateDashboardOrders()` |
| 手动调账            | `src/views/finance/ManualAdjustModal.tsx`  | `revalidateDashboardStats()`  |
| 提现审核            | `src/views/finance/WithdrawAuditModal.tsx` | `revalidateDashboardStats()`  |
| 充值同步成功        | `src/views/finance/DepositList.tsx`        | `revalidateDashboardStats()`  |

---

## 5. 安全隔离（server-only）

本次补齐：

- `src/lib/serverFetch.ts` 添加 `import 'server-only'`
- `src/components/dashboard/DashboardStats.tsx` 添加 `import 'server-only'`

说明：

- `src/lib/actions/dashboard-revalidate.ts` 已使用 `'use server'`，不需要重复添加
- 测试环境通过 `vitest` alias 将 `server-only` 指向 mock，避免单测误报
  - `vitest.config.ts` 新增 `'server-only' -> src/__tests__/mocks/server-only.ts`

---

## 6. 回归结果

- `check-types`：通过
- `lint`：通过
- `vitest`：31 files / 183 tests 全通过
- 附带修复：删除 `DepositList.tsx` 中生产 `console.log` 泄漏

---

## 7. 经验与边界

- `revalidateTag` 比 `revalidatePath` 更适合 Dashboard 这种多数据源混合页，失效更精准
- 统计类与交易流类必须拆开缓存标签，避免“一个写操作导致整页全失效”
- `server-only` 落地后，记得同步测试 alias，否则会出现“测试环境不是 Server Component”错误

---

## 8. 心智模型提问

**如果一条数据没有明确“业务可接受陈旧时间（秒）”，为什么我们敢为它配置缓存？**

> 推论：先定一致性目标，再定 `revalidate/tags`，最后再实现失效触发点。
