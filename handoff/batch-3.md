# Handoff — Batch 3

> 依据：`docs/AI-joymini/120` §7 Batch 3；`118` #7–8
> 状态：Dev 完成，待 QA 真实后端验证

## 任务

- 118 #7：统一功能开关；质量页禁用态；`AI_EVAL_ENABLED` 门禁数据集/用例写；移除 `AI_QUALITY_V2_ENABLED`。
- 118 #8：trace 写 `aiMessageId`；feedback 写 `traceId`；安全事件写 `conversationId`。

## 提交

- `56879855` feat(api): connect trace, feedback and security lineage
- `07245b1b` feat(admin): surface feedback feature state and unify the flag
- 文档：`113` §7/§10、`118` §8.1 #7 同步

## 行为变化

### 血缘

- `chatStream` 把 `conversationId` 写入 LangGraph state；`intent-router` 的安全事件落库带上它。
- `recordReplyTrace` 用 `triggerMessageId + source='ai'` 反查本轮 AI 消息，写 `AiTrace.aiMessageId`。
- `recordExplicit` / `recordImplicit` 写 `AiAnswerFeedback.traceId`：
  - 先按 `aiMessageId` / `triggerMessageId` 匹配；
  - 找不到再取该会话最近一条 trace；
  - 找不到不阻断反馈写入。
- `updateTriage` 写 HUMAN `AiScore` 时沿用反馈的 `traceId`。

### 开关

- 新增 `GET /admin/ai-ops/features`（SUPER/ADMIN/EDITOR/VIEWER 可读）：
  ```json
  { "feedbackUiEnabled": true, "evalEnabled": false }
  ```
- 质量页读取该接口；关闭时显示“反馈分诊未启用”，隐藏开始质检/确认/排除按钮。
- ChatWindow 读取同一接口，把 `feedbackUiEnabled` 传给 MessageBubble；不再使用 `NEXT_PUBLIC_AI_FEEDBACK_UI_ENABLED`。
- `POST /admin/ai-eval/datasets` 与 `POST /datasets/:id/cases` 增加 `assertEnabled()`。
- `AI_QUALITY_V2_ENABLED` 从文档移除，不再实现独立回滚开关。

## 自测证据

```text
API 全量：89 suites / 729 tests passed
API typecheck：exit 0
前端全量：55 files / 347 tests passed
前端 typecheck：exit 0
```

## 已知限制

1. `recordErrorTrace` 未写 `aiMessageId`（错误轮通常没有落库 AI 消息）。
2. `testChat`（LIVE eval）仍不写 trace；eval 的 `traceId` 悬空留到 Batch 4 处理。
3. 历史反馈/安全事件没有回填 `traceId` / `conversationId`；只验证新写入。
4. `AiFeedbackClient` 旧页面仍读 `NEXT_PUBLIC_AI_FEEDBACK_UI_ENABLED`（它是 `/ai-feedback` 导出桩，不在 AI Ops 主路径）。
5. EDITOR 工程导航与接口不一致（D-02）仍未处理。

## QA 重点

- `GET /admin/ai-ops/features`：4 角色可读；flag 真/假与 env 一致。
- 关闭 `AI_FEEDBACK_UI_ENABLED`：质量页显示禁用横幅、无写按钮；写接口 403。
- 关闭 `AI_EVAL_ENABLED` 且 `NODE_ENV!=development`：创建数据集/加用例 403。
- 反馈 traceId：造 trace + AI 消息 + feedback，断言 `ai_answer_feedback.trace_id` 等于 trace.id。
- trace aiMessageId：真实 chatStream 后断言 `ai_traces.ai_message_id` 等于本轮 AI 消息 id。
- 安全 conversationId：注入模式 log 下触发一次，断言 `ai_security_events.conversation_id` 有值。
- 前端：ChatWindow 在 flag=false 时不显示反馈按钮；质量页禁用态。
