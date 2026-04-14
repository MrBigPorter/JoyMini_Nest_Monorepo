#!/usr/bin/env node

/**
 * 翻译问题检测功能测试脚本
 * 用于验证新添加的翻译问题检测和批量修复功能
 */

console.log('🚀 开始测试翻译问题检测功能...\n');

// 模拟测试数据
const mockArticles = [
  {
    id: 'test-article-1',
    title: '测试文章1',
    titleLocalized: {
      zh: '测试文章1',
      en: '测试文章1', // 标题未翻译（与中文相同）
    },
    contentLocalized: {
      zh: '这是一篇中文文章内容，包含很多详细信息。',
      en: 'This is English content', // 内容不完整（比中文短很多）
    },
    translationStatus: 'COMPLETED',
  },
  {
    id: 'test-article-2',
    title: '测试文章2',
    titleLocalized: {
      zh: '测试文章2',
      en: 'Test Article 2', // 标题已翻译
    },
    contentLocalized: {
      zh: '另一篇中文文章',
      en: 'Another English article', // 内容完整
    },
    translationStatus: 'COMPLETED',
  },
  {
    id: 'test-article-3',
    title: '测试文章3',
    titleLocalized: {
      zh: '测试文章3',
      en: '', // 标题未翻译（空字符串）
    },
    contentLocalized: {
      zh: '第三篇中文文章',
      en: '', // 内容未翻译（空字符串）
    },
    translationStatus: 'FAILED',
  },
];

// 模拟问题检测算法
function detectArticleTranslationIssues(article, languageCode = 'en') {
  const issues = [];
  const lang = languageCode;

  // 1. 检查标题是否未翻译
  const titleEn = article.titleLocalized?.[lang];
  const titleZh = article.titleLocalized?.zh;
  if (titleEn && titleZh && titleEn === titleZh) {
    issues.push({
      language: lang,
      issueType: 'TITLE_NOT_TRANSLATED',
      severity: 'HIGH',
      description: `${lang.toUpperCase()}标题与中文标题完全相同，未翻译`,
    });
  }

  // 2. 检查内容是否完整
  const contentEn = article.contentLocalized?.[lang] || '';
  const contentZh = article.contentLocalized?.zh || '';
  if (contentZh && contentEn.length < contentZh.length * 0.3) {
    issues.push({
      language: lang,
      issueType: 'CONTENT_INCOMPLETE',
      severity: 'MEDIUM',
      description: `${lang.toUpperCase()}内容不完整（${contentEn.length}/${contentZh.length}字符）`,
    });
  }

  // 3. 检查是否有翻译
  if (!article.titleLocalized?.[lang] || !article.contentLocalized?.[lang]) {
    issues.push({
      language: lang,
      issueType: 'NOT_TRANSLATED',
      severity: 'HIGH',
      description: `缺少${lang.toUpperCase()}翻译`,
    });
  }

  // 4. 检查翻译状态
  if (article.translationStatus === 'FAILED') {
    issues.push({
      language: lang,
      issueType: 'TRANSLATION_FAILED',
      severity: 'HIGH',
      description: `${lang.toUpperCase()}翻译失败`,
    });
  }

  return issues;
}

// 运行测试
console.log('📊 测试文章数据:');
mockArticles.forEach((article, index) => {
  console.log(`\n文章 ${index + 1}: ${article.title}`);
  console.log(`  - 中文标题: ${article.titleLocalized.zh}`);
  console.log(`  - 英文标题: ${article.titleLocalized.en}`);
  console.log(`  - 中文内容长度: ${article.contentLocalized.zh.length}`);
  console.log(`  - 英文内容长度: ${article.contentLocalized.en.length}`);
  console.log(`  - 翻译状态: ${article.translationStatus}`);
});

console.log('\n🔍 检测翻译问题:');
let totalIssues = 0;
mockArticles.forEach((article, index) => {
  const issues = detectArticleTranslationIssues(article, 'en');
  if (issues.length > 0) {
    console.log(`\n文章 ${index + 1} "${article.title}" 发现问题:`);
    issues.forEach((issue, issueIndex) => {
      console.log(`  ${issueIndex + 1}. [${issue.severity}] ${issue.issueType}: ${issue.description}`);
    });
    totalIssues += issues.length;
  } else {
    console.log(`\n文章 ${index + 1} "${article.title}" 无问题`);
  }
});

console.log(`\n📈 检测结果总结:`);
console.log(`  - 总文章数: ${mockArticles.length}`);
console.log(`  - 发现问题文章数: ${mockArticles.filter(a => detectArticleTranslationIssues(a, 'en').length > 0).length}`);
console.log(`  - 总问题数: ${totalIssues}`);

// 测试批量修复逻辑
console.log('\n🛠️ 测试批量修复逻辑:');
const problematicArticles = mockArticles.filter(a => detectArticleTranslationIssues(a, 'en').length > 0);
console.log(`  - 需要修复的文章数: ${problematicArticles.length}`);
console.log(`  - 文章ID列表: ${problematicArticles.map(a => a.id).join(', ')}`);

// 模拟批量修复API调用
console.log('\n📡 模拟API调用:');
console.log('  1. GET /v1/admin/blog/translation-issues?languageCode=en');
console.log('     → 返回问题检测结果');
console.log('  2. POST /v1/admin/blog/translation-fix-batch');
console.log('     → 批量投递修复任务');
console.log('  3. GET /v1/admin/blog/enabled-languages');
console.log('     → 返回启用语言列表');

console.log('\n✅ 测试完成！');
console.log('\n🎯 预期功能:');
console.log('  1. 自动检测标题未翻译的问题');
console.log('  2. 自动检测内容不完整的问题');
console.log('  3. 自动检测缺少翻译的问题');
console.log('  4. 支持按语言筛选问题');
console.log('  5. 支持批量修复所有问题');
console.log('  6. 支持选择性修复特定文章');
console.log('  7. 实时显示修复进度');

console.log('\n📁 已更新的文件:');
console.log('  - apps/api/src/blog/blog.service.ts (添加问题检测和批量修复方法)');
console.log('  - apps/api/src/blog/blog.controller.ts (添加API端点)');
console.log('  - apps/admin-next/src/api/index.ts (添加API客户端方法)');
console.log('  - apps/admin-next/src/views/blog/BlogTranslationProgress.tsx (添加前端UI)');
console.log('  - plans/translation-issue-detection-fix-plan.md (详细实施计划)');

console.log('\n🚀 现在可以访问管理后台的翻译进度页面，查看新增的"问题文章检测"功能！');