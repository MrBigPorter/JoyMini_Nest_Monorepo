-- CreateTable
CREATE TABLE "blog_comment_flags" (
    "id" VARCHAR(32) NOT NULL,
    "commentId" VARCHAR(32) NOT NULL,
    "reporterId" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_comment_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_user_blocks" (
    "id" VARCHAR(32) NOT NULL,
    "blockerId" VARCHAR(32) NOT NULL,
    "blockedUserId" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_blog_comment_flag_comment_id" ON "blog_comment_flags"("commentId");

-- CreateIndex
CREATE INDEX "idx_blog_user_block_blocker_id" ON "blog_user_blocks"("blockerId");

-- CreateIndex
CREATE UNIQUE INDEX "blog_user_blocks_blockerId_blockedUserId_key" ON "blog_user_blocks"("blockerId", "blockedUserId");
