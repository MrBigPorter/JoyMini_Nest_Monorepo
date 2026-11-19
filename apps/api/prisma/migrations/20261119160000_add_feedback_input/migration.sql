-- 反馈导出需要用户提问原文
ALTER TABLE "ai_answer_feedback" ADD COLUMN "input" TEXT;
