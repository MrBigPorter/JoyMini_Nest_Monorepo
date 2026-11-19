-- AI 回答反馈：显式标注与隐式信号
CREATE TABLE "ai_answer_feedback" (
    "id" VARCHAR(32) NOT NULL,
    "conversation_id" VARCHAR(32) NOT NULL,
    "message_id" VARCHAR(32),
    "user_id" VARCHAR(32),
    "source" VARCHAR(16) NOT NULL,
    "verdict" VARCHAR(16),
    "error_type" VARCHAR(32),
    "signal" VARCHAR(32),
    "note" VARCHAR(500),
    "admin_id" VARCHAR(32),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_answer_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_ai_feedback_conversation" ON "ai_answer_feedback"("conversation_id");
CREATE INDEX "idx_ai_feedback_source_created" ON "ai_answer_feedback"("source", "created_at");
CREATE INDEX "idx_ai_feedback_signal" ON "ai_answer_feedback"("signal");
