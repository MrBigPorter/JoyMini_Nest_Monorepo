-- ai-eval-loop: run 可复现快照 + 归因版本 + 答案判定三态
-- 全部为新增 nullable 列或带默认值列，无锁表风险。
-- verdict / score 改为 nullable：EXTERNAL run 由 harness 写入，没有任务成功率判定。

ALTER TABLE "ai_eval_runs"
  ADD COLUMN "dataset_snapshot" JSONB,
  ADD COLUMN "code_version" VARCHAR(64),
  ADD COLUMN "gate_mode" VARCHAR(32),
  ADD COLUMN "judge_spec_version" VARCHAR(32),
  ADD COLUMN "metric_spec_version" VARCHAR(32),
  ADD COLUMN "is_baseline" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ai_eval_runs_is_baseline_idx" ON "ai_eval_runs"("is_baseline");

ALTER TABLE "ai_eval_results"
  ADD COLUMN "answer_verdict" VARCHAR(16),
  ADD COLUMN "answer_score" DOUBLE PRECISION,
  ADD COLUMN "grounding" VARCHAR(32),
  ADD COLUMN "judge_error_kind" VARCHAR(32),
  ADD COLUMN "judge_input_hash" VARCHAR(64),
  ADD COLUMN "judge_spec_version" VARCHAR(32);

ALTER TABLE "ai_eval_results" ALTER COLUMN "verdict" DROP NOT NULL;
ALTER TABLE "ai_eval_results" ALTER COLUMN "score" DROP NOT NULL;
