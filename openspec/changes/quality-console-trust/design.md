# Design — quality-console-trust

## Context

见 `proposal.md` 与 `specs/admin-ai/quality-console`、`specs/admin-ai/quality-loop`。现状关键点（实测）：`apps/admin-next/src/api/http.ts` 的 `withRetry` 对 403 返回 `undefined`，`handleHttpError` 同样静默；页面 `advanceReview` 固定 `setReviewIndex(0)`；`failureKind` 初值 `'UNKNOWN'` 且不随条目重置；备注用 `window.prompt`；批量排除并发 20 个 PATCH；「加入回归」默认 `datasetList[0]` 并按 `question` 字符串反查。

## Goals / Non-Goals

**Goals**：页面在每个失败/禁用/未知场景都说真话；质检主流程可连续操作；两个页面动作有确定的服务端语义。

**Non-Goals**：不改执行链路与指标计算（`eval-run-integrity`）；不改读接口分页形状（`eval-console-ops`）；不重做页面视觉。

## Decisions

### D1 403 与禁用态在 HTTP 层显式建模

`withRetry` 不再返回 `undefined`，改为抛 `ForbiddenError`；`handleHttpError` 对 403 返回可区分的错误对象。页面用统一 `RenderState`（`loading | disabled(reason) | error | empty | ready`）渲染，`disabled` 的来源是「无权限」或「`AI_EVAL_ENABLED=false`」。备选（页面各处自行 catch）会再次出现漏判，放弃。

### D2 角色视图复用现有权限，不新增账号类型

沿用页面已有的 `canTriageFeedback(role)` 与 `evalEnabled`，并按角色设默认 tab：运营 → 质量待办；质量负责人 → 回归测试（运行/基线/证据）；研发 → 质量待办内链路面板 + 检索调试；管理者 → 回归测试内趋势。切换 tab 只换默认落点，不改数据口径。备选（新建角色枚举）会牵动鉴权与账号体系，放弃。

### D3 质检交互用局部状态机

卡片维护 `skipping | editing | submitting` 三个互斥状态：跳过只 `setReviewIndex(i+1)`；备注为内联可选输入；提交用 `submittingIds` 集合去重。切条时从 `current.failureKind ?? 筛选值` 重置归因。备选（全局 loading）会让整页闪烁，放弃。

### D4 加入回归走专用接口，事务 + advisory lock

`POST /v1/admin/ai-feedback/:id/regression-case`：事务内 `pg_advisory_xact_lock(hashtext(feedbackId))` → 若已有 `sourceFeedbackId` 对应用例则直接返回（幂等）→ 创建用例并回写 `linkedEvalCaseId`。迁移加 `AiEvalCase(source_feedback_id) WHERE source_feedback_id IS NOT NULL` 部分唯一索引兜底。备选（继续用 `addCases` + 字符串反查）无法消除并发错配，放弃。

### D5 批量排除走单接口，逐条结果

`PATCH /v1/admin/ai-feedback/batch-exclude`：DTO 数组 ≤50，服务端逐条校验（状态、归因、是否判官失败），返回 `{ succeeded: string[], skipped: { id, reason }[] }`。跳过 `MODEL_ERROR` 的理由写入 reason。备选（前端分批限流）仍会产生部分失败无法解释，放弃。

### D6 证据按消息标识精确匹配，回退标注

卡片用现有 trace 查询按 `messageId` 找链路；命中则展示失败 span 摘要；未命中回退会话最新并标「近似」；trace 为空标「证据已过期」。前端推断的归因统一加「推断」徽标。备选（按时间窗猜）会产生错配，放弃。

### D7 分页越界自动回退

列表请求返回后若 `page > max(1, ceil(total/pageSize))`，`setPage` 到最后一页并重取一次；重取仍空才显示空状态。备选（提示用户手动翻页）在批量处理后频繁触发，放弃。

## Requirement ↔ 实现 ↔ 验证映射

| Requirement | 实现位置 | 验证用例 |
|---|---|---|
| 管理端页面必须如实呈现失败、禁用与未知 | `api/http.ts`、页面 `RenderState`、各 KPI 渲染 | vitest：403 → 禁用态；`AI_EVAL_ENABLED=false` → 无写入口；null → 未知 |
| 角色视图必须与决策对应 | 页面 tab 默认值与角色 props | vitest：四种角色默认落点正确，切换后同 run 数字一致 |
| 质检卡片必须可跳过且归因不得被默认值覆盖 | `advanceReview`/归因状态 | vitest：跳过前移、按筛选进入初值正确、切条重置 |
| 分诊提交必须防重复且备注可选 | `submittingIds` + 内联备注 | vitest：双击一次请求、取消不提交、已认领徽标 |
| 质检证据必须可追溯 | 页面链路面板 + trace 查询 | vitest：精确/近似/过期三态；无 trace 不伪造 |
| 分页必须在总量缩水后回退 | 列表请求回调 | vitest：越界回退并重取，真零显示空态 |
| 批量排除必须逐条反馈结果 | 新 controller/service + `batch-exclude` | jest：部分成功逐条 reason；>50 → 400；含 MODEL_ERROR 跳过 |
| 加入回归幂等（支撑上述信任层） | 新 `regression-case` 接口 + 部分唯一索引迁移 | jest：同反馈并发两次 → 同一用例；回链失败整体回滚 |

## Risks / Trade-offs

- [403 改抛错会暴露此前被吞的失败] → 这是目标；在发布说明中列出会变红的入口，避免误报为回归。
- [角色默认视图可能与个人习惯不符] → 只改默认落点，用户切换后本次会话记住选择。
- [部分唯一索引迁移遇到历史重复数据] → 迁移前按 `source_feedback_id` 去重（保留最新），并记录被合并数量。
- [证据回退到会话最新仍可能错配] → 强制「近似」徽标，且不参与任何指标。

## Migration Plan

1. 手写迁移：为 `ai_eval_cases(source_feedback_id)` 建部分唯一索引；迁移前清理重复并记录数量。
2. 发布顺序：迁移 → API（新接口）→ 前端（改用新接口）。
3. 回滚：前端切回旧调用路径；索引可保留（不影响读写）。

## Open Questions

无。
