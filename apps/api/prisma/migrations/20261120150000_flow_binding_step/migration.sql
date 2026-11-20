-- 记录会话当前流程步骤，供安全切换判断“是否有进行中的流”。
ALTER TABLE "conversation_flow_bindings"
    ADD COLUMN IF NOT EXISTS "flow_step" VARCHAR(16) NOT NULL DEFAULT 'IDLE';
