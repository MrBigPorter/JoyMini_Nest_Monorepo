# Orders 缓存契约

> 文档版本：Phase 6 P0  
> 完成日期：2026-03-23  
> 状态：✅ 完成（可回退）

---

## 📋 概览

本文档沉淀 Orders（订单管理）单页面缓存优化的核心设计、实现与心智模型。

### 业务背景

- **目标**：减少 Orders 首屏客户端瀑布请求，复用服务端预取数据
- **方案**：Server 端按 URL 预取订单列表 → `HydrationBoundary` 注水 → Client 端 `useQuery` 复用缓存
- **范围**：仅改 Orders 单页；不改 `BaseTable` 全局模型，不改后端接口，不改 Dashboard 之外其他读写流

---

## 🎯 6 个 Checkpoint 清单

| #   | Checkpoint   | 说明                                                                | 状态 |
| --- | ------------ | ------------------------------------------------------------------- | ---- |
| 1️⃣  | 读侧契约定义 | 收敛 `orders-cache.ts`：URL 解析 / queryKey / request params helper | ✅   |
| 2️⃣  | 页面级预取   | `orders/page.tsx` Server 预取 + `HydrationBoundary` 注水            | ✅   |
| 3️⃣  | 列表迁移     | 拆出 `OrderListClient`，由 `OrdersClient` 负责 URL 壳               | ✅   |
| 4️⃣  | 边界锁定     | 单页可回退改造，不动全局框架 / 后端接口                             | ✅   |
| 5️⃣  | Vitest 覆盖  | 新增 `OrderListClient.test.tsx`（7 cases）                          | ✅   |
| 6️⃣  | 文档沉淀     | 本文档 + 心智模型提问                                               | ✅   |

---

## 🔧 核心实现

### 1. 读侧契约（`orders-cache.ts`）

**职责**：

- 统一 Orders URL 参数的解析规则
- 生成稳定 `queryKey`
- 输出后端 `orderApi.getList()` 请求参数

**关键 API**：

```typescript
parseOrdersSearchParams(params: NextSearchParams): OrdersListQueryInput
buildOrdersListParams(input: OrdersListQueryInput): OrderListParams
ordersListQueryKey(input: OrdersListQueryInput)
```

**字段规范**：

- 分页：`page`, `pageSize`
- 筛选：`keyword`, `orderStatus`
- sentinel：兼容 `ALL` / `All`，最终统一归一到 `undefined`

**关键收敛点**：

- `orderStatus` 改为显式 `parseOptionalInt()`，避免 `0 / undefined / All` 混淆
- `queryKey` 第一维统一为 `'orders'`，与其他页面模式一致
- `buildOrdersListParams()` 使用 `!== undefined`，避免条件值因 truthy 判断丢失

---

### 2. 页面级预取（`orders/page.tsx`）

**流程**：

```text
URL searchParams
    ↓
parseOrdersSearchParams()
    ↓
queryClient.prefetchQuery()
    ↓
serverGet('/v1/admin/order/list')
    ↓
HydrationBoundary 注水
    ↓
OrderListClient useQuery 复用缓存
```

**关键点**：

- `queryFn` 在服务端和客户端都返回 `{ list, total }`
- 服务端 tag 使用 `[ORDERS_LIST_TAG, 'dashboard:orders']`
- 订单写操作后可以同时失效 Orders 页与 Dashboard 最近订单区域

---

### 3. 列表消费收敛（`OrdersClient` + `OrderListClient`）

本次不是继续堆大组件，而是拆成两层：

#### `OrdersClient`

只负责：

- 读取 `useSearchParams()`
- 将 URL 解析为 `initialFormParams`
- 将搜索 / 分页变化回写到 URL

#### `OrderListClient`

只负责：

- `useQuery` 拉取订单列表
- 管理 `pagination` / `filters` 本地状态
- 渲染 `SchemaSearchForm + BaseTable`
- 处理订单详情、取消、删除、发货等页面级交互

**收益**：

- URL 壳与表格消费解耦
- 与 `PaymentChannelsClient + PaymentChannelListClient` 结构一致
- 单测可以只打列表消费层，不必引入 `next/navigation`

---

## 🧠 心智模型提问

### Q1：为什么 Orders 要拆成 `OrdersClient` + `OrderListClient`？

**答**：因为 Orders 原先把 URL、数据查询、表格渲染、弹窗交互都塞进一个组件，导致：

- 难测试
- queryKey 与 URL 容易失配
- 无法和 PaymentChannels / Banners 复用相同心智模型

拆层后：

