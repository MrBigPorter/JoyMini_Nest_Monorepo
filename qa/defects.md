# Defects — Batch 1

> 被测提交：`998bb043fca133dbdc61cfa09f7fddd43e1d7508`
> 说明：Batch 1 验收范围内没有失败的验收用例（API 24/24、Playwright 8/8）。以下为 QA 过程中发现的**非阻断**问题；按任务要求只记录，不修产品代码。
>
> 首次 Playwright 运行有 1 条失败，原因是 QA 选择器未考虑项目 `trailingSlash: true`（真实 href 为 `/ai-ops/runtime/`、`/ai-ops/quality/?...`）。这是测试代码问题，已在 QA 侧修正，**不是产品缺陷**，不计入下表。

## D-01 — VIEWER 仍可读取评测集用例原文

| 项 | 内容 |
|---|---|
| 严重度 | P1（隐私/权限），但**明确延后到 Batch 4**，不计入 Batch 1 阻断 |
| 来源 | `handoff/batch-1.md` 已知限制 #2；`118` §8.1 #1 “Eval 数据集/结果的原文留给 Batch 4” |
| 位置 | `apps/api/src/admin/ai-eval/ai-eval.controller.ts`（`GET datasets/:id`、`GET runs/:id` 的 `@Roles` 含 VIEWER）；`ai-eval-dataset.service.ts` `getDataset`/`getRun` 未脱敏 |
| 影响 | VIEWER 可通过接口读取评测用例的 `question/answer`、运行结果的 `actualAnswer`，与 118 P0-1 的“VIEWER 去原文”目标不一致 |

**复现**（QA 库，已清理探针数据）：

```text
# ADMIN 创建评测集并加一条用例
POST /api/v1/admin/ai-eval/datasets            -> 200  {id: cmwpc0ebg...}
POST /api/v1/admin/ai-eval/datasets/<id>/cases -> 200

# VIEWER 读取详情
GET  /api/v1/admin/ai-eval/datasets/<id>       -> 200
data.cases[0] = {
  "question": "qa_eval_question_secret",
  "answer":   "qa_eval_answer_secret",
  ...
}
```

**期望**：VIEWER 的 eval 数据集/结果读接口应脱敏（或不对 VIEWER 开放）。
**实际**：原文完整返回。
**证据**：本次 QA 终端输出（dataset id `cmwpc0ebg0008w7l9cbj7o7oc`）；探针数据已通过 `DELETE FROM ai_eval_datasets WHERE name LIKE 'qa\_%'` 清理，QA 种子清理逻辑也已补上该表。
**建议**：按 118 计划在 Batch 4 处理；若在 Batch 1 合并前要求零原文暴露，需提前修复。

## D-02 — EDITOR 能看到工程导航，但 Traces 等接口对 EDITOR 返回 403

| 项 | 内容 |
|---|---|
| 严重度 | P2（既有问题，未由本批扩大；UI/API 权限不一致） |
| 来源 | `handoff/batch-1.md` 已知限制 #3 |
| 位置 | `apps/admin-next/src/routes/index.ts:193,200`（`hiddenForRoles: ['VIEWER']`，EDITOR 不隐藏）；`apps/api/src/admin/ai-traces/ai-traces.controller.ts`（`@Roles(SUPER_ADMIN, ADMIN, VIEWER)`，不含 EDITOR） |
| 影响 | EDITOR 在侧边栏看到「链路追踪」等入口，点进去调用 API 得到 403，页面显示加载失败 |

**复现**：

```text
# EDITOR JWT
GET /api/v1/admin/ai-traces -> 403

# 路由配置：工程组仅对 VIEWER 隐藏
routes/index.ts:193  hiddenForRoles: ['VIEWER']
routes/index.ts:200  hiddenForRoles: ['VIEWER']   # 其余工程路由同样只有 VIEWER
```

**期望**：导航可见性与接口可访问性一致（要么 EDITOR 可见且可读，要么对 EDITOR 也隐藏）。
**实际**：导航可见、接口 403。
**证据**：上条 curl 与源码行号。
**建议**：Batch 2/4 统一各角色的工程页权限；本批只要求 VIEWER，故不阻断。

