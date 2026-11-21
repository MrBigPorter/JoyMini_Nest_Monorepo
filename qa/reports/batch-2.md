# QA Report — Batch 2

> 依据：`docs/AI-joymini/120` §7 Batch 2；`118` §8.1 #4–5；`113` §9.1–9.2；`handoff/batch-2.md`
> 结论：**PASS**（首轮 `ef757859` 发现 D-B2-01 P1 + D-B2-02/03 P2；修复提交 `2347f3a5`，在 QA 提交 `31640c94` 上复验通过，见 §9）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 首轮提交 | `ef757859`（后端 `0f5f8b8b` + 前端 `db52a60a` + handoff） |
| 复验提交 | `31640c94`（含前端修复 `2347f3a5`；HEAD） |
| 范围 | 摄入派生、actionable/signal 分轨、from/to UTC 日界、updateTriage 原子派生、HUMAN score、质量页队列筛选/NO_ISSUE/一次一条/日期窗、首页今日计数 + 下钻、Insights signal 链接 |
| 产品代码改动 | 无（QA 只改 `qa/**` 与测试文件） |

## 2. 环境

沿用 Batch 1 的隔离 QA 环境：

| 资源 | 值 |
|---|---|
| Postgres | `lucky-db-qa`（pgvector/pg16）127.0.0.1:5433，库 `joy_mini_qa` |
| Redis | `lucky-redis-qa` 127.0.0.1:6382 / DB 15 |
| API | 127.0.0.1:4102（4100 仍被无关进程占用，见 Batch 1 报告） |
| Admin | 127.0.0.1:4101 |
| 种子 | `qa/seed/batch1.ts`（基线 9 条反馈 / 1 trace / 1 security）+ `qa/seed/batch2.ts`（`qa_b2_*` 11 条反馈 / 2 security） |
| 开关 | `AI_FEEDBACK_UI_ENABLED=true`、`AI_EVAL_ENABLED=true`、`NODE_ENV=test` |

**关键日期**：QA 运行时 UTC 今日 = `2026-11-20`；batch2 种子把 `yesterday_*` 放在 `2026-11-19`，用于日界验证。

## 3. 执行命令

```bash
# 基线（Batch 1 数据）
npx tsx qa/seed/batch1.ts
npx tsx qa/seed/batch2.ts --clean

# Batch 1 回归
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/batch1-permissions.e2e-spec.ts
cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts e2e-qa/navigation.spec.ts e2e-qa/drilldown.spec.ts \
  e2e-qa/insights.spec.ts e2e-qa/redaction.spec.ts --project=qa-chromium

# Batch 2 数据 + 用例
npx tsx qa/seed/batch2.ts
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/batch2-triage.e2e-spec.ts
cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts e2e-qa/batch2-triage.spec.ts --project=qa-chromium
```

证据：`qa/logs/batch2-batch1-api.log`、`qa/logs/batch2-batch1-playwright.log`、`qa/logs/batch2-api-e2e.log`、`qa/logs/batch2-playwright.log`、`qa/logs/batch2-reconciliation.log`、`qa/logs/batch2-sql-reconciliation.txt`。

## 4. 结果

| 套件 | 结果 |
|---|---|
| Batch 1 回归 API（24 cases） | **24 passed / 0 failed** |
| Batch 1 回归 Playwright（9 cases） | **8 passed / 1 failed**（唯一失败 = D-B2-01） |
| Batch 2 API e2e（18 cases） | **18 passed / 0 failed** |
| Batch 2 Playwright（4 cases） | **4 passed / 0 failed** |
| API typecheck | exit 0 |

