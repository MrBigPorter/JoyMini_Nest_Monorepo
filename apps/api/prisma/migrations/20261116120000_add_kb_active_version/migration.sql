-- 知识库热更新：区分「最新写入的版本」与「当前对外服务的版本」。
--
-- version        每次写入 +1（已有列）
-- active_version 已通过门、正在对外服务的版本；检索按它过滤
-- active_version_at 切换时间；清理任务按它算保留期（保留期 = 回滚窗口）
--
-- 上线前置条件（必须在迁移后、代码切换前执行，结果必须为 0 行）：
--   下面这类文档的 active_version 指向的版本没有可用 chunk，
--   一旦检索开始按 active_version 过滤，它们会从检索里整批消失。
--
--   SELECT d.id, d.doc_id, d.locale
--   FROM knowledge_documents d
--   WHERE NOT EXISTS (
--     SELECT 1 FROM document_chunks c
--     WHERE c.document_id = d.id
--       AND c.document_version = d.version
--       AND c.embedding IS NOT NULL
--   );
--
--   非 0 行 → 对结果集先跑一次 reindex，再重跑上面的查询。

ALTER TABLE "knowledge_documents"
  ADD COLUMN "active_version" SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN "active_version_at" TIMESTAMP(3);

-- 现网对齐：把「对外版本」对齐到「最新写入版本」
UPDATE "knowledge_documents" SET "active_version" = "version";

-- 有 chunk 的文档，切换时间记为最后一次更新时间（老数据没有更准确的依据）
UPDATE "knowledge_documents"
SET "active_version_at" = "updated_at"
WHERE EXISTS (
  SELECT 1 FROM "document_chunks" c WHERE c."document_id" = "knowledge_documents"."id"
);
