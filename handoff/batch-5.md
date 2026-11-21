# Handoff — Batch 5

> 依据：`docs/AI-joymini/119` Phase 1；`120` §7 Batch 5
> 状态：Dev 完成，待 QA 真实后端验证

## 任务

119 Phase 1：问题事件 + 时间窗指标 + 分析任务记录 + 管理页；不做聚类/告警/修复闭环。

## 提交

- `4be75eaf` feat(api): add phase 1 problem event analysis
- `7aaeda85` feat(admin): add problem analysis page

## 数据模型

新增三张表（`apps/api/prisma/migrations/20261121130000_ai_problem_analysis`）：

- `ai_problem_events`：标准化事件，唯一键 `(type, source_id)`。
- `ai_metric_windows`：指标窗口，唯一键 `(window_start, window_type, metric, dimension, dimension_value)`。
- `ai_analysis_runs`：任务记录，唯一键 `(job_type, window_start)`。

> 迁移 SQL 是从 QA 库 `prisma migrate diff` 生成后**人工剔除**了无关的 DropTable（LangGraph checkpoint 表）和 DropIndex/RenameIndex，只保留三张新表及索引。QA `migrate deploy` 前请确认没有额外破坏性语句。

## 行为

- `POST /admin/ai-analysis/runs { date?: 'YYYY-MM-DD' }`（SUPER/ADMIN）：
  - 以 UTC 日窗口构建事件；
  - 事件来源：feedback、trace（ERROR / RAG sourceCount=0）、eval unsolved（有期望）、security NEW；
  - 写入指标：`problem_rate`、`service_error_rate`、`zero_hit_rate`、`explicit_negative_rate`、`repeat_rate`（ALL + INTENT 维度）；
  - 幂等：同窗口重跑 upsert 事件、覆盖指标；
  - Postgres advisory lock 防并发；
  - 每天 02:00 UTC 自动跑前一天。
- `GET /admin/ai-analysis/runs`
- `GET /admin/ai-analysis/metrics?date=`
- `GET /admin/ai-analysis/events?date=&type=&page=&pageSize=`
- 页面 `/ai-ops/analysis`（工程组，VIEWER 隐藏）：日期、运行、任务表、指标表、事件表。

## 自测

```text
API 全量：89 suites / 735 tests passed
API typecheck：exit 0
前端 typecheck：exit 0
路由/Sidebar 单测：13 passed
```

## 已知限制

1. **无聚类**：Phase 2；没有 `ai_problem_clusters` 表。
2. **规则事件**：没有 `UNCITED_RAG`、`COST_SPIKE`、`UNEXPECTED_TRANSFER` 的自动确认（只取已确认 failureKind）。
3. 指标分母用 `ai_trace` 数量（AI 回复数）；不是所有消息都有 trace。
4. 事件按 sourceId 去重；同一会话的 feedback + trace error 可能各产生一条（只在 trace 与 feedback traceId 匹配时跳过 trace error）。
5. 没有 retention/分区；Phase 5。
6. cron 是单进程 + DB advisory lock；多实例下锁可用，但任务仍由抢到锁的实例执行。
7. 页面没有趋势图，只做 Phase 1 表格。

## QA 重点

- 在 QA 库执行新迁移（`prisma migrate deploy`），确认只新增三张表。
- 用 Batch 1–4 种子 + 新增 Batch 5 种子跑 `POST /runs`：
  - 事件类型/数量正确；
  - `problem_rate = events / traces`，`service_error_rate`、`zero_hit_rate`、`repeat_rate` 分子分母正确；
  - INTENT 维度存在；
  - 同窗口重跑事件/指标数量不变；
  - 非法 date 400；VIEWER 403；
  - 页面 `/ai-ops/analysis` 显示任务/指标/事件，VIEWER 导航不可见。
- 任务失败可见：临时让某表不可用或模拟异常，断言 run FAILED + error。
