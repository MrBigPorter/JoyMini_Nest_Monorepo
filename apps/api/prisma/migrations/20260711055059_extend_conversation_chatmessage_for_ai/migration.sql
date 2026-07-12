/*
  Warnings:

  - A unique constraint covering the columns `[thread_id]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "ConversationType" ADD VALUE 'AI';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "role" TEXT DEFAULT 'user',
ADD COLUMN     "source" TEXT DEFAULT 'user',
ADD COLUMN     "token_count" INTEGER;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "ai_metadata" JSONB,
ADD COLUMN     "ai_title" TEXT,
ADD COLUMN     "thread_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_thread_id_key" ON "Conversation"("thread_id");
