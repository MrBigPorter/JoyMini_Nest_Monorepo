# Tasks

## 1. 写路径

- [x] 1.1 手写迁移：`AiAnswerFeedback` 增 `version`（默认 0）、`claimedBy/claimedAt`；DTO 增 `expectedVersion/takeOver`；`updateTriage` 改交互式事务 + CAS + `AiScore` 同事务（删除 `.catch()`）；select 扩全；spec mock 改交互式事务；验证：jest 并发提交返回 409、评分失败整体回滚、仅改备注不写 reviewedBy [Req: 反馈必须可分诊]
- [x] 1.2 认领 CAS：仅空位可认领，`takeOver=true` 才覆盖；前端带 `expectedVersion`；验证：jest 两人同时认领只有一个成功，vitest 覆盖按钮态 [Req: 反馈必须可分诊]
- [x] 1.3 认领与处理完成分开呈现；`REVIEWED` 不再吞 `NO_ISSUE/ADDED_TO_EVAL/FIXED_PENDING_VERIFY/CLOSED`；验证：vitest 状态文案与筛选计数正确 [Req: 反馈必须可分诊]

## 2. 输入与判分条件

- [x] 2.1 DTO 限长（题干 2000/答案 8000/标签 20×32/必含关键词 20×500/判分条件 8KB）与端点分档批上限；`expected` 用自定义校验而非 `@MaxLength`；验证：jest 各边界值、`>50` 与超长返回 400 [Req: 评测用例输入必须限长且查重]
- [x] 2.2 题干规范化查重（同数据集）；验证：jest 空白/全半角/大小写差异判为重复，结果含 skipped 原因 [Req: 评测用例输入必须限长且查重]
- [x] 2.3 `expect` 为唯一判分字段；`updateCase` 字段级合并保留 `confirmAction/forbidExecution/intent`；`expected` 只读回填；验证：jest 编辑后条件仍在、判分结果与编辑一致 [Req: 判分条件必须唯一且编辑无损]
- [x] 2.4 前端编辑 UI 默认展示 `expect`、`maxLength` 限制、条件字段可见；验证：vitest 与 tsc 通过 [Req: 判分条件必须唯一且编辑无损]

## 3. 读取

- [x] 3.1 `runs/:id` 增 `resultsTotal/page/pageSize`（独立 DTO，默认 50、上限 200），保留 `results` 数组；RUNNING 按 `createdAt desc`；验证：jest 2000 条 → 50+total；10000 → 400；harness 与 e2e 仍读到数组 [Req: 评测与回归读取必须分页且有上限]
- [x] 3.2 `datasets/:id` 同形状；`addCases` 返回 `created`；用例数改用 `_count.cases`；验证：jest 与 vitest 通过，回归页总数正确 [Req: 评测与回归读取必须分页且有上限]
- [x] 3.3 `getChunks` 保持全量；新增服务端 `chunks/diff` 端点（按两版本 chunkIndex 并集判新增/删除/修改）；前端改调 diff；验证：jest 三分类正确，`tools/eval` 仍拿到数组 [Req: 评测与回归读取必须分页且有上限]
- [x] 3.4 前端结果与用例分页控件；轮询只取第 1 页；验证：vitest + tsc 通过 [Req: 评测与回归读取必须分页且有上限]

## 4. 性能与时区

- [x] 4.1 迁移加 `ChatMessage(conversationId, createdAt)` 与 `(conversationId, source, createdAt)` 两索引；`attachMessageContext` 改固定次数 `$queryRaw`；验证：jest 记录 Prisma 调用次数 ≤5 且 10 条与 100 条页大小一致 [Req: 反馈列表查询次数必须与页大小无关]
- [x] 4.2 新增 `toLocalDayRangeIso`，URL 保持 `YYYY-MM-DD`；验证：vitest 在 `TZ=Asia/Shanghai` 与 UTC 下区间一致，刷新后筛选保持 [Req: 日期筛选必须使用显式时区]

## 5. 状态与未知态

- [x] 5.1 `prevStatusRef` 检测 RUNNING→终态后刷新数据集与基线下拉，`cancel()` 成功同样刷新；验证：vitest 各触发一次，打开历史终态不触发 [Req: 运行终态必须刷新且状态必须可解释]
- [x] 5.2 运行卡展示 `runId/scope/metricFamily/processed/total/failureCategory`；验证：vitest 断言齐全 [Req: 运行终态必须刷新且状态必须可解释]
- [x] 5.3 未知态规范全站落地（`null` → 未知/未检查，推断标「推断」）；验证：`grep -n "?? 0"` 在质量页归零，vitest 覆盖三类未知 [Req: 枚举与摘要字段不得有幽灵值]

## 6. 溯源

- [x] 6.1 迁移建 `AiEvalAnnotation`（`labelerId/guidelineVersion/source/confidence`，唯一键 `(run_id, case_id, labeler_id)`）；标注 service 改 DB，JSONL 仅导出；删除 helpfulness/tone 1-5；预标注 confidence 落库；验证：jest 两人同 case 并存、唯一键冲突处理、导出兼容离线脚本 [Req: 标注必须可归属且不污染指标]
- [x] 6.2 `history` 与 `diff` 端点（描述性四分类，不声称显著）；验证：jest 三次运行时间线与四分类结果正确 [Req: 回归用例必须可解释]
- [x] 6.3 `FIXED_PENDING_VERIFY` 由运行结果自动推进：通过关闭、失败打回并记 `regressedAt`；验证：jest 状态机三态各一例 [Req: 回归用例必须可解释]
- [ ] 6.4 前端时间线、diff 与待验徽标；验证：vitest 通过 [Req: 回归用例必须可解释]
- [ ] 6.5 知识分拆 `parseQuality`/`effectiveness`；展示 `passed` 与四项检查明细；分档与 `passed` 同源；版本区分 `activeVersion` 与最新写入；检索调试保留 `debug.relevanceGate/rerank`；验证：jest 与 vitest 通过，未采集显示「未采集」而非 0 [Req: 知识质量分必须区分解析质量与有效性]
- [ ] 6.6 新增 `GET /v1/admin/ai-eval/runs/:id/calibration`（数据集级同构）：一致率、`n`、分歧明细；`n<20` 返回 `insufficientSample` 且无百分比；页面只读校准卡；验证：jest 10 条标注 3 条分歧结果正确、n=10 返回样本不足；vitest 不显示百分比 [Req: 判官校准必须可计算且可见]

## 7. 幽灵值与验证

- [ ] 7.1 清理或接线：`QUEUED`、`executionErrorKind`、`summary.usage`、`metadata.evalRunId`、`AiScore.configId/spanId` 与 `source=CODE/API`；`AiScore` 增 `valueKind`；验证：`quality-contract` 注册表测试通过，grep 无未登记 key [Req: 枚举与摘要字段不得有幽灵值]
- [ ] 7.2 全量验证：`openspec validate "eval-console-ops" --strict`、两端 tsc、api jest（ai-feedback/ai-eval/rag）、admin vitest、curl 分页边界；验证：全部命令以 0 退出，`resultsPageSize=10000` 返回 400 且 `results` 仍为数组 [Req: 评测与回归读取必须分页且有上限]
- [ ] 7.3 校准与阈值演练：构造 25 条标注（含 5 条分歧）与 10 条标注两组数据，确认前者返回一致率与明细、后者返回样本不足；验证：两组断言符合预期 [Req: 判官校准必须可计算且可见]

## Workflow follow-up

- 实现并验证通过后运行 `openspec archive "eval-console-ops"`。
- 归档前确认 `ai-quality-loop-contract` 已归档。
