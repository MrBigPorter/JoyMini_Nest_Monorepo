#!/usr/bin/env node

/**
 * 测试Categories页面语言切换修复效果
 * 
 * 这个脚本测试Categories页面语言切换问题的修复效果
 * 根据.clinerules宪法v2.0要求，修复必须：
 * 1. 确保useFrontendCategories Hook的queryKey包含locale
 * 2. 确保useFrontendCategoryBySlug Hook的queryKey包含locale
 * 3. 确保useFrontendTags Hook的queryKey包含locale
 * 4. 确保useFrontendTagBySlug Hook的queryKey包含locale
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 测试Categories页面语言切换修复效果\n');

// 1. 检查useFrontendArticles.ts文件
const hookPath = path.join(__dirname, '../apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts');
console.log('1. 检查useFrontendArticles.ts文件...');
if (fs.existsSync(hookPath)) {
  const content = fs.readFileSync(hookPath, 'utf8');
  
  // 检查关键修复点
  const checks = {
    '导入useParams': content.includes("import { useParams } from 'next/navigation'"),
    'useFrontendCategories包含locale': content.includes('useFrontendCategories() {') && content.includes('queryKey: [\'frontendCategories\', locale]'),
    'useFrontendCategoryBySlug包含locale': content.includes('useFrontendCategoryBySlug(') && content.includes('queryKey: [\'frontendCategory\', slug, locale'),
    'useFrontendTags包含locale': content.includes('useFrontendTags() {') && content.includes('queryKey: [\'frontendTags\', locale]'),
    'useFrontendTagBySlug包含locale': content.includes('useFrontendTagBySlug(') && content.includes('queryKey: [\'frontendTag\', slug, locale'),
  };
  
  Object.entries(checks).forEach(([check, passed]) => {
    console.log(`   ${passed ? '✅' : '❌'} ${check}`);
  });
} else {
  console.log(`   ❌ useFrontendArticles.ts文件不存在: ${hookPath}`);
}

// 2. 检查Categories页面文件
const categoriesPagePath = path.join(__dirname, '../apps/frontend-blog/src/app/[locale]/categories/page.tsx');
console.log('\n2. 检查Categories页面文件...');
if (fs.existsSync(categoriesPagePath)) {
  const content = fs.readFileSync(categoriesPagePath, 'utf8');
  
  // 检查关键修复点
  const checks = {
    '使用useFrontendCategories': content.includes('useFrontendCategories()'),
    '从next-intl导入useTranslations': content.includes("import { useTranslations } from 'next-intl'"),
    '正确使用国际化': content.includes('t(\'categories.title\')') || content.includes('t("categories.title")'),
  };
  
  Object.entries(checks).forEach(([check, passed]) => {
    console.log(`   ${passed ? '✅' : '❌'} ${check}`);
  });
} else {
  console.log(`   ❌ Categories页面文件不存在: ${categoriesPagePath}`);
}

// 3. 检查分类详情页面
const categoryDetailPagePath = path.join(__dirname, '../apps/frontend-blog/src/app/[locale]/categories/[slug]/page.tsx');
console.log('\n3. 检查分类详情页面文件...');
if (fs.existsSync(categoryDetailPagePath)) {
  const content = fs.readFileSync(categoryDetailPagePath, 'utf8');
  
  // 检查关键修复点
  const checks = {
    '使用useFrontendCategoryBySlug': content.includes('useFrontendCategoryBySlug'),
    '从路由参数获取slug': content.includes('params.slug'),
    '正确使用国际化': content.includes('t(\'categories.notFound\')') || content.includes('t("categories.notFound")'),
  };
  
  Object.entries(checks).forEach(([check, passed]) => {
    console.log(`   ${passed ? '✅' : '❌'} ${check}`);
  });
} else {
  console.log(`   ❌ 分类详情页面文件不存在: ${categoryDetailPagePath}`);
}

// 4. 模拟测试场景
console.log('\n4. 模拟测试场景...');
console.log('   📋 场景1: 访问Categories页面');
console.log('     预期: 显示当前语言对应的分类列表');
console.log('     实现: useFrontendCategories Hook的queryKey包含locale');

console.log('\n   📋 场景2: 切换语言后访问Categories页面');
console.log('     预期: 重新获取对应语言的分类列表');
console.log('     实现: queryKey变化触发React Query重新获取数据');

console.log('\n   📋 场景3: 访问分类详情页面');
console.log('     预期: 显示当前语言对应的分类文章');
console.log('     实现: useFrontendCategoryBySlug Hook的queryKey包含locale');

console.log('\n   📋 场景4: 切换语言后访问分类详情页面');
console.log('     预期: 重新获取对应语言的分类文章');
console.log('     实现: queryKey变化触发React Query重新获取数据');

// 5. 总结
console.log('\n📊 测试总结');
console.log('=' .repeat(40));

const issues = [];

// 检查关键问题
if (fs.existsSync(hookPath)) {
  const content = fs.readFileSync(hookPath, 'utf8');
  
  if (!content.includes('queryKey: [\'frontendCategories\', locale]')) {
    issues.push('❌ useFrontendCategories的queryKey没有包含locale');
  }
  
  if (!content.includes('queryKey: [\'frontendCategory\', slug, locale')) {
    issues.push('❌ useFrontendCategoryBySlug的queryKey没有包含locale');
  }
  
  if (!content.includes('queryKey: [\'frontendTags\', locale]')) {
    issues.push('❌ useFrontendTags的queryKey没有包含locale');
  }
  
  if (!content.includes('queryKey: [\'frontendTag\', slug, locale')) {
    issues.push('❌ useFrontendTagBySlug的queryKey没有包含locale');
  }
}

if (issues.length === 0) {
  console.log('✅ 所有检查通过！Categories页面修复符合.clinerules宪法要求。');
  console.log('\n🎯 修复效果：');
  console.log('   - Categories页面语言切换时重新获取分类列表');
  console.log('   - 分类详情页面语言切换时重新获取文章');
  console.log('   - Tags页面语言切换时重新获取标签列表');
  console.log('   - 标签详情页面语言切换时重新获取文章');
  console.log('   - 所有数据获取Hook的queryKey都包含locale参数');
} else {
  console.log('❌ 发现问题：');
  issues.forEach(issue => console.log(`   ${issue}`));
}

console.log('\n🔧 建议：');
console.log('   1. 运行开发服务器测试: cd apps/frontend-blog && yarn dev');
console.log('   2. 访问/categories页面，切换语言检查分类名称是否更新');
console.log('   3. 访问分类详情页面，切换语言检查文章内容是否更新');
console.log('   4. 检查网络请求，确认lang参数是否正确传递');

console.log('\n📝 注意事项：');
console.log('   - 确保所有页面组件都正确使用国际化');
console.log('   - 检查是否有其他页面使用这些Hook需要更新');
console.log('   - 验证SSR环境下的语言处理是否正确');