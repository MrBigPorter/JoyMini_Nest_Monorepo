# Design — eval-console-ops

## Context

见 `proposal.md` 与两个 delta spec。关键实测点：`ai-feedback.service.ts` 的分诊更新是「读→派生→写」非原子、`AiScore` 写入失败被 `.catch()` 吞掉；列表每行 1-3 次查询；页面日期筛选直接把 date-only 当 UTC；`getRun`/`getDataset` 返回全量；`updateCase` 用一次编辑把 `expect` 重写成只剩 `mustMention`；标注写每管理员 JSONL；知识质量与「当前版本」标签混用；`QUEUED`、`executionErrorKind`、`summary.usage`、`AiScore.configId/spanId` 无产出或无消费。

## Goals / Non-Goals

**Goals**：写路径可并发、可回滚；读路径有上限且形状兼容；每个数字可解释；标注可归属且可算一致率；知识口径不再混淆；幽灵值清理或接线。

**Non-Goals**：不改外部指标公式；不重做标注 UI 的交互设计（只删 1-5、补 provenance）；不引入新基础设施。

## Decisions

### D1 分诊用交互式事务 + 版本条件更新

`AiAnswerFeedback` 增 `version` 与 `claimedBy/claimedAt`。`updateTriage` 改为 `$transaction(async tx => ...)`：读当前行（含 version）→ 派生状态 → `updateMany({ id, version })`，`count===0` 返回 409 → 同事务写 `AiScore`（失败即整体回滚，删除既有 `.catch()`）。备选（乐观锁放 Redis）多一失效源，放弃。

### D2 认领与处理完成分离

认领是独立接口语义：`claimedBy` 仅空位可写，`takeOver=true` 才覆盖；`reviewedBy/reviewedAt` 只在判定类提交时写，仅备注不写。列表与卡片以 `reviewStatus + claimedBy` 两个维度展示。

### D3 输入上限 + 题干规范化查重

DTO 上限按 spec；`question` 规范化（trim、压缩空白、统一全半角与大小写）后在同一数据集内查重，命中返回 409 或批量结果中标记 skipped。批上限按端点分档。备选（DB 唯一索引）会把「同题不同答案」也禁止，放弃。

### D4 `expect` 唯一权威

读取时以 `expect` 生成页面判分条件；`expected` 只在无 `expect` 时只读回填。`updateCase` 对 `expect` 做字段级合并（只替换文本字段，保留 `confirmAction/forbidExecution/intent`），避免一次编辑清空条件。

### D5 分页采用增量字段，不改数组形状

`getRun`/`getDataset` 保留 `results`/`cases` 数组为当前页，新增 `resultsTotal/page/pageSize` 与 `casesTotal`；查询参数走独立 DTO（默认 50、上限 200）。`RUNNING` 结果按 `createdAt desc`，保证最新在第一页。备选（改 `{list,total}`）会破坏 harness 与前端，放弃。

### D6 N+1 改固定次数查询

`attachMessageContext` 改为一次 `$queryRaw`（按 `conversationId IN (...) AND id IN (...)` 或窗口函数取所需消息），补 `ChatMessage(conversationId, createdAt)` 与 `(conversationId, source, createdAt)` 索引。备选（Prisma include）无法表达「每会话最新一条」，放弃。

### D7 时区转换放前端工具

URL 保持 `YYYY-MM-DD`；调用 API 前用 `toLocalDayRangeIso` 生成 `[本地 00:00, 次日 00:00)` 的 ISO 区间。后端 `parseDate` 语义不动。备选（后端按服务器时区解释 date-only）会让同一 URL 在不同部署时区产生不同结果，放弃。

### D8 终态刷新用 `prevStatusRef`

轮询回调比较上一状态，仅在 `RUNNING → 终态` 时刷新数据集与基线下拉；`cancel()` 成功后同样触发一次。打开历史终态运行不触发。

### D9 回归可解释走两个只读端点

`GET /runs/:id/history`（单用例跨运行判定时间线）与 `GET /runs/:id/diff`（四分类：新增失败、修复、回退、仍失败）。diff 只做描述性集合运算，显著性仍由 `compare.py` 负责；状态推进由运行结果写回。

### D10 标注落库，JSONL 只作导出

新表 `AiEvalAnnotation`：`runId/caseId/labelerId/correctness/comment/guidelineVersion/source/confidence`，唯一键 `(run_id, case_id, labeler_id)`。删除 helpfulness/tone 1-5（依 `114`）；预标注写 `source='prelabel'` 与置信度。JSONL 导出保留兼容离线脚本。

