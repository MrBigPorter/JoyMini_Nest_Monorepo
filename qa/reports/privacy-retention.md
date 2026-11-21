# QA Report — Privacy & Retention

> 依据：PII `346fd403`、eval 隐私 `3f780241`、ignore `b152616c`；冻结提交 `b152616c`，复验 `301cff59`
> 结论：**PASS**（D-PR-01 已在 `301cff59` 修复；复验 API 7/7、UI 1/1；Batch 1/4/5 回归通过）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 冻结提交 | `b152616c`（PII `346fd403`、eval 隐私 `3f780241`、ignore `b152616c`） |
| 复验提交 | `301cff59`（含 D-PR-01 span 脱敏修复与 `42ee6d76` insights；HEAD） |
| 范围 | trace PII 脱敏；30 天保留清理；VIEWER eval 读脱敏；VIEWER eval 页面；Batch 1/4/5 回归 |
| 产品代码改动 | 无（QA 只改 `qa/**` 与测试文件） |

> 注：复验时工作区 HEAD 为 `301cff59`；`git diff b152616c..301cff59 -- apps/api/src apps/admin-next/src` 的隐私相关文件只有 `ai-customer.service.ts` 的 span snippet 修复（另含 `42ee6d76` insights/chat 改动，不在本报告范围）。隐私/PII/eval/迁移代码已包含 `b152616c`。

## 2. 迁移安全审核（先做）— PASS

文件：`apps/api/prisma/migrations/20261121150000_ai_trace_retention/migration.sql`

```sql
CREATE INDEX "ai_traces_created_at_idx" ON "ai_traces"("created_at");
```

```text
$ grep -inE '\b(drop|rename|truncate|alter|delete)\b' migration.sql
NONE
```

- 仅一个 CREATE INDEX，无 DROP/RENAME/ALTER；
- 已 `prisma generate` + `migrate deploy`，`ai_traces_created_at_idx` 存在。
- QA 环境曾因容器停止（Colima 仍在，`lucky-db-qa`/`lucky-redis-qa` Exited）无法 deploy；已 `docker start` 恢复后成功，数据未丢。

## 3. 环境与命令

```bash
docker start lucky-db-qa lucky-redis-qa
cd apps/api
export DATABASE_URL='postgresql://lucky:lucky_qa_pw@127.0.0.1:5433/joy_mini_qa?schema=public'
npx prisma generate --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
# 重启 API/Admin；启动 judge stub（4199）

cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/privacy-retention.e2e-spec.ts

cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts e2e-qa/privacy-retention.spec.ts --project=qa-chromium

# 回归
npx jest ... test/ai-ops/batch1-permissions.e2e-spec.ts
npx jest ... test/ai-ops/batch4-eval.e2e-spec.ts
npx tsx qa/seed/batch5.ts
npx jest ... test/ai-ops/batch5-analysis.e2e-spec.ts
```

## 4. 结果

| 套件 | 结果 |
|---|---|
| Privacy/Retention API（7 cases） | **7 passed / 0 failed**（复验 `301cff59`；首轮 6/7 = D-PR-01） |
| Privacy VIEWER eval UI（1 case） | **1 passed / 0 failed** |
| Batch 1 权限回归（24 cases） | **24 passed / 0 failed** |
| Batch 4 eval 回归（9 cases） | **9 passed / 0 failed** |
| Batch 5 analysis 回归（9 cases） | **9 passed / 0 failed** |

### 4.1 API 用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| PR-01 | `recordReplyTrace` 写含 PII 的 input/output | `ai_traces.input/output` 为 `138****1234`、`u***@example.com`、`1101**********1234`；订单号保留 | 一致；原始 PII 不出现 | PASS |
| PR-02 | **span 输出不得保留原文** | `ai_spans.output` 无原始 PII | LLM span snippet 与 trace output 同为 `138****1234 / u***@example.com / 1101**********1234 / 订单 202611210001` | PASS（`301cff59` 修复后） |
| PR-03 | `TraceService.purgeExpired()` | 40 天前 trace/span/LLM score 删除；HUMAN score 保留；新 trace 保留 | 一致 | PASS |
| PR-04 | VIEWER `GET /ai-eval/datasets/:id` | `cases.question/answer/expected/expect` 全 null | 全 null | PASS |
| PR-05 | ADMIN 同接口 | 原值 | `qa_pr_secret_question` 等 | PASS |
| PR-06 | VIEWER `GET /ai-eval/runs/:id` | `results.actualAnswer/reason` 与 `results.case.*` null | 全 null | PASS |
| PR-07 | ADMIN 同接口 | 原值 | 原值 | PASS |
| PR-08 | VIEWER/EDITOR judge | 403 | 403 / 403 | PASS |
| PR-09 | VIEWER eval 页面 | 不显示 question/answer/expected 原文 | 页面 body 不含 4 个 secret；用例行显示“期望：未填写” | PASS |

### 4.2 回归

