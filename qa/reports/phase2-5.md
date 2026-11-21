# QA Report — 119 Phase 2–5 (Clusters / Alerts / Fix Loop / Retention)

> 冻结提交 `50e7aaaf`（代码 `2a8fc31a`，handoff `batch-6-phase2-5.md`）；复验 `515ef779`（修复 `4cc2954a`）
> 结论：**PASS**（迁移审核 PASS；首轮 Phase 2–5 API 7/7、页面 3/3；复验 API **9/9**、页面 3/3；Batch 1/2/4/5 回归 24/18/9/9）。D-P25-01/02 已修复。

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 冻结提交 | `50e7aaaf`（代码 `2a8fc31a`）；复验 `515ef779`（`4cc2954a`） |
| 范围 | 问题簇、指标告警、修复闭环、保留清理、`/ai-ops/analysis` 页面、角色入口 |
| 产品代码改动 | 无（QA 只改 `qa/**` 与测试文件） |

## 2. 迁移审核 — PASS

文件：`apps/api/prisma/migrations/20261121160000_ai_problem_clusters_alerts/migration.sql`

```text
$ grep -inE '\b(drop|rename|truncate|alter|delete|update|insert)\b' migration.sql
NONE

$ grep -oE '^(CREATE [A-Z]+|ALTER|DROP|RENAME|TRUNCATE|DELETE|UPDATE|INSERT)' migration.sql | sort | uniq -c
   4 CREATE INDEX
   3 CREATE TABLE
   3 CREATE UNIQUE
```

- 仅 3 个 `CREATE TABLE` + 7 个索引，无 DROP/RENAME/ALTER/数据改写；
- 已 `prisma generate` + `prisma migrate deploy`（`129 migrations found`，应用成功）；
- 表已存在：`ai_problem_clusters`、`ai_problem_cluster_days`、`ai_analysis_alerts`；
- 部署时 QA Postgres 曾停止，`docker start lucky-db-qa lucky-redis-qa` 后成功；随后重启 API。

## 3. 命令

```bash
# 迁移
cd apps/api
set -a; . ../../qa/.env.qa; set +a
npx prisma generate --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
bash ../../qa/scripts/restart-api-env.sh

# API Phase 2–5
../../node_modules/.bin/jest --config ./test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/phase2-5.e2e-spec.ts

# 页面
cd ../admin-next
QA_ADMIN_URL=http://127.0.0.1:4101 QA_API_URL=http://127.0.0.1:4102/api \
  ../../node_modules/.bin/playwright test --config=playwright.qa.config.ts \
  e2e-qa/phase2-5.spec.ts

# 回归
npx tsx qa/seed/batch1.ts && npx jest ... batch1-permissions.e2e-spec.ts
npx tsx qa/seed/batch2.ts --clean && npx jest ... batch2-triage.e2e-spec.ts
npx jest ... batch4-eval.e2e-spec.ts
npx tsx qa/seed/batch5.ts && npx jest ... batch5-analysis.e2e-spec.ts
```

日志：`qa/logs/phase2-5-api.log`、`qa/logs/phase2-5-playwright.log`、`qa/logs/regression-batch{1,2,4,5}.log`。

## 4. 结果

| 套件 | 结果 |
|---|---|
| Phase 2–5 API（首轮 7 cases） | **7 passed / 0 failed** |
| Phase 2–5 API（复验 9 cases，含角色/404） | **9 passed / 0 failed** |
| Phase 2–5 页面（3 cases） | **3 passed / 0 failed** |
| Batch 1 权限 | 24/24 |
| Batch 2 triage | 18/18 |
| Batch 4 eval | 9/9 |
| Batch 5 analysis | 9/9 |

### 4.1 Phase 2 聚类 — PASS

种子（UTC `2026-12-20`）：7 条 trace（其中 1 条带 rag `sourceCount=0` 且 input 为同一问题的另一标点变体）；5 条同一问题的显式负反馈（大小写/标点/空格变体）；2 条另一问题；3 条无 input 的重复追问信号。

