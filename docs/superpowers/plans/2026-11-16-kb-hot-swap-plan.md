# 知识库热更新（无感切换）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 知识库更新期间用户永远命中一个完整版本；失败更新零影响；可回滚。

**Architecture:** PG 保留多版本 chunk（`documentVersion`），`KnowledgeDocument.activeVersion` 指向对外版本；Meilisearch 用 `isActiveVersion` 布尔标记做全局过滤；切换是一次 CAS + 一次标记翻转。

**Tech Stack:** NestJS + Prisma/PostgreSQL(pgvector) + Meilisearch + BullMQ + Jest

**Spec:** `docs/superpowers/specs/2026-11-16-kb-hot-swap-design.md`（含两处修正：§6.3 Meili 改为布尔标记、§6.8 先写 Meili 后写向量）

## Global Constraints

- 保留期 7 天；清理条件为「切换后稳定 ≥ 7 天」，不是「chunk 超过 7 天」。
- 不引入新向量库或独立检索服务。
- Meili 不可用时**不切换**，旧版本继续服务；删除/索引 API 失败必须抛（不能只 warn）。
- 迁移脚本必须可重复执行（幂等）。
- 每个任务结束跑 `yarn workspace @lucky/api tsc --noEmit --pretty`，0 error。
- 既有 2 个过期 suite（`auth`、`flash-sale`）的 3 条失败不视为回归。
- 测试文件与实现同目录，命名 `*.spec.ts`。

## Review Focus

计划完成前必须有用例钉住，最容易被使用者撞上、且没有任务天然覆盖的五类：

1. **更新进行中并发检索** —— 用户拿到空结果或旧内容（Task 4/5）
2. **Meili 不可用时更新** —— 必须旧版本继续服务，不能变成文档整体消失（Task 2/6）
3. **迁移后 `activeVersion` 无可用 chunk 的文档** —— 会从检索里整批消失（Task 3）
4. **回滚后 BM25 层为空** —— 标记没翻回去（Task 6）
5. **跨版本续话前后矛盾** —— 第二轮回答沿用旧数字（Task 8）

---

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `apps/api/src/common/meilisearch/meilisearch.service.ts` | 索引文档体、过滤、按文档删除 | 1,2,3,5,6 |
| `apps/api/src/admin/rag/rag-sync.service.ts` | 批量同步写入路径（改追加） | 1,4 |
| `apps/api/src/admin/rag/rag.service.ts` | 删除路径、reindex | 1,3 |
| `apps/api/src/admin/rag/rag-embedding.service.ts` | 单 chunk 向量化 + 索引（换顺序） | 2,4 |
| `apps/api/src/admin/rag/rag-embedding.processor.ts` | job 完成判定 | 4,6 |
| `apps/api/src/client/ai-customer/knowledge/rag-retrieval.service.ts` | 四层检索（加版本过滤） | 5 |
| `apps/api/src/client/ai-customer/knowledge/kb-version.service.ts` | 激活/回滚/清理 | 6,7 |
| `apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts` | 跨版本续话告知 | 8 |
| `apps/api/prisma/schema.prisma` + migration | `activeVersion` / `activeVersionAt` | 3 |

---

## Task 1: Meili 孤儿删除（缺陷 B）

**Files:**
- Modify: `apps/api/src/common/meilisearch/meilisearch.service.ts`（新增方法，放在 `deleteChunk` 之后）
- Modify: `apps/api/src/admin/rag/rag-sync.service.ts:486`（删 PG chunk 之前调用）
- Modify: `apps/api/src/admin/rag/rag.service.ts:362-385`（`deleteMeilisearchChunks` 改为调用新方法）
- Test: `apps/api/src/common/meilisearch/meilisearch.service.spec.ts`（新建）

**Interfaces:**
- Produces: `MeilisearchService.deleteChunksByDocument(documentId: string): Promise<void>`

- [ ] **Step 1: 写失败测试** —— mock `client.index()` 返回 `{ deleteDocuments: jest.fn() }`，断言 `deleteDocuments` 收到 `{ filter: 'documentId = "doc_1"' }`；第二个用例让 `deleteDocuments` reject，断言 `deleteChunksByDocument` 也 reject。
- [ ] **Step 2: 跑测试确认失败** —— `yarn workspace @lucky/api test src/common/meilisearch/meilisearch.service.spec.ts`，Expected: FAIL（方法不存在）。
- [ ] **Step 3: 实现** —— `if (!this.client) { this.logger.error('[deleteChunksByDocument] Meilisearch client unavailable'); return; }`；`try { await index.deleteDocuments({ filter: \`documentId = "${documentId}"\` }); } catch (e) { logger.error(...); throw e; }`。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: 接到写入路径** —— `rag-sync.service.ts` 在 `documentChunk.deleteMany` **之前** `await this.meilisearchService.deleteChunksByDocument(document.id)`；`rag.service.ts` 的 `deleteMeilisearchChunks` 改为单次调用新方法。
- [ ] **Step 6: 提交** —— `fix(rag): 更新文档时同步删除 Meili 旧 chunk，避免孤儿累积`

