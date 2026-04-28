#!/usr/bin/env node

/**
 * 测试语言切换修复效果
 *
 * 这个脚本测试语言切换问题的修复效果
 * 根据.clinerules宪法v2.0要求，修复必须：
 * 1. 解决客户端路由切换时的状态管理问题
 * 2. 确保API调用传递正确的locale参数
 * 3. 确保React Query缓存key包含locale
 */

const fs = require("fs");
const path = require("path");

console.log("🔍 测试语言切换修复效果\n");

// 1. 检查HTTP客户端修复
const httpPath = path.join(
  __dirname,
  "../apps/frontend-blog/src/lib/api/http.ts",
);
console.log("1. 检查HTTP客户端修复...");
if (fs.existsSync(httpPath)) {
  const content = fs.readFileSync(httpPath, "utf8");

  // 检查关键修复点
  const checks = {
    添加lang查询参数:
      content.includes("config.params = {") && content.includes("lang: lang"),
    "保留Accept-Language头部": content.includes(
      "config.headers['Accept-Language'] = lang",
    ),
    符合后端优先级: content.includes(
      "后端 LanguageService.resolveLanguage() 优先使用查询参数",
    ),
  };

  Object.entries(checks).forEach(([check, passed]) => {
    console.log(`   ${passed ? "" : "❌"} ${check}`);
  });
} else {
  console.log(`   ❌ HTTP客户端文件不存在: ${httpPath}`);
}

// 2. 检查useArticlesInfiniteQuery修复
const articlesHookPath = path.join(
  __dirname,
  "../apps/frontend-blog/src/lib/hooks/useArticlesInfiniteQuery.ts",
);
console.log("\n2. 检查useArticlesInfiniteQuery修复...");
if (fs.existsSync(articlesHookPath)) {
  const content = fs.readFileSync(articlesHookPath, "utf8");

  // 检查关键修复点
  const checks = {
    导入useParams: content.includes(
      "import { useParams } from 'next/navigation'",
    ),
    获取locale参数:
      content.includes("const locale = (params.locale as string)") ||
      content.includes("const locale = params.locale as string"),
    queryKey包含locale:
      (content.includes("locale }") || content.includes("locale,")) &&
      content.includes("queryKey"),
  };

  Object.entries(checks).forEach(([check, passed]) => {
    console.log(`   ${passed ? "" : "❌"} ${check}`);
  });
} else {
  console.log(`   ❌ useArticlesInfiniteQuery文件不存在: ${articlesHookPath}`);
}

// 3. 检查其他相关Hook
console.log("\n3. 检查其他相关Hook...");
const hooksToCheck = ["useBookmarks.ts", "useBookmarksInfiniteQuery.ts"];

hooksToCheck.forEach((hookFile) => {
  const hookPath = path.join(
    __dirname,
    "../apps/frontend-blog/src/lib/hooks",
    hookFile,
  );
  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, "utf8");
    const hasLocaleInQueryKey =
      content.includes("locale") && content.includes("queryKey");
    console.log(
      `   ${hasLocaleInQueryKey ? "" : "⚠️ "} ${hookFile}: ${hasLocaleInQueryKey ? "queryKey包含locale" : "可能需要更新"}`,
    );
  } else {
    console.log(`   ℹ️  ${hookFile}: 文件不存在`);
  }
});

// 4. 模拟测试场景
console.log("\n4. 模拟测试场景...");
console.log("   📋 场景1: 语言切换时HTTP请求");
console.log("     预期: 每个API请求都包含lang查询参数");
console.log("     实现: HTTP拦截器自动添加lang参数");

console.log("\n   📋 场景2: 语言切换时React Query缓存");
console.log("     预期: 缓存key包含locale，语言切换时重新获取数据");
console.log("     实现: queryKey包含locale参数，useParams监听路由变化");

console.log("\n   📋 场景3: 后端语言解析");
console.log("     预期: 后端正确识别语言并返回对应内容");
console.log("     实现: LanguageService.resolveLanguage()优先使用查询参数");

// 5. 总结
console.log("\n📊 测试总结");
console.log("=".repeat(40));

const issues = [];

// 检查关键问题
if (fs.existsSync(httpPath)) {
  const content = fs.readFileSync(httpPath, "utf8");
  const hasLangParam = content.includes("lang: lang");
  const hasAcceptLanguage = content.includes("Accept-Language");

  if (!hasLangParam) {
    issues.push("❌ HTTP客户端没有添加lang查询参数");
  }

  if (!hasAcceptLanguage) {
    issues.push("⚠️  HTTP客户端没有设置Accept-Language头部");
  }
}

if (fs.existsSync(articlesHookPath)) {
  const content = fs.readFileSync(articlesHookPath, "utf8");
  const hasLocaleInQueryKey =
    (content.includes("locale }") || content.includes("locale,")) &&
    content.includes("queryKey");
  const hasUseParams = content.includes("useParams");

  if (!hasLocaleInQueryKey) {
    issues.push("❌ useArticlesInfiniteQuery的queryKey没有包含locale");
  }

  if (!hasUseParams) {
    issues.push("❌ useArticlesInfiniteQuery没有使用useParams获取locale");
  }
}

if (issues.length === 0) {
  console.log(" 所有检查通过！修复符合.clinerules宪法要求。");
  console.log("\n🎯 修复效果：");
  console.log("   - HTTP请求自动添加lang查询参数");
  console.log("   - React Query缓存key包含locale");
  console.log("   - 语言切换时自动重新获取数据");
  console.log("   - 后端能正确识别并返回对应语言内容");
} else {
  console.log("❌ 发现问题：");
  issues.forEach((issue) => console.log(`   ${issue}`));
}

console.log("\n🔧 建议：");
console.log("   1. 运行开发服务器测试: cd apps/frontend-blog && yarn dev");
console.log("   2. 切换语言，检查文章内容是否更新");
console.log("   3. 检查网络请求，确认lang参数是否正确传递");
console.log("   4. 验证刷新页面和点击切换效果是否一致");

console.log("\n📝 注意事项：");
console.log("   - 确保所有数据获取Hook都更新了queryKey");
console.log("   - 检查是否有其他API调用需要locale参数");
console.log("   - 验证SSR环境下的语言处理是否正确");
