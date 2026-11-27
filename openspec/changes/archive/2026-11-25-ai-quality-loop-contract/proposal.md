# Proposal — AI 质量闭环唯一契约

## Why

`/ai-ops/quality` 的可靠性问题不是零散 bug，而是**这条链路没有唯一契约**：`admin-ai/quality-loop` 的 4 条 Requirement 远落后于已上线的行为，`ai-customer/quality-loop` 与它在「判官失败」上互斥，`metricSpecVersion='3'` 同时用于两套指标，页面上「基线」有三义，「待处理」有四义。结果是每个功能按当下理解单独实现，交接处全部对不上：反馈↔用例两列只写不读、内部 run 永不 promote、判官坏了通过率莫名下跌、403 被吞成成功。

产品叙事已固化在 `docs/AI-joymini/122-AI质量闭环-需求总纲.md`。本 change 把它变成**可测契约 + 可执行门禁**，供三个修复 change（`eval-run-integrity`、`quality-console-trust`、`eval-console-ops`）共同引用，避免各写各的。

## What Changes

- 新增 capability `ai-quality/loop-contract`，立 7 条 Requirement：
  1. 链路十步必须各有唯一产出与消费方（空消费方须登记 `pendingConsumer`）；
  2. 指标必须登记族、分母与版本（禁止同名异义、禁止两族共用版本号）；
  3. 术语必须唯一（「基线」「待处理」「当前版本」各只一义）；
  4. 权威层级必须成文并被遵守（judge verdict 定分，标注只校准，failureKind 只路由，解析分只描述解析）；
  5. 对外数字必须可溯源（run、族/版本、判官版本、快照、scope）；
  6. 状态机不得有死状态（含 `FIXED_PENDING_VERIFY` 自动推进）；
  7. 一致性门禁必须可执行（注册表 + jest、Requirement↔实现↔用例映射、coding-standards 审阅项）。
- 不修改既有 capability 的 Requirement；不写实现代码。

## Capabilities

### New Capabilities

- `ai-quality/loop-contract`: 横跨 admin 与 ai-customer 的质量闭环契约——产出/消费登记、指标字典、术语与权威层级、溯源、状态机、一致性门禁。

### Modified Capabilities

（无。本 change 只新增契约；既有 `admin-ai/quality-loop` 与 `ai-customer/quality-loop` 的 Requirement 变更分别落在三个修复 change。）

## Impact

- 约束面：`apps/api`（summary/枚举/指标族）、`apps/admin-next`（术语与未知态）、数据库字段登记（仅契约要求，不落实现）。
- 不改变任何现有接口行为；三个修复 change 各自声明所改链路步骤并引用本契约。
- 涉及文档：`docs/AI-joymini/122-AI质量闭环-需求总纲.md`、`docs/coding-standards.md`（新增审阅项）。
