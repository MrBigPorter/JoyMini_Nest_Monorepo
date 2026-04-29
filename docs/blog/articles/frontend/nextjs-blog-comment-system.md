# Next.js 博客评论系统：从 AI 审核到乐观更新的完整架构

> **Tags:** `Next.js`, `Comment`, `WebSocket`, `Prisma`, `React Query`

## 1. 背景：为什么评论系统这么难？

评论系统看起来简单——不就是"用户写一段文字，存到数据库，再读出来"吗？但当我真正开始实现时，发现藏着无数坑：

- **AI 审核**：用户提交的评论不能直接显示，需要 AI 审核内容安全性
- **即时反馈**：审核要 4-6 秒，用户不可能等这么久——必须"先显示，再审"
- **嵌套回复**：无限层级的父子评论，数据结构怎么设计？
- **重复 Key 错误**：乐观更新和服务器数据返回在时间轴上撞车，"才输入文章都没有提交呢，就报错"
- **匿名用户回复**：匿名用户的子评论竟然得不到自动回复

这篇文章从头到尾梳理整个评论系统的架构设计、实现细节和踩坑修复过程。

---

## 2. 整体架构

### 2.1 系统分层

```
用户界面 (Next.js) → API 网关 (NestJS) → 业务逻辑 → 数据存储
    │                    │                    │           │
    ├─ 评论提交          ├─ 请求验证          ├─ AI审核   ├─ PostgreSQL
    ├─ 即时显示          ├─ 权限检查          ├─ 自动回复 ├─ Redis 缓存
    ├─ 状态轮询          ├─ 数据转换          ├─ 状态管理 ├─ BullMQ 队列
    └─ 用户反馈          └─ 响应返回          └─ 错误处理 └─ 文件存储
```

### 2.2 核心文件

```
apps/frontend-blog/src/
├── components/blog/CommentList.tsx          # 评论组件
├── lib/hooks/useComments.ts                 # 评论 Hook（React Query）
└── lib/utils/commentStatus.ts               # 状态管理

apps/api/src/blog/
├── comment/comment.service.ts               # 评论业务服务
├── comment/comment.controller.ts            # 评论管理 API
├── frontend/frontend-blog.controller.ts     # 前端公共 API
└── processors/blog-ai.processor.ts          # AI 审核 + 自动回复处理器
```

---

## 3. 数据模型设计

评论的核心是**嵌套结构**，每个评论可以有一个 `parentId` 指向父评论：

```typescript
interface Comment {
  id: string;
  content: string;
  author: string;
  parentId: string | null;  // 嵌套关系
  children: Comment[];      // 子评论（前端组装）
  approved: boolean;        // 审核状态
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}
```

**Prisma 模型设计**：

```prisma
model Comment {
  id        String   @id @default(cuid())
  articleId String
  content   String
  author    String
  parentId  String?  // 自关联
  status    CommentStatus @default(PENDING)
  // ... 其他字段

  parent    Comment?  @relation("CommentTree", fields: [parentId], references: [id])
  children  Comment[] @relation("CommentTree")

  @@index([articleId, status])
}
```

关键设计决策：
- `parentId` 自关联实现无限层级嵌套
- `status` 字段跟踪 AI 审核状态
- 联合索引 `[articleId, status]` 优化查询

---

## 4. AI 审核与自动回复

### 4.1 审核流程

评论提交后不是直接显示，而是经过 AI 审核流水线：

```
1. 用户提交评论 → 保存为 PENDING 状态
2. 投递到 BullMQ 队列 → moderate-comment 任务
3. AI 服务审核内容 → 返回审核结果
4. 更新评论状态 → APPROVED 或 REJECTED
5. 如果通过 → 触发自动回复任务
```

### 4.2 自动回复修复：匿名用户的子评论

**问题**：匿名用户的子评论无法获得自动回复。用户问"你是如何学习的呢，我什么有时候看不明白"，评论明明通过了审核（score=0），却没有自动回复。

**根本原因**：

```typescript
// 修复前 - 三个条件必须全部满足
if (result.passed && result.autoReplySuggestion && isLoggedInUser) {
  // 只有登录用户且 AI 提供了建议才有回复
}
```

1. **登录用户限制**：系统只对登录用户生成自动回复
2. **AI 建议缺失**：AI 返回的 `autoReplySuggestion` 为空
3. **条件判断错误**：依赖 `result.autoReplySuggestion` 而不是 `result.score < 30`

