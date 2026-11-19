-- P0-7: 为 document_chunks.embedding 增加 HNSW 余弦相似度索引。
--
-- 背景：document_chunks.embedding 是 vector(1024)（bge-m3），此前没有任何
-- 向量索引，KNN 检索会全表扫描。HNSW 索引让 pgvector 走近似最近邻。
--
-- 参数说明：
--   vector_cosine_ops — 与检索侧使用的余弦距离（<=>）保持一致
--   m = 16            — 每个节点的双向连接数（越大召回越高、内存越多）
--   ef_construction = 64 — 建图时的候选集大小（越大建图越慢、质量越高）
--
-- 用 IF NOT EXISTS 保证可重复执行（迁移重跑不会报错）。
-- pgvector 扩展已在 20260705014510_add_intent_examples 中创建。

CREATE INDEX IF NOT EXISTS "idx_document_chunks_embedding_hnsw"
  ON "document_chunks"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
