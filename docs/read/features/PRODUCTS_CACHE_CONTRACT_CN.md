# Products 缓存契约

> 文档版本：Phase 6 P0  
> 完成日期：2026-03-23  
> 状态：✅ 完成（可回退）

---

## 概览

Products 页面对齐了读侧缓存契约链路：

- URL 参数解析（`parseProductsSearchParams`）
- queryKey 生成（`productsListQueryKey`）
- request params 生成（`buildProductsListParams`）
- 页面级 Server 预取 + `HydrationBoundary`

范围锁定在单页面：不改 `BaseTable`、不改后端接口、可随时回退。

---

## 本次改动

1. **读侧契约**

- 使用 `src/lib/cache/products-cache.ts` 统一 URL -> query -> request 规则
- 保持 `PRODUCTS_LIST_TAG = 'products:list'`

2. **页面级预取**

- `src/app/(dashboard)/products/page.tsx` 使用契约 helper 进行 server prefetch
- 注水数据形状保持 `{ data, total }`，与 SmartTable 消费一致

3. **列表消费对齐**

- 新增 `src/components/products/ProductListClient.tsx`
- `src/components/products/ProductsClient.tsx` 改为 URL 壳，透传完整 URL 参数（含 `page/pageSize`）
- `ProductsClient` 不再剔除分页参数，避免 server/client queryKey 在深链分页时错位

4. **测试补充**

- 新增 `src/__tests__/views/ProductsClient.test.tsx`（URL 壳 + 参数透传）
- 保留 `src/__tests__/views/ProductManagement.test.tsx` 覆盖列表消费侧

---

## 心智模型提问

### Q1：为什么 Products 需要保留 `page/pageSize` 在 URL？

因为 server 预取会按 URL 解析分页；如果客户端壳组件把分页参数剔除，hydration key 就会回到默认分页，导致深链分页场景下 cache miss。

### Q2：为什么这里没有强行重写 `ProductManagementClient` 成 `BaseTable + useQuery`？

当前 Products 已基于 `SmartTable` 完成了 hydration 消费，且本次目标是“单页可回退优化”。通过补齐 URL 契约与参数透传即可消除主要错位风险，不需要改全局表格模型。

### Q3：什么时候才需要把 Products 彻底迁到 `BaseTable + useQuery`？

当需要统一所有页面到同一列表架构，或 `SmartTable` 的分页/URL 同步能力成为持续瓶颈时，再做整页迁移更合适。

---

## 验证

- `ProductsClient.test.tsx` 通过
- `ProductManagement.test.tsx` 通过
- Products 相关文件 eslint/prettier 通过

---

## 交付文件

- `src/components/products/ProductListClient.tsx`
- `src/components/products/ProductsClient.tsx`
- `src/__tests__/views/ProductsClient.test.tsx`
- `read/features/PRODUCTS_CACHE_CONTRACT_CN.md`
