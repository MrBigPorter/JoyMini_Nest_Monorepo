-- CreateTable
CREATE TABLE "document_chunks" (
    "id" VARCHAR(32) NOT NULL,
    "document_id" VARCHAR(32) NOT NULL,
    "chunk_index" SMALLINT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1024),
    "token_count" SMALLINT,
    "document_version" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_chunks_document_id_idx" ON "document_chunks"("document_id");

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
