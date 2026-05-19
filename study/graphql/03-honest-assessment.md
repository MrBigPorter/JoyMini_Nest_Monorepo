# GraphQL vs REST — 诚实评估

> 你说得对：REST 也可以一个端点返回所有数据。那 GraphQL 到底多什么？

---

## 优势 1：TypeScript 类型自动生成

这是最实在的好处。

### 现在的问题

你手动维护 frontend-blog.ts（188 行），每个接口要手动定义类型：

```typescript
export interface FrontendArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category?: { id: string; name: string; slug: string; };
  tags?: Array<{ id: string; name: string; slug: string; }>;
  author?: { id: string; name: string; avatar: string; };
}
```

如果后端改了字段名：
- 编译不报错，只有运行时崩溃才发现
- 需要手动去 frontend-blog.ts 里找着改

### GraphQL Codegen 方式

```bash
npx graphql-codegen
```

```typescript
// 自动生成，跟后端 schema 100% 同步
export interface GetArticlesQuery {
  articles: Array<{
    id: string;
    title: string;
  }>;
}
```

如果后端改了字段：
- 编译时报错，类型 X 上不存在属性 category
- 改一行 schema，全部前端自动更新

> 如果你经常改后端字段，这个价值很大。如果后端接口基本不变化，价值较小。

---

## 优势 2：字段级选择，省流量

你的 FrontendArticle 类型包含：
```
id, slug, title, excerpt, content, contentMd, coverImage,
views, likes, commentsCount, publishedAt, updatedAt,
meta: {           # 这个很大
  blurhash,
  images: {       # 4 种尺寸 x 2 种格式
    original, large.webp, large.jpg, medium.webp, medium.jpg, thumbnail.webp, thumbnail.jpg
  },
  video: { hlsUrl, duration, qualities, poster, posterWebp },
  contentVideo: [{ videoKey, hlsUrl, poster }]
},
category, tags, author, relatedArticles
```

HomeScreen 列表实际只用：
```
id, title, excerpt, coverImage, publishedAt, likes, commentsCount, category.name
```

但 REST 返回整个 meta（包含所有图片尺寸 + 视频信息），即使列表根本不需要。

用 GraphQL 可以精确只取需要的字段，不用改后端代码。

> 如果用户流量/加载速度敏感，这个有价值。如果大多数用 WiFi，价值中等。

---

## 优势 3：无端点膨胀

### 你现在的 REST 端点（约 30 个）

```
articles/     -> getArticles, getFeatured, getBySlug, getPopular, getRelated, search
categories/   -> getCategories, getCategoryBySlug
tags/         -> getTags, getTagBySlug, getTagArticles
comments/     -> getComments, createComment
bookmarks/    -> getBookmarks, addBookmark, removeBookmark, status
likes/        -> like, unlike, status
auth/         -> login, register, refresh, logout, profile, ...
```

### GraphQL

```
POST /graphql  <- 唯一端点
```

不需要加新路由、不需要写新的 Controller。

> 如果你的项目会持续扩展功能，这个价值大。如果基本定型不动了，价值小。

---

## GraphQL 的缺点

| 缺点 | 说明 |
|------|------|
| 学习成本 | 后端学 @nestjs/graphql，前端学 @apollo/client |
| 缓存更复杂 | REST 可以简单缓存 GET 请求。GraphQL 全是 POST，缓存需要额外配置 |
| 调试不方便 | REST 可以用浏览器地址栏直接试，GraphQL 需要工具 |
| 文件上传麻烦 | GraphQL 原生不支持文件上传，需要额外方案 |
| 复杂度迁移 | 从后端移到了前端（前端要写 query、管理缓存策略） |

---

## 结论

| 你的情况 | 判断 |
|----------|------|
| 后端接口经常改类型？ | GraphQL 类型生成很有用 |
| 有很多屏幕只用到部分字段？ | GraphQL 省流量有价值 |
| 项目还在持续加功能？ | GraphQL 省端点管理 |
| 接口稳定、改动少？ | REST 简单够用 |

如果对现在 REST 的体验满意、类型同步也没出过问题，那确实没必要改。
如果需要 GraphQL 经验（面试/简历），做一个 PoC 试试就够了。
