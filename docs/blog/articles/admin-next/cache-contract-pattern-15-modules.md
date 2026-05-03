---
title: '缓存契约模式：15 个统一的 React Query 缓存模块'
slug: cache-contract-pattern-15-modules
tags: Next.js, Admin, React Query, Caching, TypeScript, Architecture, Data Fetching
description: lib/cache/ 目录包含 15 个缓存模块，每个模块遵循相同的契约模式，将 URL 搜索参数与 API 查询参数和 React Query 缓存键连接起来，解决后台面板中分页、过滤器和缓存失效同步的常见痛点。
---

# 缓存契约模式：15 个统一的 React Query 缓存模块

## 概述

`lib/cache/` 目录包含 **15 个缓存模块**，每个模块遵循相同的契约模式，将 URL 搜索参数 ↔ API 查询参数 ↔ React Query 缓存键连接起来。这种模式解决了后台面板中的一个常见痛点：在列表-详情-编辑生命周期中保持分页、过滤器和缓存失效同步。

这 15 个模块覆盖了后台面板中的每个列表视图：

| 模块 | 标签常量 | QueryInput 接口 | 领域 |
|--------|-------------|---------------------|--------|
| [`users-cache.ts`](apps/admin-next/src/lib/cache/users-cache.ts) | `USERS_LIST_TAG` | `UsersListQueryInput` | 后台用户管理 |
| [`address-cache.ts`](apps/admin-next/src/lib/cache/address-cache.ts) | `ADDRESS_LIST_TAG` | `AddressListQueryInput` | 地址管理 |
| [`admin-users-cache.ts`](apps/admin-next/src/lib/cache/admin-users-cache.ts) | — | — | 管理员账户管理 |
| [`banners-cache.ts`](apps/admin-next/src/lib/cache/banners-cache.ts) | — | — | Banner 管理 |
| [`finance-cache.ts`](apps/admin-next/src/lib/cache/finance-cache.ts) | — | — | 财务概览 |
| [`finance-deposits-cache.ts`](apps/admin-next/src/lib/cache/finance-deposits-cache.ts) | — | — | 充值记录 |
| [`finance-transactions-cache.ts`](apps/admin-next/src/lib/cache/finance-transactions-cache.ts) | — | — | 交易历史 |
| [`finance-withdrawals-cache.ts`](apps/admin-next/src/lib/cache/finance-withdrawals-cache.ts) | — | — | 提现订单 |
| [`groups-cache.ts`](apps/admin-next/src/lib/cache/groups-cache.ts) | — | — | 拼团管理 |
| [`kyc-cache.ts`](apps/admin-next/src/lib/cache/kyc-cache.ts) | `KYC_LIST_TAG` | `KycListQueryInput` | KYC 认证记录 |
| [`login-logs-cache.ts`](apps/admin-next/src/lib/cache/login-logs-cache.ts) | — | — | 登录审计日志 |
| [`operation-logs-cache.ts`](apps/admin-next/src/lib/cache/operation-logs-cache.ts) | — | — | 操作审计日志 |
| [`orders-cache.ts`](apps/admin-next/src/lib/cache/orders-cache.ts) | `ORDERS_LIST_TAG` | `OrdersListQueryInput` | 订单管理 |
| [`payment-channels-cache.ts`](apps/admin-next/src/lib/cache/payment-channels-cache.ts) | — | — | 支付渠道配置 |
| [`products-cache.ts`](apps/admin-next/src/lib/cache/products-cache.ts) | — | — | 商品/宝物管理 |

---

## 1. 契约：三个函数 + 一个接口

每个模块恰好导出**三个函数和一个接口**，遵循以下签名模板（以 [`users-cache.ts`](apps/admin-next/src/lib/cache/users-cache.ts) 作为规范示例）：

### 接口：[`UsersListQueryInput`](apps/admin-next/src/lib/cache/users-cache.ts:5)

```typescript
export interface UsersListQueryInput {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: number;
  // 可选的领域特定过滤器...
}
```

所有 `QueryInput` 接口都有必需的 `page` + `pageSize`（带默认值），以及领域特定的可选过滤器。

### 函数 1：[`parseUsersSearchParams()`](apps/admin-next/src/lib/cache/users-cache.ts:36) — URL → QueryInput

将 `NextSearchParams`（来自 Next.js `useSearchParams()` 的原始 `[key: string]: string | string[] | undefined` 类型）转换为类型化的 `UsersListQueryInput`：