## D-03 — VIEWER 首页「快速入口」仍展示工程页链接 — **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | P2（一致性；118 #1 只要求 Sidebar 隐藏，故不阻断） |
| 状态 | **FIXED**，提交 `5dd97bed`（父 `998bb043`） |
| 位置 | `apps/admin-next/src/app/(dashboard)/ai-ops/page.tsx`「快速入口」区块 |
| 原问题 | Sidebar 已对 VIEWER 隐藏工程组，但首页「快速入口」仍提供 `AI Runtime / 流程版本 / 用量与成本 / 客户记忆 / 安全事件`，隐藏只是单点 |
| 修复 | 「快速入口」改用 `getVisibleRoutes(role)` 过滤；VIEWER 只保留质量待办 / 转人工队列 / 运营洞察 |

**复验命令**（QA 环境：admin 4101、API 4102）：

```bash
cd apps/admin-next
QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 QA_API_URL=http://127.0.0.1:4102/api \
  ../../node_modules/.bin/playwright test --config=playwright.qa.config.ts \
  e2e-qa/navigation.spec.ts --project=qa-chromium --reporter=list
```

**复验结果（PASS）**：

```text
✓ VIEWER navigation  sidebar hides ...                       (1.9s)
✓ ADMIN navigation   sidebar shows the engineering group ...  (1.5s)
✓ SUPER_ADMIN navigation ...                                  (1.4s)
3 passed (5.7s)
```

- VIEWER「快速入口」= 3 个链接，恰好 `quality/support/insights`，engineering 0。
- ADMIN / SUPER_ADMIN「快速入口」= 8 个，含 `runtime/flows/usage/memory/security`。
- 证据：`qa/logs/d03-reverify.log`、`qa/logs/d03-viewer-ssr.html`、`qa/reports/batch-1.md` §9。

## D-04 — 快速入口之外，首页运维卡片仍向 VIEWER 链接工程页 — **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | P2/P3（一致性；独立于 D-03 的快速入口，非 Batch 1 验收项） |
| 状态 | **FIXED**，提交 `08eb6a7b`（父 `5dd97bed`） |
| 位置 | `apps/admin-next/src/app/(dashboard)/ai-ops/page.tsx`：StatCard「AI 队列等待 / AI 死信 / Outbox 失败 / RAG 向量队列」、「今日 Token」、AnomalyCard「安全事件」、提醒行「安全待处理」 |
| 原问题 | D-03 修复后，VIEWER 首页仍可通过数据卡片/异常卡进入 runtime/usage/security 工程页（SSR 中 runtime×4、usage×1、security×1） |
| 修复 | `engineeringVisible` 统一控制：VIEWER 的上述 StatCard 变为无链接（`href=undefined`），安全异常卡变为 `<div>`，安全提醒行不再注入；ADMIN/SUPER 保持原链接 |

**复验命令**（QA 环境：admin 4101、API 4102；仅跑导航 spec + SSR）：

```bash
# SSR
curl -H "Cookie: auth_token=<VIEWER JWT>" http://127.0.0.1:4101/ai-ops/ \
  | grep -oE 'href="/ai-ops/[a-z-]+/?"' | sort | uniq -c

# Playwright
cd apps/admin-next
QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 QA_API_URL=http://127.0.0.1:4102/api \
  ../../node_modules/.bin/playwright test --config=playwright.qa.config.ts \
  e2e-qa/navigation.spec.ts --project=qa-chromium --reporter=list
```

**复验结果（PASS）**：

```text
# VIEWER SSR: 所有 /ai-ops 链接
2 href="/ai-ops/insights/"
2 href="/ai-ops/quality/"
4 href="/ai-ops/support/"
# 工程链接计数：0

# Playwright
3 passed (5.9s)
✓ VIEWER      无工程 href；统计卡显示数值但不可点；安全卡显示 1 / 1；安全提醒行不渲染
✓ ADMIN       统计卡/安全卡/安全提醒行仍链接 /ai-ops/{runtime,usage,security}
✓ SUPER_ADMIN 同上
```

