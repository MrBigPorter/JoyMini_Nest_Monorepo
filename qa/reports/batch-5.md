# QA Report — Batch 5（119 Phase 1）

> 依据：`docs/AI-joymini/120` §7 Batch 5；`119` Phase 1；`handoff/batch-5.md`
> 结论：**PASS**（首轮 `2c5fc116` 发现 D-B5-01 P1 + D-B5-02 P2；修复 `0bcdcc80` 后 API 9/9、UI 2/2，见 §9）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 首轮提交 | `2c5fc116`（后端 `4be75eaf`、前端 `7aaeda85`、handoff） |
| 复验提交 | `0bcdcc80`（Redis 锁 + zero-hit 分母修复；HEAD） |
| 范围 | 三张新表迁移；事件构建（feedback/trace/eval/security）；5 个指标；幂等重跑；Redis 并发锁/TTL；角色/日期校验；分析页；失败可见 |
| 产品代码改动 | 无（QA 只改 `qa/**` 与测试文件） |

## 2. 迁移安全审核（先做）

**结论：安全，已 deploy。** 审核文件：`apps/api/prisma/migrations/20261121130000_ai_problem_analysis/migration.sql`。

```text
$ grep -inE '\b(drop|rename|alter|truncate|delete|update|insert)\b' migration.sql
NONE

$ grep -oE '^(CREATE TABLE|CREATE (UNIQUE )?INDEX)' migration.sql | sort | uniq -c
   6 CREATE INDEX
   3 CREATE TABLE
   3 CREATE UNIQUE INDEX
```

- 仅创建 `ai_problem_events`、`ai_metric_windows`、`ai_analysis_runs` 及索引；
- **没有** `DROP TABLE checkpoint_*`、`DROP INDEX idx_document_chunks_embedding_hnsw`、RenameIndex 或任何 ALTER/DROP；
- QA 库 `prisma migrate deploy` 成功，三张表存在。

```bash
cd apps/api
export DATABASE_URL='postgresql://lucky:lucky_qa_pw@127.0.0.1:5433/joy_mini_qa?schema=public'
npx prisma generate --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
# Applying migration `20261121130000_ai_problem_analysis` -> All migrations applied.
```

## 3. 环境与种子

隔离 QA：Postgres `lucky-db-qa` 5433 / `joy_mini_qa`，Redis 6382/DB15，API 4102，Admin 4101。
窗口：`QA_BATCH5_DATE=2026-11-18`（UTC），seed 见 `qa/seed/batch5.ts`：

- traces=4（ERROR 1、ZERO_HIT 1、正常 2）；conversations=2；
- feedback=4（explicit incorrect、SERVICE_ERROR、repeated_question、abandoned）；
- eval unsolved 1（case 有 expected）；security NEW 1；
- 原文标记 `qa_b5_secret_*` 仅存在于源表，用于断言事件不含原文。

## 4. 执行命令

```bash
npx tsx qa/seed/batch5.ts
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/batch5-analysis.e2e-spec.ts
cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts e2e-qa/batch5-analysis.spec.ts --project=qa-chromium
```

> API 套件在 D-B5-01 之后通过 `qa/scripts/restart-api.sh` 重启 API 以清掉泄漏的 advisory lock，继续验证其余项；这不改变产品缺陷本身。

## 5. 结果

| 套件 | 结果 |
|---|---|
| API e2e（9 cases） | **9 passed / 0 failed**（复验 `0bcdcc80`） |
| Playwright（2 cases） | **2 passed / 0 failed** |

