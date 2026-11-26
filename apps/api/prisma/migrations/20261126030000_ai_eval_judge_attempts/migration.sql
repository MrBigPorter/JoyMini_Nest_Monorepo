-- 判官尝试留痕（eval-ingestion-hardening D3）。
--
-- 独立成表而不是给 ai_eval_results 加列：结果行由 getRun() 无差别返回给
-- 所有角色，新列会自动出现在 VIEWER 的响应里；且按保留期清理只能逐行置空。
-- 这里按 created_at 批量删除，读权限单独收紧。
--
-- 回滚：DROP TABLE "ai_eval_judge_attempts" 即可，不影响结果行与运行状态。

CREATE TABLE "ai_eval_judge_attempts" (
    "id" VARCHAR(32) NOT NULL,
    "run_id" VARCHAR(32) NOT NULL,
    "case_id" VARCHAR(64),
    "source" VARCHAR(16) NOT NULL,
    "attempt_index" INTEGER NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "verdict" VARCHAR(16),
    "score" DOUBLE PRECISION,
    "error_kind" VARCHAR(32),
    "raw_output" TEXT,
    "raw_truncated" BOOLEAN NOT NULL DEFAULT false,
    "judge_version" VARCHAR(64),
    "judge_input_hash" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_eval_judge_attempts_pkey" PRIMARY KEY ("id")
);

-- 查看某次运行某条用例的判官轨迹；retention 任务按时间扫。
CREATE INDEX "ai_eval_judge_attempts_run_id_case_id_idx"
  ON "ai_eval_judge_attempts" ("run_id", "case_id");
CREATE INDEX "ai_eval_judge_attempts_created_at_idx"
  ON "ai_eval_judge_attempts" ("created_at");

ALTER TABLE "ai_eval_judge_attempts"
  ADD CONSTRAINT "ai_eval_judge_attempts_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "ai_eval_runs" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
