# Users 缓存契约

> 文档版本：Phase 6 P0  
> 完成日期：2026-03-23  
> 状态：✅ 完成（可回退）

---

## 📋 概览

本文档沉淀 Users（用户管理）单页面缓存优化的核心设计、实现与心智模型。

### 业务背景

- **目标**：避免 Users 首屏客户端瀑布请求，保证深链分页/筛选进入页面时可以直接命中服务端预取缓存
- **方案**：Server 端按 URL 参数预取用户列表 → `HydrationBoundary` 注水 → Client 端 `useQuery` 复用同一 `queryKey`
- **范围**：仅改 `users` 单页；不改 `BaseTable` 全局模型，不改后端接口，不碰通用 `SmartTable` 框架

---

## 🎯 6 个 Checkpoint 清单

| #   | Checkpoint   | 说明                                                               | 状态 |
| --- | ------------ | ------------------------------------------------------------------ | ---- |
| 1️⃣  | 读侧契约定义 | 收敛 `users-cache.ts`：URL 解析 / queryKey / request params helper | ✅   |
| 2️⃣  | 页面级预取   | `users/page.tsx` Server 预取 + `HydrationBoundary` 注水            | ✅   |
| 3️⃣  | 列表消费对齐 | 拆出 `UserListClient`，由 `UsersClient` 只负责 URL 壳              | ✅   |
| 4️⃣  | 边界锁定     | 单页可回退改造，不改全局表格框架 / 后端接口                        | ✅   |
| 5️⃣  | Vitest 覆盖  | `UsersClient.test.tsx` + `UserListClient.test.tsx`（10 tests）     | ✅   |
| 6️⃣  | 文档沉淀     | 本文档 + 心智模型提问                                              | ✅   |

---

## 🔧 核心实现

### 1. 读侧契约（`users-cache.ts`）

**职责**：

- 统一 Users URL 参数的解析规则
- 生成稳定 `queryKey`
- 输出后端 `clientUserApi.getUsers()` 请求参数

**关键 API**：

```typescript
parseUsersSearchParams(params: NextSearchParams): UsersListQueryInput
buildUsersListParams(input: UsersListQueryInput): QueryClientUserParams
usersListQueryKey(input: UsersListQueryInput)
```

**字段规范**：

- 分页：`page`, `pageSize`
- 筛选：`userId`, `phone`, `status`, `kycStatus`, `startTime`, `endTime`
- 时间范围：UI 层用 `dateRange` 采集，但缓存契约层只认 `startTime/endTime`
- sentinel：兼容 `ALL / All`，统一归一为 `undefined`

**关键收敛点**：

- `status=0`（Frozen）是合法值，不能再用 truthy 判断
- `kycStatus` 与 `status` 在契约层统一转成 number，避免 string/number 漂移
- `buildUsersListParams()` 改为返回 `QueryClientUserParams`，让 Server/Client 请求参数类型完全一致

---

### 2. 页面级预取（`users/page.tsx`）

**流程**：

```text
URL searchParams
    ↓
parseUsersSearchParams()
    ↓
queryClient.prefetchQuery()
    ↓
serverGet('/v1/admin/client-user/list')
    ↓
HydrationBoundary 注水
    ↓
UserListClient useQuery 复用缓存
```

**关键点**：

- 服务端和客户端都消费同一个 `queryKey`
- hydrate 数据形状统一为 `{ data, total }`
- 这样 `Users` 页面首屏不会先空表再发客户端请求

---

### 3. 列表消费收敛（`UsersClient` + `UserListClient`）

本次把原本塞在 `UsersClient` 里的 URL、列表、操作弹窗三类职责拆开：

#### `UsersClient`

只负责：

- 读取 `useSearchParams()`
- 组装 `initialFormParams`
- 把筛选 / 分页变化写回 URL

#### `UserListClient`

只负责：

- `useQuery` 拉用户列表
- 管理 `pagination` / `filters`
- 渲染 `SchemaSearchForm + BaseTable`
- 处理查看详情、冻结/恢复用户等页面内交互

**为什么不继续依赖 `SmartTable` 做 hydration？**
因为 `SmartTable` 当前分页状态并不会从 URL 初始化，深链到 `page=2` 时会出现：

- Server 用 `page=2` 预取
- Client 首次仍按 `page=1` 渲染
- `queryKey`/分页状态错位

本次保持“单页可回退”的前提下，直接在 Users 页内部改为 `useQuery + BaseTable`，不触碰 `SmartTable` 全局模型。

---

## 🧠 心智模型提问

### Q1：为什么 Users 必须从 `dateRange` 收敛成 `startTime/endTime`？

