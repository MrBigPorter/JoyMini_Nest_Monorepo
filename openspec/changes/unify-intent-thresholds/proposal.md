# Proposal

## Why

意图判定的门禁阈值目前散落在四处、名称与语义互相冲突，同一常量名在分类器和路由节点里取不同值；注释、`CLAUDE.md`、`docs/AI-joymini/63-*.md` 与代码三方对不上。更关键的是**置信度门禁作用在融合之前**：pgvector 与 BM25 两路结果各自先被 `0.7` 卡一遍，再做加权融合，导致「向量分 0.69 + BM25 分 0.90」的意图两条腿分别被淘汰或打折，而它按融合公式本应得到 0.753 并顺利过线。这类样本在 golden set 中被计为误判，却无法从现有日志区分「模型分低」和「门禁位置错」，直接阻碍 T2-3 的归因（当前基线 Top-1 68.2%，`rag` 精确率 38.9%）。

## What Changes

- 新增单一常量模块导出全部门禁参数，消除 `LOW_CONFIDENCE_THRESHOLD` 同名不同值（分类器 `0.7` / 路由节点 `0.5`），并区分两者的语义：前者是**召回及格线**，后者是**回落 LLM 的终判线**。
- **BREAKING（行为）**：置信度门禁从「两路各自过滤 → 再融合」改为「两路融合 → 再去重 → 再过滤」。融合分不再因为单路分数略低于阈值而被提前淘汰。
- 修正 `orchestrator.node.ts` 中关于 gap 阈值 `0.15` 的过期注释，以及「同一 domain 可能出现多次（BM25 + vector 各来一次）」的失效说明——分类器出口已经按域去重。
- 明确三组观感相近但语义不同的参数各自的名字与单位：召回及格线、融合权重、close-contenders 边际，禁止复用同一名字。
- 对齐 `CLAUDE.md` 与 `docs/AI-joymini/63-Intent-Score-Gap-Check-Spec.md` 中写死的阈值，改为指向常量模块。
- 阈值**数值**本次不调整；若融合顺序修正后 golden set 指标变动，另行出具对比数据再决定是否重设门禁。

## Capabilities

### New Capabilities

- `ai-customer/intent-classification`: 多路召回（pgvector + BM25）的融合、按域去重、置信度门禁与 LLM 回落——规定门禁必须作用在融合之后，且阈值只有一个事实来源。
- `ai-customer/intent-selection`: 通过门禁后的多标签如何收敛为待执行意图集合——close-contenders 边际、catch-all 意图的降级规则、无标签时的兜底。

### Modified Capabilities

（无。项目此前没有 OpenSpec 规格，这是首次为意图链路建立基线。）

## Impact

**代码**

- `apps/api/src/client/ai-customer/graph/utils/intent-classifier.ts` — 阈值常量、融合与过滤顺序、`GAP_THRESHOLD` 用途澄清
- `apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts` — 重命名终判线常量，避免与召回及格线混淆
- `apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts` — 复用常量模块，修正过期注释
- 新增 `apps/api/src/client/ai-customer/graph/constants/intent.ts`（路径以实施时既有目录约定为准）

**测试**

- `intent-classifier` / `orchestrator.node` 现有单测需要跟着常量迁移；新增「融合分过线但单路低于阈值」的样本用例，并做红绿验证。

**文档**

- `CLAUDE.md` 的 Key Architecture 条目、`docs/AI-joymini/63-Intent-Score-Gap-Check-Spec.md`、`docs/current-task.md` 的 T2-2 行。

**度量**

- 复跑 `tools/eval/run-replay.sh`，出具「改前 vs 改后」Top-1 准确率与各意图精确率对比；无改善则回退顺序修正。

**不涉及**：数据库结构、对外 HTTP 接口、SSE 事件格式、前端。
