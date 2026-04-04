# Users 缓存契约（Phase 6 P0 / 单页面）

> 日期：2026-03-23  
> 范围：`users`（`UsersClient.tsx`）

---

## 1. 问题

### Q1：Users 页面为什么也要补 parse/build/queryKey？

**答案：Users 过滤项更多（`status` / `kycStatus` / 时间范围），如果没有统一参数契约，URL、请求参数与 hydration key 很容易语义错位。**

改造前风险：

- `dateRange` 直接进 URL 可能出现 `[object Object]`
- `status`/`kycStatus` 在 string 与 number 间来回漂移
- Server 预取与 Client 请求缺少统一 key，命中率不稳定

---

## 2. 本次契约定义

新增：`apps/admin-next/src/lib/cache/users-cache.ts`

统一能力：

1. `parseUsersSearchParams`
   - 统一解析 `userId/phone/status/kycStatus/startTime/endTime`
2. `buildUsersListParams`
   - 输出后端 `client-user/list` 所需参数结构
3. `usersListQueryKey`
   - 保证 `page.tsx` 预取与 `UsersClient` 消费命中同一 key
4. `USERS_LIST_TAG`
   - 预留读侧失效语义：`users:list`

---

## 3. 页面改造

- `apps/admin-next/src/app/(dashboard)/users/page.tsx`
  - 接入 `searchParams`
  - 服务端预取 `/v1/admin/client-user/list`
  - `HydrationBoundary` 注水
- `apps/admin-next/src/components/users/UsersClient.tsx`
  - URL 同步时把 `dateRange` 映射为 `startTime/endTime`
  - 请求参数和 hydration key 都复用 users cache helper
  - 接入 `enableHydration + hydrationQueryKey`

保持不变：

- `SmartTable` 全局模型
- 后端接口与 DTO 结构

---

## 4. 回归验证

- `apps/admin-next/src/__tests__/views/UsersClient.test.tsx` 通过
- 覆盖点：
  - 组件可渲染
  - SmartTable 正常渲染
  - hydration 参数透传与 URL 初始参数保持

---

## 5. 心智模型提问

**当一个页面既有“结构化筛选”(select) 又有“自由筛选”(日期范围) 时，参数规范化应该放在哪一层最稳？**

> 答：放在页面自己的 cache contract helper 最稳。UI 只负责采集，helper 负责语义收敛，Server 预取与 Client 请求都复用同一逻辑，才能避免双轨漂移。
