-- AlterTable
ALTER TABLE "blog_comments" ADD COLUMN     "ai_moderated_at" TIMESTAMP(3),
ADD COLUMN     "ai_moderation_categories" VARCHAR(255),
ADD COLUMN     "ai_moderation_reason" TEXT,
ADD COLUMN     "ai_moderation_score" SMALLINT,
ADD COLUMN     "is_ai_generated" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "idx_blog_comment_ai_score" ON "blog_comments"("ai_moderation_score");
