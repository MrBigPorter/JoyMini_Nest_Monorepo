# Fix: likeCount 出现负数的问题

## 问题

用户报告：即使有 `LikeDeduplicationGuard` 返回 429 错误（24h 内重复点赞），`likeCount` 仍然会变成负数。

错误响应：

```json
{
  "code": 42900,
  "message": "You have already liked this article. Please wait for 24 hours before liking again.",
  "tid": "c4567fe1f6ba4fcf84c4a1d74475aa87",
  "data": null
}
```

## Root Cause 分析

### 问题 1（主要）：Unlike 端点完全没有保护

| 端点                          | Guard                    | 状态        |
| ----------------------------- | ------------------------ | ----------- |
| `POST /articles/:slug/like`   | `LikeDeduplicationGuard` | ✅ 有保护   |
| `POST /articles/:slug/unlike` | **无 Guard**             | ❌ 完全开放 |

对比 [`frontend-blog.controller.ts`](apps/api/src/blog/frontend/frontend-blog.controller.ts:397-413)：

```typescript
// like → 有 Guard
@Post('articles/:slug/like')
@UseGuards(LikeDeduplicationGuard)  // ✅
async likeArticle(...)

// unlike → 无 Guard
@Post('articles/:slug/unlike')
async unlikeArticle(...)  // ❌ 任何人可反复调用
```

### 问题 2：unlikeArticle() 没有前置条件检查

[`blog.service.ts`](apps/api/src/blog/blog.service.ts:1781-1792) 中，`unlikeArticle()` 无条件执行 `{ likeCount: { decrement: 1 } }`，没有检查：

- 用户是否已点赞
- `likeCount` 是否会低于 0

```typescript
async unlikeArticle(slug: string, fingerprint: string) {
  // ❌ 没有检查 likeCount > 0
  // ❌ 没有检查用户是否已点赞
  return this.prisma.blogArticle.update({
    where: { slug },
    data: { likeCount: { decrement: 1 } },  // 可无限递减
  });
}
```

### 问题 3：fingerprint 为空字符串

Unlike 端点没有 `LikeDeduplicationGuard`，所以 `req.body.serverFingerprint` 永远不会被写入，传给 `unlikeArticle()` 的 `fingerprint` 始终是空字符串 `''`，无法用于任何验证。

### 问题 4：没有数据库层约束

Prisma schema 中 `likeCount` 定义为 `Int @default(0)`，但没有最小值约束：

```
schema.prisma:1534  likeCount  Int  @default(0)  // ❌ 无 @min(0)
```

## 导致负数场景

1. **恶意攻击**：通过 `curl` 或 Postman 反复调用 `POST /v1/frontend/blog/articles/{slug}/unlike`，无需登录认证
2. **前端逻辑缺陷**：如果 `likeStatus` 缓存与实际状态不同步，UI 显示已点赞但实际未点赞时，用户"取消点赞"会触发 unlike
3. **并发竞争**：多个请求同时到达，`decrement` 操作不是事务性的

## 修复方案

### 方案 A：在 unlikeArticle() 中添加最小值为 0 的约束（推荐，轻量级）

直接在 [`blog.service.ts`](apps/api/src/blog/blog.service.ts:1781) 的 `unlikeArticle()` 中添加检查：

```typescript
async unlikeArticle(slug: string, fingerprint: string) {
  const article = await this.prisma.blogArticle.findUnique({
    where: { slug },
    select: { likeCount: true },
  });
  if (!article) throw new NotFoundException('Article not found');
  if (article.likeCount <= 0) {
    // 已经为 0 或负数，不允许再减
    return { likeCount: article.likeCount };
  }

  return this.prisma.blogArticle.update({
    where: { slug },
    data: { likeCount: { decrement: 1 } },
    select: { likeCount: true },
  });
}
```

**优点**：改动最小，直接解决负数问题
**缺点**：仍然允许未点赞的用户调用 unlike（不减少计数即可）

### 方案 B：在 unlike 端点也添加 LikeDeduplicationGuard（完整方案，推荐）

1. 将 `LikeDeduplicationGuard` **重命名**为 `LikeGuard`，使其同时适用于 like 和 unlike
2. 为 unlike 端点也添加 `@UseGuards(LikeGuard)`
3. 在 unlike 成功时将 Redis 中的指纹键删除（允许 24h 内再次点赞）
4. 同时在 service 层添加 `likeCount > 0` 检查

**优点**：

- 防止未点赞用户调用 unlike
- 完善指纹一致性（like 和 unlike 都用同样的指纹）
- like → unlike → like 流程正确：Redis 键在 unlike 时删除

### 方案 C：Prisma 原生拦截器（最彻底）

使用 Prisma 中间件拦截所有 `update` 操作，确保 `likeCount` 不会低于 0。

**优点**：全局保护，不管从哪里修改
**缺点**：侵入性较大，可能影响性能

### 推荐方案：B + A 的组合

前后端联动确保 likeCount 不为负：

1. **Service 层**：在 `unlikeArticle()` 中添加 `likeCount > 0` 前置检查（方案 A）
2. **Guard 层**：为 unlike 端点添加 `LikeDeduplicationGuard` 保护，并在 unlike 成功后删除 Redis 指纹（方案 B）
3. **Controller 层**：生成指纹并从 Redis 验证后才允许 unlike

## 改动清单

| #   | 文件                                                                                                                   | 改动类型 | 说明                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------- |
| 1   | [`apps/api/src/blog/blog.service.ts`](apps/api/src/blog/blog.service.ts:1781)                                          | 修改     | `unlikeArticle()` 添加 `likeCount > 0` 前置检查 |
| 2   | [`apps/api/src/blog/guards/like-deduplication.guard.ts`](apps/api/src/blog/guards/like-deduplication.guard.ts)         | 修改     | 可选：重构为通用 `LikeGuard`，支持 like/unlike  |
| 3   | [`apps/api/src/blog/frontend/frontend-blog.controller.ts`](apps/api/src/blog/frontend/frontend-blog.controller.ts:407) | 修改     | 可选：为 unlike 端点添加 Guard                  |

## 架构图

```mermaid
flowchart TD
    subgraph 当前流程（有负数的原因）
        Like[POST /like] -->|LikeDeduplicationGuard| GuardCheck{Redis 检查}
        GuardCheck -->|有键: 429| Blocked[拒绝]
        GuardCheck -->|无键: 写入Redis| LikeSvc[likeArticle increment:1]

        Unlike[POST /unlike] -->|无 Guard| UnlikeSvc[unlikeArticle decrement:1]
        UnlikeSvc --> Negative[likeCount 可降到负数]
    end

    subgraph 修复后流程
        Like2[POST /like] -->|LikeGuard| G2{Redis 检查}
        G2 -->|有键: 429| B2[拒绝]
        G2 -->|无键: 写入Redis| LS2[likeArticle increment:1]

        Unlike2[POST /unlike] -->|LikeGuard| UG{Redis 检查}
        UG -->|无键: 未点赞| UB[拒绝/直接返回]
        UG -->|有键: 已点赞| US2[unlikeArticle decrement:1]
        US2 -->|likeCount <= 0?| Check{检查}
        Check -->|是| Return[直接返回当前值]
        Check -->|否| Decr[实际递减]
        Decr --> DelKey[删除 Redis 指纹键]
    end
```
