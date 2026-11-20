-- 一条用户消息可能抽取多个记忆字段，sourceMessageId 不能单独唯一。
DROP INDEX IF EXISTS "idx_ai_memory_source_message";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_memory_source_message"
    ON "ai_user_memories"("source_message_id", "kind", "key");
