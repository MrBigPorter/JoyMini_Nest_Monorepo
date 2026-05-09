---
title: 生产环境 Node.js OOM 排查与修复：从 300MB 上限到 SSE 泄漏的完整实录
slug: production-nodejs-oom-troubleshooting
tags: Node.js, OOM, NestJS, SSE, Production, Debug, Performance
description: 本文完整记录了一次 NestJS 后端在生产环境因 JavaScript Heap OOM 崩溃的排查过程，分析了三个叠加因素（heap 上限过紧、SSE 连接泄漏、Prisma 内存占用），并给出了逐步修复方案。
---

# 生产环境 Node.js OOM 排查与修复：从 300MB 上限到 SSE 泄漏的完整实录

## 一、事故现场

某个下午，Sentry 告警响起：

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

生产环境的 NestJS 后端容器（`lucky-backend-prod`）崩溃了。这是 V8 引擎的堆内存溢出（OOM），直接导致整个 API 服务不可用。

GC trace 显示了一个触目惊心的数字：

```
Mark-Compact 289.0 (302.1) -> 288.9 (302.1) MB
```

内存已用到 **289 MB / 302 MB** —— 离人为设定的上限只剩下 4%。这意味着不是"内存不够"，而是"我们给的内存上限太紧了"。

## 二、根因分析：三个因素的叠加

这次 OOM 不是单一原因造成的，而是三个问题叠加后的结果。

### 2.1 主因：`--max-old-space-size=300` 太紧

从 [`compose.prod.yml`](/compose.prod.yml:41) 可以看到：

```yaml
- NODE_OPTIONS=--max-old-space-size=300
```

一个运行着 NestJS + Prisma + BullMQ + SSE 的后端应用，只给了 300 MB 的堆内存上限。对于 Node.js 应用来说，这个数字非常紧张。

| 组件 | 大致内存占用 |
|------|------------|
| NestJS 框架本身 | ~50 MB |
| Prisma query engine | ~60 MB |
| BullMQ 队列连接 | ~20 MB |
| SSE 长连接 | ~10-30 MB |
| 业务数据（文章/评论） | ~100-150 MB |
| **合计** | **~240-310 MB** |

300 MB 的上限意味着任何一次请求峰值 —— 比如一次大量文章的翻译查询、或者一次大数据量的 Prisma 查询 —— 都可能将堆内存推到极限并触发 OOM。

### 2.2 放大器：SSE 连接未正确清理

SSE（Server-Sent Events）端点是另一个重要的内存消耗源。

查看 [`frontend-blog.controller.ts`](/apps/api/src/blog/frontend/frontend-blog.controller.ts:281) 的 SSE 实现，每个连接会创建两个 EventEmitter 监听器：

```typescript
this.eventEmitter.on('blog.comment.reply.created', replyHandler);
this.eventEmitter.on('blog.comment.moderated', moderatedHandler);
```

**问题在于**：当客户端非正常断开（如手机网络切换、浏览器后台标签被挂起），Observable 的 teardown 函数（`return () => {...}`）可能不会被触发。导致：

- EventEmitter 监听器变成"孤儿"，永远无法被移除
- 监听器闭包中引用了 `subscriber` 对象和 HTTP response 对象
- 这些对象无法被 GC 回收
- 随着时间推移，内存泄漏逐渐积累

每个泄露的 SSE 连接包含：
- 一个打开的 HTTP 响应流
- Observable 的 `subscriber` 对象
- 闭包作用域中的 `replyHandler` 和 `moderatedHandler`
- EventEmitter 内部维护的监听器列表引用

在持续运行数小时后，几十个"僵尸"SSE 连接可以轻松吃掉 50-100 MB 的额外内存。

### 2.3 基础问题：Prisma 查询的内存占用

[`blog.service.ts`](/apps/api/src/blog/blog.service.ts) 是一个 3758 行的巨型服务。Prisma 查询中频繁使用深度 `include` 关联（文章 + 分类 + 标签 + 作者），加上 [`mapArticleToLocalized()`](/apps/api/src/blog/blog.service.ts:844) 的深拷贝操作，每次查询都会分配大量临时对象。

关键的热点查询：

1. **`getArticleComments()`** — 一次性加载文章的所有已审核评论到内存，再在应用层构建评论树。对于有上千条评论的文章，这会产生一个巨大的 JavaScript 对象。
2. **`getArticles()` 配合翻译检测** — 同时加载 `content` 和 `contentLocalized` 两个大文本字段，每条记录的内存占用激增。

## 三、修复方案

### 3.1 第一步：增加堆内存上限（最关键）

修改 [`compose.prod.yml`](/compose.prod.yml:41)：

```yaml
# Before
- NODE_OPTIONS=--max-old-space-size=300

# After
- NODE_OPTIONS=--max-old-space-size=400
```

同时增加容器内存限制：

```yaml
deploy:
  resources:
    limits:
      memory: 600M    # 从 500M 提升到 600M
    reservations:
      memory: 200M
```

**为什么 600 MB 是合理的？** 1GB VPS 的预算分配：

| 服务 | 内存 |
|------|------|
| OS | ~130 MB |
| Nginx | ~30 MB |
| Redis | ~150 MB |
| PostgreSQL | ~200 MB |
| **Backend（新）** | **600 MB** |
| **合计** | **~1110 MB** |

少量超出（~110 MB）由 Swap 覆盖，不会真正导致系统 OOM。

### 3.2 第二步：修复 SSE 连接清理（长期健康）

在 SSE 端点中添加 `req.on('close')` 兜底清理机制：

