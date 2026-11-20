# Handoff — Batch 1

> 依据：`docs/AI-joymini/120-开发与集成测试分工及验收流程.md` §7 Batch 1
> 状态：Dev 完成，待 QA 在冻结提交上做真实后端集成测试

## 任务

- 118 #1：VIEWER 去原文；judge 去 VIEWER；Sidebar 隐藏整个工程组。
- 118 #2：质量页 URL 下钻、KPI 链接、Insights 参数。

## 分支与提交

- branch: `feat/ai-ops-operator-console`
- base: `a26794b4`（docs 提交之前）
- commits:
  - `de578ca5` feat(api): add viewer redaction helper and current-role decorator
  - `809a935f` feat(api): redact viewer raw text and deny viewer judge
  - `64cf90f2` feat(admin): hide engineering navigation for viewers
  - `04fe6c51` feat(admin): drive quality drill-down from URL and redact viewer text
  - `ac6ba927` test(admin): cover viewer navigation and KPI drill-down in mock e2e
- 冻结提交：以 QA 开始时 `git rev-parse HEAD` 为准；QA 只测这个提交。

## 改动文件

### 后端

- `apps/api/src/common/utils/data-masking.ts`：新增 `redactSensitiveFields`（VIEWER、大小写归一、数组/点路径、置 null）。
- `apps/api/src/common/decorators/user.decorator.ts`：新增 `CurrentRole`。
- `apps/api/src/admin/ai-traces/ai-traces.controller.ts`：列表/详情脱敏。
- `apps/api/src/admin/ai-feedback/ai-feedback.controller.ts`：列表脱敏。
- `apps/api/src/admin/chat/admin-chat.controller.ts`：会话列表、消息历史、SLA 队列脱敏。
- `apps/api/src/admin/ai-eval/ai-eval.controller.ts`：judge 去掉 VIEWER。
- 对应 controller specs。

### 前端

- `apps/admin-next/src/routes/index.ts`：`hiddenForRoles` + `getVisibleRoutes`。
- `apps/admin-next/src/components/layout/Sidebar.tsx`：按角色过滤。
- `apps/admin-next/src/lib/ai-ops-quality-filters.ts`：URL 解析/构建。
- `apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx`：URL 筛选、KPI 链接、信号筛选、清除、VIEWER 占位。
- `apps/admin-next/src/app/(dashboard)/ai-ops/insights/page.tsx`：三条链接带 signal。
- `apps/admin-next/src/app/(dashboard)/ai-ops/page.tsx`：待处理链接带 `reviewStatus=PENDING`。
- `apps/admin-next/src/app/(dashboard)/ai-ops/traces/page.tsx`、`support/page.tsx`：VIEWER 占位。
- `apps/admin-next/src/components/customer-service/MessageBubble.tsx`：`content == null` 占位。
- 对应单测与 mock e2e。

## 验收标准对照

| 标准 | 实现位置 | 自测 |
|---|---|---|
| VIEWER traces 无 input/output | `ai-traces.controller.ts` + helper | 单测通过 |
| VIEWER traces 详情 span 无 input/output/error | 同上 | 单测通过 |
| VIEWER feedback 无 input/answer | `ai-feedback.controller.ts` | 单测通过 |
| VIEWER SLA 无 lastMessage | `admin-chat.controller.ts` | 单测通过 |
| VIEWER 聊天无 lastMsgContent/content/meta | 同上 | 单测通过 |
| judge 对 VIEWER 403 | `ai-eval.controller.ts` | 元数据单测通过 |
| VIEWER 导航无工程组 | `routes/index.ts` + Sidebar | 单测 + mock e2e 通过 |
| 质量页读 URL 参数 | `quality/page.tsx` + filter helper | 单测通过 |
| KPI 链接带参 | `quality/page.tsx` | 单测 + mock e2e 通过 |
| Insights 三条链接带 signal | `insights/page.tsx` | 单测通过 |
| 刷新保留筛选 | URL 为唯一来源 | mock e2e 通过 |
| 清除筛选 | `quality/page.tsx` | 单测通过 |

## 自测证据

```text
API 全量：88 suites / 717 tests passed
API typecheck：exit 0
前端全量：55 files / 342 tests passed
前端 typecheck：exit 0
前端 build：exit 0（/ai-ops/quality 动态路由正常）
Mock e2e：VIEWER 导航 + KPI 下钻 2 passed
```

## 开关与环境

- 无迁移、无数据写入。
- 读取接口不依赖 `AI_FEEDBACK_UI_ENABLED`；写接口仍依赖。
- `AI_EVAL_ENABLED` / `NODE_ENV=development` 仍控制 eval 写入口。
- QA 环境按 120：`joy_mini_qa`、Redis DB 15、API 4100、Admin 4101、`qa_*` 账号。

## 已知限制

1. **Insights 数量一致性**：Insights 按日期窗口，质量页 Batch 2 才有 `from/to`；Batch 1 只验收链接参数正确。
2. **Eval 读接口残留**：`/admin/ai-eval/datasets/:id`、`/runs/:id` 仍向 VIEWER 返回 question/answer/actualAnswer；按计划留给 Batch 4，QA 报告需记录。
3. **EDITOR 工程导航**：本次只对 VIEWER 隐藏；EDITOR 仍可见部分工程页，属既有问题，未扩大。
4. **Mock e2e 不是后端证据**：`ai-ops-smoke` 全部拦截 `/api`；后端接线以 QA 真实 API 为准。
5. **聊天消息置空**：VIEWER 打开客服工作台会看到占位文案；媒体消息不会再拼 URL。

## QA 待办

- 搭 `qa/.env.qa`、`qa/compose.qa.yml`、`qa/seed/batch1.ts`。
- 加 `test:e2e:ai-ops` 脚本，只跑 `test/ai-ops`，避开损坏的 `operation-log.e2e-spec.ts`。
- 4 角色权限矩阵：traces / feedback / SLA / chat / judge / context。
- 真实 Playwright：VIEWER 导航、URL 筛选、KPI 点击、刷新/后退。
- SQL 对账：卡片数字 = `SERVICE_ERROR` / `PENDING` / `ADDED_TO_EVAL` 计数。
- 输出 `qa/reports/batch-1.md` 与 `qa/defects.md`。

## 回滚

- 无迁移，可按提交独立 revert。
- judge 恢复 `Role.VIEWER` 即回滚权限变更。
- 前端可退回 mount-only URL 解析（会失去同路由 KPI 自动同步）。
