ALTER TABLE "ai_answer_feedback"
  ADD COLUMN "failure_kind" VARCHAR(32),
  ADD COLUMN "resolution" VARCHAR(24),
  ADD COLUMN "owner_admin_id" VARCHAR(32),
  ADD COLUMN "linked_eval_case_id" VARCHAR(32),
  ADD COLUMN "trace_id" VARCHAR(32);

CREATE INDEX "idx_ai_feedback_failure" ON "ai_answer_feedback" ("failure_kind", "created_at");
CREATE INDEX "idx_ai_feedback_resolution" ON "ai_answer_feedback" ("resolution", "created_at");