### 5.1 API 用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| B5-01 | 主窗口运行 | COMPLETED；8 events | COMPLETED；processed/createdEvents=8 | PASS |
| B5-02 | 事件类型/数量 | 8：SERVICE_ERROR 2、EXPLICIT_NEGATIVE 1、REPEATED 1、ABANDONED 1、ZERO_HIT 1、EVAL_UNSOLVED 1、SECURITY_HIT 1 | 一致 | PASS |
| B5-03 | 事件不含原文 | 无 `qa_b5_secret` | API + DB 均无 | PASS |
| B5-04 | 事件过滤/分页 | type=SERVICE_ERROR=2；pageSize=2 返回 2 条、total 8 | 一致 | PASS |
| B5-05 | 指标 ALL | problem 8/4=2、service 2/4=0.5、zero 1/3=0.3333、explicit 1/4=0.25、repeat 1/2=0.5 | 一致；sampleSize=denominator | PASS |
| B5-06 | 指标 INTENT | order 1/2=0.5、rag 1/2=0.5 | 一致 | PASS |
| B5-07 | **同窗口重跑（不重启）** | 201，events/metrics 不变 | **两次均 201/COMPLETED；8 events / 7 metrics** | PASS（`0bcdcc80` 修复后） |
| B5-08 | API 重启后重跑 | 201；8 events / 7 metrics / 1 run | 一致（upsert/覆盖正确） | PASS |
| B5-09 | 非法 date | 400 | 400 | PASS |
| B5-10 | 角色 | VIEWER POST/GET 403；EDITOR GET 200、POST 403；ADMIN GET 200 | 一致 | PASS |
| B5-11 | 失败可见 | run FAILED；`error` 有值 | trigger 模拟异常；FAILED + `qa simulated analysis failure` | PASS |
| B5-12 | Redis 并发锁/TTL | 并发一个 201、一个 409；key 存在且 TTL≈30min；结束后释放 | 500 events 首跑持锁；PTTL ∈ (0,1800000]；第二个 409；结束后 PTTL=-2 | PASS |

### 5.2 Playwright 用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| B5-UI-01 | `/ai-ops/analysis`（ADMIN） | 显示任务/指标/事件；指标与分子分母正确；含 INTENT；可运行 | 7 指标、8 事件、INTENT:order/rag、200.0% / 8 / 4 等；运行成功“分析完成：8 条事件”；失败任务列显示原因 | PASS |
| B5-UI-02 | VIEWER 导航 | Sidebar 无 `/ai-ops/analysis` | 0 | PASS |

## 6. 缺陷

### D-B5-01 — advisory lock 泄漏，同窗口重跑 409（P1）— **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | **P1（首轮阻断）** |
| 状态 | **FIXED**，提交 `0bcdcc80`（HEAD） |
| 位置 | `apps/api/src/admin/ai-analysis/ai-analysis.service.ts` |
| 首轮影响 | 第一次运行后 `pg_advisory_unlock` 可能在 Prisma 连接池的另一条连接上执行，原连接仍持有 session 级 advisory lock；第二次同窗口 `POST /runs` 409；cron 也会被锁住直到重启 |
| 修复 | 改用项目已有 `RedisLockService.runWithLock(key, 30min, callback, true)`：Redis `SET NX PX` + UUID value + compare-and-delete Lua；锁占用抛 `Lock busy` → 409；key 为 `ai:analysis:<windowStart ISO>` |

**首轮复现**（`2c5fc116`）：

```text
POST /admin/ai-analysis/runs {"date":"2026-11-18"} -> 201 COMPLETED, 8 events
POST /admin/ai-analysis/runs {"date":"2026-11-18"} -> 409 "Another analysis run is in progress"
```

**复验（PASS，`0bcdcc80`）**：

```text
run 1: HTTP 201 COMPLETED events=8
run 2: HTTP 201 COMPLETED events=8
metrics=7, events=8, analysis_runs=1
Redis key PTTL after runs: -2 (released)
并发：500 events 首跑持锁，第二个请求 409；PTTL ∈ (0, 1800000]；结束后释放
```

**证据**：`qa/logs/batch5-reverify-api.log`（9/9）、`qa/logs/batch5-reverify-numbers.log`；首轮 `qa/logs/batch5-api-e2e.log`。
**修复实现**：`RedisLockService` 使用 NX + 30 分钟 TTL + compare-and-delete（Lua），不再跨 Prisma 连接泄漏。

