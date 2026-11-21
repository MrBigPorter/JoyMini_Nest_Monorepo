# QA Report — Final Batch (Semantic Clusters / Operator Surface / Eval Budget)

> 冻结提交 `ec114966`（语义聚类 `87794db9`、运营面 `e117b51c`、评测预算 `7bec0f8f`、安全修正 `ec114966`）
> 结论：**PASS**（迁移审核 PASS；final-batch API 7/7；运营面 UI 4/4；回归 Batch 1/2/4/5 = 24/18/9/9，Phase 2–5 = 9/9）。无产品缺陷。

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 冻结提交 | `ec114966` |
| 范围 | 语义聚类 + 回退；CLOSED/IGNORED 保护；评测 token 预算；质检运营面；保留/角色回归 |
| 产品代码改动 | 无（QA 只改 `qa/**` 与测试文件） |

## 2. 迁移审核 — PASS

文件：`apps/api/prisma/migrations/20261121170000_ai_problem_cluster_embedding/migration.sql`

```sql
ALTER TABLE "ai_problem_clusters"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

CREATE INDEX IF NOT EXISTS "idx_ai_problem_clusters_embedding_hnsw"
  ON "ai_problem_clusters"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

- 破坏性关键字扫描（DROP/DELETE/TRUNCATE/RENAME）→ **NONE**；
- 仅 `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`，可重复执行；
- `prisma generate` + `prisma migrate deploy` 成功（应用 `20261121170000_ai_problem_cluster_embedding`），`embedding` 列存在；
- 重启 API 后 `/ai-analysis/clusters` 200。

部署时 QA 容器曾停止，`docker start lucky-db-qa lucky-redis-qa` 后恢复。

## 3. 命令

```bash
# 迁移
cd apps/api
set -a; . ../../qa/.env.qa; set +a
npx prisma generate --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
bash ../../qa/scripts/restart-api-env.sh

# 语义聚类 + 预算（会重启 API 切换 embedding/预算）
../../node_modules/.bin/jest --config ./test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/final-batch.e2e-spec.ts

# 运营面
cd ../admin-next
QA_ADMIN_URL=http://127.0.0.1:4101 QA_API_URL=http://127.0.0.1:4102/api \
  ../../node_modules/.bin/playwright test --config=playwright.qa.config.ts \
  e2e-qa/operator-surface.spec.ts

