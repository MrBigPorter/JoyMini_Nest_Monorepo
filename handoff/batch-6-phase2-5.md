# Handoff — 119 Phase 2–5

> 依据：`docs/AI-joymini/119` §6.3 / §7.2 / §8 / §11
> 提交：`2a8fc31a`
> 状态：Dev 完成，待 QA

## 数据模型

新增迁移 `20261121160000_ai_problem_clusters_alerts`：

- `ai_problem_clusters`：signature 唯一、代表问题、count、severity、intent/domain、suggestedCause/fixType/status/owner、first/last seen。
- `ai_problem_cluster_days`：簇按天计数，`(cluster_id, day)` 唯一。
- `ai_analysis_alerts`：指标异常告警，`(window_start, metric, dimension, dimension_value)` 唯一。

> 迁移仅 CREATE TABLE/INDEX，无 DROP/RENAME/ALTER。

## 行为

### Phase 2：问题簇

- 事件构建时把用户问题（feedback.input / trace.input）脱敏后截 200 字，写入 `metadata.questionPreview`。
- `clusterWindow` 对 preview 做「小写 + 去标点空白」签名（sha256 前 64 位），按签名 upsert 簇：
  - 重复跑同一窗口不会累加 count；count 从 `ai_problem_event` 反算；
  - `cluster_day.count` 按当天事件数覆盖；
  - 事件回填 `clusterId`。
- 归因建议：SERVICE_ERROR→SERVICE、ZERO_HIT→KNOWLEDGE_GAP、UNEXPECTED_TRANSFER→ROUTING、EVAL_UNSOLVED→MODEL、SECURITY_HIT→SECURITY、ABANDONED/REPEATED→UX。
- **限制**：签名是精确/近精确去重，不是 embedding 语义聚类；同义改写不会合并。语义聚类需要 pgvector + embedding，后续增强。

### Phase 3：告警

- 每小时第 5 分钟重跑当天窗口（幂等）。
- 指标 `ALL` 维度、样本 ≥5、有 ≥3 天历史时：
  - value > max(baseline×1.5, 0.05) 且 value ≥0.2 或 >baseline×1.5 才告警；
  - HIGH/MEDIUM，写 `ai_analysis_alerts`。
- 页面可确认（ACK）。

### Phase 4：修复闭环

- `PATCH clusters/:id`：status（NEW/ASSIGNED/FIXING/VERIFYING/CLOSED/IGNORED）、ownerAdminId、fixType、suggestedCause。
- `POST clusters/:id/regression {datasetId, expected}`：
  - 用簇代表问题创建回归用例，`expect.mustMention=[expected]`、`source='cluster'`、metadata.clusterId；
  - 簇状态置 FIXING；
  - 期望答案必填。
- 页面：认领、状态、修复类型、建回归；簇按天趋势可通过 `GET clusters/:id` 返回。

### Phase 5：保留

- 每日 04:00 UTC：事件 180 天、运行 90 天、簇日 365 天、告警 180 天。
- 未做表分区；当前是 deleteMany + 现有索引。数据量上来后再迁移成分区。

## 自测

```text
API typecheck：exit 0
前端 typecheck：exit 0
analysis service spec：3 passed
```

## 已知限制

1. 聚类不是语义聚类；同义问题不会合并。
2. 告警阈值是启发式，样本量小；生产需要按真实分布调参。
3. 告警每小时重跑当天窗口，没有独立小时指标表。
4. 回归从簇生成时用簇代表问题，不包含完整上下文/期望答案模板。
5. 保留是 delete，不归档；分区未做。
6. 簇/告警页面只在 `/ai-ops/analysis`，没有独立路由。

## QA 重点

- 迁移安全审核；`prisma generate` + `migrate deploy`。
- 造同一问题多条事件 → 簇 count/天数正确；重跑窗口 count 不翻倍。
- 簇 PATCH 状态/负责人/修复类型；建回归后用例带 expected + source=cluster，簇变 FIXING。
- 告警：造 4 天历史 + 当天高值 → 生成告警；低样本不告警；ACK 生效。
- 保留：插入 200 天事件/100 天 run/400 天簇日/200 天告警，调用 purge 后清理。
- 页面：问题簇/告警表格、认领、状态/修复类型、建回归、告警确认。