关键断言（见 `apps/admin-next/e2e-qa/navigation.spec.ts`）：

- VIEWER 页面级 `a[href^="/ai-ops/{runtime,flows,usage,memory,security}"]` 数量 = 0；
- 「AI 队列等待 / AI 死信 / Outbox 失败 / 今日 Token（UTC） / RAG 向量队列」仍可见且含数字，但根节点不是 `<a>`；
- 「安全事件（NEW / 总数）」卡显示 `1 / 1`，根节点不是 `<a>`；
- VIEWER 的「安全待处理」提醒行不渲染（代码用 `engineeringVisible && ...` 直接不注入）；
- ADMIN/SUPER 五个统计卡的 `href` 分别为 runtime×4、usage×1，安全卡/提醒行为 `/ai-ops/security/`。

**测试数据**：为覆盖安全提醒行，`qa/seed/batch1.ts` 增加 1 条 `qa_security_1`（`NEW`）；清理逻辑按 `qa_` 前缀删除，不碰真实安全事件。

**证据**：`qa/logs/d04-reverify.log`、`qa/logs/d04-viewer-ssr.html`、`qa/logs/d04-admin-ssr.html`、`qa/logs/d04-super-ssr.html`、`qa/reports/batch-1.md` §10。

**残留**：VIEWER 页面已无任何 `runtime/flows/usage/memory/security` href；`traces/context` 仅存在于 Sidebar（VIEWER 已隐藏）。未发现其它工程 href 残留。

---

## 附：非缺陷但需注意

- `apps/api/src/main.ts` 启动日志写 `Health → /api/health`，真实健康路由为 `/api/v1/health`（`/api/health` 返回 404）。仅影响运维脚本提示，与本批无关，未单列缺陷。

---

# Batch 2 — 缺陷（首轮 `ef757859`；复验 `31640c94`，含修复 `2347f3a5`）

> 首轮：Batch 2 API 18/18、Playwright 4/4；Batch 1 回归 8/9（唯一失败 D-B2-01）。
> 复验：Batch 1 API 24/24、Batch 1 Playwright 9/9、Batch 2 API 18/18、Batch 2 Playwright 9/9；D-B2-01/02/03 全部 **FIXED**。

## D-B2-01 — 首页「待处理」卡/提醒行数量是新口径，下钻仍是旧 `reviewStatus=PENDING` — **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | **P1（首轮阻断）** |
| 状态 | **FIXED**，提交 `2347f3a5`（复验 `31640c94`） |
| 位置 | `apps/admin-next/src/app/(dashboard)/ai-ops/page.tsx:314`（提醒行）与 `:483`（异常卡） |
| 首轮问题 | 卡片/提醒行数字 = `summary.pending`（113 §9.1 actionable，UTC 今日 8），点击仍按旧 `reviewStatus=PENDING` 过滤（16 条），数字与列表不一致 |
| 修复 | href 改为 `/ai-ops/quality?queue=TODO&from=<UTC today>&to=<UTC today>` |

**首轮复现**（`ef757859`）：

```text
GET /v1/admin/ai-feedback/summary?from=2026-11-20&to=2026-11-20 -> pending = 8
GET /v1/admin/ai-feedback?reviewStatus=PENDING&pageSize=100      -> total = 16

Playwright: card 显示 8 -> click -> /ai-ops/quality/?reviewStatus=PENDING -> 共 16 条
```

**复验（PASS）**：

```text
VIEWER / ADMIN: card 「待处理」 = today pending 8
click -> /ai-ops/quality/?queue=TODO&from=2026-11-20&to=2026-11-20
list total = 8; 刷新后 URL 与 total 保留
```

**证据**：`qa/logs/run-batch1-playwright.log`（Batch 1 9/9，含原失败用例）；`qa/logs/run-batch2-playwright.log`（Batch 2 8/8 含 VIEWER/ADMIN 下钻）；`qa/logs/batch2-reverify-numbers.log`（today pending 8 / TODO 8）。