# 回归
npx tsx qa/seed/batch1.ts && npx jest ... batch1-permissions.e2e-spec.ts
npx tsx qa/seed/batch2.ts --clean && npx jest ... batch2-triage.e2e-spec.ts
npx jest ... batch4-eval.e2e-spec.ts
npx tsx qa/seed/batch5.ts && npx jest ... batch5-analysis.e2e-spec.ts
npx jest ... phase2-5.e2e-spec.ts
```

日志：`qa/logs/final-batch-api.log`、`qa/logs/operator-surface-playwright.log`、`qa/logs/regression-*.log`。

## 4. 结果

| 套件 | 结果 |
|---|---|
| Final batch API（7 cases） | **7 passed / 0 failed** |
| 运营面 UI（4 cases） | **4 passed / 0 failed** |
| Batch 1 权限 | 24/24 |
| Batch 2 triage | 18/18 |
| Batch 4 eval | 9/9 |
| Batch 5 analysis | 9/9 |
| Phase 2–5 | 9/9 |

### 4.1 语义聚类 — PASS

QA stub 实现 Ollama 兼容 `/api/embeddings`，返回 1024d 确定性向量：优惠券类问题共享同一维度（余弦距离 0）；`qa_dim_mismatch` 返回 768d。为消除外部依赖，测试固定关闭 Jina/Infinity，仅走 Ollama stub。

| 用例 | 结果 |
|---|---|
| 不同签名但同义：`qa_final_优惠券怎么领` / `qa_final_哪里领券` | 合成 **1 个簇**，count=2；代表问题保留首条 `qa_final_优惠券怎么领`；簇 embedding 非空 |
| 同窗口重跑 | count 仍 2，不翻倍 |
| 簇置 CLOSED 后再来同义问题 | 旧簇不接收，新建簇 count=1；旧簇 count 保持 2 |
| 新簇置 IGNORED 后再来同义问题 | 再建新簇 count=1；IGNORED 簇 count 保持 1 |
| 无 provider（Ollama embedding URL 指向死端口） | run **COMPLETED**；两个退款问题按签名各成 1 簇（各 count=1） |
| 维度不符（stub 返回 768d） | run **COMPLETED**；按签名建簇，簇 embedding 为 NULL |

> 语义合并为**真实 HTTP provider 路径 E2E**（QA 1024d stub），不是仅单测；提交内另有 service 单测。真实 Jina 语义质量未在本轮测量。

### 4.2 评测 token 预算 — PASS

| 用例 | 结果 |
|---|---|
| `AI_EVAL_RUN_TOKEN_BUDGET=200` + 2000 字长答案 | run **FAILED**；`summary.error='token budget exceeded'`；`summary.usage.exceeded=true`、`budget=200`；`finishedAt` 有值 |
| 同预算 + 两条慢判分用例，启动 0.8s 后 cancel | 6s 后仍 **CANCELLED**，未变 FAILED/COMPLETED（取消优先） |
| 默认预算 + 两条正常用例 | **COMPLETED**；`summary.usage.estimatedTokens>0`、`costConfigured=false`、`exceeded=false`；2 条结果 |

### 4.3 运营面 — PASS

| 用例 | 结果 |
|---|---|
| 批量排除 | 按钮显示当前页 `（2）`；确认后只把 2 条 SERVICE_ERROR 置 IGNORED/EXCLUDED；MODEL_ERROR 两条仍 PENDING/OPEN |
| 认领 | 认领写 `ownerAdminId=qa_admin_admin`，提示「已认领，负责人是你」 |
| 已确认行 | 「标记已修复待验证」→ FIXED_PENDING_VERIFY；「关闭」→ CLOSED，DB 一致 |
| 质检卡 | 显示「转人工原因：用户明确要求」「处理客服：人工客服（qa_admin）」「负责人：我」 |
| 快捷键 | J/K 切换卡片；1/2/3 选择回答正确/确认/排除；选主要原因 `MODEL_ERROR` 后 Enter 保存并下一条，DB `REVIEWED/CONFIRMED/MODEL_ERROR`；Esc 退出 |
| 知识检索 0 命中 | 显示「没有检索到相关文档」+ 4 项检查清单 + `/knowledge` 链接；无 `"chunkId"`/`"documentId"` 原始 JSON |

## 5. 缺陷

**无产品缺陷。** 本批未发现 P0–P3 产品问题。

## 6. 测试侧调整（非产品缺陷）

1. **Batch 5 角色断言更新**：`4cc2954a` 已把 analysis 读接口收紧为 SUPER/ADMIN；Batch 5 原断言「EDITOR 可读 (200)」改为 **403**，ADMIN 仍 200。Batch 5 复跑 9/9。
2. **final-batch 前缀隔离**：初版用 `qa_fb_` 与 Batch 1 seed 的 feedback id 冲突；已改为 `qa_final_`，避免清理误删 Batch 1 数据。
3. **嵌入 provider 固定**：final-batch 测试重启 API 时关闭 Jina/Infinity，仅走 QA Ollama stub，避免外部 API key/网络造成不确定；结束时恢复原始 QA 环境。
4. **QA stub 扩展**：`qa/scripts/judge-stub.mjs` 新增 `/api/embeddings`（兼容 `/v1/api/embeddings`），返回 1024d；`qa_dim_mismatch` 返回 768d。

## 7. 残留 / 未覆盖

1. 语义聚类 E2E 使用确定性 stub，不评估真实 embedding 语义质量/阈值分布；真实 Jina 仅作为环境可用性观察。
2. 告警与预算均为字符数估算，不是真实 token 账单（代码已在注释说明）。
3. 预算/取消测试单实例、单 worker；未验证多实例并发。
4. 运营面只跑到 ADMIN；VIEWER 只读与 EDITOR 无入口沿用既有导航/角色测试。
5. 页面回归只跑 operator-surface；未跑前端全量（提交方声明 356 通过）。
6. `AI_EVAL_RUN_TOKEN_BUDGET` 在进程启动时读取，测试通过重启 API 切换；未验证运行时热更新。