```typescript
commentStream(
  @Query('articleId') articleId?: string,
  @Req() req: Request,
): Observable<MessageEvent> {
  return new Observable<MessageEvent>((subscriber) => {
    const replyHandler = (payload: any) => {
      // ... 处理逻辑
    };
    const moderatedHandler = (payload: any) => {
      // ... 处理逻辑
    };

    this.eventEmitter.on('blog.comment.reply.created', replyHandler);
    this.eventEmitter.on('blog.comment.moderated', moderatedHandler);

    // 安全兜底：HTTP 连接关闭时强制清理
    req.on('close', () => {
      this.eventEmitter.off('blog.comment.reply.created', replyHandler);
      this.eventEmitter.off('blog.comment.moderated', moderatedHandler);
      if (!subscriber.closed) {
        subscriber.unsubscribe();
      }
    });

    return () => {
      this.eventEmitter.off('blog.comment.reply.created', replyHandler);
      this.eventEmitter.off('blog.comment.moderated', moderatedHandler);
    };
  });
}
```

这个方案的关键在于：**双重保障**。`req.on('close')` 是 HTTP 层面的钩子，无论客户端如何断开（正常 TCP FIN、网络超时、浏览器强关），Node.js 的 HTTP 模块都会触发这个事件。而原有的 Observable teardown 则处理正常的订阅取消流程。

### 3.3 第三步：添加 SSE 限流

防止 SSE 连接被滥用：

```typescript
@Get('comments/stream')
@Sse()
@UseGuards(ThrottlerGuard)
@SkipThrottle(false)
commentStream(@Query('articleId') articleId?: string, @Req() req: Request) {
  // ...
}
```

### 3.4 第四步：优化 Prisma 查询

对 [`getArticleComments()`](/apps/api/src/blog/blog.service.ts:1843) 使用游标分页或递归 CTE，而不是一次性加载所有评论。

```typescript
// Before：一次性加载所有评论
const comments = await this.prisma.blogComment.findMany({
  where: { articleId, status: 'approved' },
});

// After：先加载根评论，再懒加载子评论
const rootComments = await this.prisma.blogComment.findMany({
  where: { articleId, status: 'approved', parentId: null },
  take: 20,
  skip: (page - 1) * 20,
});
```

## 四、修复检查清单

| # | 操作 | 文件 | 优先级 |
|---|------|------|--------|
| 1 | `--max-old-space-size` 300 → 400 | `compose.prod.yml` | 🔴 Critical |
| 2 | 容器内存 500M → 600M | `compose.prod.yml` | 🔴 Critical |
| 3 | SSE 添加 `req.on('close')` 兜底清理 | `frontend-blog.controller.ts` | 🟡 High |
| 4 | SSE 添加限流 | `frontend-blog.controller.ts` | 🟢 Medium |
| 5 | 优化 getArticleComments 游标分页 | `blog.service.ts` | 🟢 Medium |

## 五、经验教训

### 5.1 Node.js 内存不是"越多越好"，但"太少一定会死"

很多 Node.js 开发者容易陷入两个极端：
- **完全不设上限**：应用可以无限吃内存，出问题才被发现
- **设得太低**：为了省资源，结果进程频繁 OOM

合理的做法是：**先监控正常峰值，再设置 1.5-2 倍的安全余量**。可以使用 `process.memoryUsage()` 在开发/预发布环境跑压测，观察 `heapUsed` 的峰值，然后乘以 1.5。

```typescript
// 在 Health Check 中添加内存监控
const memoryUsage = process.memoryUsage();
console.log({
  heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`,
  heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(1)} MB`,
  rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(1)} MB`,
});
```

### 5.2 SSE 是隐形的内存泄漏源

SSE 看起来很简单 —— 一个长连接，服务器往客户端推数据。但它涉及多层资源的生命周期管理：

- HTTP 连接 → Node.js 的 `req` 和 `res` 对象
- Observable → `subscriber` + teardown 函数
- EventEmitter → 监听器函数 + 闭包引用
- RxJS 内部调度器

**每一层都可能成为泄漏点。** 使用 SSE 时必须确保：

1. 客户端断开时，所有监听器被清理
2. 使用 `req.on('close')` 作为兜底
3. 设置连接数上限和限流
4. 监控活跃连接数

### 5.3 Prisma 的隐藏成本

Prisma 的 TypeScript 体验很好，但它有以下隐形成本：

- **Query Engine 进程**：每个连接约 30-60 MB 额外内存
- **深嵌套 include**：`include: { category: true, tags: true, author: true }` 会创建大量中间对象
- **大字段查询**：`content` 和 `contentLocalized` 可能是几十 KB 的文本，全表扫描时内存消耗巨大

建议对包含大文本字段的查询使用 `select` 明确选取需要的列：

```typescript
// 避免这样的查询
const articles = await prisma.blogArticle.findMany({
  include: { category: true, tags: true, author: true },
});

// 改用 select 明确字段
const articles = await prisma.blogArticle.findMany({
  select: {
    id: true,
    title: true,
    slug: true,
    // 不要 content 和 contentLocalized 除非真的需要
  },
});
```

## 六、总结

这次生产 OOM 的根因是一个"三合一"问题：

1. **配置问题**：`--max-old-space-size=300` 太紧，没有预留安全余量
2. **代码问题**：SSE 连接缺乏 HTTP 级别的兜底清理，导致内存泄漏
3. **查询问题**：Prisma 深度嵌套查询一次性分配大量内存

修复方案也很清晰：**提升上限（治标）+ 修复泄漏（治本）+ 优化查询（预防）**。

对于任何生产环境的 Node.js 应用，建议从一开始就建立内存监控体系，并在上线前进行内存压力测试。一个 OOM 导致的进程崩溃，恢复时间（< 30 秒）可能看起来不长，但如果发生在流量高峰期，足以造成大量 502 错误和用户投诉。
