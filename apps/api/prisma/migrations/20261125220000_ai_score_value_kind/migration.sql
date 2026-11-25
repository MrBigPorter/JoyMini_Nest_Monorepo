-- 统一评分量纲：binary=0/1 判定，graded=0..1 连续分。
-- 历史行没有量纲标识，按现有来源回填：HUMAN 分诊是 0/1，LLM 评测是连续分。
ALTER TABLE "ai_scores"
ADD COLUMN "value_kind" VARCHAR(16) NOT NULL DEFAULT 'binary';

UPDATE "ai_scores"
SET "value_kind" = 'graded'
WHERE "source" = 'LLM';

-- 代码/API 评分从未接入；config_id 与 span_id 只写不读（新写入也不再产生）。
DROP INDEX IF EXISTS "ai_scores_config_id_created_at_idx";
ALTER TABLE "ai_scores" DROP COLUMN "config_id", DROP COLUMN "span_id";
