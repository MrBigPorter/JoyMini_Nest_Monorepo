-- 分诊并发控制与认领：版本列 + 认领者/认领时间
-- 回滚：三列均可空/有默认，代码可先回退，列保留不影响旧逻辑。
ALTER TABLE "ai_answer_feedback"
  ADD COLUMN "claimed_by" VARCHAR(32),
  ADD COLUMN "claimed_at" TIMESTAMP(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
