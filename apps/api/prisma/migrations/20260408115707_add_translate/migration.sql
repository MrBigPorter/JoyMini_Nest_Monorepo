-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('PENDING', 'TRANSLATING', 'COMPLETED', 'MANUAL', 'FAILED');

-- AlterTable
ALTER TABLE "blog_articles" ADD COLUMN     "contentEn" TEXT,
ADD COLUMN     "excerptEn" TEXT,
ADD COLUMN     "titleEn" VARCHAR(255),
ADD COLUMN     "translatedAt" TIMESTAMP(3),
ADD COLUMN     "translationStatus" "TranslationStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "idx_blog_article_translation_status" ON "blog_articles"("translationStatus");
