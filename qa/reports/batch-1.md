# QA Report — Batch 1

> 依据：`docs/AI-joymini/120-开发与集成测试分工及验收流程.md` §5 / §7 Batch 1 / §8；`118` §5.1 P0-1、§8.1 #1–2；`handoff/batch-1.md`
> 结论：**PASS**（Batch 1 验收范围内无 P0/P1；3 条非阻断观察见 `qa/defects.md`）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 冻结提交 | `998bb043fca133dbdc61cfa09f7fddd43e1d7508` |
| 被测范围 | 118 #1（VIEWER 去原文 / judge 去 VIEWER / Sidebar 隐藏工程组）、118 #2（质量页 URL 下钻 / KPI 链接 / Insights 参数） |
| 产品代码改动 | 无（QA 只新增 `qa/**`、`apps/api/test/ai-ops/**`、`apps/admin-next/e2e-qa/**`、两个配置/脚本文件） |

## 2. 环境

隔离资源，未触碰开发库 `joy_mini` 或开发 Redis DB 0。

| 资源 | 开发 | QA（本次） |
|---|---|---|
| Postgres | `lucky-db`（端口 55435） | `lucky-db-qa`（`pgvector/pgvector:pg16`，127.0.0.1:5433），库 `joy_mini_qa` |
| Redis | `lucky-redis`（6381）/ DB 0 | `lucky-redis-qa`（127.0.0.1:6382）/ 逻辑 DB 15 |
| API | 4000 | **4102**（见下方偏差说明） |
| Admin | 4001 | 4101 |
| Judge stub | — | 4199（OpenAI 兼容本地桩） |
| 账号 | 开发测试号 | `qa_admin_{viewer,editor,admin,super}` |
| 开关 | 开发值 | `AI_FEEDBACK_UI_ENABLED=true`、`AI_EVAL_ENABLED=true`、`NODE_ENV=test` |

**端口偏差（已报告，不静默跳过）**：任务建议 API 用 4100。QA 开始时 4100 已被另一个与本任务无关的进程占用：

```text
$ lsof -nP -iTCP:4100 -sTCP:LISTEN
COMMAND   PID   USER   FD   TYPE ...
node    76821 porter   12u  IPv6 ... TCP *:4100 (LISTEN)
$ ps -p 76821 -o command
node -e require('http').createServer(...).listen(4100,...)   # 非本项目 API
```

为避免干扰其他工作，QA API 使用 4102；除端口外接线完全一致（同一 `main.ts`、全局前缀 `/api`、URI 版本 `v1`、同一套守卫/拦截器/异常过滤器）。Admin 通过 `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4102/api` 指向。

迁移只从冻结提交执行：

```text
$ cd apps/api && npx prisma migrate deploy --schema prisma/schema.prisma
All migrations have been successfully applied.
```

种子：`qa/seed/batch1.ts`（Prisma，非 SQL dump；所有 id/name 以 `qa_` 开头，可 `--clean`）。清理顺序覆盖 span/trace/feedback/message/conversation/admin/eval-dataset，不删除非 `qa_` 数据。

## 3. 执行命令

```bash
# 数据服务
docker compose -f qa/compose.qa.yml up -d

# 迁移 + 种子（DATABASE_URL 指向 joy_mini_qa）
cd apps/api && npx prisma migrate deploy --schema prisma/schema.prisma
npx tsx qa/seed/batch1.ts

# judge 桩 + API（qa/.env.qa）
node qa/scripts/judge-stub.mjs
cd apps/api && ../../node_modules/.bin/nest start        # 127.0.0.1:4102

# API 契约 e2e（真实 HTTP，24 cases）
yarn workspace @lucky/api test:e2e:ai-ops

# 真实 Playwright（无 API mock，8 cases）
cd apps/admin-next
QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 QA_API_URL=http://127.0.0.1:4102/api \
  ../../node_modules/.bin/playwright test --config=playwright.qa.config.ts --project=qa-chromium

# SQL 对账
docker exec lucky-db-qa psql -U lucky -d joy_mini_qa -c "SELECT ... FROM ai_answer_feedback;"
```

一键复跑：`bash qa/scripts/run-batch1.sh`；停止：`bash qa/scripts/run-batch1.sh --stop`。

证据文件：

- `qa/logs/api-e2e.log` — 24/24 passed
- `qa/logs/playwright.log` — 8/8 passed
- `qa/logs/sql-reconciliation.txt` — SQL 计数
- `qa/reports/playwright-report/` — HTML 报告（失败时含 trace/video/screenshot）
- `qa/logs/api.log`、`qa/logs/admin.log` — 服务日志

## 4. 结果

| 套件 | 结果 |
|---|---|
| API 契约 e2e（真实 HTTP + QA DB/Redis） | **24 passed / 0 failed** |
| 真实 Playwright（真实 admin 4101 + 真实 API 4102，无 mock） | **8 passed / 0 failed** |
| API typecheck（`yarn workspace @lucky/api tsc --noEmit`） | exit 0 |
| `operation-log.e2e-spec.ts` | 未运行（按任务要求避开已知损坏套件） |

