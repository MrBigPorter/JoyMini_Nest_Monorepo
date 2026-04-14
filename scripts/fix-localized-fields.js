#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

// 设置环境变量
process.env.DATABASE_URL = 'postgresql://dev:devpassword@localhost:5432/lucky_dev?schema=public';

const prisma = new PrismaClient();

async function fixLocalizedFields() {
  console.log('=== 修复 Localized 字段缺少中文的问题 ===\n');

  try {
    // 获取所有文章
    const articles = await prisma.blogArticle.findMany({
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
    });

    console.log(`找到 ${articles.length} 篇文章\n`);

    let fixedCount = 0;

    for (const article of articles) {
      console.log(`处理文章 ID: ${article.id}`);
      console.log(`翻译状态: ${article.translationStatus}`);
      
      const updates = {};
      let needsUpdate = false;
      
      // 修复 titleLocalized
      if (article.title && article.translationStatus === 'COMPLETED') {
        const currentTitleLocalized = article.titleLocalized || {};
        const hasZh = currentTitleLocalized.zh !== undefined;
        const hasEn = currentTitleLocalized.en !== undefined;
        
        if (!hasZh && article.title) {
          updates.titleLocalized = {
            ...currentTitleLocalized,
            zh: article.title,
          };
          needsUpdate = true;
          console.log(`  ✅ 修复 titleLocalized: 添加中文标题`);
        } else if (hasZh && !currentTitleLocalized.zh) {
          updates.titleLocalized = {
            ...currentTitleLocalized,
            zh: article.title,
          };
          needsUpdate = true;
          console.log(`  ✅ 修复 titleLocalized: 更新中文标题`);
        }
      }
      
      // 修复 excerptLocalized
      if (article.excerpt && article.translationStatus === 'COMPLETED') {
        const currentExcerptLocalized = article.excerptLocalized || {};
        const hasZh = currentExcerptLocalized.zh !== undefined;
        
        if (!hasZh && article.excerpt) {
          updates.excerptLocalized = {
            ...currentExcerptLocalized,
            zh: article.excerpt,
          };
          needsUpdate = true;
          console.log(`  ✅ 修复 excerptLocalized: 添加中文摘要`);
        } else if (hasZh && !currentExcerptLocalized.zh) {
          updates.excerptLocalized = {
            ...currentExcerptLocalized,
            zh: article.excerpt,
          };
          needsUpdate = true;
          console.log(`  ✅ 修复 excerptLocalized: 更新中文摘要`);
        }
      }
      
      // 修复 contentLocalized
      if (article.content && article.translationStatus === 'COMPLETED') {
        const currentContentLocalized = article.contentLocalized || {};
        const hasZh = currentContentLocalized.zh !== undefined;
        
        if (!hasZh && article.content) {
          updates.contentLocalized = {
            ...currentContentLocalized,
            zh: article.content,
          };
          needsUpdate = true;
          console.log(`  ✅ 修复 contentLocalized: 添加中文内容`);
        } else if (hasZh && !currentContentLocalized.zh) {
          updates.contentLocalized = {
            ...currentContentLocalized,
            zh: article.content,
          };
          needsUpdate = true;
          console.log(`  ✅ 修复 contentLocalized: 更新中文内容`);
        }
      }
      
      // 修复 contentMdLocalized
      if (article.contentMd && article.translationStatus === 'COMPLETED') {
        const currentContentMdLocalized = article.contentMdLocalized || {};
        const hasZh = currentContentMdLocalized.zh !== undefined;
        
        if (!hasZh && article.contentMd) {
          updates.contentMdLocalized = {
            ...currentContentMdLocalized,
            zh: article.contentMd,
          };
          needsUpdate = true;
          console.log(`  ✅ 修复 contentMdLocalized: 添加中文Markdown内容`);
        } else if (hasZh && !currentContentMdLocalized.zh) {
          updates.contentMdLocalized = {
            ...currentContentMdLocalized,
            zh: article.contentMd,
          };
          needsUpdate = true;
          console.log(`  ✅ 修复 contentMdLocalized: 更新中文Markdown内容`);
        }
      }
      
      // 执行更新
      if (needsUpdate) {
        try {
          await prisma.blogArticle.update({
            where: { id: article.id },
            data: updates,
          });
          fixedCount++;
          console.log(`  ✅ 文章 ${article.id} 更新成功\n`);
        } catch (error) {
          console.error(`  ❌ 文章 ${article.id} 更新失败:`, error.message);
        }
      } else {
        console.log(`  ⏭️  文章 ${article.id} 无需更新\n`);
      }
    }
    
    console.log(`\n=== 修复完成 ===`);
    console.log(`总共处理文章: ${articles.length}`);
    console.log(`成功修复文章: ${fixedCount}`);
    
  } catch (error) {
    console.error('修复过程中出错:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// 执行修复
fixLocalizedFields().catch(console.error);