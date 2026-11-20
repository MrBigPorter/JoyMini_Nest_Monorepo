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

# Batch 2 — 缺陷（commit `ef757859`）

> Batch 2 API 18/18、Playwright 4/4 通过；Batch 1 回归 8/9，唯一失败即 D-B2-01。

## D-B2-01 — 首页「待处理」卡/提醒行数量是新口径，下钻仍是旧 `reviewStatus=PENDING`

| 项 | 内容 |
|---|---|
| 严重度 | **P1（阻断）** |
| 状态 | OPEN（QA 只记录，未修） |
| 位置 | `apps/admin-next/src/app/(dashboard)/ai-ops/page.tsx:314`（提醒行）与 `:483`（异常卡）：`href="/ai-ops/quality?reviewStatus=PENDING"` |
| 影响 | 卡片/提醒行数字 = `summary.pending`（113 §9.1 actionable，UTC 今日），但点击进入的列表按旧 `reviewStatus=PENDING` 过滤，包含系统信号等非待办；数字与列表不一致，运营无法从“待处理 8”得到 8 条待办 |

**复现**（batch1 + batch2 种子，UTC 今日 `2026-11-20`）：

```text
GET /v1/admin/ai-feedback/summary?from=2026-11-20&to=2026-11-20
  -> pending = 8                       # 卡片显示 8
GET /v1/admin/ai-feedback?reviewStatus=PENDING&pageSize=100
  -> total = 16                        # 点击后的列表

Playwright:
  card[data-testid="anomaly-pending-feedback"] 显示 8
  click -> /ai-ops/quality/?reviewStatus=PENDING
  quality list -> 共 16 条
```

**期望**：href 改为 `?queue=TODO`（与质量页 KPI 一致，全量 10）或带 `from/to` 的 TODO（今日 8）；至少必须使用 113 §9.1 的 actionable 口径，而不是 `reviewStatus=PENDING`。
**实际**：`reviewStatus=PENDING`。
**证据**：`qa/logs/batch2-batch1-playwright.log`（Expected `/queue=TODO/`，Received `/quality/?reviewStatus=PENDING`；1 failed / 8 passed）；`qa/logs/batch2-reconciliation.log`。
**备注**：即使改为 `queue=TODO`，首页（今日 8）与质量页（全量 10）仍有窗口差，见 Batch 2 报告 §7 已知限制。

## D-B2-02 — Insights「Transfer rate」KPI 与 SIGNAL 队列下钻数量不一致

| 项 | 内容 |
|---|---|
| 严重度 | P2（指标下钻不一致；非本批阻断） |
| 状态 | OPEN |
| 位置 | `apps/admin-next/src/app/(dashboard)/ai-ops/insights/page.tsx`（链接 `queue=SIGNAL&signal=transferred`）；`apps/api/src/admin/ai-insights/ai-insights.service.ts`（统计所有 implicit `signal='transferred'`） |
| 影响 | Insights KPI 显示 6，点击后质量页 SIGNAL 队列只有 1 条；运营会认为数据丢失 |

**复现**（batch1 + batch2 种子，UTC 今日）：

```text
GET /v1/admin/ai-insights/overview?from=2026-11-20&to=2026-11-20
  -> feedback.transferred = 6
GET /v1/admin/ai-feedback?queue=SIGNAL&signal=transferred&pageSize=100
  -> total = 1

# 对照：repeated_question 2 = 2；abandoned 2 = 2
```

**原因**：Insights 统计所有 `source='implicit' AND signal='transferred'`，包含 `SERVICE_ERROR`（4 条）与 `EXPECTED_TRANSFER/EXCLUDED`（1 条）；SIGNAL 队列按 113 §9.1 排除 `SERVICE_ERROR` 和 `EXCLUDED`，只剩 `UNKNOWN` 1 条。
**期望**：KPI 与下钻使用同一口径（例如 Insights 也排除 SERVICE_ERROR/EXCLUDED），或在页面上明确“KPI 是原始信号数，下钻是待处理信号”。
**证据**：`qa/logs/batch2-reconciliation.log`（insights feedback + queue totals）；`qa/logs/batch2-batch1-playwright.log`（Insights 用例通过，但只对账同 query 的 list total）。

## D-B2-03 — 前端缺少 `NO_ISSUE`，选择“无问题”筛选会被静默丢弃

| 项 | 内容 |
|---|---|
| 严重度 | P2（非关键筛选） |
| 状态 | OPEN |
| 位置 | `apps/admin-next/src/lib/ai-ops-quality-filters.ts` 的 `RESOLUTION_VALUES` 未包含 `NO_ISSUE`；`quality/page.tsx` 的 `RESOLUTION_LABELS` 已包含 `NO_ISSUE`，因此下拉框会出现“无问题” |
| 影响 | 用户选择“无问题”后 URL 写入 `resolution=NO_ISSUE`，但 `parseFeedbackFilters` 不认该值并清空，筛选不生效 |

**复现**：

```text
$ npx tsx -e "import {parseFeedbackFilters} from './apps/admin-next/src/lib/ai-ops-quality-filters'; \
  console.log(JSON.stringify(parseFeedbackFilters('resolution=NO_ISSUE')))"
{"reviewStatus":"","failureKind":"","resolution":"","signal":"","queue":""}
```

**期望**：`RESOLUTION_VALUES` 增加 `NO_ISSUE`，与表格/下拉框标签一致。
**实际**：值被丢成空字符串。
**证据**：上条命令输出；源码 `ai-ops-quality-filters.ts` 的 `RESOLUTION_VALUES`。

## Batch 2 已知限制（非新缺陷）

- **首页今日 vs 质量页全量**：首页卡按 UTC 今日；质量页 summary/list 无日期选择器（handoff 已知限制 #1）。服务故障卡今日 4 → 列表全量 5。属已知窗口差，需产品决定是否补 `from/to`。
- **历史回填未执行**：handoff 明确本批只测新写入路径；旧 `verdict=correct`、旧 `transferred` 存量未验证。
