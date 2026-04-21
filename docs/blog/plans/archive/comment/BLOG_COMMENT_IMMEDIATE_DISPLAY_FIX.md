# 评论即时显示功能修复方案

## 📋 设计历程

本功能经历了多个设计迭代阶段，相关设计文档已归档至 `docs/blog/plans/archive/`：

- `comment-immediate-display-plan.md` - 原始详细计划（240行）
- `comment-immediate-display-simplified-plan.md` - 简化实施计划（422行）
- `comment-immediate-display-final-plan.md` - 最终方案设计（175行）

## 🎯 问题背景

在博客评论系统中，用户提交评论后需要等待AI审核才能显示。为了提高用户体验，我们实现了乐观更新（Optimistic Update）机制，让评论能够立即显示，后台异步进行AI审核。

然而，在实际使用中发现，乐观更新虽然逻辑正确，但评论并没有立即显示在页面上。

## 🔍 问题分析

### 根本原因：React Query 缓存键不匹配

这是一个非常经典的 React Query "坑"。乐观更新逻辑写得非常完整，思路也完全正确，但未能及时渲染的原因出在 **Query Key（缓存键）不匹配** 上。

在 React Query 中，只有**完全一致**的 Query Key 才能正确触发缓存更新和页面重渲染。

### 具体问题

对比获取评论和更新评论时使用的 Query Key：

**1. 获取数据时 (`useComments`):**

```typescript
queryKey: ["comments", articleId, params];
```

在 `CommentList.tsx` 中调用的是 `useComments(articleId)`，此时 `params` 为 `undefined`。所以 React Query 实际存储和监听的缓存键是：
**`['comments', articleId, undefined]`**

**2. 乐观更新写入缓存时 (`usePostComment`):**

```typescript
queryClient.getQueryData(['comments', articleId])
queryClient.setQueryData(['comments', articleId], ...)
```

在 `usePostComment` 的 `onMutate` 和 `onSuccess` 回调中，使用的键是：
**`['comments', articleId]`**

### 发生了什么？

因为 `['comments', articleId, undefined]` 和 `['comments', articleId]` 在 React Query 看来是**完全不同的两个缓存**：

1. `getQueryData` 拿到的是 `undefined`，所以代码总是走入 `if (!old)` 的分支
2. `setQueryData` 悄悄创建了一个**全新的、没有任何组件在监听**的"幽灵缓存"
3. 页面仍然在死死盯着原来的那个缓存，自然看不到任何变化
4. 直到接口真正返回，或者发生窗口聚焦等事件触发了自动 refetch，页面才会拿到后端的最新数据并刷新

## 🛠️ 解决方案

要解决这个问题，需要确保 Mutation 中更新的缓存键，与 Query 中使用的缓存键**完全一致**。

### 修复方案：保持 Query Key 的严格一致

修改 `usePostComment`，让它在操作缓存时带上 `undefined`（或者接收传入的 params）：

```typescript
export function usePostComment(articleId: string, params?: any) {
  const queryClient = useQueryClient();

  // 使用与 useComments 完全相同的缓存键
  const exactQueryKey = ["comments", articleId, params];

  return useMutation({
    mutationFn: (data) => frontendBlogApi.postComment(articleId, data),
    onMutate: async (newComment) => {
      // 取消正在进行的查询
      await queryClient.cancelQueries({ queryKey: ["comments", articleId] });

      // 获取之前的评论数据 - 使用精确缓存键
      const previousComments = queryClient.getQueryData(exactQueryKey);

      // 构建乐观评论对象
      const optimisticComment = {
        id: `temp-${Date.now()}`,
        articleId: articleId,
        author: newComment.author,
        email: newComment.email || null,
        website: newComment.website || null,
        content: newComment.content,
        parentId: newComment.parentId || null,
        approved: true, // 立即显示为已通过审核，实现完全即时显示
        likes: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        children: [],
      };

      // 更新缓存 - 使用精确缓存键
      queryClient.setQueryData(exactQueryKey, (old: any) => {
        // 缓存更新逻辑...
      });

      // 返回临时评论ID和精确缓存键，供onSuccess使用
      return {
        previousComments,
        optimisticId: optimisticComment.id,
        exactQueryKey,
      };
    },
    onError: (err, newComment, context) => {
      // 出错时回滚到之前的状态
      if (context?.previousComments) {
        queryClient.setQueryData(exactQueryKey, context.previousComments);
      }
    },
    onSuccess: (data, variables, context) => {
      // 状态轮询和缓存更新逻辑...
    },
  });
}
```

