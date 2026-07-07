-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "domain" VARCHAR(50) NOT NULL,
    "doc_id" VARCHAR(100) NOT NULL,
    "keywords" VARCHAR(100)[],
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "content_type" VARCHAR(30) NOT NULL DEFAULT 'policy',
    "priority" VARCHAR(5) NOT NULL DEFAULT 'P2',
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" SMALLINT NOT NULL DEFAULT 1,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_documents_domain_is_active_idx" ON "knowledge_documents"("domain", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_doc_id_locale_key" ON "knowledge_documents"("doc_id", "locale");
