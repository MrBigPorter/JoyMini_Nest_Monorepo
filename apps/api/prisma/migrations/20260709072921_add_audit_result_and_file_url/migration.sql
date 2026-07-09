-- AlterTable
ALTER TABLE "knowledge_documents" ADD COLUMN     "audit_result" JSONB,
ADD COLUMN     "file_url" VARCHAR(512);
