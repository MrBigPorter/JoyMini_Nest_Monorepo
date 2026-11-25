-- 待验用例由运行结果自动推进：通过关闭、失败打回并记录回退时间。
ALTER TABLE "ai_answer_feedback"
ADD COLUMN "regressed_at" TIMESTAMP(3);
