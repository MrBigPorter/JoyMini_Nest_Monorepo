-- CreateTable
CREATE TABLE "ai_problem_events" (
    "id" VARCHAR(32) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_type" VARCHAR(8) NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "severity" SMALLINT NOT NULL,
    "confidence" REAL NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "source_id" VARCHAR(64) NOT NULL,
    "conversation_id" VARCHAR(32),
    "message_id" VARCHAR(32),
    "trace_id" VARCHAR(32),
    "intent" VARCHAR(50),
    "domain" VARCHAR(50),
    "failure_kind" VARCHAR(32),
    "cluster_id" VARCHAR(32),
    "status" VARCHAR(16) NOT NULL DEFAULT 'NEW',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_problem_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_metric_windows" (
    "id" VARCHAR(32) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_type" VARCHAR(8) NOT NULL,
    "metric" VARCHAR(40) NOT NULL,
    "dimension" VARCHAR(16) NOT NULL,
    "dimension_value" VARCHAR(50) NOT NULL,
    "numerator" INTEGER NOT NULL,
    "denominator" INTEGER NOT NULL,
    "value" REAL NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_metric_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analysis_runs" (
    "id" VARCHAR(32) NOT NULL,
    "job_type" VARCHAR(24) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created_events" INTEGER NOT NULL DEFAULT 0,
    "created_clusters" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ai_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_problem_events_window_start_type_idx" ON "ai_problem_events"("window_start", "type");

-- CreateIndex
CREATE INDEX "ai_problem_events_conversation_id_idx" ON "ai_problem_events"("conversation_id");

-- CreateIndex
CREATE INDEX "ai_problem_events_trace_id_idx" ON "ai_problem_events"("trace_id");

-- CreateIndex
CREATE INDEX "ai_problem_events_cluster_id_idx" ON "ai_problem_events"("cluster_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_problem_events_type_source_id_key" ON "ai_problem_events"("type", "source_id");

-- CreateIndex
CREATE INDEX "ai_metric_windows_window_start_metric_idx" ON "ai_metric_windows"("window_start", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "ai_metric_windows_window_start_window_type_metric_dimension_key" ON "ai_metric_windows"("window_start", "window_type", "metric", "dimension", "dimension_value");

-- CreateIndex
CREATE INDEX "ai_analysis_runs_status_started_at_idx" ON "ai_analysis_runs"("status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_analysis_runs_job_type_window_start_key" ON "ai_analysis_runs"("job_type", "window_start");

