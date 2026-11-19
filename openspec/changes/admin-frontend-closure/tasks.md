# Tasks

## 1. 类型契约

- [x] 1.1 用已提交的 `apps/swagger-docs/swagger-spec.json` 作为类型源；验证：文件存在且能被脚本读取（不启动后端）
- [x] 1.2 新增 `scripts/generate-api-types.mjs`，用 `openapi-typescript` 产出 `src/type/generated-api.d.ts`；验证：生成文件可被 `tsc` 引用，且文件头标注 generated
- [x] 1.3 替换结构完全一致的类型（当前为 `Tokens` → `AdminTokenPairDto`）；其余重叠留到页面迁移时映射（见 design D4）；验证：`tsc` 0 error
- [x] 1.4 `ci.yml` 的 check job 增加「重新生成 + `git diff --exit-code src/type/generated-api.d.ts`」；验证：手改生成物后 CI 失败并指出差异
- [x] 1.5 文档记录生成流程（含 `export:swagger:full` 刷新 spec 的人工步骤，并说明 CI 不校验 spec 新鲜度）；验证：按文档从零跑一次可复现

## 2. 用户管理页

- [x] 2.1 写操作改为 `useMutation` 并实现 `onMutate` 乐观更新；同页重叠类型按 design D4 做 DTO→视图模型映射；验证：断网提交后界面先变、随后回滚
- [x] 2.2 `onSuccess` 对接 `revalidateTag` 与本地 refetch；验证：写后列表与首页统计同步
- [x] 2.3 `onError` 展示可理解的提示；验证：服务端拒绝时提示正确且状态回退

## 3. 订单列表页

- [x] 3.1 同上，覆盖状态变更类写操作；同页重叠类型按 design D4 做映射；验证：断网与服务端拒绝两条路径
- [x] 3.2 确认失效范围精确；验证：修改订单后其它页面不重新请求（看网络面板）

## 4. 财务审核页

- [x] 4.1 写操作改为 `useMutation`，但**不做乐观更新**（资金操作保守）；同页重叠类型按 design D4 做映射；验证：提交后保持处理中态，成功后才更新
- [x] 4.2 失败必须明确展示且不改变列表状态；验证：构造失败，列表保持原样并提示

## 5. 查询模型统一

- [x] 5.1 三个页面所用表格的取数改为 `useQuery`，首屏用注水数据；验证：首屏无额外请求
- [x] 5.2 翻页与筛选走同一查询模型；验证：翻到第 3 页刷新后状态完整恢复
- [x] 5.3 首屏预取失败降级；验证：断掉服务端预取，页面仍可客户端加载

## 6. 验证与文档

- [x] 6.1 三个页面各跑一次端到端检查（断网、服务端错误、成功三条路径）；验证：九条路径结果符合规格
- [x] 6.2 记录首屏性能数据，确认无退化；验证：LCP 与改动前对比无显著上升（[报告](../../../docs/read/performance/ADMIN_FRONTEND_CLOSURE_LCP_AB_CN.md)）
- [x] 6.3 更新开发文档说明新的写操作模式；验证：文档含一个可复制的范例

## Workflow follow-up

- 满足评审后归档：`openspec archive admin-frontend-closure`
- 归档后确认 `openspec/specs/admin/data-flow/spec.md` 生成
