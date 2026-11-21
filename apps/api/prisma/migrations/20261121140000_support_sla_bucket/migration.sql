-- Add a minute bucket so multiple API instances cannot duplicate SLA snapshots.
ALTER TABLE "support_sla_snapshots" ADD COLUMN "bucket" TIMESTAMP(3);

CREATE UNIQUE INDEX "support_sla_snapshots_bucket_key" ON "support_sla_snapshots"("bucket");
