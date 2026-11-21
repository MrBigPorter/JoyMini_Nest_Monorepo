# Handoff — Batch 4

> 依据：`docs/AI-joymini/120` §7 Batch 4；`118` #3、#6
> 状态：Dev 完成，待 QA 真实后端验证

## 任务

- 118 #3：回归用例必须有期望答案；来源反馈；用例可编辑/删除。
- 118 #6：eval run 生命周期（并发锁、孤儿回收、终态停轮询、显示 error）。

## 提交

- `f6e39769` feat(api): require eval expectations and add run lifecycle controls
- `c08df55c` feat(admin): require expected answers for regression cases

## 行为变化

### 后端

- `EvalCaseDto` 新增 `expected / metadata / sourceFeedbackId / source`，`addCases` 持久化。
- `startRun`：
  - 任一用例没有 `expect.mustMention` / `expect.confirmAction` / `expected` → 400；
  - 同一 dataset 已有 RUNNING → 400；
  - 启动前把超过 30 分钟的 RUNNING 标 FAILED（`summary.error`）。
- 新增 `PATCH /datasets/:id/cases/:caseId`、`DELETE /datasets/:id/cases/:caseId`（SUPER/ADMIN，受 `AI_EVAL_ENABLED` 门禁）。
- LIVE eval 不再生成随机 `traceId`；`AiEvalResult.traceId` / `AiScore.traceId` 为 null（testChat 不写 trace，留空比悬空诚实）。
- `getDataset` 返回 `_count.runs/cases`，运行次数不再被 `take:20` 冒充总数。

### 前端

- 「加入回归」先要求填写期望答案；发送：
  ```json
  { "expect": { "mustMention": ["..."] }, "expected": "...", "sourceFeedbackId": "fb-id", "source": "feedback" }
  ```
- 用例列表显示期望，支持「编辑期望」「删除」。
- 评测运行：启动后轮询，`COMPLETED/FAILED` 停止；`summary.error` 显示失败原因。
- 运行次数用 `_count.runs`。

## 自测证据

```text
API 全量：89 suites / 734 tests passed
API typecheck：exit 0
前端全量：55 files / 348 tests passed
前端 typecheck：exit 0
```

## 已知限制 / 迁移影响

1. **存量用例**：现有 `expect={}` 的用例在新规则下无法启动，必须先在页面补期望（或重新导入）。这是有意的门禁，不是 bug。
2. LIVE eval 仍不写 trace；如果未来需要，必须让 `testChat` 接入 TraceService。
3. 历史 `AiEvalResult.traceId` 悬空数据未清理；只影响旧结果。
4. 用例删除是硬删；已产生的 results 通过外键级联删除（Prisma onDelete: Cascade）。
5. 并发锁是应用层检查，极端并发下仍可能两个请求同时通过；单实例足够，多实例需 DB 唯一约束/锁（Batch 5+）。

## QA 重点

- 空期望启动 → 400；补 `expected` 后可启动。
- 同 dataset 第二次启动（RUNNING 中）→ 400。
- 手动把 run.startedAt 改成 40 分钟前 → 下一次 list/get 后变 FAILED 且有 error。
- `PATCH/DELETE cases` 持久化/删除；跨 dataset 的 caseId → 404。
- 加入回归：不填期望 → 前端不调用 addCases；填了 → payload 带 expected/sourceFeedbackId/source。
- LIVE 运行结果 `traceId = null`，AI score traceId 也为 null。
- 前端：run 完成后轮询停止；FAILED 显示失败原因。
