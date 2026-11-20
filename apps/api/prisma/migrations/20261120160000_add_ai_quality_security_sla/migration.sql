-- 反馈分诊
ALTER TABLE "ai_answer_feedback"
  ADD COLUMN IF NOT EXISTS "review_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "reviewed_by" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "idx_ai_feedback_review"
  ON "ai_answer_feedback"("review_status", "created_at");

-- 评测集
CREATE TABLE IF NOT EXISTS "ai_eval_datasets" (
  "id" VARCHAR(32) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "created_by" VARCHAR(32),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_eval_datasets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_eval_datasets_name_key" ON "ai_eval_datasets"("name");

CREATE TABLE IF NOT EXISTS "ai_eval_cases" (
  "id" VARCHAR(32) NOT NULL,
  "dataset_id" VARCHAR(32) NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "expect" JSONB NOT NULL,
  "tags" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_eval_cases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_eval_cases_dataset_id_idx" ON "ai_eval_cases"("dataset_id");

CREATE TABLE IF NOT EXISTS "ai_eval_runs" (
  "id" VARCHAR(32) NOT NULL,
  "dataset_id" VARCHAR(32) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
  "created_by" VARCHAR(32),
  "summary" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "ai_eval_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_eval_runs_dataset_started_idx" ON "ai_eval_runs"("dataset_id", "started_at");

CREATE TABLE IF NOT EXISTS "ai_eval_results" (
  "id" VARCHAR(32) NOT NULL,
  "run_id" VARCHAR(32) NOT NULL,
  "case_id" VARCHAR(32) NOT NULL,
  "verdict" VARCHAR(16) NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "latency_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_eval_results_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_eval_results_run_id_idx" ON "ai_eval_results"("run_id");

ALTER TABLE "ai_eval_cases" ADD CONSTRAINT "ai_eval_cases_dataset_id_fkey"
  FOREIGN KEY ("dataset_id") REFERENCES "ai_eval_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_dataset_id_fkey"
  FOREIGN KEY ("dataset_id") REFERENCES "ai_eval_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_eval_results" ADD CONSTRAINT "ai_eval_results_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "ai_eval_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_eval_results" ADD CONSTRAINT "ai_eval_results_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "ai_eval_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 注入命中
CREATE TABLE IF NOT EXISTS "ai_security_events" (
  "id" VARCHAR(32) NOT NULL,
  "type" VARCHAR(32) NOT NULL,
  "mode" VARCHAR(16) NOT NULL,
  "length" INTEGER NOT NULL,
  "user_id_hash" VARCHAR(64),
  "conversation_id" VARCHAR(32),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_security_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_security_events_type_created_idx" ON "ai_security_events"("type", "created_at");
CREATE INDEX IF NOT EXISTS "ai_security_events_created_at_idx" ON "ai_security_events"("created_at");

-- SLA 历史快照
CREATE TABLE IF NOT EXISTS "support_sla_snapshots" (
  "id" VARCHAR(32) NOT NULL,
  "waiting" INTEGER NOT NULL,
  "breached" INTEGER NOT NULL,
  "longest_wait" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_sla_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "support_sla_snapshots_created_at_idx" ON "support_sla_snapshots"("created_at");
