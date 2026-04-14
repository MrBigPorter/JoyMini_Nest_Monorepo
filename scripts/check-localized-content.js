#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

// 设置环境变量
process.env.DATABASE_URL = 'postgresql://dev:devpassword@localhost:5432/lucky_dev?schema=public';

const prisma = new PrismaClient();

async function checkLocalizedContent() {
  console.log('=== 检查 Localized 字段实际内容 ===\n');

  try {
    // 获取所有文章
    const articles = await prisma.blogArticle.findMany({
      take: 10,
      select: {
        id: true,
        title: true,
        titleLocalized: true,
        excerpt: true,
        excerptLocalized: true,
        content: true,
        contentLocalized: true,
        translationStatus: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`找到 ${articles.length} 篇文章\n`);

    for (const article of articles) {
      console.log(`文章 ID: ${article.id}`);
      console.log(`创建时间: ${article.createdAt}`);
      console.log(`更新时间: ${article.updatedAt}`);
      console.log(`翻译状态: ${article.translationStatus}`);
      
      // 检查 titleLocalized 的实际内容
      console.log('\ntitleLocalized 字段:');
      if (article.titleLocalized) {
        const titleLocalized = article.titleLocalized;
        console.log('  类型:', typeof titleLocalized);
        console.log('  值:', JSON.stringify(titleLocalized));
        
        if (typeof titleLocalized === 'object') {
          console.log('  包含的键:', Object.keys(titleLocalized));
          console.log('  zh 值:', titleLocalized.zh);
          console.log('  en 值:', titleLocalized.en);
          
          // 检查是否是嵌套对象
          if (titleLocalized.en && typeof titleLocalized.en === 'object') {
            console.log('  en 是对象:', JSON.stringify(titleLocalized.en));
          }
          if (titleLocalized.zh && typeof titleLocalized.zh === 'object') {
            console.log('  zh 是对象:', JSON.stringify(titleLocalized.zh));
          }
        }
      } else {
        console.log('  为空');
      }
      
      // 检查 excerptLocalized
      console.log('\nexcerptLocalized 字段:');
      if (article.excerptLocalized) {
        const excerptLocalized = article.excerptLocalized;
        console.log('  类型:', typeof excerptLocalized);
        console.log('  值:', JSON.stringify(excerptLocalized));
        
        if (typeof excerptLocalized === 'object') {
          console.log('  包含的键:', Object.keys(excerptLocalized));
        }
      } else {
        console.log('  为空');
      }
      
      // 检查 contentLocalized
      console.log('\ncontentLocalized 字段:');
      if (article.contentLocalized) {
        const contentLocalized = article.contentLocalized;
        console.log('  类型:', typeof contentLocalized);
        
        if (typeof contentLocalized === 'object') {
          console.log('  包含的键:', Object.keys(contentLocalized));
          // 只显示前100个字符
          if (contentLocalized.en && typeof contentLocalized.en === 'string') {
            console.log('  en 长度:', contentLocalized.en.length);
            console.log('  en 前100字符:', contentLocalized.en.substring(0, 100) + '...');
          }
          if (contentLocalized.zh && typeof contentLocalized.zh === 'string') {
            console.log('  zh 长度:', contentLocalized.zh.length);
            console.log('  zh 前100字符:', contentLocalized.zh.substring(0, 100) + '...');
          }
        }
      } else {
        console.log('  为空');
      }
      
      console.log('\n' + '='.repeat(80) + '\n');
    }
    
  } catch (error) {
    console.error('检查过程中出错:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkLocalizedContent().catch(console.error);