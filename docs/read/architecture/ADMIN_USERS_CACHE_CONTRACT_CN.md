# Admin Users 缓存契约（Phase 6 P0 / 单页面）

> 日期：2026-03-23  
> 范围：`admin-users`（`AdminUsersClient.tsx` / `AdminUserManagementClient.tsx`）

---

## 1. 问题

### Q1：`admin-users` 不是 `SmartTable`，为什么也值得做单页缓存契约？

**答案：它同样是典型的读侧列表页，只是历史上走了 `useAntdTable + BaseTable` 路线。参数语义、首屏预取和客户端消费依然需要统一。**

改造前问题：

- `useAntdTable` 首屏一定触发客户端请求，无法消费服务端预取结果
- 搜索参数、分页参数与 URL 之间没有统一 helper
- 手动深链时，Server 与 Client 对 page / status 语义可能不一致

---

## 2. 本次契约定义

新增：`apps/admin-next/src/lib/cache/admin-users-cache.ts`

统一能力：

1. `parseAdminUsersSearchParams`
   - 解析 `page/pageSize/username/realName/role/status`
   - 将 `ALL` 统一折叠为未筛选
2. `buildAdminUsersListParams`
   - 统一请求参数构造
3. `adminUsersListQueryKey`
   - 统一 Server 预取与 Client 消费 key
4. `ADMIN_USERS_LIST_TAG`
   - 预留读侧失效语义：`admin-users:list`

---

## 3. 页面改造

- `apps/admin-next/src/app/(dashboard)/admin-users/page.tsx`
  - 接入 `searchParams`
  - 预取 `/v1/admin/user/list`
  - `HydrationBoundary` 注水
- `apps/admin-next/src/components/admin-users/AdminUsersClient.tsx`
  - URL 参数透传保留 `page/pageSize`
- `apps/admin-next/src/components/admin-users/AdminUserManagementClient.tsx`
  - 读侧从 `useAntdTable` 收敛为 `useQuery + BaseTable`
  - 继续保留现有 tab / modal / mutation 行为

---

## 4. 为什么这轮允许替换 `useAntdTable`？

### Q2：这不是比 SmartTable 页面改动更大吗？

**答案：是的，但仍然局限在单页内部，且收益是把“不可注水的历史请求模型”替换为“可预取、可回退”的统一模型。**

边界控制：

- 不抽象成全局基建
- 不影响其他列表页
- 仅保留 `BaseTable` 作为展示层

---

## 5. 回归验证

- `apps/admin-next/src/__tests__/views/AdminUserManagement.test.tsx` 通过
- 覆盖点：
  - 页面渲染
  - 表格渲染
  - 初始参数归一化后请求正确

---

## 6. 心智模型提问

**当一个旧页面的“列表请求模型”本身就无法消费服务端预取时，应该继续打补丁，还是局部替换成统一模型？**

> 答：优先做局部替换，但必须把改动边界收缩在单页内。否则持续给旧模型打补丁，会让后续每个页面都背不同的技术债。