### 4.1 Batch 2 API 用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| B2-01 | explicit correct | `NO_ISSUE` / `REVIEWED` / `failureKind=null` | 一致；`reviewedBy=null`（系统推断） | PASS |
| B2-02 | explicit incorrect | `MODEL_ERROR` / `OPEN` / `PENDING` | 一致；errorType 保留 | PASS |
| B2-03 | implicit `ai_error` | `SERVICE_ERROR` / `OPEN` | 一致 | PASS |
| B2-04 | implicit `explicit_request` | `EXPECTED_TRANSFER` / `EXCLUDED` / `IGNORED` | 一致 | PASS |
| B2-05 | implicit `abandoned` | `USER_ABANDONED` / `OPEN` | 一致 | PASS |
| B2-06 | implicit `repeated_question` | `REPEATED_QUESTION` / `OPEN` | 一致 | PASS |
| B2-07 | implicit `transferred` 无原因 | `UNKNOWN` / `OPEN` | 一致 | PASS |
| B2-08 | `queue=TODO` / `SIGNAL` 总数 | = 113 §9.1 SQL 计数 | TODO 10 / SIGNAL 6，list.length 同 | PASS |
| B2-09 | `queue=SIGNAL&signal=repeated_question` | 只返回该信号 | total 2，行均为 implicit/repeated | PASS |
| B2-10 | 认领信号（写 ownerAdminId） | 移出 SIGNAL、进入 TODO | 前后队列断言一致 | PASS |
| B2-11 | 今日 summary vs SQL | total/pending/signals 与 UTC 日界 SQL 相等 | 18 / 8 / 6 = SQL | PASS |
| B2-12 | from/to 日界 | 含 `00:00:00.000` 与 `23:59:59.999`，不含昨日 | 边界两行在内、昨日行在外 | PASS |
| B2-13 | 只给 reviewStatus | resolution 同步（REVIEWED→CONFIRMED） | 一致；reviewedBy 写入 | PASS |
| B2-14 | 只给 resolution | reviewStatus 同步（EXCLUDED→IGNORED），不写 score | 一致；HUMAN score 0 | PASS |
| B2-15 | verdict=correct | `NO_ISSUE` / `REVIEWED`，清空 failureKind | 一致 | PASS |
| B2-16 | 只改备注 / 只改 reviewStatus | 不新增 HUMAN score | 0 / 0 | PASS |
| B2-17 | 判定变化 | 恰好 1 条 HUMAN score；后续备注不新增 | 1 条，value=1 / stringValue=NO_ISSUE | PASS |
| B2-18 | 只改 failureKind | 写 1 条 HUMAN score | 1 条，stringValue=UNEXPECTED_TRANSFER | PASS |

> score 计数口径：`ai_scores WHERE source='HUMAN' AND metadata->>'feedbackId'=<feedbackId>`。

### 4.2 Batch 2 Playwright 用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| B2-UI-01 | 首页今日 feedback/security 计数 | 今日数 < 全量数；卡片显示今日值 | pending 8<10；SERVICE_ERROR 4<5；security 2/2<3/3；卡片一致 | PASS |
| B2-UI-02 | 质量页队列筛选 + 系统信号 KPI | KPI=summary；全部/TODO/SIGNAL 切换与总数一致；SIGNAL+signal 组合 | 全部 20 / TODO 10 / SIGNAL 6；repeated 2 | PASS |
| B2-UI-03 | 回答正确 | 行显示“无问题”，面板推进到下一条 | C 行“无问题”，面板显示 A；API `NO_ISSUE` | PASS |
| B2-UI-04 | 一次一条 A/B 不跳条 | 排除 A 后显示 B，A 不再出现在面板 | B 显示；A 面板内 0；API A=IGNORED，B=PENDING | PASS |

一次一条实际串行覆盖 C → A → B：C 完成“回答正确”后面板显示 A；随后 A 排除后显示 B。

### 4.3 Batch 1 回归

- API 24/24：更新了 Batch 2 语义下的 `summary.pending`（actionable=4，原 reviewStatus PENDING=7）与 `signals=3`；过滤列表 `reviewStatus=PENDING` 仍为 7。
- Playwright 8/9：navigation（含 D-04）、service-error 下钻、KPI 参数、Insights queue=SIGNAL、redaction 均通过。
- **唯一失败**：首页「待处理 4」下钻仍指向 `?reviewStatus=PENDING`，列表 16 条 → **D-B2-01（P1）**。

## 5. 数据对账

种子：batch1 基线 9 条 + batch2 `qa_b2_*` 11 条 = 20；security 1 + 2 = 3。

