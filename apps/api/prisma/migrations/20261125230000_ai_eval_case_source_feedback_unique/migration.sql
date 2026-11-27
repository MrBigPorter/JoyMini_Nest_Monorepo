-- 一条反馈最多沉淀一个回归用例（quality-console-trust D4）。
--
-- 旧的「addCases + 按题干反查」在并发下会生成重复用例并关联错行；
-- 服务端改用事务 + pg_advisory_xact_lock，这里再加部分唯一索引兜底：
-- 只有 source_feedback_id 非空的行受约束，手工/导入用例（NULL）不受影响。
--
-- 历史重复数据先按 source_feedback_id 去重：保留最新一条（created_at 最大，
-- 同一时间按 id 较大者），被合并的数量写入迁移日志便于事后核对。
-- 回滚：DROP INDEX 即可，不涉及列变更。

DO $$
DECLARE
  duplicate_groups INTEGER;
  removed_rows INTEGER;
BEGIN
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT source_feedback_id
        FROM "ai_eval_cases"
       WHERE source_feedback_id IS NOT NULL
       GROUP BY source_feedback_id
      HAVING count(*) > 1
    ) dup;

  DELETE FROM "ai_eval_cases" older
   USING "ai_eval_cases" newer
   WHERE older.source_feedback_id IS NOT NULL
     AND older.source_feedback_id = newer.source_feedback_id
     AND (
       older.created_at < newer.created_at
       OR (older.created_at = newer.created_at AND older.id < newer.id)
     );

  GET DIAGNOSTICS removed_rows = ROW_COUNT;
  RAISE NOTICE 'ai_eval_cases dedupe by source_feedback_id: % duplicate groups, % rows removed',
    duplicate_groups, removed_rows;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_eval_cases_source_feedback_id_key"
  ON "ai_eval_cases" (source_feedback_id)
  WHERE source_feedback_id IS NOT NULL;
