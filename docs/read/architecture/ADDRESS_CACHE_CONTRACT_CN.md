# Address 缓存契约（Phase 6 P0 / 单页面）

> 日期：2026-03-23  
> 范围：`address`（`AddressListClient.tsx`）

---

## 1. 问题

### Q1：Address 页面为什么要做和 Groups/Operation Logs 一样的缓存契约？

**答案：Address 是典型读侧列表页，首屏和刷新链路可直接复用“Server 预取 + Hydration”模板，改造风险小、回退简单。**

改造前：

- `requestAddress` 直接透传表格参数，参数解析规则分散
- `page.tsx` 没有服务端预取，首屏只能等客户端请求
- 页面 URL 参数与 query key 没有统一 helper，后续容易出现语义漂移

---

## 2. 本次契约定义

新增：`apps/admin-next/src/lib/cache/address-cache.ts`

统一能力：

1. `parseAddressSearchParams`
   - 统一解析 `page/pageSize/keyword/userId/province/phone`
2. `buildAddressListParams`
   - 客户端与服务端请求参数共用一套构造逻辑
3. `addressListQueryKey`
   - 预取和消费使用同一 query key
4. `ADDRESS_LIST_TAG`
   - 预留失效语义标签：`address:list`

---

## 3. 页面改造

- `apps/admin-next/src/app/(dashboard)/address/page.tsx`
  - 接入 `searchParams`
  - `QueryClient.prefetchQuery` 预取 `/v1/admin/address/list`
  - `HydrationBoundary` 注水
- `apps/admin-next/src/components/address/AddressListClient.tsx`
  - 使用 parse/build helper 归一化请求参数
  - 接入 `enableHydration + hydrationQueryKey`

保持不变：

- `AddressClient` URL 同步职责
- `addressApi` 接口定义
- `SmartTable` 公共模型

---

## 4. 回归验证

- `apps/admin-next/src/__tests__/views/AddressList.test.tsx` 通过
- 覆盖点：
  - 列表渲染正常
  - `initialFormParams` 透传不回归
  - hydration 开关和 queryKey 透传正确

---

## 5. 心智模型提问

**当多个页面都在复用 SmartTable 时，应该优先抽全局重构，还是先按页面建立 parse/build/queryKey 契约？**

> 答：先做页面级契约。先保证每个页面语义稳定，再评估可抽象性；否则全局改造会把未确认的语义差异一起放大，风险更高。
