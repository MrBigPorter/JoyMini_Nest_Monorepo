# Design

## Context

反馈表已有 verdict/errorType/note，但无分诊状态；评测只有 `POST /judge`；Prompt runTest 只写测试记录；注入检测只 emitStage。

## Decisions

### D1. 反馈分诊

`AiAnswerFeedback` 增加 `reviewStatus`（PENDING/REVIEWED/IGNORED）、`reviewedBy`、`reviewedAt`。
`PATCH /admin/ai-feedback/:id` 更新状态/结论/备注，写操作仅 ADMIN/SUPER_ADMIN。

### D2. 评测集

四张表：Dataset → Case → Run → Result。Run 在后台执行，API 立即返回 RUNNING；UI 轮询 `GET /runs/:id`。
Case 必须包含 question/answer/expect，复用 `AiEvalJudgeService.judge`。

### D3. Prompt 真测试

`runTest` 读取 active version config，用 `buildAgentPrompt` + `createLLM` 调一次模型；失败仍落 test run，`actualOutput` 为空。

### D4. 注入命中

`intent-router` 命中时异步写 `AiSecurityEvent`（type/mode/length/userIdHash），不存原文；失败不阻断。
查询 API 支持 type/日期/分页；summary 返回类型/模式分布与当前 mode。

## Risks

- judge 依赖外部模型；run 可能失败，UI 显示 FAILED
- Prompt 测试成本；只允许手动触发
- 注入事件增长；后续加保留期清理
