# Finance Stats 缓存契约与写后失效（Phase 6 P0）

> 日期：2026-03-23  
> 范围：`apps/admin-next` 的 `FinanceStatsServer`、`DashboardStats` 共享财务统计，以及 `adjust / withdrawalsAudit / syncRecharge` 写操作失效面。

---

## 1. 问题陈述

### Q1：Finance 页的方法和 Dashboard / Orders 一样吗？

**答案：方法论相同，但落点不同。**

相同点：

- 都要先定义一致性等级
- 都要显式定义 `revalidate/tags`
- 都要让写操作触发精准失效

不同点：

- `Dashboard` 适合先做整页试点
- `Orders` 适合做 Server 预取 + Hydration
- `Finance` 有 3 个 tab 列表（transactions / deposits / withdrawals），一次性全量改造风险较高

因此本轮只先做 **stats 契约统一 + 写后失效统一**，不强行重构 3 个列表。

---

## 2. 为什么先做 Stats，而不是先做 3 个列表？

### Q2：为什么不直接把 Finance 三个 tab 一次性改成 Server 预取 + Hydration？

**答案：因为收益/风险比不划算。**

- `FinanceStatsServer` 已经是 Server Component，改造成本最低
- 3 个 tab 都依赖 `SmartTable` + 客户端 request + 参数整形，直接全改会波及较大
- 先统一 stats 与写后失效，就能立刻解决跨页财务数字不一致的问题

结论：

- 先收口 Stats 这一层
- 列表后续按 tab 单独推进（transactions → deposits → withdrawals）更稳

---

## 3. 本次落地的缓存契约

新增文件：`apps/admin-next/src/lib/cache/finance-cache.ts`

```ts
export const FINANCE_TAG = "finance";
export const FINANCE_STATS_TAG = "finance:stats";
export const FINANCE_TRANSACTIONS_TAG = "finance:transactions";
export const FINANCE_DEPOSITS_TAG = "finance:deposits";
export const FINANCE_WITHDRAWALS_TAG = "finance:withdrawals";
```

### Stats 读接口统一

| 页面      | 文件                     | API                            | revalidate | tags                                          |
| --------- | ------------------------ | ------------------------------ | ---------- | --------------------------------------------- |
| Finance   | `FinanceStatsServer.tsx` | `/v1/admin/finance/statistics` | `30`       | `finance`, `finance:stats`                    |
| Dashboard | `DashboardStats.tsx`     | `/v1/admin/finance/statistics` | `60`       | `dashboard:stats`, `finance`, `finance:stats` |

说明：

- 两页共享相同业务 tag：`finance`、`finance:stats`
- Dashboard 保留自己的视图 tag：`dashboard:stats`
- TTL 可以不同，但失效面统一

---

## 4. 写后失效统一

新增文件：`apps/admin-next/src/lib/actions/finance-revalidate.ts`

### 失效函数

- `revalidateFinanceStats()`
  - `finance`
  - `finance:stats`
  - `dashboard:stats`

- `revalidateFinanceAfterAdjust()`
  - `revalidateFinanceStats()`
  - `finance:transactions`

- `revalidateFinanceAfterWithdrawAudit()`
  - `revalidateFinanceStats()`
  - `finance:withdrawals`
  - `finance:transactions`

- `revalidateFinanceAfterRechargeSync()`
  - `revalidateFinanceStats()`
  - `finance:deposits`
  - `finance:transactions`

### 接入位置

| 写操作                      | 文件                     | 失效函数                                |
| --------------------------- | ------------------------ | --------------------------------------- |
| 调账 `adjust`               | `ManualAdjustModal.tsx`  | `revalidateFinanceAfterAdjust()`        |
| 提现审核 `withdrawalsAudit` | `WithdrawAuditModal.tsx` | `revalidateFinanceAfterWithdrawAudit()` |
| 充值同步 `syncRecharge`     | `DepositList.tsx`        | `revalidateFinanceAfterRechargeSync()`  |

---

## 5. 为什么 Dashboard 也要一起失效？

### Q3：Finance 页写操作为什么还要联动 `dashboard:stats`？

**答案：因为 Dashboard 也展示了财务统计，它是共享读模型。**

如果只失效 Finance 自己的 tag：

- Finance 页面会更新
- Dashboard 的财务卡片可能还显示旧值

所以这类“共享业务统计”必须：

- 业务 tag 统一（`finance` / `finance:stats`）
- 视图 tag 各自保留（`dashboard:stats`）
- 写后同时触发业务 + 视图的失效

---

## 6. 安全隔离

本次顺手补齐：

- `FinanceStatsServer.tsx` 添加 `import 'server-only'`

原因：

- 它是 async Server Component
- 依赖 `serverGet`
- 不应该被 client 边界误引用

---

## 7. 回归验证

- `check-types`：通过
- `lint`：通过
- `vitest`：31 files / 183 tests 通过

---

## 8. 下一步建议

如果继续推进 Finance，建议顺序为：

1. `transactions` 列表缓存契约化
2. `deposits` 列表缓存契约化
3. `withdrawals` 列表缓存契约化

仍然保持**单 tab、单闭环**推进，不并行全页重构。

---

## 9. 心智模型提问

**当一个页面同时有“共享业务统计”和“页面私有视图”时，应该用业务 tag、页面 tag，还是双标签并存？**

> 结论：共享业务一致性靠业务 tag，精细控制靠页面 tag；两者并存通常是最稳的方案。
