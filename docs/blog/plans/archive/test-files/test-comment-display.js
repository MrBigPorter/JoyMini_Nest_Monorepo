#!/usr/bin/env node

/**
 * 测试评论显示问题
 * 这个脚本模拟评论提交过程，检查乐观更新是否正常工作
 */

const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3000/v1/frontend/blog';
const ARTICLE_ID = 'xss-attack-defense-complete-guide';

async function testCommentDisplay() {
  console.log('=== 测试评论显示问题 ===\n');
  
  // 1. 首先获取当前评论
  console.log('1. 获取当前评论列表...');
  try {
    const commentsRes = await fetch(`${API_BASE}/articles/${ARTICLE_ID}/comments`);
    const commentsData = await commentsRes.json();
    console.log(`   当前评论数量: ${commentsData.data?.items?.length || 0}`);
    console.log(`   总评论数: ${commentsData.data?.total || 0}`);
  } catch (error) {
    console.log(`   获取评论失败: ${error.message}`);
  }
  
  // 2. 提交新评论
  console.log('\n2. 提交新评论...');
  const newComment = {
    content: '测试评论显示问题 - ' + Date.now(),
    author: '测试用户',
    email: 'test@example.com',
    website: 'https://example.com'
  };
  
  try {
    const postRes = await fetch(`${API_BASE}/articles/${ARTICLE_ID}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newComment)
    });
    
    const postData = await postRes.json();
    console.log(`   提交结果: ${postData.code === 10000 ? '成功' : '失败'}`);
    console.log(`   消息: ${postData.message}`);
    console.log(`   事务ID: ${postData.tid}`);
    
    if (postData.data) {
      console.log(`   返回的评论ID: ${postData.data.id}`);
      console.log(`   评论状态: ${postData.data.status}`);
    }
  } catch (error) {
    console.log(`   提交评论失败: ${error.message}`);
  }
  
  // 3. 等待3秒后再次获取评论
  console.log('\n3. 等待3秒后检查评论...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  try {
    const commentsRes2 = await fetch(`${API_BASE}/articles/${ARTICLE_ID}/comments`);
    const commentsData2 = await commentsRes2.json();
    console.log(`   3秒后评论数量: ${commentsData2.data?.items?.length || 0}`);
    console.log(`   3秒后总评论数: ${commentsData2.data?.total || 0}`);
    
    if (commentsData2.data?.items?.length > 0) {
      console.log('\n   最新评论:');
      commentsData2.data.items.slice(0, 3).forEach((comment, index) => {
        console.log(`   ${index + 1}. ${comment.content.substring(0, 50)}...`);
        console.log(`      作者: ${comment.author}, 状态: ${comment.status || 'unknown'}`);
        console.log(`      时间: ${comment.createdAt}`);
      });
    }
  } catch (error) {
    console.log(`   获取评论失败: ${error.message}`);
  }
  
  // 4. 等待10秒后再次检查（给AI审核时间）
  console.log('\n4. 等待10秒后检查AI审核结果...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  try {
    const commentsRes3 = await fetch(`${API_BASE}/articles/${ARTICLE_ID}/comments`);
    const commentsData3 = await commentsRes3.json();
    console.log(`   10秒后评论数量: ${commentsData3.data?.items?.length || 0}`);
    console.log(`   10秒后总评论数: ${commentsData3.data?.total || 0}`);
    
    // 检查评论状态
    if (commentsData3.data?.items?.length > 0) {
      const latestComment = commentsData3.data.items[0];
      console.log(`\n   最新评论状态: ${latestComment.status || 'unknown'}`);
      console.log(`   内容: ${latestComment.content.substring(0, 50)}...`);
    }
  } catch (error) {
    console.log(`   获取评论失败: ${error.message}`);
  }
  
  console.log('\n=== 测试完成 ===');
}

// 运行测试
testCommentDisplay().catch(console.error);