```typescript
export function parseUsersSearchParams(
  params: NextSearchParams,
): UsersListQueryInput {
  const page = parsePositiveInt(readParam(params, 'page'), 1);
  const pageSize = parsePositiveInt(readParam(params, 'pageSize'), 10);
  const keyword = readParam(params, 'keyword')?.trim();
  const status = parseOptionalInt(readParam(params, 'status'));

  return {
    page,
    pageSize,
    ...(keyword ? { keyword } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}
```

关键行为：
- `parsePositiveInt()`：解析为数字，拒绝 NaN/0/负数，回退到默认值
- `parseOptionalInt()`：解析为数字或 `undefined`（处理 `'ALL'` / `'All'` 标记值）
- 可选字段使用展开排除 undefined：`...(keyword ? { keyword } : {})`

### 函数 2：[`buildUsersListParams()`](apps/admin-next/src/lib/cache/users-cache.ts:60) — QueryInput → API 参数

将类型化输入转换为 API 客户端期望的格式（通常是 `Record<string, string | number | undefined>`）：

```typescript
export function buildUsersListParams(
  input: UsersListQueryInput,
): Record<string, string | number | undefined> {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.keyword ? { keyword: input.keyword } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };
}
```

React Query 的 `queryFn` 使用它来构建 API 请求：

```typescript
export function useUsersList(input: UsersListQueryInput) {
  return useQuery({
    queryKey: usersListQueryKey(input),
    queryFn: () => userApi.getUsers(buildUsersListParams(input)),
  });
}
```

### 函数 3：[`usersListQueryKey()`](apps/admin-next/src/lib/cache/users-cache.ts:75) — QueryInput → 查询键

返回一个不可变元组（`as const`），用作 React Query 的缓存键：

```typescript
export function usersListQueryKey(input: UsersListQueryInput) {
  return [
    'users',
    input.page,
    input.pageSize,
    input.keyword ?? '',
    input.status ?? 'all',
  ] as const;
}
```

`as const` 断言确保 React Query 键匹配中的类型安全元组推断，平坦的数组结构（无嵌套）使缓存失效可预测。

### 标签常量：[`USERS_LIST_TAG`](apps/admin-next/src/lib/cache/users-cache.ts:1)

```typescript
export const USERS_LIST_TAG = 'users:list';
```

用于变更后的精确缓存失效：

```typescript
import { USERS_LIST_TAG } from '@/lib/cache/users-cache';

// 创建/更新用户后
queryClient.invalidateQueries({ queryKey: [USERS_LIST_TAG] });
```

---

## 2. 共享工具函数

每个缓存模块都复制了三个小的辅助函数（它们足够小，提取到共享文件会增加导入开销而收益不大）：

### [`readParam()`](apps/admin-next/src/lib/cache/users-cache.ts:18)

```typescript
function readParam(params: NextSearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}
```

Next.js 搜索参数可以是 `string | string[] | undefined` — 这个辅助函数始终从数组中提取第一个值。

### [`parsePositiveInt()`](apps/admin-next/src/lib/cache/users-cache.ts:24)

```typescript
function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
```

安全的数字解析，强制正值并有保证的回退值。

### [`parseOptionalInt()`](apps/admin-next/src/lib/cache/users-cache.ts:29)

```typescript
function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value || value === 'ALL' || value === 'All') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.floor(parsed);
}
```

处理常见模式：过滤器下拉菜单中的"全部"选项映射为 `undefined`。

---

## 3. 数据流：端到端

```
URL (useSearchParams)                  React Query 缓存
         |                                     |
         v                                     v
  parseUsersSearchParams()       usersListQueryKey()
         |                                     |
         v                                     |
  UsersListQueryInput  ────────────────────────┘
         |
         v
  buildUsersListParams()
         |
         v
  API 请求 (userApi.getUsers())
```

### 具体示例：

1. 用户导航到 `/admin/users?page=2&keyword=test&status=1`
2. [`parseUsersSearchParams()`](apps/admin-next/src/lib/cache/users-cache.ts:36) 将 URL 参数转换为 `{ page: 2, pageSize: 10, keyword: 'test', status: 1 }`
3. [`usersListQueryKey()`](apps/admin-next/src/lib/cache/users-cache.ts:75) 产生 `['users', 2, 10, 'test', 1]` 用于缓存
4. [`buildUsersListParams()`](apps/admin-next/src/lib/cache/users-cache.ts:60) 产生 `{ page: 2, pageSize: 10, keyword: 'test', status: 1 }` 用于 API 调用
5. 变更成功后，`queryClient.invalidateQueries({ queryKey: ['users:list'] })` 触发重新获取

