# QA Report — Batch 4

> 依据：`docs/AI-joymini/120` §7 Batch 4；`118` #3/#6；`handoff/batch-4.md`
> 结论：**PASS**（首轮 `b67a3cbb` 发现 D-B4-01 P1；修复 `2561806f` 后复验 API 9/9、UI 3/3，见 §8）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 首轮提交 | `b67a3cbb`（后端 `f6e39769`、前端 `c08df55c`、handoff） |
| 复验提交 | `2561806f`（修复 D-B4-01；HEAD） |
| 范围 | 空期望门禁；并发锁；孤儿 RUNNING 回收；用例编辑/删除；加入回归期望与 payload；LIVE traceId=null；轮询/失败原因；带期望用例的 summary |
| 产品代码改动 | 无（QA 只改 `qa/**` 与测试文件） |

## 2. 环境

沿用隔离 QA：Postgres `lucky-db-qa` 5433 / `joy_mini_qa`，Redis 6382/DB15，API 4102，Admin 4101。

额外配置（`qa/.env.qa`，均为 QA 专用）：

```text
AI_FEEDBACK_UI_ENABLED=true
AI_EVAL_ENABLED=true
AI_EVAL_LIVE_USER_ID=qa_eval_live
AI_LLM_TYPE=online
DEEPSEEK_API_KEY=qa-fake-deepseek
AI_OLLAMA_BASE_URL=http://127.0.0.1:4199/v1
OLLAMA_MODEL=deepseek-chat
```

`qa/scripts/judge-stub.mjs` 新增确定性失败钩子：请求正文含 `qa_judge_fail` 时返回 500，用于 FAILED run 的 API/UI 验证。Chat LLM 也指向该本地桩，LIVE 运行不外发真实用户数据。

## 3. 执行命令

```bash
# 重启 API（qa/.env.qa）与 Admin
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/batch4-eval.e2e-spec.ts

cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts e2e-qa/batch4-eval.spec.ts --project=qa-chromium
```

证据：`qa/logs/batch4-api-e2e.log`、`qa/logs/batch4-playwright.log`。

## 4. 结果

| 套件 | 结果 |
|---|---|
| API e2e（9 cases） | **9 passed / 0 failed**（复验 `2561806f`） |
| Playwright（3 cases） | **3 passed / 0 failed** |

### 4.1 API 用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| B4-01 | `expect={}` 且 `expected=null` 启动 | 400 | 400；message 含 `no expectation` | PASS |
| B4-02 | `expect={}` + **字符串** `expected='must mention 7 days'` 启动 | 201 + COMPLETED | 201 + COMPLETED（`2561806f` 修复后） | PASS |
| B4-03 | `expect={}` + **对象** `expected={mustMention:['7 days']}` 启动 | 201 + COMPLETED | 一致 | PASS |
| B4-04 | 2 条带期望用例的 STORED run | COMPLETED；`summary.total=2`；result/score `traceId=null` | 一致 | PASS |
| B4-05 | 同 dataset 已有 RUNNING 再启动 | 400 | 400；message 含 `run in progress` | PASS |
| B4-06 | `startedAt=40 分钟前` 的 RUNNING，GET run | FAILED；`summary.error` 含 `stale RUNNING`；`finishedAt` 有值 | 一致 | PASS |
| B4-07 | judge 失败（stub 500） | run FAILED；`summary.error` 有值 | FAILED；error 含 judge 失败 | PASS |
| B4-08 | PATCH expected / DELETE / 跨 dataset | PATCH 持久化；DELETE 消失；跨 dataset 404 | 一致 | PASS |
| B4-09 | LIVE run result/score traceId | 均为 null | 均为 null | PASS |

### 4.2 Playwright 用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| B4-UI-01 | 加入回归（空期望 / 填写期望） | 空：显示错误且不调用 addCases；填：payload 带 `expected/mustMention/sourceFeedbackId/source` | 空：错误可见且 POST 数不变；填：四字段齐全 | PASS |
| B4-UI-02 | FAILED run | 显示“失败原因”；终态后轮询停止 | 原因可见；4.5s 内 GET `/runs/:id` 数不变 | PASS |
| B4-UI-03 | COMPLETED run | 显示通过率/总数；终态后轮询停止 | “通过率 100.0%”“共 1 条 · 解决 1”；请求数不变 | PASS |

## 5. 缺陷

