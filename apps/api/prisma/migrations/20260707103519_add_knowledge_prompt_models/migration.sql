-- CreateTable
CREATE TABLE "knowledge_prompts" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "category" VARCHAR(32) NOT NULL,
    "domain" VARCHAR(32),
    "tsFallback" BOOLEAN NOT NULL DEFAULT true,
    "activeVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_prompt_versions" (
    "id" VARCHAR(32) NOT NULL,
    "promptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "changeLog" VARCHAR(512),
    "authorId" VARCHAR(32),
    "metrics" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_prompt_test_runs" (
    "id" VARCHAR(32) NOT NULL,
    "promptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "testQuery" VARCHAR(512) NOT NULL,
    "expectedOutcome" TEXT,
    "actualOutput" TEXT,
    "score" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "passed" BOOLEAN,
    "createdBy" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_prompt_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_prompt_eval_logs" (
    "id" VARCHAR(32) NOT NULL,
    "promptName" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "sessionId" VARCHAR(64) NOT NULL,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "toolFailCount" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "hallucinationFlagged" BOOLEAN NOT NULL DEFAULT false,
    "judgeScore" DOUBLE PRECISION,
    "judgeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_prompt_eval_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_prompts_name_key" ON "knowledge_prompts"("name");

-- CreateIndex
CREATE INDEX "knowledge_prompts_category_status_idx" ON "knowledge_prompts"("category", "status");

-- CreateIndex
CREATE INDEX "knowledge_prompts_domain_idx" ON "knowledge_prompts"("domain");

-- CreateIndex
CREATE INDEX "knowledge_prompt_versions_promptId_idx" ON "knowledge_prompt_versions"("promptId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_prompt_versions_promptId_version_key" ON "knowledge_prompt_versions"("promptId", "version");

-- CreateIndex
CREATE INDEX "knowledge_prompt_test_runs_promptId_version_idx" ON "knowledge_prompt_test_runs"("promptId", "version");

-- CreateIndex
CREATE INDEX "knowledge_prompt_eval_logs_promptName_version_idx" ON "knowledge_prompt_eval_logs"("promptName", "version");

-- CreateIndex
CREATE INDEX "knowledge_prompt_eval_logs_createdAt_idx" ON "knowledge_prompt_eval_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "knowledge_prompt_versions" ADD CONSTRAINT "knowledge_prompt_versions_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "knowledge_prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_prompt_test_runs" ADD CONSTRAINT "knowledge_prompt_test_runs_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "knowledge_prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