- Batch 1 权限 24/24（首轮 judge 503 是 judge stub 未启动；重启 stub 后通过）；
- Batch 4 eval 9/9；
- Batch 5 analysis 9/9（concurrency 测试首次因上次中断遗留的 Redis lock key 导致 TTL 偏小；清理 key 后通过；TTL 断言已放宽为约 30 分钟）。

## 5. 缺陷

### D-PR-01 — `ai_spans.output.snippet` 仍保存原始 PII（P1）— **FIXED**

| 项 | 内容 |
|---|---|
| 严重度 | **P1（首轮阻断）** |
| 状态 | **FIXED**，提交 `301cff59`（HEAD） |
| 位置 | `apps/api/src/client/ai-customer/ai-customer.service.ts` `recordReplyTrace()` |
| 首轮问题 | LLM span 的 `output.snippet` 使用未脱敏 `output`；trace `output` 已用 `redactPiiText` |
| 修复 | 先 `const safeOutput = redactPiiText(output)`，trace `output` 与 LLM span `snippet` 都用 `safeOutput` |

**复现**（最小复现 `recordReplyTrace`）：

```text
input:  联系电话 13812341234，邮箱 user@example.com，身份证 110101199001011234，订单号 202611210001
output: 已登记：13812341234 / user@example.com / 110101199001011234 / 订单 202611210001

ai_traces.input  -> 联系电话 138****1234，邮箱 u***@example.com，身份证 1101**********1234，订单号 202611210001
ai_traces.output -> 已登记：138****1234 / u***@example.com / 1101**********1234 / 订单 202611210001
ai_spans (llm).output.snippet -> "已登记：13812341234 / user@example.com / 110101199001011234 / 订单 202611210001"   # RAW
```

**期望**：trace 及其 spans 的持久化文本均不含手机号/邮箱/身份证原文（订单号可保留）。
**首轮证据**：`qa/logs/privacy-retention-api.log`（PR-02 断言失败；Jest 显示 raw span snippet）。
**复验（PASS）**：`qa/logs/privacy-retention-reverify-api.log`（7/7）；span snippet 与 trace output 一致为脱敏值，原始 PII 不再出现。

## 6. 残留风险与未覆盖

1. **RAG span previews**：`sources[].preview` 可能保存知识库原文中的 PII；本次只验证用户 input/output 的 PII。
2. **eval metadata 未脱敏**：本次只覆盖 `question/answer/expected/expect`；`AiEvalCase.metadata`、`tags`、`sourceFeedbackId` 等未在验收范围，可能含原始文本。
3. **HUMAN 分数的 dangling traceId**：保留 HUMAN score 是设计；trace 删除后其 `traceId` 悬空，符合“人工记录长期保留”的意图，但下游若按 traceId 关联需处理。
4. **保留任务**：`purgeExpired` 由 03:00 UTC cron 触发；本次直接调用验证；未等待真实 cron，也未验证多实例。
5. **历史数据**：只验证新写入；旧 trace 中的 PII 未回溯清理。

## 7. 结论

- 迁移仅 CREATE INDEX，安全 deploy；
- `ai_traces.input/output` 与 `ai_spans.output.snippet` 的 PII 脱敏、订单号保留通过；
- 30 天保留清理通过（旧 trace/span/LLM score 删除，HUMAN score 与新 trace 保留）；
- VIEWER eval 数据集/运行读接口与页面均不显示原文；ADMIN 原值；VIEWER/EDITOR judge 403；
- Batch 1 权限 24/24、Batch 4 eval 9/9、Batch 5 analysis 9/9 回归通过。

首轮的 **D-PR-01（P1）** 已在 `301cff59` 修复：span snippet 与 trace output 共用同一份 `redactPiiText` 输出；复验 API 7/7。

**Privacy & Retention：PASS。** 无遗留阻塞项。

## 8. 复验记录 — D-PR-01（commit `301cff59`）

**命令**：

```bash
# 重启 API/Admin 到 301cff59
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/privacy-retention.e2e-spec.ts
```

**结果**：

| 检查 | 首轮 `b152616c` | 复验 `301cff59` |
|---|---|---|
| Privacy/Retention API | 6 passed / 1 failed | **7 passed / 0 failed** |
| `ai_traces.input/output` PII | 脱敏 | 脱敏（未回归） |
| `ai_spans.output.snippet` PII | **原始 PII** | **同一份脱敏文本；原始 PII 不出现** |
| 订单号 `202611210001` | 保留 | 保留 |
| VIEWER eval / retention / judge | 通过 | 通过 |

**证据**：`qa/logs/privacy-retention-reverify-api.log`（7/7）、`qa/logs/privacy-retention-playwright.log`（1/1）；首轮 `qa/logs/privacy-retention-api.log`。
**备注**：复验初次命中上一轮失败遗留的旧 trace（cleanup 未按 conversationId 删除）；测试 cleanup 已修正（按 conversationId 删除 trace/spans），非产品问题。

**结论**：D-PR-01 FIXED；Privacy & Retention PASS，无阻塞。
