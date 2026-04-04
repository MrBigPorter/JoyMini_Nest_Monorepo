# KYC 缓存契约（Phase 6 P0 / 单页面）

> 日期：2026-03-23  
> 范围：`kyc`（`KycClient.tsx` / `KycListClient.tsx`）

---

## 1. 问题

### Q1：KYC 页面为什么要单独定义缓存契约？

**答案：KYC 同时有状态筛选和日期范围筛选，URL 参数、请求参数和 hydration key 很容易出现“看起来一致，实际不一致”的隐性漂移。**

改造前风险：

- `dateRange` 可能被直接序列化进 URL
- `kycStatus` 在字符串与数字之间转换分散
- Server 预取与 Client 消费没有统一 query key

---

## 2. 本次契约定义

新增：`apps/admin-next/src/lib/cache/kyc-cache.ts`

统一能力：

1. `parseKycSearchParams`
   - 统一解析 `userId/kycStatus/startDate/endDate`
   - `kycStatus=ALL` 自动视为未筛选
2. `buildKycListParams`
   - 统一服务端与客户端请求参数构造
3. `kycListQueryKey`
   - 保证预取和消费命中同一份缓存
4. `KYC_LIST_TAG`
   - 预留失效语义：`kyc:list`

---

## 3. 页面改造

- `apps/admin-next/src/app/(dashboard)/kyc/page.tsx`
  - 接入 `searchParams`
  - 服务端预取 `/v1/admin/kyc/records`
  - `HydrationBoundary` 注水
- `apps/admin-next/src/components/kyc/KycClient.tsx`
  - URL 回写时统一 `dateRange -> startDate/endDate`
- `apps/admin-next/src/components/kyc/KycListClient.tsx`
  - 请求参数统一走 parse/build helper
  - 接入 `enableHydration + hydrationQueryKey`

保持不变：

- 全局 `SmartTable` 模型
- KYC 写操作流程（审核/撤销/删除）
- 后端接口定义

---

## 4. 回归验证

- `apps/admin-next/src/__tests__/views/KycList.test.tsx` 通过
- 覆盖点：
  - 组件可渲染
  - 页面头部可渲染
  - hydration 参数透传正确

---

## 5. 心智模型提问

**当页面存在“显示层参数”(dateRange) 与“接口层参数”(startDate/endDate)时，哪一层应该负责映射？**

> 答：由页面 cache contract 负责映射最稳。这样 URL、Server 预取、Client 请求都能复用同一规则，避免三个地方各写一套转换逻辑。