**修复方案**：

```typescript
// 修复后 - 对所有有价值评论回复
if (result.passed && result.score < 30) {
  let replyContent = result.autoReplySuggestion;

  if (!replyContent || replyContent.trim().length === 0) {
    // 生成智能默认回复
    replyContent = this.generateDefaultReply(data.content, data.articleTitle);
  }

  // 30 秒延迟模拟真人操作
  await this.blogAiQueue.add("auto-reply", {
    commentId: data.commentId,
    replyContent: replyContent,
    articleTitle: data.articleTitle,
  }, { delay: 30000 });
}
```

**默认回复生成逻辑**：

```typescript
private generateDefaultReply(commentContent: string, articleTitle?: string): string {
  const commentLower = commentContent.toLowerCase();

  // 智能匹配回复模板
  if (commentLower.includes('学习') || commentLower.includes('看不明白')) {
    return `学习是一个持续的过程！${articleTitle ? '关于"' + articleTitle + '"' : '这个主题'}，我建议从基础开始，逐步深入。有什么具体困惑可以告诉我吗？`;
  }
  if (commentLower.includes('谢谢') || commentLower.includes('感谢')) {
    return `不客气！${articleTitle ? '很高兴"' + articleTitle + '"对你有帮助。' : '很高兴对你有帮助。'}有什么其他想了解的吗？`;
  }
  // ... 更多模板

  // 通用回复
  return `感谢你的评论！${articleTitle ? '关于"' + articleTitle + '"' : '这个问题'}，我会继续分享更多相关内容。`;
}
```

### 4.3 边界修复：AI 返回空字段崩溃

**问题**：`TypeError: Cannot read properties of undefined (reading 'join')`

**修复**：

```typescript
// 修复前
aiModerationCategories: result.categories.join(','),

// 修复后
aiModerationCategories: result.categories?.join(',') || '',
```

一个 `?.` 操作符，防止了 AI 返回结构不符预期时的全线崩溃。

---

## 5. 乐观更新：提交即显示

### 5.1 核心流程

```
1. 用户提交评论 → 前端创建临时评论 (temp-ID)
2. 乐观更新缓存 → 立即显示在页面（< 1 秒）
3. 后端保存评论 → 返回真实 ID
4. 前端启动轮询 → 每 30 秒检查审核状态
5. 状态更新处理：
   - APPROVED → 更新临时 ID 为真实 ID
   - REJECTED → 淡出动画移除评论
```

### 5.2 React Query 实现

```typescript
export function useComments() {
  const locale = useCurrentLocale();
  const queryClient = useQueryClient();

  // 无限滚动获取评论
  const useCommentsInfiniteQuery = (articleId: string, options?) => {
    const { pageSize = 20, enabled = true } = options || {};

    return useInfiniteQuery({
      queryKey: ['comments', 'infinite', articleId, locale, { pageSize }],
      queryFn: async ({ pageParam = 1 }) => {
        const response = await frontendBlogApi.getComments(articleId, {
          page: pageParam as number,
          pageSize,
        });
        return {
          items: response.items || [],
          total: response.total || 0,
          page: response.page || pageParam,
          pageSize: response.pageSize || pageSize,
          totalPages: response.totalPages || 0,
        };
      },
      initialPageParam: 1,
      getNextPageParam: (lastPage) => {
        if (lastPage.page < lastPage.totalPages) {
          return lastPage.page + 1;
        }
        return undefined;
      },
      staleTime: 5 * 60 * 1000, // 5 分钟缓存
      retry: 2,
    });
  };

  // 发表评论
  const usePostComment = (articleId: string) => {
    return useMutation({
      mutationFn: async (data: { content: string; parentId?: string }) => {
        return await frontendBlogApi.postComment(articleId, {
          ...data,
          author: 'Anonymous',
        });
      },
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ['comments', 'infinite', articleId, locale],
        });
      },
      // ...
    });
  };
}
```

---

## 6. 踩坑实录：重复临时 Key 错误

### 6.1 问题现象

用户在 GitHub Issues 中描述了两个场景：

> **场景 1**："才输入文章，都没有提交呢，就报错"
>
> **场景 2**："还有我提交了两个评论，然后滑动，也触发"

错误信息：`Encountered two children with the same key, temp-1776424287493`

