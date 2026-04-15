-- CreateTable
CREATE TABLE "user_bookmarks" (
    "id" VARCHAR(32) NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "articleId" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_user_bookmark_user_id" ON "user_bookmarks"("userId");

-- CreateIndex
CREATE INDEX "idx_user_bookmark_article_id" ON "user_bookmarks"("articleId");

-- CreateIndex
CREATE INDEX "idx_user_bookmark_created_at" ON "user_bookmarks"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_bookmarks_userId_articleId_key" ON "user_bookmarks"("userId", "articleId");

-- AddForeignKey
ALTER TABLE "user_bookmarks" ADD CONSTRAINT "user_bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_bookmarks" ADD CONSTRAINT "user_bookmarks_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "blog_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
