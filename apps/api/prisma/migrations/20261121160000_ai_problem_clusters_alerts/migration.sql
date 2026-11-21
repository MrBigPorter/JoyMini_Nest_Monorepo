CREATE TABLE "ai_problem_clusters" (
    "id" VARCHAR(32) NOT NULL,
    "signature" VARCHAR(64) NOT NULL,
    "representative_text" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "severity" SMALLINT NOT NULL DEFAULT 1,
    "intent" VARCHAR(50),
    "domain" VARCHAR(50),
    "suggested_cause" VARCHAR(32),
    "fix_type" VARCHAR(32),
    "status" VARCHAR(16) NOT NULL DEFAULT 'NEW',
    "owner_admin_id" VARCHAR(32),
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_problem_clusters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_problem_clusters_signature_key" ON "ai_problem_clusters"("signature");
CREATE INDEX "ai_problem_clusters_status_last_seen_at_idx" ON "ai_problem_clusters"("status", "last_seen_at");
CREATE INDEX "ai_problem_clusters_intent_domain_idx" ON "ai_problem_clusters"("intent", "domain");

CREATE TABLE "ai_problem_cluster_days" (
    "id" VARCHAR(32) NOT NULL,
    "cluster_id" VARCHAR(32) NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_problem_cluster_days_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_problem_cluster_days_cluster_id_day_key" ON "ai_problem_cluster_days"("cluster_id", "day");
CREATE INDEX "ai_problem_cluster_days_day_idx" ON "ai_problem_cluster_days"("day");

CREATE TABLE "ai_analysis_alerts" (
    "id" VARCHAR(32) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "metric" VARCHAR(40) NOT NULL,
    "dimension" VARCHAR(16) NOT NULL,
    "dimension_value" VARCHAR(50) NOT NULL,
    "value" REAL NOT NULL,
    "baseline" REAL NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "message" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_analysis_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_analysis_alerts_window_start_metric_dimension_dimen_key" ON "ai_analysis_alerts"("window_start", "metric", "dimension", "dimension_value");
CREATE INDEX "ai_analysis_alerts_status_created_at_idx" ON "ai_analysis_alerts"("status", "created_at");