### 4.1 API 契约用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| A01 | VIEWER `GET /admin/ai-traces` | 200；`list[].input/output` 为 null | 200；全部 null | PASS |
| A02 | ADMIN / SUPER `GET /admin/ai-traces` | 200；原文可见 | `qa_trace_input_secret` / `qa_trace_output_secret` | PASS |
| A03 | EDITOR `GET /admin/ai-traces` | 403 | 403 | PASS |
| A04 | VIEWER `GET /admin/ai-traces/:id` | 200；`spans[].input/output/error` 为 null | 200；全部 null | PASS |
| A05 | ADMIN `GET /admin/ai-traces/:id` | span 原文可见 | `{qa:"span_input_secret"}` 等 | PASS |
| A06 | VIEWER `GET /admin/ai-feedback` | 200；`input/answer` 为 null | 9 条均 null | PASS |
| A07 | ADMIN `GET /admin/ai-feedback` | 原文可见 | `qa_user_question_secret_1` / `qa_ai_answer_secret_1` | PASS |
| A08 | EDITOR `GET /admin/ai-feedback` | 403 | 403 | PASS |
| A09 | VIEWER `GET /admin/ai-feedback/summary` | 200；仅聚合数 | total 9 / pending 7 | PASS |
| A10 | VIEWER `GET /admin/chat/conversations` | 200；`lastMsgContent` 为 null | 2 条均 null | PASS |
| A11 | ADMIN / EDITOR 会话列表 | 原文可见 | `qa_last_message_secret_1` | PASS |
| A12 | VIEWER `GET /admin/chat/conversations/:id/messages` | 200；`content/meta` 为 null | 2 条均 null | PASS |
| A13 | ADMIN 消息历史 | 原文可见 | `qa_ai_answer_secret_1` / meta 对象 | PASS |
| A14 | VIEWER `GET /admin/chat/sla/queue` | 200；`items[].lastMessage` 为 null | null | PASS |
| A15 | ADMIN SLA 队列 | 原文可见 | `qa_sla_last_message_secret` | PASS |
| A16 | EDITOR SLA 队列 | 403 | 403 | PASS |
| A17 | VIEWER `POST /admin/ai-eval/judge` | 403 | 403 | PASS |
| A18 | EDITOR `POST /admin/ai-eval/judge` | 403 | 403 | PASS |
| A19 | ADMIN / SUPER `POST /admin/ai-eval/judge` | 通过角色门禁 | 200；stub 返回 `solved`，`vendorIndependent=true` | PASS |
| A20 | VIEWER `GET /admin/ai-context/:id` | 403 | 403 | PASS |
| A21 | EDITOR `GET /admin/ai-context/:id` | 403 | 403 | PASS |
| A22 | ADMIN / SUPER `GET /admin/ai-context/:id` | 通过角色门禁 | 200 | PASS |
| A23 | summary 数字 vs SQL | 相等 | SERVICE_ERROR 3 / PENDING 7 / ADDED_TO_EVAL 2 | PASS |
| A24 | 过滤列表 total vs SQL | 相等 | 3 / 7 / 2，`list.length` 同 | PASS |

judge 使用本地 OpenAI 兼容桩（`qa/scripts/judge-stub.mjs`，`AI_EVAL_JUDGE_BASE_URL=http://127.0.0.1:4199/v1`），`NODE_ENV=test` 使同厂 judge 分支关闭，未向任何第三方发出真实用户数据。

### 4.2 真实 Playwright 用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| U01 | VIEWER 侧边栏 | 无 `AI Operations · 工程`，无 runtime/flows/usage/memory/security/context/traces 链接 | 组与 7 个链接均 0 | PASS |
| U02 | ADMIN 侧边栏 | 工程组与 runtime/traces/security/context 链接可见 | 均 1 | PASS |
| U03 | 首页「服务故障 3」下钻 | URL `?failureKind=SERVICE_ERROR`；列表 3 条且均为 SERVICE_ERROR；请求带该参数 | 3 行，归因列均为「服务故障」；请求命中 | PASS |
| U04 | 首页「待处理 7」下钻 | URL `?reviewStatus=PENDING`；共 7 条 | 一致 | PASS |
| U05 | 质量页 5 张 KPI 卡 | 5 个 href 参数精确；点击/刷新保留；清除移除 | 全部一致；刷新保留；清除后共 9 条 | PASS |
| U06 | Insights 三个信号链接 | `signal=transferred/repeated_question/abandoned`，且质量页按信号筛选 | 三条 href 正确；分别得 3/1/1 条 | PASS |
| U07 | VIEWER 链路详情 UI | 显示「只读账号不显示原文」，DOM 不含任何 raw secret | 通过 | PASS |
| U08 | ADMIN 链路详情 UI | 原始 input/output 可见 | 通过 | PASS |

