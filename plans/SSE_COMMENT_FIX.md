# SSE 评论实时推送修复文档

**日期**: 2026-05-08  
**模块**: `apps/frontend-blog` + `apps/api`  
**状态**: ✅ 已修复并验证

---

## 问题描述

博客文章评论页面的 SSE（Server-Sent Events）实时推送功能完全不工作：
- 用户回复评论后，其他浏览器窗口不会实时显示新回复
- Porter AI 自动回复不会实时出现在页面上，需要手动刷新

---

## 根本原因（共 4 个）

### 🔴 原因 1：SSE 事件从未被 emit（最根本）

**文件**：`apps/api/src/blog/processors/blog-ai.processor.ts`

`blog.comment.reply.created` 事件**只在 AI 自动回复（Porter）时 emit**，普通用户提交的回复（有 `parentId` 的评论）经 AI 审核通过后，从未触发 SSE 推送。

```
用户提交回复 → AI审核 → APPROVED → ❌ 没有emit → 前端不知道
                                  ↓（仅当score<30且触发autoReply时）
                             30秒后Porter回复 → emit → 前端收到
```

### 🔴 原因 2：React Query 缓存 key 与 SSE articleId 不匹配

**文件**：`apps/frontend-blog/src/lib/hooks/useCommentSSE.ts`

| 位置 | 使用的 articleId | 值 |
|------|------|------|
| React Query 缓存 queryKey | slug | `"admin-blog-translation-progress"` |
| SSE URL 过滤参数 | DB ID | `"cmon1263m001hlz98vx85vf8l"` |
| 后端 event payload `articleId` | DB ID | `"cmon1263m001hlz98vx85vf8l"` |
| `insertReplyIntoCache` 查找 | **错误地用 DB ID 查 slug-keyed 缓存** | 找到条目数: 0 |

结果：SSE 消息收到了，但 `getQueriesData` 返回空，缓存更新失败，页面无变化。

### 🟡 原因 3：nginx 对 SSE 端点设置了 `Connection: upgrade`

**文件**：`nginx/nginx.dev.conf`

`/api/` 通用 location 块对所有请求统一设置：
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";  # ← SSE 是普通 HTTP 流，不是 WebSocket！
```

SSE 需要 `Connection: keep-alive`，`Connection: upgrade` 导致浏览器 `EventSource` 行为异常。

### 🟡 原因 4：NestJS 路由顺序 — 静态路由被动态路由遮蔽

**文件**：`apps/api/src/blog/frontend/frontend-blog.controller.ts`

```typescript
@Get('comments/:id/status')   // 动态路由（先注册）
@Get('comments/:id/replies')  // 动态路由（先注册）
@Get('comments/stream')       // 静态路由（后注册）← 可能被遮蔽
```

NestJS 按注册顺序匹配路由，静态路由必须在同级动态路由**之前**注册。

---

## 修复方案

### Fix 1：`blog-ai.processor.ts` — 审核通过的用户回复也 emit SSE

```typescript
// processCommentModeration() 中，更新状态后立即 emit
if (result.passed && comment.parentId) {
  this.eventEmitter.emit('blog.comment.reply.created', {
    articleId: comment.articleId,
    parentId: comment.parentId,
    replyId: comment.id,
    content: data.content,
    author: comment.author || 'Anonymous',
    createdAt: new Date().toISOString(),
  });
}
```

同时将 `select` 中加入 `parentId` 字段查询。

### Fix 2：`useCommentSSE.ts` — 分离 SSE URL 用 ID 与缓存查找用 key

新增第二个参数 `cacheArticleId`（slug），用于 React Query 缓存匹配：

```typescript
// 修改前
export function useCommentSSE(articleId: string | undefined)

// 修改后
export function useCommentSSE(
  articleId: string | undefined,      // DB ID → SSE URL ?articleId= 过滤
  cacheArticleId?: string,            // slug → React Query queryKey 匹配
)

