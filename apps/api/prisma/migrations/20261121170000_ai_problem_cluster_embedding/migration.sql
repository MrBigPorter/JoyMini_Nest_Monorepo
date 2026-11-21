-- 119 Phase 2：问题簇语义聚类。
--
-- 只为 ai_problem_clusters 增加一列可空向量 + 余弦 HNSW 索引，全部是附加改动：
--   - 不修改 / 删除任何现有列与数据；
--   - 老簇 embedding 为 NULL，聚类逻辑会自动回退到 signature 精确匹配。
--
-- 维度 1024 与现有 document_chunks / intent_examples 保持一致（bge-m3 / Jina）。
-- pgvector 扩展已在 20260705014510_add_intent_examples 中创建。
-- 索引参数沿用 20261119120000_add_hnsw_embedding_index：
--   vector_cosine_ops 与检索侧 <=> 余弦距离保持一致；
--   m = 16 / ef_construction = 64 是 pgvector 的常用默认值。
--
-- 用 IF NOT EXISTS 保证可重复执行。

ALTER TABLE "ai_problem_clusters"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

CREATE INDEX IF NOT EXISTS "idx_ai_problem_clusters_embedding_hnsw"
  ON "ai_problem_clusters"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
