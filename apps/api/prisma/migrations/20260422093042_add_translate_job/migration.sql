-- CreateTable
CREATE TABLE "translation_jobs" (
    "id" VARCHAR(32) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "targetId" VARCHAR(32) NOT NULL,
    "targetLang" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "progress" SMALLINT NOT NULL DEFAULT 0,
    "errorMsg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "translation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_translation_job_status" ON "translation_jobs"("status");

-- CreateIndex
CREATE INDEX "idx_translation_job_type_target" ON "translation_jobs"("type", "targetId");

-- CreateIndex
CREATE INDEX "idx_translation_job_target_lang" ON "translation_jobs"("targetLang");