- `OrdersClient` = URL 壳
- `OrderListClient` = 读侧消费

这样服务端预取、客户端 hydrate、列表渲染三层职责更清晰。

---

### Q2：为什么 queryKey 要从 `orders-list` 收敛成 `orders`？

**答**：不是因为功能不同，而是为了**全局一致的缓存命名模型**。

当页面都遵循：

```typescript
["orders", page, pageSize, keyword, orderStatus][
  ("payment-channels", page, pageSize, name, type, status)
][("banners", page, pageSize, title, bannerCate)];
```

团队看到 key 就能马上知道：

- 第一维 = 资源名
- 后续 = 分页 + 筛选维度

这会极大降低排查缓存 miss 时的心智负担。

---

### Q3：为什么 `orderStatus` 不能继续用 truthy 判断？

**答**：truthy 判断会把“合法但为 0”的值和 `undefined` 混在一起。

虽然订单状态当前主要是正整数，但缓存契约层不应依赖“业务状态永远 > 0”这种隐含前提。更稳妥的写法是：

```typescript
orderStatus !== undefined ? { orderStatus } : {};
```

这是一种**契约层优先显式、业务层再解释**的设计。

---

### Q4：为什么服务端和客户端的 `queryFn` 必须返回同形数据？

**答**：如果服务端 hydrate 的是 `PaginatedResponse<Order>`，客户端 `useQuery` 却返回 `{ list, total }`，就会出现：

- 首屏可用
- refetch 后数据结构变化
- 组件消费层出现隐藏分支

所以最安全的做法是：**同 queryKey，必须同返回形状**。

本次 Orders 明确统一成：

```typescript
{
  (list, total);
}
```

---

### Q5：Orders 为什么保留 URL 中的分页参数？

**答**：因为 Orders 是典型后台列表，分页 URL 可分享、可刷新恢复，更适合运维 / 客服 / 人工排查场景。

这和 PaymentChannels 当前只把筛选项写回 URL 的取舍不同：

- Orders：更偏“业务排查场景”，保留分页更有价值
- PaymentChannels：更偏“配置管理场景”，分页 URL 价值较低

**结论**：缓存契约模板一致，但 URL 细节允许按业务场景微调。

---

### Q6：这次改造为什么仍然是“可回退”的？

**答**：因为改动点都在 Orders 页面内部：

- 新增 `OrderListClient`
- `OrdersClient` 简化为 URL 壳
- `orders/page.tsx` 预取
- `orders-cache.ts` 收敛

没有改：

- `BaseTable`
- `SchemaSearchForm`
- `orderApi`
- 后端接口
- 全局 QueryProvider

所以回退时只需要恢复 Orders 单页内部实现，不会带出连锁变更。

---

## 🧪 测试覆盖

**文件**：`src/__tests__/components/orders/OrderListClient.test.tsx`

**覆盖点**：

- 正常渲染
- `BaseTable` 渲染
- 搜索表单渲染
- `PageHeader` 渲染
- loading 状态
- 初始参数注入
- `onParamsChange` 可接入

**结果**：

```bash
yarn vitest run src/__tests__/components/orders/OrderListClient.test.tsx
# ✓ 7 passed
```

---

## 📦 交付文件

| 文件                                                       | 作用                |
| ---------------------------------------------------------- | ------------------- |
| `src/lib/cache/orders-cache.ts`                            | Orders 读侧缓存契约 |
| `src/app/(dashboard)/orders/page.tsx`                      | Server 预取 + 注水  |
| `src/components/orders/OrdersClient.tsx`                   | URL 壳              |
| `src/components/orders/OrderListClient.tsx`                | 列表消费层          |
| `src/__tests__/components/orders/OrderListClient.test.tsx` | Vitest 回归         |

---

## 🔙 回退方案

如果需要回退：

1. 删除 `OrderListClient.tsx`
2. 恢复 `OrdersClient.tsx` 为单组件实现
3. 移除 `orders/page.tsx` 中的 `prefetchQuery + HydrationBoundary`
4. 保留 `orders-cache.ts` 也不会影响现有逻辑

---

## ✅ 验证结果

- [x] Orders 相关改动 ESLint 通过
- [x] `OrderListClient` Vitest 通过（7/7）
- [x] 服务端 / 客户端 queryKey 对齐
- [x] 写操作失效 tag 与 dashboard 最近订单联动保留
- [x] 未修改全局表格框架与后端接口

---

**文档作者**：GitHub Copilot  
**最后更新**：2026-03-23  
**状态**：✅ 已验收
