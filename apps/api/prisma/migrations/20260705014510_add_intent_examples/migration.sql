CREATE EXTENSION IF NOT EXISTS vector;
-- CreateTable
CREATE TABLE "intent_examples" (
    "id" VARCHAR(32) NOT NULL,
    "domain" VARCHAR(32) NOT NULL,
    "sentence" TEXT NOT NULL,
    "embedding" vector(2048),

    CONSTRAINT "intent_examples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_intent_examples_domain" ON "intent_examples"("domain");
