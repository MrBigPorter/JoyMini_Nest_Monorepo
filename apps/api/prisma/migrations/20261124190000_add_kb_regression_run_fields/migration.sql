-- 语料指纹 / 快照 / 运行范围三个可空字段；历史 run 保持 NULL。
ALTER TABLE "ai_eval_runs"
  ADD COLUMN "knowledge_fingerprint" VARCHAR(64),
  ADD COLUMN "knowledge_snapshot" JSONB,
  ADD COLUMN "scope" VARCHAR(8);
