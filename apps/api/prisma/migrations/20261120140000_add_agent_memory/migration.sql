-- 跨会话用户记忆：蒸馏后的偏好/事实，不存原文。
CREATE TABLE IF NOT EXISTS "ai_user_memories" (
    "id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "value" VARCHAR(500) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source_conversation_id" VARCHAR(32),
    "source_message_id" VARCHAR(32),
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_user_memories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_memory_user_kind_key"
    ON "ai_user_memories"("user_id", "kind", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_memory_source_message"
    ON "ai_user_memories"("source_message_id");
CREATE INDEX IF NOT EXISTS "idx_ai_memory_lookup"
    ON "ai_user_memories"("user_id", "status", "expires_at");

-- 会话级摘要记忆，可与短期 checkpoint 分开清理。
CREATE TABLE IF NOT EXISTS "ai_memory_summaries" (
    "id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "thread_id" VARCHAR(64),
    "conversation_id" VARCHAR(32),
    "summary" VARCHAR(1000) NOT NULL,
    "covered_to_seq_id" INTEGER NOT NULL DEFAULT 0,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_memory_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_memory_summary_thread"
    ON "ai_memory_summaries"("user_id", "thread_id");
CREATE INDEX IF NOT EXISTS "idx_ai_memory_summary_expiry"
    ON "ai_memory_summaries"("user_id", "expires_at");
