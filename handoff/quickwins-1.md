# Handoff — 两周项 Quick Wins 1

> 依据：`118` P1-7（知识质量）、P1-11（SLA 多实例）
> 提交：`e4eff5ab`
> 状态：Dev 完成，待 QA

## 改动

### SLA 快照按分钟唯一

- `support_sla_snapshots` 新增 `bucket`（UTC 分钟桶，唯一）。
- 迁移 `20261121140000_support_sla_bucket`：仅
  - `ALTER TABLE ... ADD COLUMN bucket`
  - `CREATE UNIQUE INDEX ... (bucket)`
  - 无 DROP/RENAME/TRUNCATE。
- `SupportSlaService.checkQueue` 改为 `upsert where bucket`：
  - 多实例同一分钟只有一行；
  - 后写更新计数，不再产生重复快照。
- 单测断言 bucket 秒数为 0、create/update 同值。

### 知识质量评分

- `checkTruncation`：
  - Markdown 表格行、列表项、代码块、标题结尾不再判截断；
  - 结尾 emoji/空白/Markdown 修饰符剥离后再看标点；
  - 真正没有结尾标点的长文本仍失败。
- `getQualityStats`：
  - 新增 `flagged`（有标记文档数）；
  - `needReview` 同时包含“低分”和“有标记但分数 ≥70”，避免“待复核 0、标记 5 篇”。
- `RagService.create/update`：
  - 直接建/改文档时也跑同一套解析质量检查，分数不再只在上传时更新。
- 前端：
  - 新增「有标记」卡；
  - 「解析时间」改为「上传时间」。

## 自测

```text
API typecheck：exit 0
RAG 质量单测：5 passed
SLA 单测：6 passed
AiQuality 前端：25 passed
```

## 已知限制

1. `bucket` 对历史行是 null；唯一索引允许多个 null，旧数据不受影响。
2. 同一分钟后写覆盖前写，快照是“该分钟最后一次观测”，不是多实例求平均。
3. `needReview` 现在是并集（低分 + 高标记），与 `flagged` 可能重叠；页面两个数都展示。
4. 评分仍是上传/编辑时的启发式卫生分，不代表检索或回答质量。
5. `recentFlags` 仍按 `createdAt` 排序；“上传时间”标签已修正，但没有真实 parsedAt。

## QA 重点

- 迁移安全审核：只允许 ALTER + CREATE UNIQUE INDEX。
- `checkQueue` 连续调用两次：同一分钟 `support_sla_snapshots` 只有一行，计数被更新。
- 直接插入两条同 bucket → 唯一约束拒绝。
- 5 篇表格/emoji 结尾文档：score 100、无 truncation；`needReview >= flagged`。
- 前端「有标记」显示 5、「待复核」不再为 0；列名“上传时间”。
- 编辑文档内容后 `quality_score/quality_flags` 变化。
