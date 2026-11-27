-- eval-run-integrity：心跳、执行失败分账、判官采样、指标族 + 启动互斥
--
-- 不可逆操作：同一数据集存在多条非 EXTERNAL RUNNING 时，仅保留 started_at 最新的一条，
-- 其余一律标记 FAILED 并写入 failureCategory=duplicate_running_cleanup。
-- 这些运行在启动互斥约束上线前并发产生，已无对应 worker 存活，无法恢复其真实结果；
-- 上线前请先备份 ai_eval_runs。

-- 1) 新增列（均可空，回滚时保留即可）
ALTER TABLE "ai_eval_runs"
  ADD COLUMN IF NOT EXISTS "heartbeat_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "execution_error_kind" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "judge_sample_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "metric_family" VARCHAR(32);

-- 2) 回填心跳：存量运行以开始时间作为最近心跳
UPDATE "ai_eval_runs"
SET "heartbeat_at" = "started_at"
WHERE "heartbeat_at" IS NULL;

-- 3) 清理重复 RUNNING（不可逆，见文件头）
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "dataset_id"
           ORDER BY "started_at" DESC, "id" DESC
         ) AS rn
  FROM "ai_eval_runs"
  WHERE "status" = 'RUNNING' AND "mode" <> 'EXTERNAL'
)
UPDATE "ai_eval_runs" AS r
SET "status" = 'FAILED',
    "finished_at" = COALESCE(r."finished_at", NOW()),
    "summary" = COALESCE(r."summary", '{}'::jsonb)
                || jsonb_build_object('failureCategory', 'duplicate_running_cleanup')
FROM ranked
WHERE r."id" = ranked."id" AND ranked.rn > 1;

-- 4) 启动互斥：同一数据集至多一条非 EXTERNAL RUNNING
CREATE UNIQUE INDEX IF NOT EXISTS "ai_eval_runs_one_running_per_dataset"
  ON "ai_eval_runs" ("dataset_id")
  WHERE "status" = 'RUNNING' AND "mode" <> 'EXTERNAL';