---

## Task 2: `indexChunk` 失败必须抛 + 等 task 完成 + 换顺序（缺陷 A）

**Files:**
- Modify: `apps/api/src/common/meilisearch/meilisearch.service.ts:495-535`
- Modify: `apps/api/src/admin/rag/rag-embedding.service.ts:270-292`
- Test: `apps/api/src/admin/rag/rag-embedding.service.spec.ts`（新建）

**Interfaces:**
- Produces: `indexChunk` 在 Meili 失败时 reject；成功时已 `waitForTask`。
- Consumes: 无（Task 3 才加字段）。

- [ ] **Step 1: 写失败测试** —— 用例①：`indexChunk` 的 `addDocuments` reject → `embedChunk` 结果的 `failCount === 1`（当前实现是 0）。用例②（顺序探针）：`indexChunk` 成功后才调用 `$executeRawUnsafe` 写向量，用 `invocationCallOrder` 断言顺序。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 改 `indexChunk`** —— `addDocuments` 的返回值拿 `task.taskUid`，`await index.waitForTask(task.taskUid)`；catch 内 `logger.error` 后 `throw error`。
- [ ] **Step 4: 换顺序** —— `rag-embedding.service.ts` 把 `if (document) { indexChunk(...) }` 整块移到 `$executeRawUnsafe(UPDATE ... embedding ...)` **之前**（spec §6.8：否则重试永远补不上 Meili）。
- [ ] **Step 5: 跑测试确认通过**，并跑 `rag-embedding.processor.spec.ts` 保证"失败不写 indexed"仍成立。
- [ ] **Step 6: 提交** —— `fix(rag): Meili 索引失败不再吞掉，且等 task 完成；先索引后写向量`

---

## Task 3: 迁移 + Meili 字段 + 全量重建

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（`KnowledgeDocument`）
- Create: `apps/api/prisma/migrations/<timestamp>_kb_active_version/migration.sql`
- Modify: `apps/api/src/common/meilisearch/meilisearch.service.ts`（文档体 + filterable）
- Test: 无单测（迁移与重建由 Step 5 的核对脚本验收）

**Interfaces:**
- Produces: `KnowledgeDocument.activeVersion: number`、`KnowledgeDocument.activeVersionAt: Date | null`
- Produces: `indexChunk` 的参数对象新增两个字段 `documentVersion: number` 与 `isActiveVersion?: boolean`（缺省 `true`，保证老调用点行为不变——代码里该参数是内联对象类型，没有具名类型）

- [ ] **Step 1: 改 schema** —— 加
  ```prisma
  activeVersion   Int       @default(1)  @map("active_version")   @db.SmallInt
  activeVersionAt DateTime? @map("active_version_at")
  ```
- [ ] **Step 2: 写迁移 SQL** —— 加两列 → `UPDATE knowledge_documents SET active_version = version` → `UPDATE knowledge_documents SET active_version_at = updated_at WHERE active_version = version`
- [ ] **Step 3: 跑核对查询，必须为 0 行才继续**
  ```sql
  SELECT d.id, d.doc_id, d.locale FROM knowledge_documents d
  WHERE NOT EXISTS (SELECT 1 FROM document_chunks c
    WHERE c.document_id = d.id AND c.document_version = d.version AND c.embedding IS NOT NULL);
  ```
  非 0 → 对结果集执行现有 reindex，再重跑本步。
- [ ] **Step 4: 扩展 Meili 文档体与 filterable** —— `indexChunk` 写入 `documentVersion` 与 `isActiveVersion: data.isActiveVersion ?? true`；`ensureIndex` 的 `updateFilterableAttributes` 追加 `'documentVersion'`、`'isActiveVersion'`。
- [ ] **Step 5: 全量重建并核对** —— 对全部文档跑一次 reindex；核对 `Meili 中 isActiveVersion=true 的条数 === PG 中 document_version = version 的 chunk 总数`。
- [ ] **Step 6: 提交** —— `feat(rag): 知识库加 activeVersion 与 Meili 版本字段`

---

## Task 4: 写入路径改为追加

