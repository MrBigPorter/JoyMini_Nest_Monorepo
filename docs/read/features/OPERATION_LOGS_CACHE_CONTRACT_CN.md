# Operation Logs 缓存契约

> 文档版本：Phase 6 P0  
> 完成日期：2026-03-23  
> 状态：✅ 完成（可回退）

---

## 概览

Operation Logs 页面已对齐读侧缓存契约：

- URL 参数解析
- queryKey 生成
- request params 构建
- Server 预取 + HydrationBoundary 注水
- Client 侧列表消费与 URL 壳解耦

范围仍是“单页可回退”，未改全局 `SmartTable`、`BaseTable` 与后端接口。

---

## 6 个 Checkpoint 落地

1. **读侧契约定义**

- `src/lib/cache/operation-logs-cache.ts`
- 收敛了 `action` 哨兵值兼容（`ALL` / `All`）

2. **页面级预取**

- `src/app/(dashboard)/operation-logs/page.tsx`
- 继续使用 `prefetchQuery + HydrationBoundary`，并切到 `OperationLogsClient` 命名

3. **列表消费对齐**

- `src/components/operation-logs/OperationLogClient.tsx` 作为 URL 壳
- 保留 `page/pageSize` 参数透传，避免深链分页下 queryKey 偏移
- `OperationLogListClient` 维持 SmartTable 消费层，不动全局框架

4. **边界锁定**

- 不改 `SmartTable` 全局实现
- 不改后端接口
- 不改其他页面

5. **Vitest 回归**

- 新增 `src/__tests__/views/OperationLogClient.test.tsx`
- 既有 `src/views/__tests__/OperationLogList.test.tsx` 继续保留

6. **文档沉淀**

- 本文档 + 心智模型提问（如下）

---

## 心智模型提问

### Q1：为什么 Operation Logs 也要保留 `page/pageSize` 在 URL？

因为 Server 预取以 URL 为输入，Client 列表也以 URL 恢复状态。若壳组件丢掉分页参数，深链 `page=2` 会在客户端回到默认分页，导致 hydration 命中不稳定。

### Q2：为什么只收敛 `action` 的 `ALL/All`，不大改其他字段？

这是“最小可回退”原则：先把最容易造成 queryKey 漂移的哨兵值统一，再避免一次性改动太大带来回归风险。

### Q3：为什么这里不把 `OperationLogListClient` 迁到 `BaseTable + useQuery`？

当前页面已通过 `SmartTable` 的 hydration 能力工作，且本轮目标是单页稳态优化。对齐 URL 契约和 queryKey 即可解决主要偏移问题，不必改全局模型。

---

## 验证结果

- Operation Logs 相关文件 eslint/prettier 通过
- `OperationLogClient.test.tsx` 通过
- `OperationLogList.test.tsx` 通过

---

## 交付文件

- `src/lib/cache/operation-logs-cache.ts`
- `src/app/(dashboard)/operation-logs/page.tsx`
- `src/components/operation-logs/OperationLogClient.tsx`
- `src/__tests__/views/OperationLogClient.test.tsx`
- `read/features/OPERATION_LOGS_CACHE_CONTRACT_CN.md`
