# Tasks

## 1. 常量模块落地（行为不变）

- [ ] 1.1 新增 `apps/api/src/client/ai-customer/graph/constants/intent.ts`，按 `design.md` D1 导出 7 个常量，每个常量带单位与作用对象注释；验证：`yarn workspace @lucky/api tsc --noEmit --pretty` 0 error
- [ ] 1.2 在模块文件顶部写明「本文件是意图链路阈值唯一事实来源，新增阈值必须落在这里」；验证：文件存在该说明且评审可见
- [ ] 1.3 把 `intent-classifier.ts` 的 `LOW_CONFIDENCE_THRESHOLD`、`GAP_THRESHOLD`、`VECTOR_WEIGHT`、`BM25_WEIGHT` 改为引用常量模块；验证：文件内不再出现裸浮点阈值字面量，`grep -n '0\.7\|0\.3\|0\.02' intent-classifier.ts` 仅剩注释与测试数据
- [ ] 1.4 把 `intent-router.node.ts` 的 `LOW_CONFIDENCE_THRESHOLD`（0.5）改为引用 `ROUTER_FALLBACK_THRESHOLD`；验证：该文件不再有同名常量声明，`tsc` 0 error
- [ ] 1.5 把 `orchestrator.node.ts` 的 `MIN_SCORE`、`SCORE_MARGIN` 改为引用 `INTENT_MIN_SCORE`、`INTENT_SCORE_MARGIN`；验证：`tsc` 0 error，且该文件不再声明这两个局部常量
- [ ] 1.6 跑全量单测，确认替换后行为完全不变；验证：`yarn workspace @lucky/api test` 中 `intent-classifier`、`intent-router`、`orchestrator` 相关套件全绿，无新增失败

## 2. 融合与门禁顺序修正（行为变更，独立提交）

- [ ] 2.1 重构 `intent-classifier.ts` 的召回处理为三步：两路各自取域内最高分 → 加权融合 → 按域去重 → 施加 `INTENT_MIN_SCORE`；验证：代码中阈值判断只出现在去重之后一处
- [ ] 2.2 保持 `human_support` 的 BM25 缺失惩罚仍作用于融合前的向量分；验证：现有 human_support 惩罚单测不变绿
- [ ] 2.3 新增单测覆盖「向量 0.69 + 关键词 0.90 → 融合 0.753，进入候选集」；验证：该用例通过，且把门禁移回融合前时该用例变红（红绿验证记录进 PR 描述）
- [ ] 2.4 新增单测覆盖「两路融合后仍低于 `INTENT_MIN_SCORE` → 被淘汰」；验证：该用例通过
- [ ] 2.5 跑全量单测；验证：除 2 个已知过期套件外全绿，若顺序修正导致既有用例变红，逐条判断是「用例固化了旧顺序」还是「真实回归」并在 PR 中说明

## 3. 注释与日志口径对齐

- [ ] 3.1 删除 `orchestrator.node.ts:299-300` 里 gap 阈值 0.15 的过期注释，改为引用 `INTENT_SCORE_MARGIN` 的当前值来源；验证：该段注释不再出现具体数字 0.15
- [ ] 3.2 修正 `orchestrator.node.ts:341` 「同一 domain 可能出现多次（BM25 + vector 各来一次）」的失效说明；验证：注释与 `intent-classifier.ts` 的出口行为一致
- [ ] 3.3 在 `intent-classifier.ts` 的门禁处补一条日志，同时输出两路原始分与融合分；验证：本地跑一题命中双路的输入，日志中三者均可读
- [ ] 3.4 把 `design.md` D3 的结论写成代码注释：仅关键词命中的意图上限为 `BM25_FUSION_WEIGHT`，必然触发大模型重判；验证：注释存在且与常量引用一致

## 4. 文档对齐

- [ ] 4.1 更新 `CLAUDE.md` 的 Key Architecture 条目，把 `MIN_SCORE=0.65 / SCORE_GAP=0.15` 改为指向 `graph/constants/intent.ts`，不再写数值；验证：`grep -n '0.65\|0.15' CLAUDE.md` 不再命中阈值描述
- [ ] 4.2 在 `docs/AI-joymini/63-Intent-Score-Gap-Check-Spec.md` 顶部加迁移横幅（正文按档案策略不动）；验证：文件首屏可见横幅
- [ ] 4.3 更新 `docs/current-task.md` 的 T2-2 行状态；验证：状态列与实际进度一致

## 5. 回放验证（合入门槛）

- [ ] 5.1 用 `tools/eval/run-replay.sh` 分别对「顺序修正前」「顺序修正后」各跑一次；验证：两次输出文件均落盘可对比
- [ ] 5.2 出具对比表：Top-1、macro-F1、各意图精确率、候选集平均大小；验证：表格写入新编号文档 `docs/AI-joymini/`，含结论句
- [ ] 5.3 判定是否满足合入条件（Top-1 降幅 ≤1 个百分点且 `rag` 精确率不劣化）；验证：结论明确写「保留」或「回退 2.x 提交」，回退时执行 revert 并复跑一次确认回到基线

## Workflow follow-up

- 满足本仓库评审要求后归档变更：`openspec archive unify-intent-thresholds`
- 归档后确认 `openspec/specs/ai-customer/` 下两个主规格已生成且 `openspec validate --specs` 通过
