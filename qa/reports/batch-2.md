# QA Report — Batch 2

> 依据：`docs/AI-joymini/120` §7 Batch 2；`118` §8.1 #4–5；`113` §9.1–9.2；`handoff/batch-2.md`
> 结论：**FAIL**（1 条 P1 下钻缺陷 D-B2-01；其余 Batch 2 验收项通过）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 冻结提交 | `ef757859`（后端 `0f5f8b8b` + 前端 `db52a60a` + handoff） |
| 范围 | 摄入派生、actionable/signal 分轨、from/to UTC 日界、updateTriage 原子派生、HUMAN score、质量页队列筛选/NO_ISSUE/一次一条、首页今日计数、Insights signal 链接 |
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

Batch 2 范围内发现 **1 条 P1（阻断）** 与 2 条 P2：

| ID | 严重度 | 摘要 | 阻断 Batch 2 |
|---|---|---|---|
| D-B2-01 | **P1** | 首页「待处理」卡与提醒行显示 actionable 今日数（8），点击仍跳 `reviewStatus=PENDING`（16 条），下钻口径错 | **是** |
| D-B2-02 | P2 | Insights「Transfer rate」KPI=6，点击 `queue=SIGNAL&signal=transferred` 只有 1；repeated/abandoned 一致（2/2） | 否 |
| D-B2-03 | P2 | 前端 `RESOLUTION_VALUES` 缺 `NO_ISSUE`，选择「无问题」筛选会被 `parseFeedbackFilters` 丢弃 | 否 |

详见 `qa/defects.md`。

## 7. 残留风险与未覆盖

1. **首页今日卡 vs 质量页全量列表（已知限制）**：首页卡按 UTC 今日；质量页 summary/list 没有日期选择器（handoff 已知限制 #1）。例如服务故障卡 4（今日）→ 列表 5（全量）。这不是新回归，但下钻数字仍不等；需在产品上明确“今日卡只做计数”还是补日期参数。
2. **Insights 数量一致性**：除 D-B2-02 的 transferred 外，质量页没有 from/to，Insights 的 7 天窗口与质量页全量仍不同；Batch 1 报告已把“数量对齐”列为后续项。
3. **历史数据回填**：handoff 明确未执行；本次只测新写入路径。旧 `verdict=correct` / 旧 `transferred→UNEXPECTED_TRANSFER` 的存量行未验证。
4. **未覆盖**：LIVE eval、Runtime/Flows/Usage 写动作、多实例、故障注入、移动端、非 Chromium 浏览器、真实第三方模型/judge。
5. **端口**：API 仍使用 4102（4100 被无关进程占用），接线等价，已报告。

## 8. 结论

Batch 2 的**核心语义与 UI 行为大部分通过**：

- 7 类摄入派生、actionable/signal 分轨、from/to UTC 日界、updateTriage 双向派生、correct→NO_ISSUE、score 只在判定变化时写，均通过真实 API + SQL 对账；
- 质量页全部/待办/系统信号筛选、系统信号 KPI、回答正确显示“无问题”、C→A→B 不跳条、首页今日计数，均通过；
- Insights 三个链接已带 `queue=SIGNAL&signal=...` 并可筛选。

但存在 **D-B2-01（P1）**：首页「待处理」卡的数字是新口径（今日 actionable=8），点击却仍落到旧口径 `reviewStatus=PENDING`（16 条）。这违反 118 #4/#5 的“待处理不含系统信号、下钻可信”。

**Batch 2：FAIL**。修复 D-B2-01（把首页提醒行/异常卡的 href 改为 `queue=TODO`，并决定是否补 from/to）后，只需复验该下钻 + Batch 2 UI 用例；D-B2-02/D-B2-03 可记录/延期。
