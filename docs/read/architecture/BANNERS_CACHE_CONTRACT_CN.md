# Banners 缓存契约（Phase 6 P0 / 单页面）

> 日期：2026-03-23  
> 范围：`banners`（`BannersClient.tsx` / `BannerManagementClient.tsx`）

---

## 1. 问题

### Q1：Banners 页面为什么适合作为下一块低风险读侧改造？

**答案：它筛选维度少（`title`、`bannerCate`），读侧边界清晰，而且首屏目前仍完全依赖客户端请求。**

改造前问题：

- 页面没有 Server 预取
- `useAntdTable` 无法直接消费服务端注水结果
- `bannerCate` 在 `ALL` / string / number 之间缺少统一语义

---

## 2. 本次契约定义

新增：`apps/admin-next/src/lib/cache/banners-cache.ts`

统一能力：

1. `parseBannersSearchParams`
   - 统一解析 `page/pageSize/title/bannerCate`
   - `ALL` 自动折叠为未筛选
2. `buildBannersListParams`
   - 统一请求参数构造
3. `bannersListQueryKey`
   - 保证服务端预取与客户端查询命中同一 key
4. `BANNERS_LIST_TAG`
   - 预留失效语义：`banners:list`

---

## 3. 页面改造

- `apps/admin-next/src/app/(dashboard)/banners/page.tsx`
  - 接入 `searchParams`
  - 预取 `/v1/admin/banners/list`
  - `HydrationBoundary` 注水
- `apps/admin-next/src/components/banners/BannersClient.tsx`
  - URL 参数保留 `page/pageSize`
- `apps/admin-next/src/components/banners/BannerManagementClient.tsx`
  - 读侧从 `useAntdTable` 收敛为 `useQuery + BaseTable`
  - 保留写侧动作、拖拽句柄、弹窗与 optimistic 状态更新逻辑

---

## 4. 边界说明

### Q2：为什么这里也允许替换 `useAntdTable`？

**答案：因为目标不是全局重构，而是把无法消费注水的旧请求模型，局部替换成单页内可预取、可回退的统一模型。**

控制边界：

- 不改 `BaseTable` 组件
- 不改 `SchemaSearchForm` 公共实现
- 不改 banner 写接口
- 不抽象成新的全局框架

---

## 5. 回归验证

- `apps/admin-next/src/__tests__/views/BannerManagement.test.tsx` 通过
- 覆盖点：
  - 页面渲染
  - BaseTable 渲染
  - 初始 URL 参数能归一化成正确请求参数

---

## 6. 心智模型提问

**当旧页面的列表读取模型本身不支持 hydration 时，应该继续兼容旧模型还是在单页内局部替换？**

> 答：优先局部替换，只要边界能锁在单页内。持续为旧模型打补丁，会让未来每个页面都携带不同的请求语义和缓存债务。
