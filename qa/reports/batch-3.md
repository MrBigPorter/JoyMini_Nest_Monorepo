# QA Report — Batch 3

> 依据：`docs/AI-joymini/120` §7 Batch 3；`118` #7–8；`113` §7/§10；`handoff/batch-3.md`
> 结论：**PASS**（功能开关与血缘新写入均通过；2 项 SSE 端到端未覆盖，用最小复现验证并标注）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 冻结提交 | `fa18bfb1`（后端 `56879855`、前端 `07245b1b`、文档） |
| 范围 | `GET /admin/ai-ops/features`；反馈开关禁用态与写接口 403；eval 开关门禁；feedback→trace、trace→aiMessage、security→conversation 血缘；质量页/ChatWindow 旗帜联动 |
| 产品代码改动 | 无（QA 只改 `qa/**`、`apps/api/test/ai-ops/**`、`apps/admin-next/e2e-qa/**`） |

## 2. 环境与两阶段

沿用隔离 QA 环境：Postgres `lucky-db-qa` 5433 / `joy_mini_qa`，Redis 6382/DB15，API 4102，Admin 4101。

| 阶段 | `qa/.env.qa` | 用途 |
|---|---|---|
| A（flags on） | `AI_FEEDBACK_UI_ENABLED=true`、`AI_EVAL_ENABLED=true`、`NODE_ENV=test` | 4 角色开关 true；反馈/血缘写入；UI 正向 |
| B（flags off） | 两者 `false`、`NODE_ENV=test` | 4 角色开关 false；反馈/eval 写接口 403；UI 禁用态 |

每个阶段都改 env → **重启 API**（控制器/features 读取 `process.env`）→ 跑用例；最后恢复 true 并再次重启。

## 3. 执行命令

```bash
# 阶段 A
# qa/.env.qa: AI_FEEDBACK_UI_ENABLED=true, AI_EVAL_ENABLED=true
# 重启 API（nest start, 127.0.0.1:4102）
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/batch3-lineage.e2e-spec.ts
cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts e2e-qa/batch3-flags.spec.ts --project=qa-chromium

# 阶段 B
# qa/.env.qa: 两者=false；重启 API
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/batch3-lineage.e2e-spec.ts
cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts e2e-qa/batch3-flags.spec.ts --project=qa-chromium

# 恢复 A 并重启；4 角色 features 抽查
# VIEWER/EDITOR/ADMIN/SUPER_ADMIN -> 10000 {feedbackUiEnabled:true,evalEnabled:true}
```

日志：`qa/logs/batch3-lineage-true.log`（8/8）、`batch3-lineage-false.log`（5/5）、`batch3-flags-true.log`（1/1）、`batch3-flags-false.log`（1/1）。

## 4. 结果

| 套件 | 结果 |
|---|---|
| 阶段 A API e2e（8 cases） | **8 passed / 0 failed** |
| 阶段 B API e2e（5 cases） | **5 passed / 0 failed** |
| 阶段 A UI flags=true（1 case，质量页+ChatWindow） | **1 passed** |
| 阶段 B UI flags=false（1 case，质量页+ChatWindow） | **1 passed** |

### 4.1 功能开关

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| B3-01 | 阶段 A `GET /admin/ai-ops/features` | 4 角色 200；true/true | VIEWER/EDITOR/ADMIN/SUPER 均 10000，true/true | PASS |
| B3-02 | 阶段 B 同接口 | 4 角色 200；false/false | 均 false/false | PASS |
| B3-03 | 阶段 B `POST /admin/ai-feedback` | 403 | 403 | PASS |
| B3-04 | 阶段 B `PATCH /admin/ai-feedback/:id` | 403 | 403 | PASS |
| B3-05 | 阶段 B `GET /admin/ai-feedback` | 读仍可用 200 | 200 | PASS |
| B3-06 | 阶段 B `POST /admin/ai-eval/datasets` | 403 | 403 | PASS |
| B3-07 | 阶段 B `POST /admin/ai-eval/datasets/:id/cases` | 403 | 403 | PASS |
| B3-08 | 阶段 B `GET /admin/ai-eval/datasets` | 读仍可用 200 | 200 | PASS |
| B3-09 | 质量页 flags=false | 显示“反馈分诊未启用”；无开始质检/确认/排除 | 横幅可见；三个按钮 0 | PASS |
| B3-10 | ChatWindow flags=false | 不显示反馈按钮 | `button[title=回答正确/回答有误]` 0 | PASS |
| B3-11 | 质量页 flags=true | 无横幅；开始质检可见 | 通过 | PASS |
| B3-12 | ChatWindow flags=true | AI 消息显示反馈按钮 | 两个按钮可见 | PASS |

