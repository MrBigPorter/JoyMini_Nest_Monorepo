/*
  Warnings:

  - The `description` column on the `blog_categories` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `description` column on the `blog_tags` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `name` on the `blog_categories` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `name` on the `blog_tags` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "blog_articles" ADD COLUMN     "contentLocalized" JSONB,
ADD COLUMN     "contentMdLocalized" JSONB,
ADD COLUMN     "coverImageLocalized" JSONB,
ADD COLUMN     "excerptLocalized" JSONB,
ADD COLUMN     "titleLocalized" JSONB;

-- AlterTable
ALTER TABLE "blog_categories" DROP COLUMN "name",
ADD COLUMN     "name" JSON NOT NULL,
DROP COLUMN "description",
ADD COLUMN     "description" JSON;

-- AlterTable
ALTER TABLE "blog_tags" DROP COLUMN "name",
ADD COLUMN     "name" JSON NOT NULL,
DROP COLUMN "description",
ADD COLUMN     "description" JSON;