| 指标 | API | SQL | 结果 |
|---|---|---|---|
| 反馈总数 | 20 | 20 | PASS |
| actionable（全量） | 10 | 10 | PASS |
| signals（全量） | 6 | 6 | PASS |
| 今日 total | 18 | 18 | PASS |
| 今日 actionable | 8 | 8 | PASS |
| 今日 signals | 6 | 6 | PASS |
| SERVICE_ERROR（全量 / 今日） | 5 / 4 | 5 / 4 | PASS |
| security（全量 / 今日） | 3 / 2 | 3 / 2 | PASS |
| security NEW（全量 / 今日） | 3 / 2 | 3 / 2 | PASS |
| `queue=TODO` | 10 | 10 | PASS |
| `queue=SIGNAL` | 6 | 6 | PASS |
| `SIGNAL&signal=repeated_question` | 2 | 2 | PASS |
| `SIGNAL&signal=abandoned` | 2 | 2 | PASS |
| `SIGNAL&signal=transferred` | 1 | 1 | PASS（但与 Insights KPI 6 不一致，见 D-B2-02） |
| 首页待处理卡 | 8（今日） | 点击目标 `reviewStatus=PENDING` = 16 | **FAIL（D-B2-01）** |
| 首页服务故障卡 | 4（今日） | 点击目标 `failureKind=SERVICE_ERROR` = 5（全量） | 已知窗口限制（见 §7） |

原始输出（`qa/logs/batch2-reconciliation.log`、`qa/logs/batch2-sql-reconciliation.txt`）：

```text
summary all-time: total=20 pending=10 signals=6
summary today:    total=18 pending=8  signals=6
TODO=10  SIGNAL=6  SIGNAL&repeated=2  SIGNAL&abandoned=2  SIGNAL&transferred=1
security today=2 (NEW 2)  all=3 (NEW 3)
SQL: total=20 actionable=10 signals=6 service_error=5
```

## 6. 缺陷

Batch 2 首轮发现 **1 条 P1（阻断）** 与 2 条 P2；修复提交 `2347f3a5` 后全部复验通过：

| ID | 严重度 | 摘要 | 首轮阻断 | 复验 |
|---|---|---|---|---|
| D-B2-01 | **P1** | 首页「待处理」卡与提醒行显示 actionable 今日数（8），点击仍跳 `reviewStatus=PENDING`（16 条），下钻口径错 | **是** | **FIXED**（§9） |
| D-B2-02 | P2 | Insights「Transfer rate」KPI=6，点击 `queue=SIGNAL&signal=transferred` 只有 1；repeated/abandoned 一致（2/2） | 否 | **FIXED**（§9） |
| D-B2-03 | P2 | 前端 `RESOLUTION_VALUES` 缺 `NO_ISSUE`，选择「无问题」筛选会被 `parseFeedbackFilters` 丢弃 | 否 | **FIXED**（§9） |

详见 `qa/defects.md`。

## 7. 残留风险与未覆盖

1. **首页今日卡 vs 质量页全量列表（已知限制）**：首页卡按 UTC 今日；质量页 summary/list 没有日期选择器（handoff 已知限制 #1）。例如服务故障卡 4（今日）→ 列表 5（全量）。这不是新回归，但下钻数字仍不等；需在产品上明确“今日卡只做计数”还是补日期参数。
2. **Insights 日期窗**：D-B2-02 的队列口径已修复（链接不再带 `queue=SIGNAL`）；Insights 默认 7 天窗口，质量页 `signal=transferred` 不带 from/to。当前种子的 transferred 全部在 2 天内，KPI=列表=7；若存在更早数据，仍可能出现窗口差。链接若要严格对齐，应同时携带 Insights 的 from/to（后续项）。
3. **历史数据回填**：handoff 明确未执行；本次只测新写入路径。旧 `verdict=correct` / 旧 `transferred→UNEXPECTED_TRANSFER` 的存量行未验证。
4. **未覆盖**：LIVE eval、Runtime/Flows/Usage 写动作、多实例、故障注入、移动端、非 Chromium 浏览器、真实第三方模型/judge。
5. **端口**：API 仍使用 4102（4100 被无关进程占用），接线等价，已报告。

