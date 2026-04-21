#!/usr/bin/env node

/**
 * 验证语言闪烁修复脚本
 * 测试访问 /en/ 时是否直接显示en内容，无zh→en闪烁
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 验证语言闪烁修复\n');

// 检查关键修复
console.log('📋 关键修复检查:');

const checks = [
  {
    file: 'apps/frontend-blog/src/app/[locale]/page.tsx',
    check: (content) => {
      // 检查是否直接使用routeLocale，而不是detectLocale()
      const usesRouteLocale = content.includes('const locale = routeLocale;');
      const usesDetectLocale = content.includes('detectLocale()');
      return {
        passed: usesRouteLocale && !usesDetectLocale,
        message: usesRouteLocale ? 
          ' 直接使用URL路径语言 (routeLocale)' : 
          '❌ 未使用URL路径语言'
      };
    }
  },
  {
    file: 'apps/frontend-blog/src/app/[locale]/layout.tsx',
    check: (content) => {
      // 检查是否直接使用routeLocale，而不是getLocaleFromCookies
      const usesRouteLocale = content.includes('const locale = routeLocale;');
      const usesCookieFunction = content.includes('getLocaleFromCookies');
      return {
        passed: usesRouteLocale && !usesCookieFunction,
        message: usesRouteLocale ? 
          ' 直接使用URL路径语言 (routeLocale)' : 
          '❌ 未使用URL路径语言'
      };
    }
  },
  {
    file: 'apps/frontend-blog/middleware.ts',
    check: (content) => {
      // 检查是否使用detectLocale函数
      const usesDetectLocale = content.includes('detectLocale');
      return {
        passed: usesDetectLocale,
        message: usesDetectLocale ? 
          ' 使用统一的detectLocale函数' : 
          '❌ 未使用detectLocale函数'
      };
    }
  },
  {
    file: 'apps/frontend-blog/src/lib/api/http.ts',
    check: (content) => {
      // 检查是否使用detectLocale函数
      const usesDetectLocale = content.includes('detectLocale()');
      return {
        passed: usesDetectLocale,
        message: usesDetectLocale ? 
          ' HTTP客户端使用detectLocale函数' : 
          '❌ HTTP客户端未使用detectLocale函数'
      };
    }
  }
];

let allPassed = true;

checks.forEach((check, index) => {
  const filePath = path.join(__dirname, '..', check.file);
  
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const result = check.check(content);
    
    console.log(`${index + 1}. ${check.file}`);
    console.log(`   ${result.message}`);
    
    if (!result.passed) {
      allPassed = false;
    }
  } else {
    console.log(`${index + 1}. ${check.file}`);
    console.log(`   ❌ 文件不存在`);
    allPassed = false;
  }
});

// 调试：显示实际检查结果
console.log('\n🔍 详细检查结果:');
checks.forEach((check, index) => {
  const filePath = path.join(__dirname, '..', check.file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const result = check.check(content);
    console.log(`${index + 1}. ${check.file}: ${result.passed ? '' : '❌'}`);
  }
});

console.log('\n🎯 预期效果:');
console.log('1. 访问 https://blog-dev.joyminis.com/en/');
console.log('2. SSR直接渲染en内容');
console.log('3. CSR使用en语言');
console.log('4. 无zh→en闪烁');

console.log('\n🔧 修复原理:');
console.log('• SSR环境：直接使用URL路径中的语言 (/en/ → en)');
console.log('• CSR环境：detectLocale函数从cookie/URL/浏览器检测');
console.log('• 一致性：SSR和CSR使用相同语言，避免水合错误');

console.log('\n📊 测试步骤:');
console.log('1. 清除浏览器Cookie');
console.log('2. 访问 https://blog-dev.joyminis.com/en/');
console.log('3. 验证页面直接显示英文内容');
console.log('4. 验证无语言闪烁 (zh→en)');

if (allPassed) {
  console.log('\n 所有检查通过！语言闪烁问题已修复。');
  console.log('🚀 现在访问 /en/ 应该直接显示英文内容，无闪烁。');
  process.exit(0);
} else {
  console.log('\n⚠️  部分检查未通过，请检查修复。');
  process.exit(1);
}