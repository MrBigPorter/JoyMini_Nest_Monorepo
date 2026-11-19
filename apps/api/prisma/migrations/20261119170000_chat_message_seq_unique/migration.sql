-- 会话内消息序号唯一：并发发送时由数据库兜底
DROP INDEX IF EXISTS "ChatMessage_conversationId_seqId_idx";
CREATE UNIQUE INDEX "idx_chat_message_conv_seq" ON "ChatMessage"("conversationId", "seqId");
