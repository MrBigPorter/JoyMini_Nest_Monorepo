-- Retention scans by createdAt; without this index the daily purge is a full scan.
CREATE INDEX "ai_traces_created_at_idx" ON "ai_traces"("created_at");