### 4.2 血缘

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| B3-13 | explicit feedback 按 `aiMessageId` 匹配 trace | `ai_answer_feedback.trace_id = trace.id` | `qa_b3_trace_fb` | PASS |
| B3-14 | 分诊后 HUMAN score | `ai_scores.trace_id = trace.id` | 同名 trace；`value=1` | PASS |
| B3-15 | explicit feedback 按 `triggerMessageId` 匹配 trace | traceId 命中 | `qa_b3_trace_fb_trigger` | PASS |
| B3-16 | message 匹配不到时回退会话最近 trace | traceId = 最近 trace | `qa_b3_trace_fb_fallback` | PASS |
| B3-17 | 无 trace 的会话 | feedback 仍写入，traceId=null | 行存在，null | PASS |
| B3-18 | implicit feedback | 同样写 traceId | `qa_b3_trace_imp` | PASS |
| B3-19 | trace `aiMessageId`（最小复现） | `ai_traces.ai_message_id` = 本轮 AI 消息 id | 插入行 `aiMessageId=qa_b3_msg_reply_ai`（triggerMessageId=qa_b3_msg_reply_user） | PASS（最小复现） |
| B3-20 | 安全事件 conversationId（最小复现，log 模式） | `ai_security_events.conversation_id` 有值 | `conversationId=qa_b3_conv_inject`、`type=prompt_override`、`mode=log` | PASS（最小复现） |

**B3-19 说明**：直接调用生产代码的私有 `recordReplyTrace`（与 chatStream 收尾调用同一方法），创建带 `triggerMessageId` 的 AI 消息并断言反查写入 `aiMessageId`。未走真实外部 LLM 的 SSE 全链路（见 §6 未覆盖）。
**B3-20 说明**：直接调用生产 `createIntentRouterNode`，state 带 `conversationId`，输入命中 prompt_override；事件在分类前落库。未走完整 SSE（见 §6）。

关键证据（`batch3-lineage-true.log`）：

```text
ai_traces INSERT ... ["<traceId>","qa_b3_conv_reply","qa_b3_msg_reply_user","qa_b3_msg_reply_ai",...]
ai_security_events INSERT ... ["<id>","prompt_override","log",20,"<hash>","qa_b3_conv_inject","NEW",...]
```

## 5. 缺陷

Batch 3 范围内 **无 P0/P1/P2 缺陷**。1 条 P3 代码审查观察（未触发）：质量页在 `/features` 请求失败时把 `feedbackUiEnabled` 默认成 true（`featuresData?.feedbackUiEnabled !== false`），仍会显示分诊按钮；写接口仍会 403。ChatWindow 使用 `?? false`（fail-closed），两者不一致。详见 `qa/defects.md` D-B3-01。

## 6. 未覆盖与残留风险

1. **真实 chatStream SSE 全链路未跑**：需要可用的外部 LLM/embedding/RAG 依赖；本批用 `recordReplyTrace` 最小复现验证同一条新逻辑。`ai-stream.handler` 注入 `conversationId` 与 chatStream 传 `triggerMessageId` 为代码审查，不是端到端证据。
2. **`recordErrorTrace` 不写 `aiMessageId`**（handoff 已知限制 #1）。
3. **`testChat` / LIVE eval 仍不写 trace**；eval 的 traceId 留到 Batch 4（handoff #2）。
4. **历史数据未回填** `traceId` / `conversationId`；只验证新写入（handoff #3）。
5. **`AiFeedbackClient` 旧页面仍读 `NEXT_PUBLIC_AI_FEEDBACK_UI_ENABLED`**（`/ai-feedback` 导出桩，非 AI Ops 主路径；handoff #4）。
6. **EDITOR 工程导航/接口不一致（D-02）**未处理（既有问题）。
7. **质量页 fail-open**（P3，见 D-B3-01）。
8. **环境**：API 仍使用 4102（4100 被无关进程占用）；`NODE_ENV=development` 的 evalEnabled 分支仅单测覆盖，未在 live API 验证。

## 7. 结论

Batch 3 在冻结提交 `fa18bfb1` 上通过真实 QA API/DB 验证：

- `GET /admin/ai-ops/features` 四角色可读，true/false 与 `qa/.env.qa` 一致；
- 关闭反馈开关：质量页禁用横幅、无分诊按钮，ChatWindow 无反馈按钮；`POST/PATCH /admin/ai-feedback` 403，读接口仍 200；
- 关闭 eval 开关且 `NODE_ENV=test`：创建数据集/加用例 403，读接口仍 200；
- feedback 写 `traceId`（aiMessageId / triggerMessageId / 回退最近 trace / 无 trace 不阻断 / implicit），分诊 HUMAN score 沿用同一 trace；
- trace 写 `aiMessageId`、安全事件写 `conversationId`（均用生产方法最小复现，日志有插入证据）；
- flags=true 时 UI 恢复。

**Batch 3：PASS。** 无阻塞项。两项 SSE 端到端未覆盖已明确标注，未以猜测代替证据。
