// 测试评论即时显示功能
console.log("=== 测试评论即时显示功能 ===");

// 模拟乐观更新评论
const optimisticComment = {
  id: "temp-1234567890",
  articleId: "test-article-id",
  author: "测试用户",
  email: null,
  website: null,
  content: "这是一个测试评论",
  parentId: null,
  approved: true,
  likes: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  children: [],
};

console.log("1. 乐观评论结构检查:");
console.log("   - ID:", optimisticComment.id);
console.log("   - 是否临时ID:", optimisticComment.id.startsWith("temp-"));
console.log("   - 是否已批准:", optimisticComment.approved);
console.log("   - 作者:", optimisticComment.author);
console.log("   - 内容:", optimisticComment.content);

// 检查评论加载状态逻辑
const isCommentLoaded =
  optimisticComment.id &&
  (optimisticComment.approved || !optimisticComment.id.startsWith("temp-"));
console.log("\n2. 评论加载状态检查:");
console.log("   - isCommentLoaded:", isCommentLoaded);
console.log("   - 预期结果: true (应该立即显示)");

// 测试回复评论
const replyComment = {
  ...optimisticComment,
  id: "temp-1234567891",
  parentId: "parent-comment-id",
  content: "这是一个回复评论",
};

const isReplyLoaded =
  replyComment.id &&
  (replyComment.approved || !replyComment.id.startsWith("temp-"));
console.log("\n3. 回复评论加载状态检查:");
console.log("   - isReplyLoaded:", isReplyLoaded);
console.log("   - 预期结果: true (应该立即显示)");

console.log("\n=== 测试完成 ===");
console.log("总结: 乐观更新评论应该立即显示，无需等待API响应。");
