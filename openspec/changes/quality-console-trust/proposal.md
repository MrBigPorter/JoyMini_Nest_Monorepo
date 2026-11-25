# Proposal — 质量台信任层

## Why

运营今天无法信任页面给出的任何成功提示：`withRetry` 把 403 静默吞成 `undefined`，`AI_EVAL_ENABLED` 关闭时「创建评测集」「导入用例」仍提示成功但一条没写；质检主流程「跳过」实际跳回第 1 条、归因被固定 `UNKNOWN` 覆盖、备注用 `window.prompt` 且可重复提交；批量排除并发 20 个 PATCH 撞限流后只报数量；「加入回归」默认选中只读 harness 数据集并按题干字符串反查用例。这些不是边缘问题，它们直接破坏运营的日常路径，并让页面对四类使用者的承诺（运营队列、质量发布决策、研发定位、管理趋势）无法成立。

本 change 只做页面信任层与两个服务端接口，不改执行链路；失败语义与数据正确性由 `eval-run-integrity` 与 `eval-console-ops` 负责。

## What Changes

- 新增 capability `admin-ai/quality-console`，立 6 条 Requirement：如实呈现失败/禁用/未知、角色视图与决策对应、质检卡片可跳过且归因不被覆盖、分诊提交防重复且备注可选、质检证据可追溯、分页在总量缩水后回退。
- `admin-ai/quality-loop` 新增 1 条：批量排除必须逐条反馈结果（一次服务端批量接口，返回成功 id 与跳过原因）。
- 新增两个接口：`POST /v1/admin/ai-feedback/:id/regression-case`（事务 + advisory lock，幂等）与 `PATCH /v1/admin/ai-feedback/batch-exclude`（单次 ≤50，逐条结果）。
- **BREAKING**（前端行为）：403 不再被当作成功；无权限或开关关闭时不渲染写入口。

## Capabilities

### New Capabilities

- `admin-ai/quality-console`: 管理端质量台的信任层契约——状态如实呈现、角色视图、质检交互、证据追溯、分页回退。

### Modified Capabilities

- `admin-ai/quality-loop`: 新增「批量排除必须逐条反馈结果」，规定批量接口的单次上限与返回结构。

## Impact

- 影响：`apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx`、`apps/admin-next/src/api/http.ts`、`apps/admin-next/src/api/index.ts`、`apps/admin-next/src/api/types.ts`、`apps/admin-next/src/utils/ai-ops-eval.ts`、`apps/api/src/common/ai/ai-feedback.controller.ts`/`ai-feedback.service.ts`。
- 前端测试：`AiQuality.test.tsx`、`ai-ops-quality-filters.test.ts`、`ai-ops-smoke`。
- 不改变读接口字段；新增接口只服务页面两个动作。