## 8. 结论

Batch 2 的**核心语义与 UI 行为全部通过**：

- 7 类摄入派生、actionable/signal 分轨、from/to UTC 日界、updateTriage 双向派生、correct→NO_ISSUE、score 只在判定变化时写，均通过真实 API + SQL 对账；
- 质量页全部/待办/系统信号筛选、日期窗、系统信号 KPI、回答正确显示“无问题”、C→A→B 不跳条、首页今日计数与下钻，均通过；
- Insights 三个链接与 KPI 口径一致并可筛选。

首轮的 **D-B2-01（P1）** 已在 `2347f3a5` 修复：首页「待处理」链接改为 `queue=TODO&from=<UTC today>&to=<UTC today>`，列表 total = 卡片数字（8），刷新保留；D-B2-02/03 也已修复。

**Batch 2：PASS**（复验提交 `31640c94`，含 `2347f3a5`）。无遗留阻塞项。

## 9. 复验记录 — D-B2-01/02/03（commit `31640c94`，含 `2347f3a5`）

**复验环境**：全新启动 QA（`colima start` → `bash qa/scripts/run-batch1.sh`）：Postgres 5433、Redis 6382、API 4102、Admin 4101。脚本先跑 Batch 1 基线回归，再 seed batch2 跑 Batch 2。

**命令**：

```bash
bash qa/scripts/run-batch1.sh
```

脚本内部顺序：

```bash
npx tsx qa/seed/batch1.ts && npx tsx qa/seed/batch2.ts --clean
# Batch 1 API + Playwright(navigation/drilldown/insights/redaction)
npx tsx qa/seed/batch2.ts
# Batch 2 API + Playwright(batch2-triage/insights)
npx tsx qa/seed/batch2.ts   # 复位为可复现种子
```

**结果**：

| 检查 | 期望 | 实际 | 结果 |
|---|---|---|---|
| Batch 1 API e2e | 24 passed | **24 passed** | PASS |
| Batch 1 Playwright（9 cases） | 全部通过 | **9 passed**（含曾失败的 pending 下钻） | PASS |
| Batch 2 API e2e | 18 passed | **18 passed** | PASS |
| Batch 2 Playwright（8 + insights 1） | 全部通过 | **9 passed** | PASS |
| 首页「待处理 N」→ URL | `queue=TODO&from=today&to=today`；列表=N；刷新保留 | VIEWER/ADMIN 均通过；today pending 8 → list 8；刷新保留 | PASS |
| 质量页日期输入 + queue TODO | 只含今天 actionable，昨天不出现 | today 8 < all 10；`qa_b2_fb_yesterday` 不在今日列表；KPI 链接保留日期 | PASS |
| `resolution=NO_ISSUE` | URL 参数保留并筛选 | `parseFeedbackFilters` 返回 `NO_ISSUE`；筛选 1 条，行显示“无问题” | PASS |
| Insights Transfer rate | 列表 total = KPI 口径 | KPI `feedback.transferred` = 7，列表 `signal=transferred` = 7（相等） | PASS |
| 回归 | 无 P0/P1 | D-B2-01/02/03 全部修复 | PASS |

> **关于 7 而非 6**：协调者预期 6 是按“今日”计；Insights 默认 7 天窗口包含 `qa_b2_fb_yesterday_service`（signal=transferred）。当前种子下 KPI 与列表均为 **7**，等式成立；今日窗口为 6。链接未携带 Insights 的 from/to，若未来有更早数据仍可能窗口不齐（见 §7 第 2 条，非阻塞）。

**证据**：
- `qa/logs/run-batch1-api.log`（24/24）
- `qa/logs/run-batch1-playwright.log`（9/9）
- `qa/logs/run-batch2-api.log`（18/18）
- `qa/logs/run-batch2-playwright.log`（9/9）
- `qa/logs/batch2-reverify-numbers.log`（today pending 8 / all 10 / TODO 8 / NO_ISSUE 1 / insights transferred 7 = list 7 / parse NO_ISSUE 生效）

**结论**：D-B2-01/02/03 均复验通过；Batch 2 PASS，无阻塞项。