---

## 4. 领域特定变体

虽然契约是统一的，但每个模块会根据其领域的过滤需求进行调整：

### 日期范围过滤器（KYC、财务）

[`kyc-cache.ts`](apps/admin-next/src/lib/cache/kyc-cache.ts) 添加了 `startDate` 和 `endDate`：

```typescript
export interface KycListQueryInput {
  page: number;
  pageSize: number;
  userId?: string;
  kycStatus?: number;
  startDate?: string;
  endDate?: string;
}
```

### 带标记的枚举过滤器（订单）

[`orders-cache.ts`](apps/admin-next/src/lib/cache/orders-cache.ts) 将 `'ALL'` / `'All'` 映射为 `undefined` 用于状态过滤器：

```typescript
const orderStatus = parseOptionalInt(readParam(params, 'orderStatus'));
// 对于 '' | 'ALL' | 'All' | 无效数字返回 undefined
```

### 搜索关键词的字符串修剪

所有模块都对关键词输入执行 `.trim()`，防止仅空白字符的搜索触发 API 调用：

```typescript
const keyword = readParam(params, 'keyword')?.trim();
```

---

## 5. 缓存失效策略

标签常量实现了两层失效方法：

### 第一层：基于标签（广泛）

```typescript
// 使所有用户列表缓存失效，无论页面/过滤器如何
queryClient.invalidateQueries({ queryKey: [USERS_LIST_TAG] });
```

这在**变更操作后**（创建、更新、删除）使用，此时任何过滤器都可能受到影响。

### 第二层：特定键（精确）

```typescript
// 仅重新获取当前可见页面
queryClient.invalidateQueries({
  queryKey: usersListQueryKey(currentInput),
});
```

这可用于**后台重新获取**，仅需要刷新当前活动的过滤器。

---

## 6. 为什么这种模式很重要

| 没有模式 | 使用模式 |
|----------------|--------------|
| URL 参数在每个组件中临时解析 | 所有列表页面统一的 `parseXxxSearchParams()` |
| 查询键内联构造，容易拼写错误 | 类型化的 `xxxListQueryKey()` 加 `as const` 确保一致性 |
| API 参数在每个 hook 中构建方式不同 | `buildXxxListParams()` 保证统一的 API 结构 |
| 缓存标签分散为魔法字符串 | 导出的 `XXX_LIST_TAG` 常量防止拼写错误 |
| 添加新过滤器需要在 3+ 处修改 | 单个 `QueryInput` 接口驱动解析、构建和键生成 |

### 新建列表页面的迁移路径

为列表页面添加新的缓存模块需要：

1. 定义 `XxxListQueryInput` 接口，包含 `page` + `pageSize` + 领域过滤器
2. 实现 `parseXxxSearchParams()` — URL → 类型化输入
3. 实现 `buildXxxListParams()` — 类型化输入 → API 参数
4. 实现 `xxxListQueryKey()` — 类型化输入 → 查询键元组
5. 导出 `XXX_LIST_TAG` 常量
6. 在页面组件中使用：`parseXxxSearchParams(useSearchParams())` → `useQuery({ queryKey: xxxListQueryKey(input), queryFn: () => api.getList(buildXxxListParams(input)) })`

---

## 关键要点

1. **15 个缓存模块**遵循相同的三函数契约：`parseXxxSearchParams()` / `buildXxxListParams()` / `xxxListQueryKey()`。
2. **每个模块导出**一个类型化的 `QueryInput` 接口、四个工具函数和一个用于缓存失效的 `TAG` 常量。
3. **数据流**是单向的：URL 参数 → 类型化输入 → 查询键（用于缓存）+ API 参数（用于网络）。
4. **`as const` 查询键**确保类型安全的 React Query 缓存匹配，防止键漂移。
5. **带有 `'ALL'` 标记的 `parseOptionalInt()`** 是所有包含枚举过滤器的模块中的标准化模式。
6. **基于标签的失效**（通过 `XXX_LIST_TAG`）提供最广泛的重新获取——变更操作后的理想选择。
