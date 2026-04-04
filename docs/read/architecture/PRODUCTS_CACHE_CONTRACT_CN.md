# Products 缓存契约（Phase 6 P0 / 单页面）

> 日期：2026-03-23  
> 范围：`products`（`ProductsClient.tsx` / `ProductManagementClient.tsx`）

---

## 1. 问题

### Q1：Products 页面为什么也要单页缓存契约？

**答案：Products 筛选参数含 `categoryId` 和 `filterType`，如果 URL、请求、hydration key 不统一，最容易出现“筛选一致但缓存不命中”。**

改造前风险：

- `categoryId` 在字符串/数字之间来回转换
- `filterType=ALL` 的默认语义在不同层处理不一致
- 页面没有 Server 预取，首屏仍依赖客户端请求

---

## 2. 本次契约定义

新增：`apps/admin-next/src/lib/cache/products-cache.ts`

统一能力：

1. `parseProductsSearchParams`
   - 解析 `treasureName/categoryId/filterType/page/pageSize`
   - 将 `ALL` 统一折叠为未筛选
2. `buildProductsListParams`
   - 统一客户端与服务端请求参数
3. `productsListQueryKey`
   - 保证预取与消费使用同一 key
4. `PRODUCTS_LIST_TAG`
   - 预留读侧失效语义：`products:list`

---

## 3. 页面改造

- `apps/admin-next/src/app/(dashboard)/products/page.tsx`
  - 接入 `searchParams`
  - 服务端预取 `/v1/admin/treasure/list`
  - `HydrationBoundary` 注水
- `apps/admin-next/src/components/products/ProductManagementClient.tsx`
  - 请求参数复用 parse/build helper
  - 接入 `enableHydration + hydrationQueryKey`

保持不变：

- `ProductsClient` URL 回写职责
- `SmartTable` 全局实现
- 产品写侧流程（创建/编辑/上下架/删除）

---

## 4. 回归验证

- `apps/admin-next/src/__tests__/views/ProductManagement.test.tsx` 通过
- 覆盖点：
  - 组件渲染
  - SmartTable 渲染
  - hydration props 与初始参数透传

---

## 5. 心智模型提问

**当筛选值同时存在“枚举默认值”(ALL) 和“真实业务值”时，应该在哪一层消解默认值语义？**

> 答：应在页面 cache helper 层统一消解。这样 URL、Server 预取、Client 请求都走同一语义，避免在 UI 或 API 调用层到处写特判。
