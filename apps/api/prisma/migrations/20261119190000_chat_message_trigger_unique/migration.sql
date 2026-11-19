-- AI 回复与触发消息的唯一关联（reliable-ai-runtime 2.5）
--
-- 幂等键 ai:msg:done:<messageId> 写在回复落库之后。如果进程恰好死在
-- 「回复已写库、done 未写」的窗口，重启重放会再写一条回复。
-- 这里用数据库唯一约束兜底：一条用户消息最多对应一条 AI 回复。
-- 历史数据 triggerMessageId 为 NULL，Postgres 允许 NULL 重复，不影响存量。

ALTER TABLE "ChatMessage" ADD COLUMN "triggerMessageId" TEXT;

CREATE UNIQUE INDEX "idx_chat_message_trigger_unique"
  ON "ChatMessage" ("triggerMessageId");
