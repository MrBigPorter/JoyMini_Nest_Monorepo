-- P1-3: AI 每日 token 用量（用户日配额与成本统计）
CREATE TABLE "ai_usage_daily" (
    "id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "date" DATE NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_usage_daily_user_id_date_key"
    ON "ai_usage_daily"("user_id", "date");

CREATE INDEX "ai_usage_daily_date_idx"
    ON "ai_usage_daily"("date");