**Files:**
- Modify: `apps/api/src/admin/rag/rag-sync.service.ts:480-520`
- Modify: `apps/api/src/admin/rag/rag-embedding.processor.ts`（job 数据透传）
- Modify: `apps/api/src/admin/rag/rag-embedding.service.ts`（`embedDocument` 支持按版本处理）
- Test: `apps/api/src/admin/rag/rag-sync.service.spec.ts`（新建）

**Interfaces:**
- Consumes: `IndexChunkData`（Task 3）
- Produces: `RagEmbeddingJobData` v 新增 `targetVersion?: number`；`embedDocument(documentId, { force?, targetVersion? })`

- [ ] **Step 1: 写失败测试** —— 更新一份已有文档后：① 旧版本 chunk 仍在（`deleteMany` 未被调用）；② 新 chunk 的 `documentVersion === 旧 version + 1`；③ 入队 job 的 `data.targetVersion === 新 version`。
- [ ] **Step 2: 跑测试确认失败**（当前实现会删旧 chunk）。
- [ ] **Step 3: 改写入** —— 删掉 `documentChunk.deleteMany`；`createMany` 的 `documentVersion` 用新 version；`processStatus` 仍置 `chunked`；入队时带 `targetVersion`。
- [ ] **Step 4: 改 `embedChunk` 传参** —— `indexChunk` 传 `documentVersion: chunk.documentVersion`、`isActiveVersion: false`（暂存期不可见）。
- [ ] **Step 5: 跑测试确认通过**；跑 `rag-embedding.processor.spec.ts`。
- [ ] **Step 6: 提交** —— `feat(rag): 更新文档改为追加新版本 chunk，不再删除旧版本`

---

## Task 5: 检索两侧加版本过滤

**Files:**
- Modify: `apps/api/src/client/ai-customer/knowledge/rag-retrieval.service.ts`（`vectorSearch`、`keywordSearchChunks`、`keywordSearchDocs`）
- Modify: `apps/api/src/common/meilisearch/meilisearch.service.ts:308`（`searchChunks`）
- Test: `apps/api/src/client/ai-customer/knowledge/rag-retrieval.service.spec.ts`（新建）

**Interfaces:**
- Produces: `searchChunks(query, domain?, limit?)` 内部固定 `filter: 'isActiveVersion = true'`，签名不变。

- [ ] **Step 1: 写失败测试** —— ① **并发更新场景**（Review Focus #1）：同一文档同时存在 v1 与 v2 的 chunk、`activeVersion = 1` 时，检索只返回 v1 的 chunk，v2 一条都不出现（向量层与 BM25 层各一个用例）；② 断言 `vectorSearch` 发出的 SQL 含 `dc.document_version = kd.active_version`；③ 给 `searchChunks` 传 domain 时，filter 为 `isActiveVersion = true AND domain = "wallet"`；不传 domain 时为 `isActiveVersion = true`。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 改 SQL** —— `vectorSearch` 的 WHERE 追加 `AND dc.document_version = kd.active_version`；`keywordSearchChunks` / `keywordSearchDocs` 同样追加（对照各自现有 join）。
- [ ] **Step 4: 改 `searchChunks`** —— 组装 `filter` 时始终以 `isActiveVersion = true` 开头，domain 存在时用 ` AND ` 拼接。
- [ ] **Step 5: 跑测试确认通过**；跑一次真实检索冒烟（`scripts/ai-e2e-smoke.sh`）确认 RAG 场景仍有命中。
- [ ] **Step 6: 提交** —— `feat(rag): 检索按 activeVersion 过滤，Meili 按 isActiveVersion 过滤`

---

## Task 6: 激活（切换）与回滚

**Files:**
- Create: `apps/api/src/client/ai-customer/knowledge/kb-version.service.ts`
- Modify: `apps/api/src/admin/rag/rag-embedding.processor.ts:121-135`（成功且 `targetVersion` 存在时调用激活）
- Test: `apps/api/src/client/ai-customer/knowledge/kb-version.service.spec.ts`（新建）

**Interfaces:**
- Produces: `KbVersionService.activate(documentId: string, targetVersion: number): Promise<{ switched: boolean; reason?: string }>`
- Produces: `KbVersionService.rollback(documentId: string, toVersion: number): Promise<void>`
- Produces: `MeilisearchService.setActiveVersionFlags(documentId: string, toVersion: number): Promise<void>`

