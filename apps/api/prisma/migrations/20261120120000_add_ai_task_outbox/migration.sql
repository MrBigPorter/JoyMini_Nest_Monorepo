-- AI 任务 Outbox：消息落库与 BullMQ 入队之间的事务性投递记录。
-- message_id 唯一：同一条消息最多一条待投递任务。
CREATE TABLE IF NOT EXISTS "ai_task_outbox" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "ai_task_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_task_outbox_message_id_key"
    ON "ai_task_outbox"("message_id");

CREATE INDEX IF NOT EXISTS "idx_ai_task_outbox_due"
    ON "ai_task_outbox"("status", "next_attempt_at");
