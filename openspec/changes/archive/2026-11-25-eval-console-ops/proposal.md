# Proposal — 质量台数据正确性与可解释性

## Why

页面能打开不等于数字可信。当前存在一批会给出**错误结论**而非仅仅少显示的问题：反馈列表每行 1-3 次查询（100 条即 200-300 条 SQL）；日期筛选按 UTC 日界而页面按本地显示，中国区「11-20」实际是本地 08:00 到次日 08:00；评测结果与用例无分页，大文档一次返回数十 MB；判分读 `expect`、页面展示 `expected`，编辑又把 `expect` 整体重写；分诊「读旧值→派生→写」非原子，可写出 `verdict=correct + resolution=EXCLUDED` 的矛盾行；标注只存每管理员 JSONL，无标注者外键、无 guide 版本，没有任何消费者；知识「检索质量」实为 4 条解析启发式；`QUEUED`、`executionErrorKind`、`summary.usage` 等幽灵值让契约看起来比实际完整；回归只有「新建规则 + run 列表」，无法回答「这条用例从哪来、每次判定如何、两次差在哪」；人工校准在契约里写了 10%/80%，但从未实现。

本 change 收口链路 5-6、8-10 与支撑 B（标注校准），使每个数字与每条结论都能被复算和解释。

## What Changes

- `admin-ai/quality-loop`：
  - MODIFIED `反馈必须可分诊`：分诊事务化 + 并发冲突检测 + 认领字段与处理完成分开。
  - ADDED 11 条：用例输入限长与查重、判分条件唯一且编辑无损、读取分页与上限、反馈列表固定查询次数、显式时区、运行终态刷新与状态可解释、回归可解释（时间线 + 四分类 diff + 自动闭环）、标注可归属、知识分拆解析/有效性、无幽灵值、判官校准可见（`n<20` 不下结论）。
- `ai-customer/quality-loop`：MODIFIED `任务成功率必须独立判定` 的人工校准 Scenario，补样本入库、provenance、样本量门槛，与既有 10%/80% 合并为一条口径。
- **BREAKING**：`expect` 成为唯一判分字段（`expected` 降级为只读兼容）；标注删除 helpfulness/tone 1-5；分页响应在保留原数组的同时新增计数字段。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `admin-ai/quality-loop`: 修改 `反馈必须可分诊`；新增数据正确性、分页、溯源、标注、知识口径、校准等 11 条。
- `ai-customer/quality-loop`: 修改 `任务成功率必须独立判定` 的人工校准要求。

## Impact

- 影响：`apps/api`（`ai-feedback.service.ts`、`ai-eval-dataset.service.ts`、`rag.service.ts`、`annotation-queue.service.ts`、RAG 质量服务）、`apps/admin-next`（质量页、API 类型、工具函数）、`tools/eval`（标注导出兼容）。
- 数据：`AiAnswerFeedback` 增 `version/claimedBy/claimedAt`；新增 `AiEvalAnnotation`；`ChatMessage` 增两条索引；`AiScore` 增 `valueKind` 并清理未用字段。
- 不改外部 `answer_accuracy-v3` 口径与既有 `passRate` 语义。