- [ ] **Step 1: 写失败测试** —— ① 有 chunk 缺 embedding → `switched: false`，PG `activeVersion` 不变；② 全部就绪 → `switched: true`，PG CAS（`updateMany where { id, version: targetVersion }`）影响 1 行；③ Meili 翻标记失败 → 不写 PG，抛错；④ `rollback(doc, v1)` 后 `isActiveVersion` 翻转回 v1（覆盖 Review Focus #4）。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现门** —— `count(chunks where documentId, documentVersion = targetVersion) === count(... AND embedding IS NOT NULL)`，不等则返回 `{ switched: false, reason: 'chunks-not-ready' }`。
- [ ] **Step 4: 实现翻转** —— Meili 先：旧版本 `updateDocuments` 置 `isActiveVersion: false`、目标版本置 `true`，`waitForTask`；再 PG CAS 写 `activeVersion = targetVersion, activeVersionAt = now()`。
- [ ] **Step 5: 接进 processor** —— `indexed` 写入成功后，若 `job.data.targetVersion != null` 则调用 `activate`；返回 `switched: false` 时打 error 日志，**不改主流程结果**。
- [ ] **Step 6: 发事件** —— `kb.version.staged` / `kb.version.switched` / `kb.version.failed`，字段见 spec §6.7。
- [ ] **Step 7: 加 admin 回滚入口** —— `POST /api/v1/admin/rag/documents/:id/rollback`，body `{ toVersion: number }`，调用 `rollback`；沿用 admin rag 控制器现有守卫与 DTO 校验风格。
- [ ] **Step 8: 跑测试确认通过**。
- [ ] **Step 9: 提交** —— `feat(rag): 知识库版本激活与回滚（门 + CAS + Meili 标记翻转 + admin 入口）`

---

## Task 7: 清理任务（保留期 = 回滚窗口）

**Files:**
- Modify: `apps/api/src/client/ai-customer/knowledge/kb-version.service.ts`
- Modify: 该模块的定时任务注册处（与现有 cron 同风格）
- Test: `apps/api/src/client/ai-customer/knowledge/kb-version.service.spec.ts`（追加用例）

**Interfaces:**
- Produces: `KbVersionService.purgeStaleVersions(now?: Date): Promise<{ documents: number; chunks: number }>`

- [ ] **Step 1: 写失败测试** —— ① `activeVersionAt` 为 8 天前 → 旧版本 chunk 被删（两侧）；② 6 天前 → 不删；③ 删除失败 → 不抛，记录 error（清理失败不能影响主流程）。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现** —— 选出 `activeVersionAt < now - 7d` 的文档；对每个：`documentChunk.deleteMany({ where: { documentId, documentVersion: { lt: activeVersion } } })` + Meili `deleteDocuments({ filter: 'documentId = "..." AND documentVersion < N' })`；发 `kb.version.purged`。
- [ ] **Step 4: 注册 cron**（每日一次，与项目现有 cron 写法一致）。
- [ ] **Step 5: 跑测试确认通过**。
- [ ] **Step 6: 提交** —— `feat(rag): 旧版本 chunk 保留 7 天后清理，两侧同步`

---

## Task 8: 跨版本续话告知

**Files:**
- Modify: `apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts`（构建上下文处）
- Test: `apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.spec.ts`（新建）

**Interfaces:**
- Produces: Redis key `kb:conv:{conversationId}:version`（TTL 7d，值 = 上次回答所用版本）；版本升高时向 system prompt 追加固定句。

- [ ] **Step 1: 写失败测试** —— ① 会话记录 v1、当前 v2 → 上下文含「政策已更新（v1 → v2）」；② 记录 v2、当前 v2 → 不追加；③ 无记录 → 不追加，并写入 v2。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现** —— 读 Redis → 比较 → 追加句子 `政策已更新（v{from} → v{to}），以下回答以最新版本为准；如与之前信息冲突，以本次为准。` → 写回当前版本。Redis 异常时跳过（不能阻断回答）。
- [ ] **Step 4: 发事件** —— `kb.version.conflict`。
- [ ] **Step 5: 跑测试确认通过**；`yarn workspace @lucky/api test` 全量保持绿（除已知 3 条）。
- [ ] **Step 6: 提交** —— `feat(ai): 同会话跨知识库版本时显式告知用户`

---

## 验收（全部完成后）

- [ ] 更新进行中并发 20 次检索：0 空结果、0 旧版本命中（向量层与 BM25 层分别断言）
- [ ] 切换后同一 query 两侧都命中新内容
- [ ] 回滚：切回旧版本，两侧都命中旧内容
- [ ] Meili 不可用 → 不切换、旧版本继续服务、有 error 日志
- [ ] 连续 3 次更新后 Meili 无孤儿（条数 = 当前版本 + 保留版本）
- [ ] 迁移核对查询为 0 行
- [ ] 跨版本续话第二轮不含旧数字
- [ ] `yarn workspace @lucky/api tsc --noEmit --pretty` 0 error
