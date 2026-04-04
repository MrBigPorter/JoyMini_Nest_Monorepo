# Login Logs 缓存契约（Phase 6 P0 / 单页面）

> 日期：2026-03-23  
> 范围：`login-logs`（`LoginLogsClient.tsx`）

---

## 1. 问题

### Q1：Login Logs 不用 SmartTable，为什么仍然做缓存契约？

**答案：它同样是读侧列表页，仍有 URL 参数、分页、筛选；若无统一参数契约，Server 预取与 Client 查询会走两套语义。**

改造前问题：

- 页面无 Server 预取，首屏依赖客户端请求
- 参数管理仅在组件内部状态，URL 深链不完整
- 刷新与分享链接下首屏缓存不可复用

---

## 2. 本次契约定义

新增：`apps/admin-next/src/lib/cache/login-logs-cache.ts`

统一能力：

1. `parseLoginLogsSearchParams`
   - 统一解析 `page/pageSize/userId/loginIp/loginStatus/loginMethod/startDate/endDate`
2. `buildLoginLogsListParams`
   - 统一请求参数序列化
3. `loginLogsListQueryKey`
   - 统一 prefetch 与 useQuery 的缓存 key
4. `LOGIN_LOGS_LIST_TAG`
   - 预留读侧失效语义：`login-logs:list`

---

## 3. 页面改造

- `apps/admin-next/src/app/(dashboard)/login-logs/page.tsx`
  - 接入 `searchParams`
  - Server 预取 `/v1/admin/login-logs/list`
  - `HydrationBoundary` 注水
- `apps/admin-next/src/components/login-logs/LoginLogsClient.tsx`
  - 从 `useRequest` 切换到 `useQuery` 消费 hydration 数据
  - 过滤/分页变更时同步 URL

保持不变：

- 页面 UI 结构与交互布局
- 后端接口契约

---

## 4. 回归验证

- `apps/admin-next/src/__tests__/views/LoginLogsClient.test.tsx` 通过
- 覆盖点：
  - 组件可渲染
  - URL 初始参数驱动首查
  - 点击搜索会触发 URL 同步

---

## 5. 心智模型提问

**当列表页不是 SmartTable 体系时，是否还应该复用同一缓存契约方法论？**

> 答：应该。缓存契约本质是“参数语义一致性”，与 UI 组件无关；只要存在 Server 预取 + Client 查询，就需要统一 parse/build/queryKey。