## D-B2-02 — Insights「Transfer rate」KPI 与 SIGNAL 队列下钻数量不一致 — **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | P2（首轮非阻断） |
| 状态 | **FIXED**，提交 `2347f3a5` |
| 位置 | `apps/admin-next/src/app/(dashboard)/ai-ops/insights/page.tsx` |
| 首轮问题 | 链接 `queue=SIGNAL&signal=transferred` 会排除 SERVICE_ERROR/EXCLUDED，与 KPI（统计所有 implicit transferred）不一致：KPI 6，列表 1 |
| 修复 | Transfer rate 链接改为 `?signal=transferred`（不带 queue），与 KPI 的总体口径一致 |

**复验（PASS）**：

```text
GET /v1/admin/ai-insights/overview
  -> feedback.transferred = 7
GET /v1/admin/ai-feedback?signal=transferred&pageSize=100
  -> total = 7
```

> 7 而非 6：Insights 默认 7 天窗口包含 `qa_b2_fb_yesterday_service`（signal=transferred）；今日窗口为 6。当前种子下 KPI 与列表相等。链接仍未携带 Insights 的 from/to，存在更早数据时可能出现窗口差（非阻塞，见报告 §7）。

**证据**：`qa/logs/run-batch2-playwright.log`（insights 用例 9/9 的一部分，动态断言列表 total = `overview.feedback.transferred`）；`qa/logs/batch2-reverify-numbers.log`。

## D-B2-03 — 前端缺少 `NO_ISSUE`，选择“无问题”筛选会被静默丢弃 — **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | P2（首轮非阻断） |
| 状态 | **FIXED**，提交 `2347f3a5` |
| 位置 | `apps/admin-next/src/lib/ai-ops-quality-filters.ts` 的 `RESOLUTION_VALUES` |
| 首轮问题 | 下拉框有“无问题”，但 `parseFeedbackFilters('resolution=NO_ISSUE')` 返回空，筛选不生效 |
| 修复 | `RESOLUTION_VALUES` 增加 `NO_ISSUE`（同时新增 from/to 解析） |

**复验（PASS）**：

```text
$ npx tsx -e "...parseFeedbackFilters('resolution=NO_ISSUE')..."
{"reviewStatus":"","failureKind":"","resolution":"NO_ISSUE","signal":"","queue":"","from":"","to":""}

Playwright: 处理状态筛选 NO_ISSUE -> URL 保留 -> 共 1 条，行处理状态 = 无问题
```

**证据**：`qa/logs/batch2-reverify-numbers.log`（parse 输出）；`qa/logs/run-batch2-playwright.log`（resolution=NO_ISSUE 用例）。

## Batch 2 已知限制（非新缺陷）

- **首页今日 vs 质量页全量**：首页卡按 UTC 今日；质量页 summary/list 无日期选择器（handoff 已知限制 #1）。服务故障卡今日 4 → 列表全量 5。属已知窗口差，需产品决定是否补 `from/to`。
- **历史回填未执行**：handoff 明确本批只测新写入路径；旧 `verdict=correct`、旧 `transferred` 存量未验证。

---

# Batch 3 — 缺陷（commit `fa18bfb1`）

> 阶段 A（flags on）API 8/8、阶段 B（flags off）API 5/5、UI flags true 1/1、flags false 1/1。**无 P0/P1/P2 缺陷**。

## D-B3-01 — 质量页在 features 请求失败时 fail-open（P3，代码审查观察，未触发）

| 项 | 内容 |
|---|---|
| 严重度 | P3（韧性/一致性；非阻断） |
| 状态 | OPEN（观察；QA 只记录） |
| 位置 | `apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx`：`const feedbackUiEnabled = featuresData?.feedbackUiEnabled !== false;` |
| 问题 | `/admin/ai-ops/features` 请求失败时 `featuresData` 为 undefined，表达式结果为 `true`，ADMIN/SUPER 仍会看到「开始质检 / 确认问题 / 排除」；点击后写接口会 403。ChatWindow 使用 `?? false`（fail-closed），两处行为不一致 |
| 影响 | features 接口故障时，质量页展示不可用按钮；不会造成写越权（后端 403 仍是边界），但 UX 与“未启用”语义冲突 |
| 期望 | 与 ChatWindow 一致 fail-closed（未知即禁用），或显示“开关状态未知/加载失败” |
| 证据 | 代码审查；本批 API 正常（true/false 均覆盖），未注入 features 接口故障，**未触发** |
| 建议 | 后续把默认值改为 `=== true`，或区分 loading/error/disabled 三态 |

