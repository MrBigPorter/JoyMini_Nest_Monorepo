#!/usr/bin/env node

/**
 * 测试前端博客专用API接口
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:3001/api/v1';

async function testFrontendBlogApi() {
  console.log('🚀 开始测试前端博客专用API接口...\n');

  try {
    // 1. 测试文章列表接口
    console.log('1. 测试文章列表接口...');
    const articlesResponse = await axios.get(`${API_BASE_URL}/frontend/blog/articles`, {
      params: { page: 1, pageSize: 5 },
      headers: { 'Accept-Language': 'en' }
    });
    console.log('✅ 文章列表接口成功');
    console.log(`   返回 ${articlesResponse.data.items?.length || 0} 篇文章`);
    console.log(`   总计 ${articlesResponse.data.total || 0} 篇文章\n`);

    // 2. 测试分类列表接口
    console.log('2. 测试分类列表接口...');
    const categoriesResponse = await axios.get(`${API_BASE_URL}/frontend/blog/categories`, {
      headers: { 'Accept-Language': 'en' }
    });
    console.log('✅ 分类列表接口成功');
    console.log(`   返回 ${categoriesResponse.data?.length || 0} 个分类\n`);

    // 3. 测试标签列表接口
    console.log('3. 测试标签列表接口...');
    const tagsResponse = await axios.get(`${API_BASE_URL}/frontend/blog/tags`, {
      headers: { 'Accept-Language': 'en' }
    });
    console.log('✅ 标签列表接口成功');
    console.log(`   返回 ${tagsResponse.data?.length || 0} 个标签\n`);

    // 4. 测试热门文章接口
    console.log('4. 测试热门文章接口...');
    const popularResponse = await axios.get(`${API_BASE_URL}/frontend/blog/articles/popular`, {
      params: { limit: 3 },
      headers: { 'Accept-Language': 'en' }
    });
    console.log('✅ 热门文章接口成功');
    console.log(`   返回 ${popularResponse.data?.length || 0} 篇热门文章\n`);

    // 5. 测试博客统计接口
    console.log('5. 测试博客统计接口...');
    const statsResponse = await axios.get(`${API_BASE_URL}/frontend/blog/stats`);
    console.log('✅ 博客统计接口成功');
    console.log(`   文章总数: ${statsResponse.data.totalArticles || 0}`);
    console.log(`   分类总数: ${statsResponse.data.totalCategories || 0}`);
    console.log(`   标签总数: ${statsResponse.data.totalTags || 0}\n`);

    // 6. 测试热门标签接口
    console.log('6. 测试热门标签接口...');
    const popularTagsResponse = await axios.get(`${API_BASE_URL}/frontend/blog/tags/popular`, {
      params: { limit: 5 }
    });
    console.log('✅ 热门标签接口成功');
    console.log(`   返回 ${popularTagsResponse.data?.length || 0} 个热门标签\n`);

    console.log('🎉 所有前端博客专用API接口测试通过！');
    console.log('\n📊 接口对比总结:');
    console.log('   - 新接口路径: /v1/frontend/blog/*');
    console.log('   - 旧接口路径: /v1/public/blog/*');
    console.log('   - 优势: 数据格式简化，多语言处理优化，只返回前端必需字段');
    console.log('   - 兼容性: 新旧接口可以并行运行，前端可以逐步迁移');

  } catch (error) {
    console.error('❌ API测试失败:');
    if (error.response) {
      console.error(`   状态码: ${error.response.status}`);
      console.error(`   错误信息: ${error.response.data?.message || error.message}`);
      console.error(`   请求URL: ${error.config?.url}`);
    } else {
      console.error(`   错误: ${error.message}`);
    }
    console.log('\n💡 建议:');
    console.log('   1. 确保API服务正在运行 (npm run dev:api)');
    console.log('   2. 检查数据库是否有测试数据');
    console.log('   3. 检查API端口配置 (默认: 3001)');
    process.exit(1);
  }
}

// 检查API服务是否可用
async function checkApiHealth() {
  try {
    await axios.get(`${API_BASE_URL}/health`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('🔍 检查API服务状态...');
  const isApiHealthy = await checkApiHealth();
  
  if (!isApiHealthy) {
    console.log('⚠️  API服务未运行或不可访问');
    console.log('   请先启动API服务:');
    console.log('   cd apps/api && npm run start:dev');
    console.log('   或使用 monorepo 命令:');
    console.log('   npm run dev:api');
    console.log('\n   等待5秒后重试...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const retryHealthy = await checkApiHealth();
    if (!retryHealthy) {
      console.log('❌ API服务仍然不可用，无法继续测试');
      process.exit(1);
    }
  }
  
  console.log('✅ API服务可用，开始测试...\n');
  await testFrontendBlogApi();
}

main().catch(console.error);