- 同一问题的 **6 条事件**（5 条 feedback + 1 条 trace ZERO_HIT，标点/大小写不同）归入 **1 个簇**，`count=6`，事件 `clusterId` 全部指向该簇；
- `ai_problem_cluster_days` 当天 `count=6`；
- 不同问题生成独立簇，`count=2`，簇 id 不同；
- 同窗口重跑：簇 `count` 仍 6、当天计数仍 6、事件仍 6 条（`(type, sourceId)` upsert，不翻倍）。

### 4.2 Phase 3 告警 — PASS

种子 4 天历史（`problem_rate` / `explicit_negative_rate` = 0.05，`repeat_rate` = 0.1）+ 当天样本 ≥5：

| 指标 | 当天值 | 基线 | severity |
|---|---|---|---|
| `problem_rate` | 11/7 | 0.05 | **HIGH** |
| `explicit_negative_rate` | 7/7 | 0.05 | **HIGH** |
| `repeat_rate` | 3/10 | 0.1 | **MEDIUM** |

- `GET /alerts?status=NEW` 返回上述告警；
- 低样本日（4 trace + 4 SERVICE_ERROR）不产生任何告警；
- `PATCH /alerts/:id/ack` → 200/`ACK`，从 NEW 列表消失、进入 ACK 列表。

### 4.3 Phase 4 修复闭环 — PASS

- `PATCH /clusters/:id` 设置 `status=ASSIGNED`、`ownerAdminId=qa_admin_admin`、`fixType=PROMPT`、`suggestedCause=MODEL`，响应与 DB 一致；
- `POST /clusters/:id/regression {datasetId, expected}`：
  - 新 `ai_eval_cases` 行：`question=簇代表问题`、`expected=期望答案`、`expect={mustMention:[expected]}`、`source='cluster'`、`metadata.clusterId=簇 id`；
  - 簇状态置 `FIXING`；
  - 空 `expected` → **400**。

### 4.4 Phase 5 保留 — PASS

插入 400 天前事件/run/簇日/告警与 10 天前同类型数据，直接调用 `AiAnalysisService.purgeExpired()`：

- 400 天前：事件、run、簇日、告警全部删除；
- 10 天前：四类数据全部保留；
- 阈值与 handoff 一致（事件/告警 180d、run 90d、簇日 365d）。

### 4.5 页面 `/ai-ops/analysis` — PASS

- ADMIN：页面 `<title>` 为「问题分析 / Problem Analysis」，无 `MISSING_MESSAGE`；问题簇表显示代表问题/条数/严重度/状态/修复类型；告警表显示指标/HIGH/MEDIUM/样本；
- 认领 → owner 显示 `qa_admin_admin`；
- 状态下拉 → `FIXING`，修复类型下拉 → `PROMPT`；
- 「建回归」弹出两次 prompt（目标评测集 ID、期望答案），成功后提示「已生成回归用例，问题簇进入修复中」，簇保持 FIXING；
- 告警「确认」→ 行从待确认列表消失；
- VIEWER/EDITOR：侧边栏无 `/ai-ops/analysis` 入口。

### 4.6 复验 `515ef779` / `4cc2954a` — PASS

| 项 | 结果 |
|---|---|
| EDITOR `clusters/alerts/metrics/events/runs` | 全部 **403** |
| ADMIN 同 5 个接口 | 全部 **200** |
| `/ai-ops/analysis` 页面标题 | 「问题分析 / Problem Analysis」；日志 `MISSING_MESSAGE` **0 条** |
| 不存在 cluster GET / PATCH | **404 / 404** |
| Phase 2–5 主流程（跑分析→簇→告警） | API **9/9**（新增角色与 404 用例） |
| 页面复跑 | **3/3** |

日志：`qa/logs/phase2-5-reverify-api.log`、`qa/logs/phase2-5-reverify-playwright.log`。