## Batch 3 已知限制 / 未覆盖（非新缺陷）

- **真实 chatStream SSE 全链路未跑**：依赖外部 LLM/embedding/RAG。`trace aiMessageId` 与 `security conversationId` 用生产方法的**最小复现**验证（`recordReplyTrace`、`createIntentRouterNode`），日志有插入证据；`ai-stream.handler` 的 `conversationId` 注入与 chatStream 传 `triggerMessageId` 为代码审查，不是端到端证据。
- **`recordErrorTrace` 未写 `aiMessageId`**（handoff 已知限制 #1）。
- **`testChat` / LIVE eval 仍不写 trace**，eval traceId 留 Batch 4（handoff #2）。
- **历史反馈/安全事件未回填** `traceId` / `conversationId`（handoff #3）。
- **`AiFeedbackClient` 旧页面仍读 `NEXT_PUBLIC_AI_FEEDBACK_UI_ENABLED`**（`/ai-feedback` 导出桩，非 AI Ops 主路径；handoff #4）。
- **EDITOR 工程导航/接口不一致（D-02）**未处理（既有问题）。

---

# Batch 4 — 缺陷（首轮 `b67a3cbb`；复验 `2561806f`）

> 首轮：API 8/9（1 failed = D-B4-01）、Playwright 3/3。复验：API **9/9**、Playwright **3/3**；D-B4-01 **FIXED**。

## D-B4-01 — 字符串 `expected` 仍被判定为空期望（P1）— **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | **P1（首轮阻断）** |
| 状态 | **FIXED**，提交 `2561806f`（HEAD） |
| 位置 | `apps/api/src/admin/ai-eval/ai-eval-dataset.service.ts`：`resolveExpectation()` / `hasKeys()` |
| 首轮问题 | `EvalCaseDto.expected` 类型为 `string \| Record`，但 `hasKeys` 只接受对象；非空字符串 `expected` 被忽略，`startRun` 仍返回 400 |
| 修复 | 非空字符串 `expected` → `{ mustMention: [expected.trim()] }`（新增单测） |

**首轮复现**（`b67a3cbb`）：

```text
POST /admin/ai-eval/datasets/:id/cases
  {"cases":[{"question":"q","answer":"a","expect":{},"expected":"must mention 7 days"}]}  -> 201
POST /admin/ai-eval/datasets/:id/runs                                                     -> 400
  "1 case(s) have no expectation; add expect.mustMention or expected before running"
```

**复验（PASS，`2561806f`）**：

```text
POST /admin/ai-eval/datasets/:id/cases
  {"cases":[{"question":"qa_b4_string_q","answer":"qa_b4_answer","expect":{},"expected":"must mention 7 days"}]}  -> 201
POST /admin/ai-eval/datasets/:id/runs -> 201
GET  /admin/ai-eval/runs/:id          -> COMPLETED

# 对象 expected / expect.mustMention 路径未回归，仍 201 + COMPLETED
```

**证据**：`qa/logs/batch4-reverify-api.log`（9/9）、`qa/logs/batch4-reverify-playwright.log`（3/3）；首轮 `qa/logs/batch4-api-e2e.log`。
**备注**：Batch 4 UI 的“加入回归 / 编辑期望”同时发 `expect.mustMention` 与 `expected`，首轮 UI 即 3/3 通过。

## Batch 4 已知限制 / 未覆盖（非新缺陷）

