# QA Report — Insights Metrics（`42ee6d76`）

> 依据：`42ee6d76 fix(api,admin): correct insights message and transfer metrics`（包含在复验提交 `301cff59`）；`118` P1-4
> 结论：**PASS**（human_agent 写入、转人工率、模型/服务/误转率、页面中文标签与分子分母均通过；1 条 P2 下钻口径观察）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 被测提交 | `42ee6d76`（包含在复验 HEAD `301cff59`） |
| 范围 | 客服回复 `human_agent`；转人工率分子/分母；modelError/serviceError/misTransfer；疑似误转；Insights 页面 |
| 产品代码改动 | 无（QA 只改 `qa/**` 与测试文件） |

## 2. 数据窗口（`qa/seed/insights-metrics.ts`，UTC 2026-11-15）

| 数据 | 值 |
|---|---|
| 会话 | `conv_a` SUPPORT 创建 D10 转人工 D11 explicit_request；`conv_b` SUPPORT 创建 D10；`conv_c` GROUP（排除）；`conv_d` AI 创建 D-1 转人工 D12 ai_error |
| 反馈 | MODEL_ERROR ×2（explicit incorrect）、SERVICE_ERROR ×2、EXPECTED_TRANSFER ×1、UNEXPECTED_TRANSFER ×1（人工确认）、UNKNOWN ×1（implicit transferred） |
| 人工回复 fixture | `qa_im_conv_human` + bot/customer 成员 + user/ai 消息（today） |

## 3. 执行命令

```bash
# 数据由 API spec 的 beforeAll 自动执行；也可手动：
DATABASE_URL='postgresql://lucky:lucky_qa_pw@127.0.0.1:5433/joy_mini_qa?schema=public' \
  npx tsx qa/seed/insights-metrics.ts

cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/insights-metrics.e2e-spec.ts

cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts \
  e2e-qa/insights-metrics.spec.ts e2e-qa/insights.spec.ts --project=qa-chromium

cd apps/admin-next && ./node_modules/.bin/vitest run \
  src/__tests__/views/AiInsights.test.tsx
```

证据：`qa/logs/insights-metrics-api.log`、`qa/logs/insights-metrics-playwright.log`、`qa/logs/insights-links-playwright.log`、`qa/logs/ai-insights-vitest.log`。

## 4. 结果

| 套件 | 结果 |
|---|---|
| Insights API e2e（3 cases） | **3 passed / 0 failed** |
| Insights metrics 页面（1 case） | **1 passed / 0 failed** |
| 既有 Insights 链接回归（1 case，中文标签） | **1 passed / 0 failed** |
| `AiInsights.test.tsx` | **7 passed / 0 failed** |

### 4.1 API 用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| IM-01 | 转人工率 | 分子=窗口内 `transferredAt` 的 SUPPORT/AI 会话；分母=窗口内创建或转人工；rate≤1；byReason 同窗口 | numerator 2 / denominator 3 = 0.667；byReason explicit_request 1 + ai_error 1；≤1 | PASS |
| IM-02 | modelError | MODEL_ERROR / (MODEL_ERROR + UNEXPECTED_TRANSFER) | 2 / 3 = 0.667 | PASS |
| IM-03 | serviceError | SERVICE_ERROR / 可行动反馈（explicit incorrect ∪ SERVICE_ERROR） | 2 / 4 = 0.5 | PASS |
| IM-04 | misTransfer | 人工确认 UNEXPECTED_TRANSFER / 已确认转人工 | 1 / 4 = 0.25；implicit transferred 不计 | PASS |
| IM-05 | 疑似误转 | `feedback.suspectedMisTransfer` 单独展示 implicit transferred | transferred=5、suspectedMisTransfer=5 | PASS |
| IM-06 | 客服回复 source | 后台回复 `human_agent`；客户仍 `user`；AI 仍 `ai` | DB 三条消息 source 分别 human_agent/user/ai | PASS |
| IM-07 | 人工消息指标 | 回复后 `messages.human` +1 | 0 → 1 | PASS |

### 4.2 页面/单测

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| IM-UI-01 | Insights 中文标签 | 会话数/AI 消息/转人工率/模型错误率/服务故障率/误转率/重复追问/用户放弃/人工消息（客服回复）/疑似误转（信号区）/Token 用量/请求数 | 全部可见 | PASS |
| IM-UI-02 | 分子/分母展示 | 转人工率 66.7% (2/3)；模型错误率 66.7% 分子/分母：2 / 3；服务故障率 50.0% 2 / 4；误转率 25.0% 1 / 4；疑似误转 5 | 一致 | PASS |
| IM-UI-03 | 既有 Insights 链接 | 转人工率/重复追问/用户放弃链接与质量页筛选 | 全部通过（标签已改为中文） | PASS |
| IM-UNIT | AiInsights.test.tsx | 7 个用例 | 7 passed | PASS |

## 5. 缺陷

**无 P0/P1/P2 阻断缺陷。** 1 条 P2 下钻口径观察：

### D-IM-01 — 「转人工率」KPI 与下钻链接不是同一总体（P2）

- 位置：`apps/admin-next/src/app/(dashboard)/ai-ops/insights/page.tsx`：转人工率卡片值 = 会话 `transfers.numerator/denominator`（2/3），href 仍为 `/ai-ops/quality?signal=transferred`。
- 问题：链接落到“系统信号”反馈列表（implicit transferred，D 窗口 5 条），不是 2 个转人工会话；KPI 数字与列表数量不是同一总体。Batch 2 曾把链接对齐到 `feedback.transferred`，本次 KPI 改为会话口径后链接未同步。
- 影响：运营从 66.7% (2/3) 点进去看到 5 条反馈信号，容易误解；非本批主验收项（本批要求 labels/fractions），故 P2 非阻断。
- 证据：`qa/seed/insights-metrics.ts`（transfers 2/3、feedback.transferred 5）；`qa/logs/insights-metrics-api.log`。
- 建议：明确链接目标：若要下钻转人工会话，应指向会话列表/转人工页；若要保留下钻反馈信号，KPI 应标注“信号区”或改用对应的分子分母。

## 6. 残留风险与未覆盖

1. **D-IM-01** 转人工率 KPI 与链接总体不一致（P2）。
2. **`会话数` 2 vs 转人工率分母 3**：前者是“窗口内创建”，后者是“窗口内创建或转人工”；页面已在转人工卡片 sub 说明分母，但两个卡片数字并列时仍需运营理解口径。
3. **`suspectedMisTransfer` = 全部 implicit transferred**（含 SERVICE_ERROR/EXPECTED/UNKNOWN），不等于已确认误转；页面标签已写“信号区”。
4. 只验证单日（2026-11-15）；未覆盖跨日/7 天窗口、多实例、真实客服多端并发回复。
5. 人工消息 fixture 使用 bot 成员；生产依赖真实 SupportChannel bot 成员存在。
6. `AiInsights.test.tsx` 通过，但未跑前端全量；本次只按任务要求跑该文件。

## 7. 结论

- 后台客服回复写 `ChatMessage.source='human_agent'`，客户消息仍 `user`，AI 消息仍 `ai`；`messages.human` 回复后 +1；
- 转人工率 2/3=0.667，rate≤1，byReason 同窗口；
- modelError 2/3、serviceError 2/4、misTransfer 1/4；misTransfer 只算人工确认 UNEXPECTED_TRANSFER；suspectedMisTransfer 单独展示 5；
- Insights 页面中文标签与“分子/分母”全部正确；既有链接回归与 AiInsights 单测通过。

**Insights Metrics：PASS。** 唯一观察 D-IM-01（P2，下钻口径）不阻断本批。
