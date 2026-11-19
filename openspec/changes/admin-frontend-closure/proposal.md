# Proposal

## Why

管理端的架构底子是好的：Server Component 预取 + HydrationBoundary 注水、URL 作为筛选状态源、Next Data Cache 按 tag 失效、HTTP 层做了单飞 refresh 与请求去重。

但有三处一翻代码就露：全仓约 65 处写调用、**0 个 `useMutation`、0 个乐观更新**；与后端重叠的类型由三份手工契约各自维护（后端 DTO、前端 1875 行手写、`packages/shared` 只共享枚举），生成物零引用；表格首屏走服务端预取、翻页后走另一套手写数据流。

这三处不影响功能，影响的是「全栈」这个说法能不能站住。

## What Changes

- 三个代表性页面（用户管理、订单列表、财务审核）的写操作改用 `useMutation`，并带乐观更新与失败回滚。
- 写成功后同时失效两层缓存：React Query 查询缓存 + Next Data Cache 对应 tag（沿用现有 Server Action 链路，不重写）。
- 与后端重叠的类型改为从 OpenAPI 生成，CI 增加「生成物与提交物一致」检查。
- 表格首屏与翻页统一到同一套查询模型。

## Capabilities

### New Capabilities

- `admin/data-flow`: 管理端的数据一致性契约——写操作如何反馈、缓存如何失效、类型如何与后端保持一致。它规定的是行为（用户看到什么、多久看到、错了会怎样），不是组件实现。

### Modified Capabilities

（无。）

## Impact

**代码**

- `apps/admin-next/src/components/{users,orders,views/finance}/**` — 写操作改造
- `apps/admin-next/src/api/http.ts` — 保持现有韧性逻辑，只是调用方改为 mutation
- `apps/admin-next/src/lib/actions/*-revalidate.ts` — 与 mutation 的成功回调对接
- `apps/admin-next/src/type/types.ts` — 逐步替换为生成物
- 新增类型生成脚本与 CI 检查

**测试**

- 断网回滚用例（前端或 E2E）
- 缓存失效用例：写后列表与统计同步更新
- CI：后端改字段后前端类型检查失败

**不涉及**：blog 应用、表格组件重构、tRPC、信息架构调整。
