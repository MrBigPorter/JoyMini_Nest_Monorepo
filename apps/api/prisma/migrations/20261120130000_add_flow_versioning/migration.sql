-- 流程定义版本：不可变快照，definitionHash 相同的定义不重复建版本。
CREATE TABLE IF NOT EXISTS "flow_definition_versions" (
    "id" TEXT NOT NULL,
    "flow_type" VARCHAR(32) NOT NULL,
    "version" INTEGER NOT NULL,
    "definition_hash" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_definition_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_flow_def_type_version"
    ON "flow_definition_versions"("flow_type", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_flow_def_type_hash"
    ON "flow_definition_versions"("flow_type", "definition_hash");
CREATE INDEX IF NOT EXISTS "flow_definition_versions_flow_type_status_idx"
    ON "flow_definition_versions"("flow_type", "status");

-- 会话 → 定义版本绑定：一个会话一个 flowType 只有一条。
CREATE TABLE IF NOT EXISTS "conversation_flow_bindings" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "flow_type" VARCHAR(32) NOT NULL,
    "definition_version_id" TEXT NOT NULL,
    "definition_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "thread_id" TEXT,
    "checkpoint_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_flow_bindings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_flow_binding_conv_type"
    ON "conversation_flow_bindings"("conversation_id", "flow_type");
CREATE INDEX IF NOT EXISTS "conversation_flow_bindings_definition_version_id_idx"
    ON "conversation_flow_bindings"("definition_version_id");

-- 审计日志：bind / switch / rollback 全量留痕。
CREATE TABLE IF NOT EXISTS "flow_binding_audit_logs" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "flow_type" VARCHAR(32) NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "actor_id" TEXT,
    "reason" VARCHAR(500),
    "from_version_id" TEXT,
    "to_version_id" TEXT,
    "thread_id" TEXT,
    "checkpoint_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_binding_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "flow_binding_audit_logs_conversation_id_created_at_idx"
    ON "flow_binding_audit_logs"("conversation_id", "created_at");

ALTER TABLE "conversation_flow_bindings"
    ADD CONSTRAINT "conversation_flow_bindings_definition_version_id_fkey"
    FOREIGN KEY ("definition_version_id") REFERENCES "flow_definition_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
