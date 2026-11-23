-- 121: 知识库驱动的意图候选生成
--
-- 全部为增量变更：
--   1. 两张注册表（意图域 / 文档域）
--   2. 生成运行、候选、合成评测用例三张表
--   3. knowledge_documents / intent_examples 的溯源与软删列
--
-- 不改既有列、不改列宽、不删表。库里存在 schema 之外的
-- LangGraph checkpoint 表，属于运行时对象，这里也不触碰。

-- ─────────────────────────────────────────────
-- 1. 意图域注册表（运行时 SSOT）
-- ─────────────────────────────────────────────
CREATE TABLE "intent_domains" (
    "id" VARCHAR(32) NOT NULL,
    "label" VARCHAR(32) NOT NULL,
    "description" TEXT NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "agent_tag" VARCHAR(32),
    "catch_all" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "keywords" VARCHAR(100)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(100)[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "tenant_id" VARCHAR(32),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intent_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "intent_domains_label_key" ON "intent_domains"("label");
CREATE INDEX "idx_intent_domains_tenant_enabled" ON "intent_domains"("tenant_id", "enabled");

-- ─────────────────────────────────────────────
-- 2. 文档域注册表（受控枚举）
-- ─────────────────────────────────────────────
CREATE TABLE "knowledge_domains" (
    "id" VARCHAR(32) NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "candidate_target_intent" VARCHAR(32) NOT NULL DEFAULT 'rag',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "tenant_id" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_domains_key_key" ON "knowledge_domains"("key");
CREATE INDEX "idx_knowledge_domains_tenant_enabled" ON "knowledge_domains"("tenant_id", "enabled");

-- ─────────────────────────────────────────────
-- 3. 生成运行（审计 / 成本 / 补偿扫描）
-- ─────────────────────────────────────────────
CREATE TABLE "kb_generation_runs" (
    "id" VARCHAR(32) NOT NULL,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "document_id" VARCHAR(32) NOT NULL,
    "document_version" SMALLINT NOT NULL,
    "content_hash" VARCHAR(64),
    "target_domain" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "generator_model" VARCHAR(64),
    "prompt_version" VARCHAR(32) NOT NULL,
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "filtered_count" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "tenant_id" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_generation_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kb_generation_runs_idempotency_key_key" ON "kb_generation_runs"("idempotency_key");
CREATE INDEX "idx_kb_generation_runs_doc_created" ON "kb_generation_runs"("document_id", "created_at");
CREATE INDEX "idx_kb_generation_runs_status_created" ON "kb_generation_runs"("status", "created_at");

-- ─────────────────────────────────────────────
-- 4. 候选收件箱
-- ─────────────────────────────────────────────
CREATE TABLE "kb_generation_candidates" (
    "id" VARCHAR(32) NOT NULL,
    "run_id" VARCHAR(32) NOT NULL,
    "document_id" VARCHAR(32) NOT NULL,
    "document_version" SMALLINT NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "target_domain" VARCHAR(32) NOT NULL,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "text" TEXT NOT NULL,
    "normalized_hash" VARCHAR(64) NOT NULL,
    "payload" JSONB,
    "nearest_score" DOUBLE PRECISION,
    "nearest_ref" VARCHAR(64),
    "source" VARCHAR(16) NOT NULL DEFAULT 'LLM',
    "generator_model" VARCHAR(64),
    "prompt_version" VARCHAR(32),
    "confidence" DOUBLE PRECISION,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "auto_applied" BOOLEAN NOT NULL DEFAULT false,
    "previous_value" JSONB,
    "rollbackable_until" TIMESTAMP(3),
    "applied_by" VARCHAR(32),
    "idempotency_key" VARCHAR(64) NOT NULL,
    "reviewed_by" VARCHAR(32),
    "reviewed_at" TIMESTAMP(3),
    "reject_reason" VARCHAR(200),
    "applied_at" TIMESTAMP(3),
    "applied_ref" VARCHAR(64),
    "tenant_id" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_generation_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kb_generation_candidates_idempotency_key_key" ON "kb_generation_candidates"("idempotency_key");
CREATE INDEX "idx_kb_candidates_doc_status" ON "kb_generation_candidates"("document_id", "status");
CREATE INDEX "idx_kb_candidates_status_kind_domain" ON "kb_generation_candidates"("status", "kind", "target_domain");
CREATE INDEX "idx_kb_candidates_domain_status_created" ON "kb_generation_candidates"("target_domain", "status", "created_at");

-- ─────────────────────────────────────────────
-- 5. 合成评测用例（永远不混入真实 golden 文件）
-- ─────────────────────────────────────────────
CREATE TABLE "kb_synthetic_golden" (
    "id" VARCHAR(32) NOT NULL,
    "candidate_id" VARCHAR(32),
    "document_id" VARCHAR(32) NOT NULL,
    "query" TEXT NOT NULL,
    "normalized_hash" VARCHAR(64) NOT NULL,
    "expected_doc_ids" VARCHAR(100)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(100)[],
    "domain" VARCHAR(32) NOT NULL,
    "lang" VARCHAR(10) NOT NULL DEFAULT 'en',
    "source_type" VARCHAR(16) NOT NULL DEFAULT 'synthetic',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "approved_by" VARCHAR(32),
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" VARCHAR(32),

    CONSTRAINT "kb_synthetic_golden_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kb_synthetic_golden_candidate_id_key" ON "kb_synthetic_golden"("candidate_id");
CREATE INDEX "idx_kb_synthetic_golden_domain_enabled" ON "kb_synthetic_golden"("domain", "enabled");

-- ─────────────────────────────────────────────
-- 6. knowledge_documents 增量列
-- ─────────────────────────────────────────────
ALTER TABLE "knowledge_documents"
    ADD COLUMN "content_hash" VARCHAR(64),
    ADD COLUMN "candidate_target_domain" VARCHAR(32),
    ADD COLUMN "last_candidate_version" SMALLINT,
    -- 与 keywords 分开：每次上传会用 frontmatter 覆盖 keywords，
    -- 自动词混进去会在下次上传时被静默抹掉。
    ADD COLUMN "auto_keywords" VARCHAR(100)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(100)[],
    ADD COLUMN "deleted_at" TIMESTAMP(3),
    ADD COLUMN "tenant_id" VARCHAR(32);

CREATE INDEX "idx_knowledge_documents_tenant_deleted" ON "knowledge_documents"("tenant_id", "deleted_at");

-- ─────────────────────────────────────────────
-- 7. intent_examples 溯源列
-- ─────────────────────────────────────────────
ALTER TABLE "intent_examples"
    ADD COLUMN "source" VARCHAR(16) NOT NULL DEFAULT 'SEED',
    ADD COLUMN "candidate_id" VARCHAR(32),
    ADD COLUMN "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "embedding_model" VARCHAR(50),
    ADD COLUMN "normalized_hash" VARCHAR(64),
    ADD COLUMN "tenant_id" VARCHAR(32);

CREATE INDEX "idx_intent_examples_domain_enabled" ON "intent_examples"("domain", "enabled");
CREATE INDEX "idx_intent_examples_normalized_hash" ON "intent_examples"("normalized_hash");
