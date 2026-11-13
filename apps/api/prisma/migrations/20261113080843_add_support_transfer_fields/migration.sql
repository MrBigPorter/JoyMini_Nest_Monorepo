-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "first_response_at" TIMESTAMP(3),
ADD COLUMN     "transfer_reason" VARCHAR(50),
ADD COLUMN     "transferred_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "idx_conv_support_queue" ON "Conversation"("type", "handler_id", "handler_assigned_at");
