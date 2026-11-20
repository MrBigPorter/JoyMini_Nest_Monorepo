ALTER TABLE "ai_security_events"
  ADD COLUMN "status" VARCHAR(16) NOT NULL DEFAULT 'NEW',
  ADD COLUMN "note" VARCHAR(500),
  ADD COLUMN "reviewed_by" VARCHAR(32),
  ADD COLUMN "reviewed_at" TIMESTAMP(3);

CREATE INDEX "ai_security_events_status_created_at_idx" ON "ai_security_events" ("status", "created_at");
