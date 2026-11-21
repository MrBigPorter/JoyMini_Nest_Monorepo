-- ChatMessage.id can be a 36-char UUID when the message originates from the
-- IM layer, while the AI tables declared VarChar(32). Widen the id columns
-- that copy message ids, so traces/actions/feedback stop failing on insert.

ALTER TABLE "ai_traces"
  ALTER COLUMN "conversation_id" TYPE VARCHAR(64),
  ALTER COLUMN "trigger_message_id" TYPE VARCHAR(64),
  ALTER COLUMN "ai_message_id" TYPE VARCHAR(64),
  ALTER COLUMN "user_id" TYPE VARCHAR(64);

ALTER TABLE "ai_scores"
  ALTER COLUMN "conversation_id" TYPE VARCHAR(64);

ALTER TABLE "ai_answer_feedback"
  ALTER COLUMN "conversation_id" TYPE VARCHAR(64),
  ALTER COLUMN "message_id" TYPE VARCHAR(64);

ALTER TABLE "ai_problem_events"
  ALTER COLUMN "conversation_id" TYPE VARCHAR(64),
  ALTER COLUMN "message_id" TYPE VARCHAR(64);

ALTER TABLE "ai_security_events"
  ALTER COLUMN "conversation_id" TYPE VARCHAR(64);

ALTER TABLE "ai_user_memories"
  ALTER COLUMN "source_conversation_id" TYPE VARCHAR(64),
  ALTER COLUMN "source_message_id" TYPE VARCHAR(64);

ALTER TABLE "ai_memory_summaries"
  ALTER COLUMN "conversation_id" TYPE VARCHAR(64);

ALTER TABLE "ai_action_requests"
  ALTER COLUMN "conversation_id" TYPE VARCHAR(64),
  ALTER COLUMN "message_id" TYPE VARCHAR(64),
  ALTER COLUMN "user_id" TYPE VARCHAR(64);
