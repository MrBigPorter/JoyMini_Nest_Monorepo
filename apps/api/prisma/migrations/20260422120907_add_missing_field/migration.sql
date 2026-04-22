-- AlterTable
ALTER TABLE "translation_jobs" ADD COLUMN     "articleId" VARCHAR(32),
ADD COLUMN     "categoryId" VARCHAR(32),
ADD COLUMN     "tagId" VARCHAR(32);

-- AddForeignKey
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "blog_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "blog_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "blog_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
