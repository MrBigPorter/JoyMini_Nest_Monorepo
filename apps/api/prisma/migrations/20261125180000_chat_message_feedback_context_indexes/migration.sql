-- 反馈分诊列表的上下文回查：原来逐条按 conversationId + createdAt / source 查询，
-- 没有可用索引；改成一次 unnest + LATERAL 后仍需要这两条复合索引。
-- 纯索引变更，回滚只需 DROP INDEX，不影响数据。
CREATE INDEX "idx_chat_message_conv_created"
  ON "ChatMessage" ("conversationId", "createdAt");

CREATE INDEX "idx_chat_message_conv_source_created"
  ON "ChatMessage" ("conversationId", "source", "createdAt");