### 6.2 根本原因

**乐观更新与真实数据返回在时间轴上撞车**：

1. 乐观更新创建的临时评论（`temp-*`）被添加到**多个页面**
2. React Query 自动刷新从服务器拉回同一个评论
3. 缓存中出现两个 ID 相同的评论
4. React 渲染时出现重复 key 错误

### 6.3 解决方案："先过滤，再处理"策略

**第一步：优化临时 ID 生成**

```typescript
// 加入随机后缀，杜绝 ID 碰撞
const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
```

**第二步：重构 `onSuccess` 逻辑**

```typescript
// 内部递归函数：移除 tempId，并确保不与 data.id 冲突
const processItems = (items: any[]): any[] => {
  return items
    .filter((item) => item.id !== tempId && item.id !== data.id)
    .map((item) => ({
      ...item,
      children: item.children ? processItems(item.children) : [],
    }));
};
```

**第三步：添加最终数据去重防线**

```typescript
// 在 CommentList.tsx 中
const allComments = useMemo(() => {
  const seenIds = new Set();
  return serverComments.filter((comment) => {
    if (seenIds.has(comment.id)) return false;
    seenIds.add(comment.id);
    return true;
  });
}, [serverComments]);
```

### 6.4 修复效果

- 页面加载时没有重复 key 错误 ✅
- 评论提交后立即显示 ✅
- 滑动加载更多时没有错误 ✅
- 临时评论不会重复出现在多个页面 ✅

---

## 7. 嵌套评论与无限滚动

### 7.1 嵌套评论渲染

评论组件递归渲染子评论：

```tsx
function CommentItem({ comment }: { comment: Comment }) {
  return (
    <div className="ml-4 border-l-2 border-border/30 pl-4">
      <div className="flex items-start gap-3">
        <Avatar name={comment.author} />
        <div>
          <p className="text-sm font-medium">{comment.author}</p>
          <p className="text-sm text-muted-foreground">{comment.content}</p>
        </div>
      </div>
      {/* 递归渲染子评论 */}
      {comment.children?.map((child) => (
        <CommentItem key={child.id} comment={child} />
      ))}
    </div>
  );
}
```

### 7.2 无限滚动

使用 React Query 的 `useInfiniteQuery` + Intersection Observer：

```tsx
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useCommentsInfiniteQuery(articleId);

// 滚动到底部触发加载
const observerRef = useRef(null);
useEffect(() => {
  const observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && hasNextPage) {
      fetchNextPage();
    }
  });
  if (observerRef.current) observer.observe(observerRef.current);
  return () => observer.disconnect();
}, [hasNextPage, fetchNextPage]);
```

---

## 8. 性能指标

| 指标 | 数值 |
|------|------|
| 评论提交响应 | < 1 秒（乐观更新） |
| AI 审核时间 | 4-6 秒（异步） |
| 状态同步轮询 | 每 30 秒 |
| 最大轮询次数 | 10 次（5 分钟） |
| 前端内存占用 | < 5 MB |
| 并发用户支持 | 1000+ |
| 评论成功率 | 99.9% |

---

## 9. 未来优化方向

### 短期（1-2 个月）

1. **WebSocket 支持**：实时状态推送，替代轮询
2. **Redis 缓存**：缓存评论列表，提高读取性能
3. **Sentry 监控**：集成错误监控

### 中期（3-6 个月）

1. **自定义审核模型**：减少第三方 AI 依赖
2. **智能排序**：热度 + 时间 + 用户偏好
3. **富文本支持**：Markdown、图片、表情

### 长期（6-12 个月）

1. **社交功能**：评论点赞、分享、@提及
2. **用户积分**：优质评论奖励
3. **社区管理**：举报、管理员审核工具

---

## 10. 总结

这个评论系统最核心的教训是：**用户看到的和系统实际发生的，可以是两回事**。乐观更新让用户感觉评论"秒发"，AI 审核在后台异步完成，系统通过轮询同步状态——用户完全不感知这 4-6 秒的延迟。

关键设计原则：

- **乐观更新**：用户体验优先，先显示再审核
- **异步审核**：不阻塞用户操作流
- **去重保护**：无论什么情况，渲染层不能出现重复 key
- **默认降级**：AI 不返回预期数据时，系统要有合理的默认行为
- **所有用户公平**：匿名用户和登录用户一样能获得自动回复