## 5. 缺陷

### D-P25-01 — 新页面缺 `aiOpsAnalysis` 翻译键（P3）— **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | P3（文案/日志；页面功能不受影响） |
| 状态 | **FIXED**，提交 `4cc2954a`（含于 `515ef779`）：六语言补齐 key |
| 复验 | 页面标题「问题分析 / Problem Analysis」；日志 `MISSING_MESSAGE` 0 条 |
| 位置 | `apps/admin-next/src/routes/index.ts` 路由名 `aiOpsAnalysis`；`src/i18n/{en,zh,ja,ko,fr,de}.json` 均无该 key |
| 现象 | 访问 `/ai-ops/analysis` 时服务端/客户端输出 `MISSING_MESSAGE: Could not resolve 'aiOpsAnalysis'`；面包屑/标题回退为 key |
| 证据 | `qa/logs/phase2-5-playwright.log`（WebServer 日志） |
| 建议 | 六个语言文件补 `aiOpsAnalysis`（如“问题分析”） |

### D-P25-02 — EDITOR 无入口但仍可读 analysis API（P3）— **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | P3（UI/API 角色一致性；只读聚合数据，无原始对话） |
| 状态 | **FIXED**，提交 `4cc2954a`：analysis 读接口改为 SUPER/ADMIN |
| 复验 | EDITOR 5 个读接口 403；ADMIN 200 |
| 位置 | `apps/admin-next/src/routes/index.ts`（analysis 对 EDITOR 隐藏）；`apps/api/src/admin/ai-analysis/ai-analysis.controller.ts`（GET 接口 `@Roles` 含 EDITOR） |
| 现象 | EDITOR `GET /clusters`、`/alerts`、`/metrics`、`/events`、`/runs` 均 200；VIEWER 同接口 403 |
| 证据 | 本报告 §6 的 curl 探测 |
| 判定 | 首轮不阻断验收；复验已按 ADMIN/SUPER 收紧 |

## 6. 补充探测

```text
EDITOR  GET /v1/admin/ai-analysis/clusters  403
EDITOR  GET /v1/admin/ai-analysis/alerts    403
EDITOR  GET /v1/admin/ai-analysis/metrics   403
EDITOR  GET /v1/admin/ai-analysis/events    403
EDITOR  GET /v1/admin/ai-analysis/runs      403
ADMIN   同上 5 个接口                        200
GET     /clusters/qa_p25_missing_cluster    404
PATCH   /clusters/qa_p25_missing_cluster    404
```

## 7. 测试侧调整（非产品缺陷）

- **Batch 5 断言更新**：Phase 2 按 handoff 有意在 `metadata.questionPreview` 保存“脱敏 + 200 字截断”的问题预览。Batch 5 原断言“事件 payload/DB 完全不出现种子文本”与这一新契约冲突；已将断言改为：
  - `metadata.questionPreview` 允许出现输入文本，但长度 ≤200；
  - `note` / trace `output` / eval `reason` / `lastMsgContent` 等原文仍不得出现；
  - 除 `metadata` 外的字段不得出现种子文本。
  这属于测试契约随新需求更新，不是产品回归。
- **Batch 5 seed 清理**：补充删除该窗口产生的 `ai_problem_clusters` / `ai_problem_cluster_days` / `ai_analysis_alerts`，避免跨批污染。

## 8. 残留 / 未覆盖

1. 聚类为精确/近精确签名，未验证同义改写合并（handoff 明确限制，需 embedding）。
2. 告警阈值为启发式；只验证 `ALL` 维度，未覆盖 `INTENT` 维度告警。
3. 保留直接调用 `purgeExpired()`，未等待 04:00 UTC cron，也未验证多实例并发。
4. 页面回归只跑 phase2-5 与 nav 相关，未跑前端全量（提交方已声明 356 通过）。
5. ~~`getCluster`/`updateCluster` 返回 400~~ 已在 `4cc2954a` 修为 404（复验通过）。