### D-B5-02 — `zero_hit_rate` 分母使用全部 trace（P2）— **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | P2（首轮指标口径） |
| 状态 | **FIXED**，提交 `0bcdcc80` |
| 位置 | `ai-analysis.service.ts` `collectMetrics()` |
| 首轮问题 | 119 §7.1 定义 `ZERO_HIT / 需要知识的请求`；实现用全部 trace：1/4=0.25 |
| 修复 | 分母改为窗口内有 `rag` span 的 trace 数（`spans: { some: { type: 'rag' } }`） |

**复验（PASS）**：

```text
seed: ZERO_HIT=1；有 RAG span 的 trace=3（zero/ok1/ok2）
zero_hit_rate = 1 / 3 = 0.3333（sampleSize=3）
problem_rate 分母仍为全部 trace=4（8/4=2）
```

**证据**：`qa/logs/batch5-reverify-api.log`（B5-05）、`qa/logs/batch5-reverify-numbers.log`；页面显示 33.3% / 1 / 3。

## 7. 残留风险与未覆盖

1. **无聚类/无告警/无修复闭环**：Phase 1 范围，Phase 2 再做。
2. **失败模拟使用 QA trigger**：验证的是“持久化异常 → run FAILED + error”路径；未注入真实 DB/表不可用。
3. **连续 7 天/小时窗口**未覆盖：本批只验证一个固定 UTC 日窗口与日级 cron 的代码路径。
4. **多实例未实测**：Redis `SET NX PX` 锁语义可跨实例，但本批只跑单 API 进程。
5. **页面无趋势图**：Phase 1 只做表格（handoff 已知限制 #7）。

## 8. 结论

Batch 5 的迁移、事件构建、指标计算、Redis 并发锁/TTL、幂等重跑、角色/日期校验、分析页与失败可见性全部通过；迁移安全审核确认无破坏性语句。

首轮的 **D-B5-01（P1）** 已通过 Redis 锁修复：同窗口连续两次 `POST /runs` 均 201/COMPLETED，events=8/metrics=7 不变；并发时一个执行、另一个 409，锁 key TTL≈30min 且结束后释放。**D-B5-02** 已修复：zero_hit_rate 分母改为有 RAG span 的 trace 数（1/3）。

**Batch 5：PASS。** 无遗留阻塞项。

## 9. 复验记录 — D-B5-01/02（commit `0bcdcc80`）

**环境**：QA API 4102 重启到 `0bcdcc80`；Redis Lock Client connected（DB15）。迁移已在上一轮安全 deploy。

**命令**：

```bash
# 重启 API（qa/.env.qa）
bash qa/scripts/restart-api.sh
# 确认 Redis 锁服务日志
grep "Redis Lock Client connected" qa/logs/api.log

# 全量 API e2e
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/batch5-analysis.e2e-spec.ts

# 页面
cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts e2e-qa/batch5-analysis.spec.ts --project=qa-chromium
```

**结果**：

| 检查 | 首轮 `2c5fc116` | 复验 `0bcdcc80` |
|---|---|---|
| API e2e | 7 passed / 1 failed | **9 passed / 0 failed** |
| 同窗口连续两次 `POST /runs` | 第二次 409 | **两次 201/COMPLETED；8 events / 7 metrics 不变** |
| 并发两请求 | — | **一个 201、一个 409；PTTL ∈ (0,1800000]；结束后 -2** |
| zero_hit_rate | 1/4=0.25 | **1/3=0.3333** |
| Playwright | 2 passed | **2 passed** |
| 页面 `/ai-ops/analysis` | 正常 | 正常（零命中率 33.3% / 1 / 3） |

**证据**：`qa/logs/batch5-reverify-api.log`（9/9）、`qa/logs/batch5-reverify-playwright.log`（2/2）、`qa/logs/batch5-reverify-numbers.log`。

**结论**：D-B5-01/02 均复验通过；Batch 5 PASS，无阻塞项。