### 更新组件调用

在 `CommentList.tsx` 中，需要更新 `usePostComment` 的调用：

```typescript
// 之前
const { mutate: postComment, isPending: isPosting } = usePostComment(articleId);

// 之后
const { mutate: postComment, isPending: isPosting } = usePostComment(
  articleId,
  undefined,
);
```

## 📝 修复内容

### 1. 修改 `usePostComment` 函数签名

- 添加 `params` 参数，确保与 `useComments` 保持一致
- 使用完全相同的缓存键：`['comments', articleId, params]`

### 2. 更新缓存操作逻辑

- 在 `onMutate` 中使用精确的缓存键获取和设置数据
- 在 `onError` 和 `onSuccess` 中继续使用相同的精确缓存键
- 将 `exactQueryKey` 传递到 `onSuccess` 的上下文中

### 3. 更新 `CommentList.tsx` 中的调用

- 确保传递给 `usePostComment` 的参数与 `useComments` 一致

### 4. 清理调试日志

- 移除所有开发调试用的 `console.log` 语句
- 保持生产环境的代码整洁

## 🏗️ 技术要点

### 乐观更新策略

1. **立即显示**：乐观评论标记为 `approved: true`，立即显示为正常评论
2. **后台审核**：AI在后台异步审核评论内容
3. **状态同步**：通过状态轮询机制同步审核结果
4. **优雅处理**：
   - 审核通过：更新临时ID为真实ID
   - 审核拒绝：淡出动画后移除评论，显示拒绝通知

### 缓存键管理

- **精确匹配**：确保Mutation和Query使用完全相同的缓存键
- **参数传递**：`params` 参数是可选的，不影响现有代码
- **向后兼容**：修复不影响其他使用 `usePostComment` 的地方

## 验证效果

修复后，评论系统的工作流程：

1. **用户提交评论** → 立即显示在页面上（乐观更新）
2. **后台AI审核** → 异步进行内容审核（4-6秒）
3. **状态同步** → 前端轮询审核状态
4. **结果处理**：
   - 审核通过：评论保持显示，ID更新为真实ID
   - ❌ 审核拒绝：评论淡出移除，显示拒绝通知

## 💡 最佳实践建议

为了避免以后再踩这个坑，建议在项目中抽取一个 **Query Keys 工厂函数**，统一管理键值：

```typescript
export const commentKeys = {
  all: ["comments"] as const,
  lists: () => [...commentKeys.all, "list"] as const,
  list: (articleId: string, params?: any) =>
    [...commentKeys.all, articleId, params] as const,
};

// 使用时：
// useQuery({ queryKey: commentKeys.list(articleId, params) })
// queryClient.setQueryData(commentKeys.list(articleId, undefined), ...)
```

## 📁 相关文件

### 主要修改文件

- `apps/frontend-blog/src/lib/hooks/useComments.ts` - 核心状态跟踪逻辑
- `apps/frontend-blog/src/components/blog/CommentList.tsx` - UI状态显示
- `apps/frontend-blog/src/lib/utils/commentStatus.ts` - 状态管理工具

### 设计文档归档

- `docs/blog/plans/archive/` - 包含所有设计迭代文档
- `docs/blog/plans/archive/test-files/` - 相关测试和调试文件

## 🎯 总结

这个修复解决了React Query乐观更新的经典"坑"，确保了评论系统的即时显示功能正常工作。核心要点是**缓存键的严格一致性**，这是React Query中容易被忽视但至关重要的细节。

修复后的系统提供了流畅的用户体验：评论提交后立即显示，后台AI审核透明进行，用户无需手动刷新页面即可看到审核结果。

---

**实施时间**: 2026-04-17  
**状态**: 已完成  
**相关文档**: 设计文档已归档至 `docs/blog/plans/archive/`
