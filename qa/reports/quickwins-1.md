# QA Report — Quick Wins 1

> 依据：`118` P1-7（知识质量）、P1-11（SLA 多实例）；`handoff/quickwins-1.md`
> 结论：**PASS**（迁移安全；SLA 分钟桶去重、知识评分修正、前端卡片/列名、Batch 5 与质量页回归均通过）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 冻结提交 | `0f6518d5`（代码 `e4eff5ab`、handoff `quickwins-1.md`） |
| 范围 | SLA 快照按 UTC 分钟去重；知识截断评分/质量统计；直接建改文档重算；质量页 RAG tab |
| 产品代码改动 | 无（QA 只改 `qa/**` 与测试文件） |

## 2. 迁移安全审核（先做）— PASS

文件：`apps/api/prisma/migrations/20261121140000_support_sla_bucket/migration.sql`

```sql
ALTER TABLE "support_sla_snapshots" ADD COLUMN "bucket" TIMESTAMP(3);
CREATE UNIQUE INDEX "support_sla_snapshots_bucket_key" ON "support_sla_snapshots"("bucket");
```

```text
$ grep -inE '\b(drop|rename|truncate|delete)\b' migration.sql
NONE
$ grep -oE '^(ALTER TABLE|CREATE (UNIQUE )?INDEX)' migration.sql | sort | uniq -c
   1 ALTER TABLE
   1 CREATE UNIQUE INDEX
```

- 仅允许的 ALTER ADD COLUMN + UNIQUE INDEX，无 DROP/RENAME/TRUNCATE；
- 已 `prisma generate` + `migrate deploy`，`bucket` 列与唯一索引存在（旧行 bucket=null，唯一索引允许多个 null）。

## 3. 环境与种子

- QA API 4102 / Admin 4101；迁移后重启。
- `qa/seed/quickwins-1.ts`：
  - 2 条额外 `qa_qw2_sla_*` 等待人工会话（加 Batch 1 的 1 条 = 3）；
  - 10 篇知识文档（经真实 `POST /admin/rag/documents` 创建）：
    - 5 篇 good：表格×2、列表×2、emoji 结尾×1 → score=100、无 flags；
    - 5 篇 flagged：真正无结尾标点的长文本 → score=75、flags=`truncation`。
- 预期 quality-stats：`total=10`、`flagged=5`、`needReview=5`、`byScore={excellent:5, good:5, fair:0, suspicious:0}`。

## 4. 执行命令

```bash
# 迁移（apps/api，DATABASE_URL 指向 joy_mini_qa）
npx prisma generate --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
# 重启 QA API/Admin

npx tsx qa/seed/quickwins-1.ts

cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/quickwins-1.e2e-spec.ts

cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts e2e-qa/quickwins-1.spec.ts --project=qa-chromium

# 回归：Batch 5 API + 质量页 Playwright
cd apps/api && npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/batch5-analysis.e2e-spec.ts
cd apps/admin-next && QA_NO_WEB_SERVER=1 QA_ADMIN_URL=http://127.0.0.1:4101 \
  QA_API_URL=http://127.0.0.1:4102/api ../../node_modules/.bin/playwright test \
  --config=playwright.qa.config.ts e2e-qa/batch2-triage.spec.ts --project=qa-chromium
```

## 5. 结果

| 套件 | 结果 |
|---|---|
| Quick Wins API e2e（4 cases） | **4 passed / 0 failed** |
| Quick Wins Playwright（1 case） | **1 passed / 0 failed** |
| Batch 5 API e2e 回归（9 cases） | **9 passed / 0 failed** |
| 质量页 Playwright 回归（8 cases） | **8 passed / 0 failed** |

### 5.1 API 用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| QW1-01 | 同分钟连续两次 `checkQueue` | 该分钟只有一行；计数被更新 | 一行；waiting 从 3 → 2（claim 一条后） | PASS |
| QW1-02 | 同 bucket 直接插入两次 | 第二次唯一约束拒绝 | P2002 | PASS |
| QW1-03 | 5 篇表格/列表/emoji 文档 | score=100；无 truncation | 5 篇全部 100/null | PASS |
| QW1-04 | 真正无结尾标点的长文本 | 仍标 truncation | 5 篇 score=75/flags=`truncation` | PASS |
| QW1-05 | `GET quality-stats` | flagged 有值；needReview >= flagged | total 10、flagged 5、needReview 5、recentFlags 5 | PASS |
| QW1-06 | PATCH content 重算 | score/flags 变化 | good 100/null → truncated 75/`truncation` → good 100/null；flagged 5→6→5；删除后 total 10 | PASS |

### 5.2 前端用例

| ID | 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| QW1-UI-01 | 质量页「知识质量」tab | 有标记=5、待复核≠0、列名「上传时间」 | 文档总数 10、有标记 5、待复核 5、优秀 5、良好 5；表头「上传时间」（无「解析时间」）；5 行 truncation | PASS |

## 6. 缺陷

**无 P0/P1/P2 缺陷。**

观察/已知限制（非新缺陷，handoff 已声明）：

1. **历史快照 bucket 为 null**：唯一索引允许多个 null；旧数据不受影响，也无回填。
2. **同分钟后写覆盖前写**：快照是“该分钟最后一次观测”，不是多实例平均。
3. **`needReview` 是并集**：低分 + 高标记（score≥70 但有 flags）；与 `flagged` 可能重叠，页面两个数都展示。本 seed 两者均为 5。
4. **评分是启发式卫生分**：不代表检索/回答质量；`上传时间` 仍用 `createdAt`，没有真实 parsedAt。
5. **多实例**：本轮用同一 DB 验证唯一约束与并发写收敛；未起两个真实 API 进程做端到端多实例。

## 7. 残留风险与未覆盖

1. 多实例 SLA cron 的端到端双进程未跑；但 DB 唯一索引 + upsert 是最终保证。
2. 截断检测仍只看最后 200 字符的最后一个非空行；正文中间截断但结尾合法不会被发现（规则局限）。
3. 知识质量分数不是语义质量；Phase 5 再做 PII/保留/真实 parsedAt。
4. 质量页「最近标记文档」按 createdAt 排序，标签已改“上传时间”，没有真实解析时间。

## 8. 结论

Quick Wins 1 在冻结提交 `0f6518d5` 上通过：

- 迁移仅 ALTER ADD COLUMN + UNIQUE INDEX，安全 deploy；
- SLA 连续两次同一分钟调用只有一行且计数更新；同 bucket 直接插入被唯一约束拒绝；
- 5 篇表格/列表/emoji 文档 score=100、无 truncation；真正无结尾标点的长文本仍为 truncation；
- `quality-stats` flagged=5、needReview=5（>= flagged）；PATCH 内容后 score/flags 重算；
- 质量页「有标记」=5、「待复核」=5（非 0）、列名「上传时间」；
- Batch 5 API 9/9、质量页 Playwright 8/8 回归通过。

**Quick Wins 1：PASS。** 无阻塞项。
