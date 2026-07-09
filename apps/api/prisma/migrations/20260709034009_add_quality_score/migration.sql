-- AlterTable
ALTER TABLE "knowledge_documents" ADD COLUMN     "quality_flags" VARCHAR(200),
ADD COLUMN     "quality_score" SMALLINT;