### D11 知识分拆两个口径

`parseQuality`：4 项结构检查，展示通过与明细；`effectiveness`：登记为 `pendingMetric`，无采集时显示「未采集」。版本区分 `activeVersion`（生效）与最大 `documentVersion`（最新写入）。检索调试保留 `debug.relevanceGate/rerank`。

### D12 幽灵值清理与量纲

`QUEUED` 无产出路径 → 从展示与类型移除或补产出；`executionErrorKind` 由 `eval-run-integrity` 补产出，本 change 接消费；`summary.usage` 与 `metadata.evalRunId` 登记 `pendingConsumer` 或移除；`AiScore` 增 `valueKind`，删除 `configId/spanId` 与 `source=CODE/API`。

### D13 校准端点与看板

`GET /v1/admin/ai-eval/runs/:id/calibration`（数据集级同构）：按 `(run, case)` 连接标注与结果，输出 `agreement`、`n`、`disagreements[]`（caseId、judge verdict、judge reason、human correctness、comment）；`n<20` 返回 `insufficientSample: true` 且不返回百分比。页面只读展示，不写回任何指标。

## Requirement ↔ 实现 ↔ 验证映射

| Requirement | 实现位置 | 验证用例 |
|---|---|---|
| 反馈必须可分诊（MODIFIED） | `ai-feedback.service.ts` `updateTriage`/claim | jest：并发 409、score 失败回滚、仅备注不写 reviewedBy |
| 评测用例输入必须限长且查重 | `eval-dataset.dto.ts` + `addCases` | jest：各字段边界、重复题干、批上限 |
| 判分条件必须唯一且编辑无损 | `updateCase`/`resolveExpectation`/页面 | jest：编辑后条件保留；vitest 展示一致 |
| 评测与回归读取必须分页且有上限 | `getRun`/`getDataset` + DTO | jest：2000→50+total、10000→400、RUNNING 倒序 |
| 反馈列表查询次数必须与页大小无关 | `attachMessageContext` + 索引 | jest：Prisma 调用 ≤5，与页大小无关 |
| 日期筛选必须使用显式时区 | `toLocalDayRangeIso` | vitest：±时区一致，URL 保持日期 |
| 运行终态必须刷新且状态必须可解释 | 页面轮询回调 + 运行卡 | vitest：终态刷新一次、历史终态不刷 |
| 回归用例必须可解释 | `history`/`diff` 端点 + 页面 | jest：三运行时间线、四分类；vitest 展示 |
| 标注必须可归属且不污染指标 | `AiEvalAnnotation` + service | jest：两人并存、唯一键、导出兼容 |
| 知识质量分必须区分解析质量与有效性 | `rag-quality.service.ts`/`rag.service.ts`/页面 | jest：passed 与 checks 同源；vitest：未采集不显示 0 |
| 枚举与摘要字段不得有幽灵值 | 注册表 + 类型清理 | 契约测试通过；grep 无未登记 key |
| 判官校准必须可计算且可见 | `calibration` 端点 + 页面校准卡 | jest：10 条 3 分歧正确、n<20 返回 insufficientSample |
| 任务成功率必须独立判定（MODIFIED） | 校准结果与标注 provenance | jest：样本不足不下结论；标注带 guide 版本 |

## Risks / Trade-offs

- [加 `version` 列与 CAS 会让旧客户端提交失败] → 前端同步带 `expectedVersion`；发布顺序 API 先行、前端随后；缺失版本按「不校验」兼容一个版本周期。
- [分页改增量字段仍需前端改造] → 保留原数组，前端未升级也能工作，只是看不到总数。
- [标注删 1-5 影响离线脚本] → 导出 JSONL 保留旧字段为空，脚本按可选字段读取。
- [校准口径与 80% 阈值可能冲突] → 样本不足只标注、不阻断；达到 20 条后按 80% 判定，阈值写入 spec。

## Migration Plan

1. 迁移 A：`AiAnswerFeedback` 增 `version`（默认 0）、`claimedBy/claimedAt`；`AiScore` 增 `valueKind`（默认 `binary`）、删除 `configId/spanId`。
2. 迁移 B：`ChatMessage` 两条组合索引。
3. 迁移 C：新建 `AiEvalAnnotation` 与唯一键；不导入历史 JSONL（保留为导出）。
4. 部署顺序：迁移 → API → 前端 → 离线脚本。回滚：保留新增列（可空/有默认），代码可回退。

## Open Questions

无。