### D-B4-01 — 字符串 `expected` 仍被判定为空期望（P1）— **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | **P1（首轮阻断）** |
| 状态 | **FIXED**，提交 `2561806f`（复验 HEAD） |
| 位置 | `apps/api/src/admin/ai-eval/ai-eval-dataset.service.ts`：`resolveExpectation()` / `hasKeys()` |
| 首轮影响 | API 直接按文档传非空字符串 `expected` 时无法启动回归，违反 118 #3 “补 expected 后可启动”；UI 主路径因同时发送 `expect.mustMention` 不受影响 |
| 修复 | `resolveExpectation()` 对非空字符串 `expected` 返回 `{ mustMention: [expected.trim()] }`（新增单测） |

**首轮复现**（`b67a3cbb`）：

```text
POST /admin/ai-eval/datasets/:id/cases
  {"cases":[{"question":"qa_b4_q1","answer":"qa_b4_a1","expect":{}}]}   -> 201
PATCH ... {"expected":"must mention 7 days"}                            -> 200（DB 已存字符串）
POST .../runs                                                           -> 400
  "1 case(s) have no expectation; add expect.mustMention or expected before running"
```

**复验（PASS）**：

```text
POST /admin/ai-eval/datasets/:id/cases
  {"cases":[{"question":"qa_b4_string_q","answer":"qa_b4_answer","expect":{},"expected":"must mention 7 days"}]}  -> 201
POST /admin/ai-eval/datasets/:id/runs -> 201
GET  /admin/ai-eval/runs/:id          -> COMPLETED
```

**原因（首轮）**：`hasKeys(value)` 要求 `typeof value === 'object'` 且有键；非空字符串 `expected` 被忽略。修复后字符串按 `mustMention` 处理，对象/`expect.mustMention` 路径保持不变（B4-03、B4-04 仍通过）。
**证据**：`qa/logs/batch4-reverify-api.log`（9/9）；`qa/logs/batch4-api-e2e.log`（首轮 8/9，Expected 201 / Received 400）。

## 6. 残留风险与未覆盖

1. **LIVE 运行使用本地 chat stub**：`AiEvalResult.traceId` / `AiScore.traceId=null` 已真实验证；但真实模型质量、超时、外部 provider 行为未覆盖。
2. **并发锁是应用层检查**：单实例通过；多实例极端并发仍可能双通过（handoff 已知限制 #5）。
3. **孤儿回收是惰性的**：只在该 dataset 的 list/get/start 时触发，没有独立 cron；被 UI 轮询的 run 会很快恢复，但无人访问的 run 会一直 RUNNING。118 “重启后 5 分钟内”在无访问时并不严格成立；本批验收按“调用 list/get 后”通过。
4. **历史 `AiEvalResult.traceId` 悬空未清理**（handoff #3）。
5. **用例硬删除**会级联删除 results（handoff #4）。
6. **真实 chatStream / LIVE 外部模型**未端到端跑；QA 使用本地桩。

## 7. 结论

Batch 4 的核心生命周期与前端行为全部通过：

- 空期望 400；字符串 `expected`/对象 `expected`/`expect.mustMention` 均可启动；带期望用例产出 summary；
- 并发 400；40 分钟孤儿变 FAILED 且有 `summary.error`；judge 失败 run FAILED；
- 用例 PATCH/DELETE/跨 dataset 404；
- LIVE result/score `traceId=null`；
- 加入回归的空期望拦截与 payload、FAILED 原因、终态停轮询均通过。

首轮的 **D-B4-01（P1）** 已在 `2561806f` 修复：非空字符串 `expected` 等价于 `{ mustMention: [expected] }`；复验 API 9/9、UI 3/3。

**Batch 4：PASS。** 无遗留阻塞项。

## 8. 复验记录 — D-B4-01（commit `2561806f`）

**复验环境**：QA API 4102 / Admin 4101 保持运行；重启 API 加载 `2561806f`（仅后端修复，前端不变）。`qa/.env.qa` flags=true。

**命令**：

```bash
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/batch4-eval.e2e-spec.ts
cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts e2e-qa/batch4-eval.spec.ts --project=qa-chromium
```

**结果**：

| 套件 | 首轮 `b67a3cbb` | 复验 `2561806f` |
|---|---|---|
| API e2e（9 cases） | 8 passed / 1 failed | **9 passed / 0 failed** |
| Playwright（3 cases） | 3 passed | **3 passed** |
| 字符串 `expected` 启动 | 400 | **201 + COMPLETED** |
| 对象 `expected` / `expect.mustMention` | 201 + COMPLETED | 201 + COMPLETED（未回归） |

**证据**：`qa/logs/batch4-reverify-api.log`（9/9）、`qa/logs/batch4-reverify-playwright.log`（3/3）。

**结论**：D-B4-01 修复，Batch 4 PASS，无阻塞项。