**答**：因为 `dateRange` 是 UI 采集结构，不是稳定的缓存/请求语义。

如果把 `dateRange` 直接进 URL 或 queryKey，会出现：

- URL 中出现 `[object Object]`
- Server 预取无法复现 UI 结构
- 测试断言很难稳定

所以最稳的分层是：

- UI：采集 `dateRange`
- URL / cache / API：只认 `startTime/endTime`

---

### Q2：为什么 Users 不能继续只把筛选项写回 URL，而忽略分页？

**答**：因为 Users 是典型后台排查页面，分页深链有实际价值。

如果只保留筛选不保留分页：

- 刷新页面后总回第 1 页
- 从客服/运营共享链接时无法精确定位到那一页结果
- Server 预取与 Client 首屏状态更容易失配

所以这次 Users 采用和 Orders 一样的策略：**分页也是 URL 契约的一部分**。

---

### Q3：为什么要把 `UsersClient` 缩成 URL 壳？

**答**：因为原来一个组件同时做：

- URL 解析
- hydration key 计算
- SmartTable 消费
- 详情弹窗
- 冻结/恢复操作

这会让问题很难定位：到底是 URL、缓存还是表格状态出错？

拆层后：

- `UsersClient` = URL 壳
- `UserListClient` = 列表消费层

后续测试、排查和回退都会简单很多。

---

### Q4：为什么 0 值筛选在 Users 特别危险？

**答**：因为 Users 的 `status=0` 正好代表 **Frozen**，是业务上非常常见的查询值。

如果写成：

```typescript
if (status) {
  // ...
}
```

那 `0` 会被当成 false 直接丢掉，最后：

- UI 选了 Frozen
- URL 没写进去
- queryKey 不含 0
- API 请求也没带 0

这类 bug 非常隐蔽。Users 页因此必须坚持 `!== undefined` 的显式判断。

---

### Q5：为什么 Server/Client 返回值形状必须统一成 `{ data, total }`？

**答**：同一个 `queryKey` 下，Server hydrate 和 Client refetch 必须是同形数据；否则首屏和后续刷新会变成两套协议。

Users 当前消费层是 `BaseTable + useQuery`，直接读：

```typescript
usersData?.data;
usersData?.total;
```

因此 Server 预取也必须返回 `{ data, total }`，不能一边 `{ list, total }` 一边 `{ data, total }`。

---

### Q6：为什么这次改造仍然是“单页可回退”？

**答**：因为变更边界都锁在 Users 页面内部：

- 新增 `UserListClient`
- `UsersClient` 改成 URL 壳
- `users-cache.ts` 收敛参数契约
- `users/page.tsx` 预取保持原页面入口不变

没有改：

- `BaseTable`
- `SchemaSearchForm`
- `SmartTable`
- 后端接口
- 全局 Query Provider

回退时只需恢复 Users 页内部实现即可，不会波及其他模块。

---

## 🧪 测试覆盖

### 1. `UsersClient.test.tsx`

覆盖：

- 组件可渲染
- URL 壳组件可渲染
- URL 参数正确透传到 `UserListClient`

### 2. `UserListClient.test.tsx`

覆盖：

- 正常渲染
- `BaseTable` 渲染
- 搜索表单渲染
- `PageHeader` 渲染
- loading 状态
- 初始参数注入
- `onParamsChange` 可接入

**结果**：

```bash
yarn vitest run src/__tests__/views/UsersClient.test.tsx src/__tests__/components/users/UserListClient.test.tsx
# ✓ 10 passed
```

---

## 📦 交付文件

| 文件                                                     | 作用               |
| -------------------------------------------------------- | ------------------ |
| `src/lib/cache/users-cache.ts`                           | Users 读侧缓存契约 |
| `src/app/(dashboard)/users/page.tsx`                     | Server 预取 + 注水 |
| `src/components/users/UsersClient.tsx`                   | URL 壳             |
| `src/components/users/UserListClient.tsx`                | 列表消费层         |
| `src/__tests__/views/UsersClient.test.tsx`               | URL 壳测试         |
| `src/__tests__/components/users/UserListClient.test.tsx` | 列表消费测试       |

---

## ✅ 验证结果

- [x] Users 相关文件 ESLint 通过
- [x] Users 相关 Vitest 通过（10/10）
- [x] Server/Client `queryKey` 与分页参数一致
- [x] `status=0` / `kycStatus` 参数语义稳定
- [x] 时间范围仅通过 `startTime/endTime` 进入 URL 与缓存契约
- [x] 未修改全局 `SmartTable` / `BaseTable` 模型与后端接口

---

**文档作者**：GitHub Copilot  
**最后更新**：2026-03-23  
**状态**：✅ 已验收
