CREATE TABLE "ai_traces" (
  "id" VARCHAR(32) NOT NULL,
  "conversation_id" VARCHAR(32) NOT NULL,
  "trigger_message_id" VARCHAR(32),
  "ai_message_id" VARCHAR(32),
  "user_id" VARCHAR(32),
  "source" VARCHAR(16) NOT NULL DEFAULT 'production',
  "intent" VARCHAR(32),
  "input" TEXT,
  "output" TEXT,
  "status" VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
  "latency_ms" INTEGER,
  "prompt_tokens" INTEGER,
  "completion_tokens" INTEGER,
  "prompt_name" VARCHAR(100),
  "prompt_version" INTEGER,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_traces_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_traces_conversation_id_created_at_idx" ON "ai_traces" ("conversation_id", "created_at");
CREATE INDEX "ai_traces_intent_created_at_idx" ON "ai_traces" ("intent", "created_at");
CREATE INDEX "ai_traces_source_created_at_idx" ON "ai_traces" ("source", "created_at");

CREATE TABLE "ai_spans" (
  "id" VARCHAR(32) NOT NULL,
  "trace_id" VARCHAR(32) NOT NULL,
  "parent_span_id" VARCHAR(32),
  "type" VARCHAR(24) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'OK',
  "input" JSONB,
  "output" JSONB,
  "error" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_spans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_spans_trace_id_fkey" FOREIGN KEY ("trace_id") REFERENCES "ai_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ai_spans_trace_id_started_at_idx" ON "ai_spans" ("trace_id", "started_at");
CREATE INDEX "ai_spans_type_started_at_idx" ON "ai_spans" ("type", "started_at");

CREATE TABLE "ai_score_configs" (
  "id" VARCHAR(32) NOT NULL,
  "key" VARCHAR(64) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "data_type" VARCHAR(16) NOT NULL,
  "categories" JSONB,
  "min_value" DOUBLE PRECISION,
  "max_value" DOUBLE PRECISION,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_score_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_score_configs_key_key" ON "ai_score_configs" ("key");

CREATE TABLE "ai_scores" (
  "id" VARCHAR(32) NOT NULL,
  "config_id" VARCHAR(32),
  "trace_id" VARCHAR(32),
  "span_id" VARCHAR(32),
  "conversation_id" VARCHAR(32),
  "message_id" VARCHAR(32),
  "source" VARCHAR(16) NOT NULL,
  "value" DOUBLE PRECISION,
  "string_value" VARCHAR(500),
  "comment" VARCHAR(500),
  "admin_id" VARCHAR(32),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_scores_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_scores_trace_id_created_at_idx" ON "ai_scores" ("trace_id", "created_at");
CREATE INDEX "ai_scores_conversation_id_created_at_idx" ON "ai_scores" ("conversation_id", "created_at");
CREATE INDEX "ai_scores_config_id_created_at_idx" ON "ai_scores" ("config_id", "created_at");

ALTER TABLE "ai_eval_cases" ADD COLUMN "expected" JSONB;
ALTER TABLE "ai_eval_cases" ADD COLUMN "metadata" JSONB;
ALTER TABLE "ai_eval_cases" ADD COLUMN "source_feedback_id" VARCHAR(32);
ALTER TABLE "ai_eval_cases" ADD COLUMN "source" VARCHAR(16);
ALTER TABLE "ai_eval_runs" ADD COLUMN "mode" VARCHAR(16) NOT NULL DEFAULT 'STORED';
ALTER TABLE "ai_eval_runs" ADD COLUMN "baseline_run_id" VARCHAR(32);
ALTER TABLE "ai_eval_results" ADD COLUMN "actual_answer" TEXT;
ALTER TABLE "ai_eval_results" ADD COLUMN "judge_model" VARCHAR(100);
ALTER TABLE "ai_eval_results" ADD COLUMN "judge_vendor" VARCHAR(50);
ALTER TABLE "ai_eval_results" ADD COLUMN "vendor_independent" BOOLEAN;
ALTER TABLE "ai_eval_results" ADD COLUMN "trace_id" VARCHAR(32);
