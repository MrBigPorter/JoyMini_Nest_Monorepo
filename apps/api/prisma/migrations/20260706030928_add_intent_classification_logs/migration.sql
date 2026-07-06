-- CreateTable
CREATE TABLE "intent_classification_logs" (
    "id" VARCHAR(32) NOT NULL,
    "sessionId" VARCHAR(64) NOT NULL,
    "userInput" TEXT NOT NULL,
    "primaryIntent" VARCHAR(32) NOT NULL,
    "allLabels" TEXT,
    "method" VARCHAR(16) NOT NULL,
    "confidence" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "rawTop5" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intent_classification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_classification_log_session" ON "intent_classification_logs"("sessionId");

-- CreateIndex
CREATE INDEX "idx_classification_log_intent" ON "intent_classification_logs"("primaryIntent");

-- CreateIndex
CREATE INDEX "idx_classification_log_created" ON "intent_classification_logs"("createdAt");