// 内部使用
const cacheKey = cacheArticleId || articleId;
insertReplyIntoCache(queryClient, cacheKey, data);          // 用 slug 查缓存
queryClient.invalidateQueries({ queryKey: ['comments', 'infinite', cacheKey] });
```

`CommentList.tsx` 调用方同步更新：
```typescript
// 修改前
useCommentSSE(articleDbId || articleId);

// 修改后
useCommentSSE(articleDbId || articleId, articleId);  // 第二个参数传 slug
```

### Fix 3：`nginx.dev.conf` — SSE 端点专用 location

在 `/api/` 通用 location **之前**，为 SSE 端点添加专用配置（HTTPS + HTTP 两个 server 均加）：

```nginx
# SSE 端点：不使用 Connection upgrade，使用普通 HTTP/1.1 长连接
location = /api/v1/frontend/blog/comments/stream {
    proxy_buffering off;
    proxy_cache off;
    proxy_http_version 1.1;
    proxy_set_header Connection '';   # 清空，不送 upgrade
    proxy_set_header Upgrade '';
    proxy_read_timeout 600s;
    # ... proxy_pass, CORS headers ...
}
```

### Fix 4：`frontend-blog.controller.ts` — 调整路由注册顺序

```typescript
// 修改后的顺序
@Get('comments/stream')       // ← 静态路由先注册
@Sse()
commentStream(...) { ... }

@Get('comments/:id/status')   // 动态路由后注册
@Get('comments/:id/replies')  // 动态路由后注册
```

---

## 数据流（修复后）

```
用户A 提交回复
    │
    ▼
POST /api/v1/frontend/blog/articles/:slug/comments
    │  parentId: "xxx"
    ▼
blog.service.ts: createComment()
    │  创建 PENDING 评论，加入 AI 审核队列
    ▼
blog-ai.processor.ts: processCommentModeration()
    │  AI 审核通过 (result.passed = true)
    │  comment.parentId != null
    ▼
eventEmitter.emit('blog.comment.reply.created', {
    articleId: "cmon1263m001hlz98vx85vf8l",  // DB ID
    parentId: "parent-comment-id",
    replyId: "new-comment-id",
    ...
})
    │
    ▼
FrontendBlogController.commentStream()
    │  handler 收到 event
    │  过滤: payload.articleId === articleId (DB ID 比对)✅
    ▼
subscriber.next({ data: payload })
    │  SSE 推送给前端
    ▼
useCommentSSE.ts: es.onmessage()
    │  解包 payload
    │  insertReplyIntoCache(queryClient, "admin-blog-translation-progress", data)
    │                                    ↑ cacheKey = slug，与 queryKey 匹配 ✅
    ▼
React Query 缓存更新
    │  找到父评论，插入新 reply 到 children
    ▼
React 重新渲染 → 用户B 看到新回复（无需刷新）✅
```

---

## 修改文件列表

| 文件 | 修改内容 |
|------|---------|
| `apps/api/src/blog/processors/blog-ai.processor.ts` | `select` 加 `parentId`；审核通过的 reply 立即 emit SSE |
| `apps/api/src/blog/frontend/frontend-blog.controller.ts` | `comments/stream` 路由移至动态路由之前；添加连接/分发日志 |
| `apps/api/src/blog/blog.service.ts` | `createComment` 添加日志 |
| `apps/frontend-blog/src/lib/hooks/useCommentSSE.ts` | 新增 `cacheArticleId` 参数；缓存查找改用 slug；全链路日志 |
| `apps/frontend-blog/src/components/blog/CommentList.tsx` | `useCommentSSE` 调用传入第二个参数 `articleId`（slug） |
| `nginx/nginx.dev.conf` | SSE 专用 location 块（HTTP + HTTPS）；去掉 `Connection: upgrade` |

---

## 关键教训

1. **SSE URL 过滤参数 vs React Query queryKey 必须使用同一种 ID**，或者分开传参明确职责
2. **nginx 代理 SSE 不能设置 `Connection: upgrade`**，这只用于 WebSocket 协议升级
3. **NestJS 路由中静态路径必须在动态路径（`:param`）之前注册**
4. **SSE EventSource 建立时机**：`useEffect` 依赖稳定的 ID，避免频繁重建连接

