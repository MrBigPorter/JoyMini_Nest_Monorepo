-- AI 写操作生命周期：确认卡片持久化 + 终态可审计。
-- 只新增表/索引，不改动既有表。

CREATE TABLE "ai_action_requests" (
    "id" VARCHAR(32) NOT NULL,
    "conversation_id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "message_id" VARCHAR(32),
    "action" VARCHAR(32) NOT NULL,
    "params" JSONB,
    "summary" JSONB,
    "status" VARCHAR(16) NOT NULL DEFAULT 'REQUESTED',
    "result" JSONB,
    "error" VARCHAR(500),
    "expires_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_action_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_ai_action_conv" ON "ai_action_requests"("conversation_id", "created_at");
CREATE INDEX "idx_ai_action_status_expiry" ON "ai_action_requests"("status", "expires_at");
