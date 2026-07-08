-- CreateTable
CREATE TABLE "intent_example_configs" (
    "id" VARCHAR(32) NOT NULL,
    "domain" VARCHAR(32) NOT NULL,
    "sentences" TEXT NOT NULL,
    "configHash" VARCHAR(64) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" VARCHAR(32),

    CONSTRAINT "intent_example_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intent_example_configs_domain_key" ON "intent_example_configs"("domain");
