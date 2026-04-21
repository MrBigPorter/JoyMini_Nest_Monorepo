#!/usr/bin/env node

/**
 * 调试评论数据结构脚本
 * 帮助理解为什么乐观更新没有生效
 */

console.log('🔍 调试评论数据结构');
console.log('='.repeat(50));

// 模拟实际的评论数据结构
const mockCommentResponse = {
  items: [
    {
      id: 'cmt_01hq1234567890abcdefghij',
      articleId: 'art_01hq1234567890abcdefghij',
      author: '用户A',
      email: null,
      website: null,
      content: '第一条评论',
      parentId: null,
      status: 'APPROVED',
      ipAddress: null,
      userAgent: null,
      aiModerationScore: null,
      aiModerationReason: null,
      aiModerationCategories: null,
      aiModeratedAt: null,
      isAiGenerated: false,
      createdAt: '2026-04-16T10:00:00.000Z',
      updatedAt: '2026-04-16T10:00:00.000Z',
      children: [
        {
          id: 'cmt_01hq234567890abcdefghijk',
          articleId: 'art_01hq1234567890abcdefghij',
          author: '用户B',
          email: null,
          website: null,
          content: '回复1',
          parentId: 'cmt_01hq1234567890abcdefghij',
          status: 'APPROVED',
          ipAddress: null,
          userAgent: null,
          aiModerationScore: null,
          aiModerationReason: null,
          aiModerationCategories: null,
          aiModeratedAt: null,
          isAiGenerated: false,
          createdAt: '2026-04-16T10:05:00.000Z',
          updatedAt: '2026-04-16T10:05:00.000Z',
          children: []
        }
      ]
    }
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1
};

console.log('\n📊 实际评论数据结构分析');
console.log('-'.repeat(30));

console.log('1. 评论ID格式:');
console.log(`   父评论ID: ${mockCommentResponse.items[0].id}`);
console.log(`   子评论parentId: ${mockCommentResponse.items[0].children[0].parentId}`);
console.log(`   类型匹配: ${typeof mockCommentResponse.items[0].id} === ${typeof mockCommentResponse.items[0].children[0].parentId}`);

console.log('\n2. 乐观更新模拟:');
const newComment = {
  content: '测试回复',
  parentId: 'cmt_01hq1234567890abcdefghij',
  author: '测试用户'
};

console.log(`   新评论parentId: ${newComment.parentId}`);
console.log(`   匹配父评论ID: ${mockCommentResponse.items[0].id}`);
console.log(`   是否匹配: ${newComment.parentId === mockCommentResponse.items[0].id}`);

console.log('\n3. 递归查找算法测试:');
const updateCommentTree = (comments, parentId, newComment) => {
  return comments.map(comment => {
    console.log(`   检查评论: ${comment.id}, 目标parentId: ${parentId}`);
    
    if (comment.id === parentId) {
      console.log(`    找到父评论: ${comment.id}`);
      return {
        ...comment,
        children: [...comment.children, newComment]
      };
    }
    
    if (comment.children && comment.children.length > 0) {
      console.log(`   🔍 递归检查子评论`);
      return {
        ...comment,
        children: updateCommentTree(comment.children, parentId, newComment)
      };
    }
    
    return comment;
  });
};

console.log('\n4. 缓存数据结构:');
console.log('   Query Key: ["comments", articleId]');
console.log('   数据结构:', {
  items: 'Array<Comment>',
  total: 'number',
  page: 'number',
  pageSize: 'number',
  totalPages: 'number'
});

console.log('\n5. 可能的问题:');
const potentialIssues = [
  '❓ 评论ID类型不匹配 (string vs number)',
  '❓ 递归算法没有正确更新嵌套结构',
  '❓ 缓存更新后React没有重新渲染',
  '❓ Query Key不匹配导致缓存更新失败',
  '❓ 乐观评论对象缺少必要字段',
  '❓ 父评论的children属性可能为undefined'
];

potentialIssues.forEach(issue => console.log(`   ${issue}`));

console.log('\n6. 调试建议:');
const debugSuggestions = [
  '1. 在onMutate中添加console.log调试',
  '2. 检查queryClient.getQueryData返回的数据结构',
  '3. 验证评论ID的类型和格式',
  '4. 测试递归算法是否正确找到父评论',
  '5. 检查缓存更新后的数据是否正确',
  '6. 确保前端服务已重启应用最新代码'
];

debugSuggestions.forEach(suggestion => console.log(`   ${suggestion}`));

console.log('\n🔧 立即调试步骤:');
console.log('1. 在useComments.ts的onMutate中添加调试日志');
console.log('2. 检查评论提交时parentId的值');
console.log('3. 验证缓存数据结构');
console.log('4. 测试递归查找算法');

console.log('\n 调试完成');
console.log('='.repeat(50));