URL 断言已按项目 `trailingSlash: true` 处理（`/ai-ops/quality/?failureKind=...`）。

## 5. 数据对账

卡片/接口数字与 QA 库直接 SQL 计数：

| 指标 | 首页/质量页数字 | API summary | SQL 计数 | 结果 |
|---|---|---|---|---|
| SERVICE_ERROR | 3 | 3 | 3 | PASS |
| PENDING | 7 | 7 | 7 | PASS |
| ADDED_TO_EVAL | 2 | 2 | 2 | PASS |
| MODEL_ERROR | 3 | 3 | 3 | PASS |
| UNEXPECTED_TRANSFER | 1 | 1 | 1 | PASS |
| 反馈总数 | 9（列表） | 9 | 9 | PASS |
| signal=transferred | 3（Insights 链接列表） | — | 3 | PASS |
| signal=repeated_question | 1 | — | 1 | PASS |
| signal=abandoned | 1 | — | 1 | PASS |

原始输出（`qa/logs/sql-reconciliation.txt`）：

```text
 total | pending | service_error | model_error | added_to_eval | signal_transferred | signal_repeated | signal_abandoned
-------+---------+---------------+-------------+---------------+--------------------+-----------------+------------------
     9 |       7 |             3 |           3 |             2 |                  3 |               1 |                1
```

过滤列表同样由 API e2e（A24）逐项比对 `total === SQL count` 且 `list.length === total`。

## 6. 缺陷

Batch 1 验收范围内：**无 P0/P1**。3 条非阻断观察（其中 1 条为 handoff 已声明的 Batch 4 延后项）见 `qa/defects.md`：

| ID | 严重度 | 摘要 | 是否阻断 Batch 1 |
|---|---|---|---|
| D-01 | P1（延后 / 超出本批范围） | VIEWER 仍可从 `GET /admin/ai-eval/datasets/:id` 读取 case 的 `question/answer` 原文 | 否（handoff 明确留给 Batch 4） |
| D-02 | P2（既有问题） | EDITOR 侧边栏可见工程组（含 Traces），但 traces API 对 EDITOR 返回 403，UI/API 不一致 | 否（既有，未扩大） |
| D-03 | P2（一致性） | VIEWER 首页「快速入口」仍显示 runtime/flows/usage/memory 工程链接；Sidebar 隐藏只是单点 | 否（118 #1 只要求 Sidebar） |

## 7. 残留风险与未覆盖

1. **API 端口 4102**：4100 被非本项目进程占用，已报告；接线与 4100 等价。
2. **Eval 原文残留（D-01）**：按 handoff/118 计划留到 Batch 4；本报告已记录，不计入 Batch 1 结论。
3. **EDITOR 工程导航（D-02）**：只对 VIEWER 隐藏；EDITOR 可进入部分工程页但后端可能 403。既有问题，本批未扩大。
4. **VIEWER 快速入口（D-03）**：Sidebar 之外仍可点进工程页；runtime/flows 对 VIEWER 为只读展示。是否收紧属产品决策，未在 Batch 1 验收标准内。
5. **未覆盖**：
   - LIVE eval run 生命周期、评测集写入/编辑（Batch 3/4）；
   - Runtime/Flows/Usage/Memory/Security/Context 页面的数据正确性与写入动作；
   - 多实例、Redis/DB 故障注入（Batch 5）；
   - 移动端 Flutter 侧；
   - 浏览器矩阵（仅 Chromium）；
   - 真实第三方模型/judge（QA 使用本地桩，避免外发数据与费用）。
6. **数据面**：种子为合成 `qa_*` 数据；结论证明“代码路径与权限边界”，不代表生产数据分布。
7. **后台任务**：QA API 的 cron/worker 在隔离 DB/Redis 上运行（如 SLA 快照），未影响断言；生产多实例行为未验证。

## 8. 结论

Batch 1 在冻结提交 `998bb043` 上、真实 QA 数据库/Redis、真实 API 与真实 Admin 前端下通过：

- VIEWER 读接口不再返回 `input/output/answer/lastMessage/lastMsgContent/content/meta/error`；
- judge 与 ai-context 对 VIEWER/EDITOR 返回 403；
- VIEWER Sidebar 无整个 `AI Operations · 工程` 组，ADMIN 有；
- 「服务故障 3」下钻恰好 3 条 SERVICE_ERROR；待处理 7 条；
- 质量页 KPI 链接参数精确，刷新保留、清除生效；
- Insights 三条链接分别带 `signal=transferred/repeated_question/abandoned` 并可筛选；
- 卡片数字与 SQL 计数一致。

**Batch 1：PASS**。D-01 为已声明的 Batch 4 延后项；D-02/D-03 为非阻断一致性问题，建议在后续批次处理。
