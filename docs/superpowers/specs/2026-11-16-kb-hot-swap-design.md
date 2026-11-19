# 知识库热更新（无感切换）设计

> 日期：2026-11-16
> 状态：设计稿待确认（未开工）
> 关联：`docs/current-task.md`、[#97 项目全景评估](../AI-joymini/97-项目全景评估与落地清单.md) §6.4 #17、`2026-11-14-enterprise-readiness-design.md`

---

## 1. 为什么做

管理员更新一份知识文档（改退款规则、改手续费），系统当前的写入路径是 **先删旧 chunk、再建新 chunk、再异步向量化**。这中间有一个以分钟计的窗口：

| 时刻 | 发生什么 | 用户此刻问到 |
|---|---|---|
| T+0 | `version 1 → 2`（`rag-sync.service.ts:475`） | — |
| T+0 | `deleteMany` 删旧 chunk（`:486`） | **查不到**，答"没有相关政策" |
| T+0 | `createMany` 新 chunk，`embedding = NULL`（`:493`） | 向量层查不到 |
| T+0 起 | 异步队列，200 chunk × 300ms ≈ 1 分钟 | BM25 层还是旧内容 → **答过时政策** |
| T+60s | 向量化 + 索引完成 | 恢复 |

**目标**：任何时刻，读只命中一个完整、可用的版本；失败的更新等于没发生。

---

## 2. 两个今天就在漏的缺陷（独立于本次改造）

这两个不是设计问题，是**在跑的 bug**，且都让"用户看到旧/错误规则"成为可能。

### 缺陷 A：`indexed` 不代表可搜到

- `rag-embedding.processor.ts:121-129`：只有全部 chunk 成功才写 `processStatus = 'indexed'`，有失败抛异常交给 BullMQ 重试。——这半边是对的。
- `meilisearch.service.ts:528`：`indexChunk` 的 catch **只打 warn、不抛**，失败的 chunk 仍然 `successCount++`，文档照样标 `indexed`。
- 另外 `await index.addDocuments()` 返回的是 **taskUid**，Meilisearch 异步建索引——提交成功 ≠ 可被搜到。

**后果**：`indexed` 的语义是"向量写完了"，不是"能搜到了"。任何以 `indexed` 为门的设计都会撒谎。

### 缺陷 B：Meilisearch 孤儿条目累积

- 更新路径 `deleteMany` + `createMany` 会让 chunk 拿到**新的 cuid**。
- 但 `rag-sync.service.ts` 这条路径**从不调用 `deleteChunk`**；全仓只有 `rag.service.ts:374`（`deleteMeilisearchChunks`）一处调用，且属于另一条 service。
- 结果：Meilisearch 中旧版本的 chunk 条目永远存活。

```
第 1 次上传 → chunk A1..A8 → Meili 有 A1..A8
第 2 次上传 → PG 删 A1..A8、建 B1..B8 → Meili 仍有 A1..A8
第 3 次上传 → Meili 里 A + B + C 三份
```

**后果**：BM25 层会命中旧版 chunk，而向量层是新的 → 两层结论矛盾。**文档改得越多，旧内容越厚。**

---

## 3. 目标 / 非目标 / 反目标

### 目标

- **G1** 更新期间零窗口：用户永远命中一个完整版本。
- **G2** 失败更新零影响：向量化/索引任何一步失败，旧版本继续服务。
- **G3** 可回滚：切换后 N 天内能切回旧版本，**两侧索引同时可用**。
- **G4** 修掉缺陷 A、B（它们让 G1 无法成立）。

### 非目标

- 不做整库原子切换（文档是独立单元，整库一致性成本翻倍）。
- 不做 blue-green 双索引。
- 不做"规则版本绑定到确认令牌"（令牌 TTL 60s / 暂存 330s，规则变更落在窗口内的概率极低）。
- 本期不做评测门禁（检索层指标是独立变更，见 §9）。

### 反目标（做到也算失败）

- 为了"看起来平滑"引入第二套向量库或独立检索服务。
- 让切换依赖人工点击才能完成（阻塞更新）。
- 用 `ready` 标记门控代替版本隔离——它解决不了"半新半旧"。

---

## 4. 约束

- 单实例部署；Meilisearch 是单索引 `document_chunks`，所有文档共享。
- 检索四层：pgvector（`vectorSearch`）、Meilisearch BM25（Layer 1.5）、chunk ILIKE（Layer 2）、文档 ILIKE（Layer 3）。
- 检索侧当前**只过滤 `isActive: true`**（`rag-retrieval.service.ts:421`），完全不看 `documentVersion`。
- `DocumentChunk.documentVersion` 字段已存在且注释写明"用于检测过期"，但写入后无人读。
- 生产数据存在 `documentVersion ≠ Document.version` 的可能（见 `rag-sync.service.ts:507` 的注释：重传老文档会沿用旧 `indexed`）。

---

## 5. 方案对比

| 方案 | 做法 | 取舍 | 结论 |
|---|---|---|:--:|
| **A 版本指针 + 软过期** | 新 chunk 追加写入带新版本号；`KnowledgeDocument.activeVersion` 指向当前版本；检索两侧按版本过滤；切换是一次事务 | chunk 表短期双份；两侧都要加过滤；**可回滚** | ✅ 选中 |
| B 影子索引（blue-green） | 整库建新索引，评测通过后切流量 | 回滚最干净，但要维护两套索引 + 版本路由 | ❌ 单库规模过度设计 |
| C `ready` 标记门控 | 新 chunk 先不可见，全绿再翻转 | 改动最小，**不能回滚**；一次更新完成一半时会出现半新半旧 | ❌ 比短暂查不到更危险 |

选 A 的决定性理由：**schema 里已经有 `documentVersion`，注释都写好了用途**——这不是新架构，是"设计对了、实现走偏"。

---

## 6. 设计

### 不变式

| # | 不变式 | 实现要点 |
|:--:|---|---|
| 1 | **不删旧 chunk** | 新 chunk 以 `documentVersion = N+1` 追加；旧版本原地保留 |
| 2 | **读按版本过滤** | `documentVersion = activeVersion`；**pgvector 与 Meili 两侧都要过滤** |
| 3 | **切换是最后一步且过门** | 门 = 全部 chunk 有向量 **且** Meili task 已完成；一次事务改 `activeVersion` |
| 4 | **跨版本续话显式告知** | orchestrator 注入一句"政策已更新，以最新为准" |
| 5 | **孤儿清理延后** | 清理条件 = 切换后稳定 N 天；两侧同时删 |

### 6.1 数据模型

```prisma
model KnowledgeDocument {
  // ... 现有字段
  /// 当前对外服务的版本。分块写入新版本后，只有它被检索。
  activeVersion Int @default(1) @map("active_version") @db.SmallInt
}
```

`DocumentChunk.documentVersion` 已有，不改。

### 6.2 写入路径

1. `KnowledgeDocument.version + 1`
2. **追加**新 chunk（`documentVersion = 新 version`），不删旧的
3. 提交向量化 + Meili 索引 job
4. job 完成且通过门 → 事务内 `activeVersion = 新 version`
5. 任一步失败 → 不切换，旧版本继续服务，发 error 级日志

### 6.3 检索过滤

- **pgvector**：`vectorSearch` 的 SQL 加 `c.document_version = d.active_version`
- **ILIKE（Layer 2/3）**：同样 join document 比对版本
- **Meilisearch**：**修正（2026-11-16，写计划时发现原方案不可实现）**

  原方案写的是「查询加 `documentVersion = <activeVersion>`」。这做不到：一次检索会跨越**多个文档**，而每个文档的 `activeVersion` 各不相同，Meilisearch 无法表达这种按文档相关子查询的过滤。

  改为**布尔标记**：
  - Meili 文档体新增 `documentVersion`（用于清理）与 `isActiveVersion: boolean`（用于过滤）
  - 查询固定加 `filter: isActiveVersion = true`——全局单一条件，不依赖跨文档关联
  - 切换时翻转标记：旧版本 → `false`，新版本 → `true`（`updateDocuments` 按 id 批量）
  - 回滚 = 把标记翻回去，**不需要重建索引**

> 注意：新增 filterable attribute 会触发 Meilisearch 全量重建索引（异步、不阻塞搜索）。在低峰执行一次。

### 6.4 门（关键）

**不能**用 `processStatus = 'indexed'` 当门（缺陷 A）。门的判定改为：

1. 该文档 `documentVersion = 新版本` 的 chunk 中，`embedding IS NOT NULL` 的数量 = chunk 总数
2. 对应的 Meilisearch task 已 `waitForTask` 完成
3. 任一项不满足 → 不切换

**推荐实现（方案 A'）**：让 `indexChunk` 的失败进入 `failCount` 且 `waitForTask`，从而 `indexed` 重新变成可信信号；门退化为「`processStatus = 'indexed'` 且 `activeVersion ≠ version`」。

备选（方案 B'）：chunk 增加 `meiliIndexedAt` 列，门 = 全部非空。多一列 + 回填，但能把"向量"与"索引"分开定位。

### 6.5 清理

```
条件：activeVersion 稳定 ≥ N 天（默认 7）
动作：删除 documentVersion < activeVersion 的 chunk（两侧）
```

**保留期 = 回滚窗口**，不是省钱参数。清理过早会让回滚后 BM25 层变空。

### 6.6 跨版本续话

- 每次回答后写 `kb:conv:{conversationId}:version`（Redis，TTL 7d）
- 下一轮检索完，若当前 `activeVersion` 更高 → orchestrator 往 system prompt 加一句：
  「政策已更新（v1 → v2），以下回答以最新版本为准；如与之前信息冲突，以本次为准。」
- 只解决"同会话前后矛盾"，不重写已发消息

### 6.7 观测

新增事件（沿用 `common/logger` 的 `emitStage`）：

| 事件 | 关键字段 |
|---|---|
| `kb.version.staged` | `documentId, fromVersion, toVersion` |
| `kb.version.switched` | `documentId, fromVersion, toVersion, chunkCount, embeddingMs, meiliMs` |
| `kb.version.failed` | `documentId, toVersion, reason` |
| `kb.version.purged` | `documentId, removedVersion, chunkCount` |
| `kb.version.conflict` | `conversationId, convVersion, activeVersion` |

`kb.version.switched` 是后续评测门禁的关联键。

### 6.8 重试顺序（修正，2026-11-16）

`embedDocument({ force: false })` 只处理 `embedding IS NULL` 的 chunk，重试因此是幂等的。但这也意味着：**如果先写向量、后写 Meilisearch，而 Meili 失败，那么重试永远不会补上 Meili 那一条**——chunk 已经有向量了，不再进入处理集。

修法：**先写 Meilisearch，再写 pgvector**。

- Meili 成功、pgvector 失败 → 重试重新处理（`addDocuments` 按 chunk id 是幂等 upsert）
- Meili 失败 → 抛异常 → 整个 job 重试，chunk 的向量还没写，仍在处理集里
- 代价：重试时多一次 Meili 写入（幂等，可接受）

---

## 7. 迁移与现网风险

**这是最容易上线当天炸的地方**：加了版本过滤后，`activeVersion` 指向的版本若无可用 chunk，该文档会从检索里**整批消失**。

```sql
-- 1) 加列
ALTER TABLE knowledge_documents ADD COLUMN active_version smallint NOT NULL DEFAULT 1;
-- 2) 对齐现网
UPDATE knowledge_documents SET active_version = version;
-- 3) 找出"当前版本没有可用 chunk"的文档（必须先处理，否则上线即失联）
SELECT d.id, d.doc_id, d.locale, d.version
FROM knowledge_documents d
WHERE NOT EXISTS (
  SELECT 1 FROM document_chunks c
  WHERE c.document_id = d.id
    AND c.document_version = d.version
    AND c.embedding IS NOT NULL
);
```

处理方式：对结果集执行一次全量 reindex，再切换代码。迁移脚本需能重复执行（幂等）。

---

## 8. 执行顺序（后面按顺序做）

| # | 任务 | 依赖 | 估时 |
|:--:|---|---|:--:|
| **1** | **修缺陷 B**：更新路径补 Meili 删除（按 `documentId` 批量删）+ 清理历史孤儿 | — | 0.5d |
| **2** | **修缺陷 A**：`indexChunk` 失败进 `failCount` + `waitForTask`；补测试钉住"Meili 失败则非 `indexed`" | — | 0.5d |
| **3** | 迁移：`active_version` + 数据对齐 + 不一致文档清单 | 1、2 | 0.5d |
| **4** | 写入路径改为追加；job 完成判定 | 3 | 0.5d |
| **5** | 检索两侧过滤（pgvector / ILIKE / Meili filterable + 查询） | 3 | 0.5d |
| **6** | 切换门 + 原子切换 + 观测事件 | 4、5 | 0.5d |
| **7** | 清理任务（保留 N 天，两侧） | 6 | 0.3d |
| **8** | 跨版本续话告知 | 6 | 0.3d |

**任务 1、2 与版本切换无关，可以单独提交**——它们今天就是坏的，不应混进本次变更。

### 验收

- [ ] 更新进行中并发 20 次检索：0 次空结果、0 次旧版本命中（**两侧分别断言**）
- [ ] 切换后同一 query 命中新内容（向量层与 BM25 层一致）
- [ ] 回滚：切回旧版本，两侧都能命中旧内容
- [ ] 故障注入：Meilisearch 不可用 → 不切换、旧版本继续服务、有 error 日志
- [ ] 连续 3 次更新后：Meili 中该文档条目数 = 当前版本 chunk 数 + 保留版本 chunk 数（无孤儿）
- [ ] 迁移：不一致文档清单为 0 才允许上线
- [ ] 跨版本续话：同一会话两轮之间切换版本，第二轮回答不含旧数字
- [ ] `yarn workspace @lucky/api tsc --noEmit --pretty` 0 error，既有测试保持绿

---

## 9. 留给后续（本期不做）

- **检索层评测**（#97 §6.4 #17）：30–50 条 query→正确文档标注，Hit Rate@3 / MRR。有了它，切换才可以加"分数不掉才允许切"的评测门。
- **生成层 judge**（enterprise-readiness-design §5.2.2）：不同厂商模型 + 人工抽检 10% 校准。
- **答案缓存**：若将来加 RAG 答案缓存，键必须含版本号或内容哈希（blog 已是此写法：`batch-${id}-${lang}-${contentHash}`）。

---

## 10. 未定项（我的判断，可推翻）

| # | 决定 | 我的判断 | 影响 |
|:--:|---|---|---|
| D1 | 门的实现 | **方案 A'**（`indexChunk` 失败进 `failCount` + `waitForTask`），改动小且语义正确 | 选 B' 则多一列 + 回填 |
| D2 | 缺陷 A/B 的归属 | **单独提交，不并进版本切换** | 合并会让一个变更同时含 bugfix 与架构改动，回滚粒度变粗 |
| D3 | 切换触发 | **自动**（全绿即切），保留手动回滚入口 | 选"人工确认"则多一个按钮 + 审计，且能接评测门 |
| D4 | 旧版本保留期 | **7 天** | 缩短省钱但压掉回滚窗口 |
| D5 | 文档间切换 | **独立切换**，不整库原子切换 | 整库一致性成本翻倍 |

---

## 11. 挂起（与本设计无关，另议）

- **转人工超时回收策略**：客服超 X 分钟未接，会话应回给 AI / 标记超时等主管 / 关闭留工单？——影响 scheduler、会话状态与用户可见行为。
- **T2-1 余项 + T2-5 S3/S4**：转人工环一次关完（工单写入 + admin 消费者 + socket 推送 + SLA 回收）。T2-1 词边界与情绪分级已在 T0-2 完成。
