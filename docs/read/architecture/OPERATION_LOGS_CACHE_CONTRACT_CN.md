# Operation Logs 缓存契约（Phase 6 P0 / 单页面）

> 日期：2026-03-23  
> 范围：`operation-logs`（`OperationLogListClient.tsx`）

---

## 1. 问题

### Q1：为什么这页适合“先做 Server 预取 + Hydration”？

**答案：它是纯读列表页，不涉及资金/订单写链路，单页改动风险最低，回退路径最清晰。**

当前痛点：

- 首屏仍以客户端请求为主，首次进入有冷启动等待
- URL 参数已可回写，但缺少统一 query key 契约
- 服务端渲染层没有利用 Next.js 的数据缓存能力

---

## 2. 本次契约定义

新增文件：

- `apps/admin-next/src/lib/cache/operation-logs-cache.ts`

核心能力：

1. `parseOperationLogsSearchParams`
   - 统一解析 `page/pageSize/adminId/action/keyword/startDate/endDate`
   - `action=ALL` 视为未筛选，防止脏参数进入请求
2. `buildOperationLogsListParams`
   - 输出后端请求参数对象，保证客户端/服务端一致
3. `operationLogsListQueryKey`
   - 统一 React Query key，确保 Server 预取与 Client 消费命中同一缓存
4. `OPERATION_LOGS_LIST_TAG`
   - 为后续失效语义预留统一标签（`operation-logs:list`）

---

## 3. 页面改造

### Q2：这次具体改了什么？

**答案：只做页面级预取和列表消费，不碰全局 `SmartTable`。**

改动：

- `apps/admin-next/src/app/(dashboard)/operation-logs/page.tsx`
  - 接入 `searchParams`
  - `QueryClient.prefetchQuery` 预取 `/v1/admin/operation-logs/list`
  - `HydrationBoundary` 注水给客户端
- `apps/admin-next/src/components/operation-logs/OperationLogListClient.tsx`
  - 接入 `enableHydration` + `hydrationQueryKey`
  - `requestLogs` 改为复用 cache helper 的 parse/build

保持不变：

- `OperationLogClient` URL 回写机制
- `SmartTable` 公共实现
- 后端 API 与数据库结构

---

## 4. 风险与边界

### Q3：会不会影响其他页面的 SmartTable 行为？

**答案：不会。Hydration 仍是显式开关，只有本页传了 `enableHydration` 才生效。**

边界策略：

- 不在 `SmartTable` 引入新全局分支
- query key 完全页面私有
- 需要回退时，仅撤销 `operation-logs` 两个文件改动即可

---

## 5. 回归建议

- Vitest：`OperationLogList` 渲染与参数透传用例通过
- 手工：
  - 打开 `/operation-logs?action=LOGIN&keyword=test`
  - 刷新页面后，筛选参数保持
  - 首屏列表直接渲染（避免二次冷启动）

---

## 6. 心智模型提问

**如果一个页面“只有读请求、几乎无写操作”，是不是就不需要先定义缓存契约？**

> 答：不是。读多写少页面更依赖“命中稳定性”；先统一 parse/build/queryKey，才能让预取、注水、后续失效策略保持同一种语言，避免未来再补契约时引入回归。

---

## 7. 2026-03-23 增量：搜索契约回归修复

### Q4：为什么 `operation-logs` 的 action 搜索会“看起来参数对了，但查不出数据”？

**答案：前端下拉是通用动作词（`LOGIN / UPDATE / AUDIT`），但数据库里真实存的是更具体的 action 值（如 `login`、`manual_adjust`、`audit_withdraw`、`update_user_info`）。**

这会导致一个典型契约错位：

- 前端发送：`action=UPDATE`
- 后端原逻辑：`where.action = 'UPDATE'` 精确匹配
- 数据库存储：`update_user_info` / `update_role`
- 结果：0 条命中

修复策略：

- 对通用动作词（`login/logout/create/update/delete/audit/export`）改为 `contains + mode: 'insensitive'`
- 对具体 action 值仍保留 `equals + mode: 'insensitive'`

### Q5：为什么日期搜索也容易误判成“没数据”？

**答案：如果 `endDate` 直接按 `new Date('2026-03-23')` 处理，实际只包含当天 00:00:00 之前的数据。**

修复后统一按：

- `startDate -> TimeHelper.getStartOfDay(...)`
- `endDate -> TimeHelper.getEndOfDay(...)`

这样日期范围才符合后台列表的常见使用心智。

### 回归验证（本次）

- 后端：`apps/api/src/admin/operation-log/operation-log.service.spec.ts` 9 tests passed
- 前端：`apps/admin-next/src/views/__tests__/OperationLogList.test.tsx` 6 tests passed

### 心智模型提问（本次）

**当 UI 提供的是“抽象筛选词”，而数据库存的是“具体业务动作码”时，筛选契约应该定义在哪一层？**

> 答：要显式定义在一层稳定的适配层里。可以放前端、后端或共享层，但不能靠“双方刚好猜对”；否则参数名正确，语义仍然错位，最终表现就是“接口没报错，但怎么搜都没数据”。
