# Proposal

## Why

反馈列表只能看不能分诊；评测只有单条 judge；Prompt 测试只落记录不调模型；注入命中只写日志，运营看不到。质量闭环目前是断的。

## What Changes

- 反馈增加 `reviewStatus/reviewedBy/reviewedAt` 与 PATCH 分诊
- 新增评测集/用例/运行/结果四张表与 API，支持批量 judge
- Prompt 测试改为真实 LLM 调用
- 注入命中落 `AiSecurityEvent`，新增查询/汇总 API 与页面
- 新增 `/ai-ops/quality` 与 `/ai-ops/security`

## Capabilities

### New Capabilities

- `admin-ai/quality-loop`
- `admin-ai/security-events`

## Impact

- 数据库：`ai_answer_feedback` 新列；`ai_eval_datasets/cases/runs/results`；`ai_security_events`
- 后端：`ai-feedback`、`ai-eval`、`ai-prompt`、`intent-router`、新增 `ai-security`
- 前端：`/ai-ops/quality`、`/ai-ops/security`
