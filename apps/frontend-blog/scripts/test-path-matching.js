/**
 * 测试路径匹配逻辑
 * 验证isProtectedRoute函数是否正确处理语言前缀
 */

console.log('🔍 测试路径匹配逻辑...\n');

// 测试用例
const testCases = [
  { path: '/zh/bookmarks', expected: true, description: '中文语言前缀' },
  { path: '/en/bookmarks', expected: true, description: '英文语言前缀' },
  { path: '/zh-CN/bookmarks', expected: true, description: '中文简体语言前缀' },
  { path: '/zh/bookmarks/', expected: true, description: '带斜杠结尾' },
  { path: '/zh/bookmarks/123', expected: true, description: '带参数' },
  { path: '/bookmarks', expected: true, description: '无语言前缀' },
  { path: '/zh/about', expected: false, description: '非受保护路由' },
  { path: '/en/about', expected: false, description: '英文非受保护路由' },
  { path: '/zh', expected: false, description: '只有语言前缀' },
  { path: '/', expected: false, description: '根路径' },
  { path: '/zh/bookmarks?query=123', expected: true, description: '带查询参数' },
  { path: '/zh/bookmarks#section', expected: true, description: '带hash' },
];

// 当前的正则表达式
const currentRegex = /^\/[a-z]{2}(-[A-Z]{2})?/;

// 改进的正则表达式
const improvedRegex = /^\/[a-z]{2}(-[A-Z]{2})?(\/|$)/;

console.log('📊 当前正则表达式测试:');
console.log(`正则: ${currentRegex.toString()}\n`);

testCases.forEach((testCase) => {
  const match = testCase.path.match(currentRegex);
  const pathWithoutLocale = testCase.path.replace(currentRegex, '');
  const isProtected = pathWithoutLocale.startsWith('/bookmarks');
  
  console.log(`路径: ${testCase.path}`);
  console.log(`  匹配结果: ${match ? match[0] : '无匹配'}`);
  console.log(`  移除语言前缀后: ${pathWithoutLocale}`);
  console.log(`  是否受保护: ${isProtected}`);
  console.log(`  期望: ${testCase.expected} (${testCase.description})`);
  console.log(`  结果: ${isProtected === testCase.expected ? '✅ 通过' : '❌ 失败'}\n`);
});

console.log('\n📊 改进的正则表达式测试:');
console.log(`正则: ${improvedRegex.toString()}\n`);

testCases.forEach((testCase) => {
  const match = testCase.path.match(improvedRegex);
  const pathWithoutLocale = testCase.path.replace(improvedRegex, '');
  const isProtected = pathWithoutLocale.startsWith('/bookmarks') || pathWithoutLocale === '/bookmarks';
  
  console.log(`路径: ${testCase.path}`);
  console.log(`  匹配结果: ${match ? match[0] : '无匹配'}`);
  console.log(`  移除语言前缀后: ${pathWithoutLocale}`);
  console.log(`  是否受保护: ${isProtected}`);
  console.log(`  期望: ${testCase.expected} (${testCase.description})`);
  console.log(`  结果: ${isProtected === testCase.expected ? '✅ 通过' : '❌ 失败'}\n`);
});

// 测试isProtectedRoute函数
console.log('\n🔧 测试isProtectedRoute函数逻辑:');

function isProtectedRouteCurrent(pathname) {
  // 当前实现
  const pathWithoutLocale = pathname.replace(/^\/[a-z]{2}(-[A-Z]{2})?/, '');
  return ['/bookmarks'].some((route) => pathWithoutLocale.startsWith(route));
}

function isProtectedRouteImproved(pathname) {
  // 改进实现
  const pathWithoutLocale = pathname.replace(/^\/[a-z]{2}(-[A-Z]{2})?(\/|$)/, '');
  return ['/bookmarks'].some((route) => 
    pathWithoutLocale.startsWith(route) || pathWithoutLocale === route
  );
}

console.log('\n当前实现:');
testCases.forEach((testCase) => {
  const result = isProtectedRouteCurrent(testCase.path);
  console.log(`  ${testCase.path}: ${result} (期望: ${testCase.expected}) ${result === testCase.expected ? '✅' : '❌'}`);
});

console.log('\n改进实现:');
testCases.forEach((testCase) => {
  const result = isProtectedRouteImproved(testCase.path);
  console.log(`  ${testCase.path}: ${result} (期望: ${testCase.expected}) ${result === testCase.expected ? '✅' : '❌'}`);
});

console.log('\n🎯 问题分析:');
console.log('1. 当前正则表达式 /^\\/[a-z]{2}(-[A-Z]{2})?/ 的问题:');
console.log('   - 匹配 "/zh" 但不匹配 "/zh/"');
console.log('   - 对于 "/zh/bookmarks" 能正确匹配，但 "/zh/" 格式可能有问题');
console.log('2. 改进建议:');
console.log('   - 使用 /^\\/[a-z]{2}(-[A-Z]{2})?(\\/|$)/ 确保匹配语言前缀后的斜杠或结束');
console.log('   - 在startsWith检查中添加精确匹配逻辑');

console.log('\n🚀 修复建议:');
console.log('1. 更新protected-routes.ts中的正则表达式');
console.log('2. 增强路径匹配逻辑，支持精确匹配');
console.log('3. 添加更多测试用例验证边缘情况');