- **LIVE 用本地 chat stub**：`AiEvalResult.traceId`/`AiScore.traceId=null` 已验证；真实模型质量/超时/provider 行为未覆盖。
- **并发锁是应用层检查**：单实例通过；多实例极端并发仍可能双通过（handoff #5）。
- **孤儿回收惰性触发**：仅在 list/get/start 时执行，无独立 cron；无人访问的 RUNNING 不会在 5 分钟内自动变化（本批验收按“调用 list/get 后”通过）。
- **历史悬空 `AiEvalResult.traceId` 未清理**（handoff #3）。
- **用例硬删除**级联删除 results（handoff #4）。

---

# Batch 5 — 缺陷（首轮 `2c5fc116`；复验 `0bcdcc80`）

> 迁移安全审核：**PASS**（仅 3 张新表 + 索引，无任何 DROP/RENAME/ALTER/TRUNCATE）。
> 首轮：API 7/8（D-B5-01）、Playwright 2/2。复验：API **9/9**、Playwright **2/2**；D-B5-01/02 **FIXED**。

## D-B5-01 — advisory lock 泄漏，同窗口重跑 409（P1）— **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | **P1（首轮阻断）** |
| 状态 | **FIXED**，提交 `0bcdcc80`（HEAD） |
| 位置 | `apps/api/src/admin/ai-analysis/ai-analysis.service.ts` |
| 首轮问题 | `pg_try_advisory_lock` / `pg_advisory_unlock` 是 session 级；Prisma `$queryRaw` 两次调用可能使用池内不同连接，unlock 成为 no-op，锁泄漏 |
| 修复 | 改用 `RedisLockService.runWithLock`：Redis `SET NX PX`（30min）+ UUID + compare-and-delete Lua；锁占用抛 `Lock busy` → 409；key=`ai:analysis:<windowStart ISO>` |

**首轮复现**（`2c5fc116`）：

```text
POST /admin/ai-analysis/runs {"date":"2026-11-18"} -> 201 COMPLETED (8 events)
POST /admin/ai-analysis/runs {"date":"2026-11-18"} -> 409 "Another analysis run is in progress"
```

**复验（PASS，`0bcdcc80`）**：

```text
run 1: HTTP 201 COMPLETED events=8
run 2: HTTP 201 COMPLETED events=8
metrics=7, events=8, analysis_runs=1；Redis key PTTL after runs = -2 (released)
并发：500 events 首跑持锁；第二个请求 409；PTTL ∈ (0,1800000]；结束后释放
```

**证据**：`qa/logs/batch5-reverify-api.log`（9/9）、`qa/logs/batch5-reverify-numbers.log`；首轮 `qa/logs/batch5-api-e2e.log`。

## D-B5-02 — `zero_hit_rate` 分母使用全部 trace（P2）— **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | P2（首轮指标口径） |
| 状态 | **FIXED**，提交 `0bcdcc80` |
| 位置 | `ai-analysis.service.ts` `collectMetrics()` |
| 首轮问题 | 119 §7.1 要求 `ZERO_HIT / 需要知识的请求`；实现用全部 AI trace（1/4=0.25） |
| 修复 | 分母改为窗口内有 `rag` span 的 trace 数（1/3=0.3333） |

**复验（PASS）**：

```text
seed: ZERO_HIT=1；有 RAG span 的 trace=3
zero_hit_rate ALL = 1 / 3 = 0.3333；problem_rate 仍 8/4=2
页面显示 33.3% / 1 / 3
```

**证据**：`qa/logs/batch5-reverify-api.log`（B5-05）、`qa/logs/batch5-reverify-numbers.log`。

## Batch 5 已知限制 / 未覆盖（非新缺陷）

- **无聚类/告警/修复闭环**：Phase 1 范围；`ai_problem_clusters` 留给 Phase 2。
- **失败模拟使用 QA trigger**：验证“持久化异常 → run FAILED + error”；未注入真实表不可用。
- **连续 7 天/小时窗口**未覆盖：只验证固定 UTC 日窗口与日级 cron 代码路径。
- **多实例未实测**：Redis `SET NX PX` 锁语义可跨实例，但本批单 API 进程。
- **页面无趋势图**（handoff #7）。
