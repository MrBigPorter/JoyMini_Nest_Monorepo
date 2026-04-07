# Blog API 接口详细文档 v1.0.0

> ✅ 所有公开接口规范，与admin-next完全一致

---

## 1. 基础信息

### 1.1 基础路径

```
https://api.luckynest.com/v1/public/blog
```

### 1.2 响应格式

```json
{
  "code": 10000,
  "message": "success",
  "data": {},
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### 1.3 错误码

| 错误码 | 说明       |
| ------ | ---------- |
| 10000  | 成功       |
| 40000  | 参数错误   |
| 40400  | 资源不存在 |
| 50000  | 服务器错误 |

---

## 2. 文章接口

### 2.1 获取文章列表

```
GET /articles
```

#### 请求参数

| 参数       | 类型   | 可选 | 说明                                     |
| ---------- | ------ | ---- | ---------------------------------------- |
| page       | number | ✅   | 页码，默认 1                             |
| pageSize   | number | ✅   | 每页数量，默认 20                        |
| categoryId | string | ✅   | 分类ID                                   |
| tagId      | string | ✅   | 标签ID                                   |
| keyword    | string | ✅   | 搜索关键词                               |
| sort       | string | ✅   | 排序: `newest`(默认), `popular`, `views` |
| status     | string | ✅   | 状态筛选: `published`(默认), `all`       |

#### 响应字段

```typescript
interface Article {
  id: string;
  slug: string;
  title: string;
  summary: string;
  coverImage: string | null;
  author: {
    id: string;
    name: string;
    avatar: string | null;
    bio: string | null;
  };
  category: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    articleCount: number;
  };
  tags: Array<{
    id: string;
    name: string;
    slug: string;
    color: string | null;
    articleCount: number;
  }>;
  viewCount: number;
  commentCount: number;
  likeCount: number;
  readingTime: number;
  isFeatured: boolean;
  publishedAt: number;
  createdAt: number;
  updatedAt: number;
}
```

### 2.2 获取单篇文章详情

```
GET /articles/:slug
```

#### 请求参数

| 参数           | 类型    | 可选 | 说明                        |
| -------------- | ------- | ---- | --------------------------- |
| slug           | string  | ❌   | 文章唯一标识                |
| includeContent | boolean | ✅   | 是否返回正文内容，默认 true |
| incrementView  | boolean | ✅   | 是否增加阅读量，默认 true   |

#### 响应附加字段

```typescript
interface ArticleDetail extends Article {
  content: string;
  htmlContent: string;
  tableOfContents: Array<{
    level: number;
    text: string;
    anchor: string;
  }>;
  relatedArticles: Article[];
  previousArticle: Article | null;
  nextArticle: Article | null;
}
```

### 2.3 获取热门文章

```
GET /articles/popular
```

#### 请求参数

| 参数  | 类型   | 可选 | 说明              |
| ----- | ------ | ---- | ----------------- |
| limit | number | ✅   | 返回数量，默认 10 |
| days  | number | ✅   | 统计天数，默认 7  |

---

## 3. 分类接口

### 3.1 获取所有分类

```
GET /categories
```

#### 响应字段

```typescript
interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  coverImage: string | null;
  articleCount: number;
  sortOrder: number;
  createdAt: number;
}
```

### 3.2 获取单分类详情

```
GET /categories/:slug
```

---

## 4. 标签接口

### 4.1 获取所有标签

```
GET /tags
```

#### 响应字段

```typescript
interface Tag {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  description: string | null;
  articleCount: number;
  createdAt: number;
}
```

### 4.2 获取热门标签

```
GET /tags/popular
```

#### 请求参数

| 参数  | 类型   | 可选 | 说明              |
| ----- | ------ | ---- | ----------------- |
| limit | number | ✅   | 返回数量，默认 20 |

---

## 5. 搜索接口

### 5.1 文章搜索

```
GET /search
```

#### 请求参数

| 参数     | 类型   | 可选 | 说明              |
| -------- | ------ | ---- | ----------------- |
| q        | string | ❌   | 搜索关键词        |
| page     | number | ✅   | 页码，默认 1      |
| pageSize | number | ✅   | 每页数量，默认 20 |

---

## 6. 统计接口

### 6.1 博客概览统计

```
GET /stats
```

#### 响应字段

```typescript
interface BlogStats {
  totalArticles: number;
  totalCategories: number;
  totalTags: number;
  totalViews: number;
  totalComments: number;
  weeklyPublishes: number;
}
```

---

## 7. 评论接口

### 7.1 获取文章评论列表

```
GET /articles/:slug/comments
```

#### 请求参数

| 参数     | 类型   | 可选 | 说明                                      |
| -------- | ------ | ---- | ----------------------------------------- |
| page     | number | ✅   | 页码，默认 1                              |
| pageSize | number | ✅   | 每页数量，默认 20                         |
| sort     | string | ✅   | 排序: `newest`(默认), `oldest`, `popular` |

#### 响应字段

```typescript
interface Comment {
  id: string;
  author: string;
  email: string | null;
  website: string | null;
  avatar: string | null;
  content: string;
  parentId: string | null;
  replies: Comment[];
  likeCount: number;
  createdAt: number;
  isApproved: boolean;
}
```

### 7.2 提交评论

```
POST /articles/:slug/comments
```

#### 请求体

```typescript
interface CreateCommentRequest {
  author: string;
  email: string;
  website?: string;
  content: string;
  parentId?: string;
  captchaToken: string;
}
```

---

## 8. 交互接口

### 8.1 文章点赞

```
POST /articles/:slug/like
```

#### 请求体

```typescript
interface LikeRequest {
  fingerprint: string;
}
```

### 8.2 取消点赞

```
DELETE /articles/:slug/like
```

### 8.3 检查点赞状态

```
GET /articles/:slug/like/status
```

---

## 9. 内容接口

### 9.1 获取文章归档

```
GET /archive
```

#### 响应字段

```typescript
interface ArchiveItem {
  year: number;
  month: number;
  count: number;
  articles: Article[];
}
```

### 9.2 获取推荐文章

```
GET /articles/:slug/recommended
```

#### 请求参数

| 参数  | 类型   | 可选 | 说明             |
| ----- | ------ | ---- | ---------------- |
| limit | number | ✅   | 返回数量，默认 6 |

---

## 10. 系统接口

### 10.1 RSS订阅源

```
GET /rss.xml
```

### 10.2 Sitemap

```
GET /sitemap.xml
```

### 10.3 作者信息

```
GET /authors/:id
```

#### 响应字段

```typescript
interface Author {
  id: string;
  name: string;
  avatar: string | null;
  bio: string | null;
  socialLinks: {
    github?: string;
    twitter?: string;
    website?: string;
  };
  articleCount: number;
  totalViews: number;
  createdAt: number;
}
```

---

## 11. 缓存策略

| 接口     | 缓存时间 | 缓存级别    |
| -------- | -------- | ----------- |
| 文章列表 | 5分钟    | CDN + Redis |
| 文章详情 | 15分钟   | CDN + Redis |
| 分类列表 | 1小时    | Redis       |
| 标签列表 | 1小时    | Redis       |
| 热门文章 | 30分钟   | Redis       |
| 统计数据 | 1小时    | Redis       |

---

**文档版本**: 1.1.0  
**最后更新**: 2026-04-06
