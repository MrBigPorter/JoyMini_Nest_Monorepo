#!/usr/bin/env node

const { PrismaClient } = require("@prisma/client");

// 设置环境变量
process.env.DATABASE_URL =
  "postgresql://dev:devpassword@localhost:5432/lucky_dev?schema=public";

const prisma = new PrismaClient();

async function diagnoseLocalizedFields() {
  console.log("=== 诊断博客文章多语言字段 ===\n");

  try {
    // 获取所有文章
    const articles = await prisma.blogArticle.findMany({
      take: 10,
      select: {
        id: true,
        title: true,
        titleEn: true,
        titleLocalized: true,
        excerpt: true,
        excerptEn: true,
        excerptLocalized: true,
        content: true,
        contentEn: true,
        contentLocalized: true,
        contentMd: true,
        contentMdEn: true,
        contentMdLocalized: true,
        translationStatus: true,
      },
      orderBy: { createdAt: "desc" },
    });

    console.log(`找到 ${articles.length} 篇文章\n`);

    for (const article of articles) {
      console.log(`文章 ID: ${article.id}`);
      console.log(`翻译状态: ${article.translationStatus}`);

      // 检查标题字段
      console.log("\n标题字段:");
      console.log(`  title (原始): ${article.title ? "有值" : "空"}`);
      console.log(`  titleEn: ${article.titleEn ? "有值" : "空"}`);
      console.log(
        `  titleLocalized: ${article.titleLocalized ? JSON.stringify(article.titleLocalized) : "空"}`,
      );

      if (article.titleLocalized) {
        const titleLocalized = article.titleLocalized;
        console.log(
          `  titleLocalized 包含语言: ${Object.keys(titleLocalized).join(", ")}`,
        );
        if (!titleLocalized.zh && article.title) {
          console.log(`  ❌ 问题: titleLocalized 缺少中文，但 title 有值`);
        }
      } else if (article.title) {
        console.log(`  ❌ 问题: titleLocalized 为空，但 title 有值`);
      }

      // 检查摘要字段
      console.log("\n摘要字段:");
      console.log(`  excerpt (原始): ${article.excerpt ? "有值" : "空"}`);
      console.log(`  excerptEn: ${article.excerptEn ? "有值" : "空"}`);
      console.log(
        `  excerptLocalized: ${article.excerptLocalized ? JSON.stringify(article.excerptLocalized) : "空"}`,
      );

      if (article.excerptLocalized) {
        const excerptLocalized = article.excerptLocalized;
        console.log(
          `  excerptLocalized 包含语言: ${Object.keys(excerptLocalized).join(", ")}`,
        );
        if (!excerptLocalized.zh && article.excerpt) {
          console.log(`  ❌ 问题: excerptLocalized 缺少中文，但 excerpt 有值`);
        }
      } else if (article.excerpt) {
        console.log(`  ❌ 问题: excerptLocalized 为空，但 excerpt 有值`);
      }

      // 检查内容字段
      console.log("\n内容字段:");
      console.log(`  content (原始): ${article.content ? "有值" : "空"}`);
      console.log(`  contentEn: ${article.contentEn ? "有值" : "空"}`);
      console.log(
        `  contentLocalized: ${article.contentLocalized ? "有值" : "空"}`,
      );

      if (article.contentLocalized) {
        const contentLocalized = article.contentLocalized;
        console.log(`  contentLocalized 类型: ${typeof contentLocalized}`);
        if (typeof contentLocalized === "object") {
          console.log(
            `  contentLocalized 包含语言: ${Object.keys(contentLocalized).join(", ")}`,
          );
          if (!contentLocalized.zh && article.content) {
            console.log(
              `  ❌ 问题: contentLocalized 缺少中文，但 content 有值`,
            );
          }
        }
      } else if (article.content) {
        console.log(`  ❌ 问题: contentLocalized 为空，但 content 有值`);
      }

      // 检查Markdown内容字段
      console.log("\nMarkdown内容字段:");
      console.log(`  contentMd (原始): ${article.contentMd ? "有值" : "空"}`);
      console.log(`  contentMdEn: ${article.contentMdEn ? "有值" : "空"}`);
      console.log(
        `  contentMdLocalized: ${article.contentMdLocalized ? "有值" : "空"}`,
      );

      if (article.contentMdLocalized) {
        const contentMdLocalized = article.contentMdLocalized;
        console.log(`  contentMdLocalized 类型: ${typeof contentMdLocalized}`);
        if (typeof contentMdLocalized === "object") {
          console.log(
            `  contentMdLocalized 包含语言: ${Object.keys(contentMdLocalized).join(", ")}`,
          );
          if (!contentMdLocalized.zh && article.contentMd) {
            console.log(
              `  ❌ 问题: contentMdLocalized 缺少中文，但 contentMd 有值`,
            );
          }
        }
      } else if (article.contentMd) {
        console.log(`  ❌ 问题: contentMdLocalized 为空，但 contentMd 有值`);
      }

      console.log("\n" + "=".repeat(80) + "\n");
    }
  } catch (error) {
    console.error("诊断过程中出错:", error);
  } finally {
    await prisma.$disconnect();
  }
}

diagnoseLocalizedFields().catch(console.error);
