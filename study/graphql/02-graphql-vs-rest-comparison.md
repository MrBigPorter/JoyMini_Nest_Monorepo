# GraphQL vs REST — 对你项目的实际对比

> 用你项目里真实存在的代码场景来做对比，不空谈理论

---

## 场景 1：ArticleDetailScreen — 一个页面要发多少次请求？

### 现在的 REST 方式（你当前的代码）

ArticleDetailScreen 打开后，需要以下数据：

| 数据 | 请求 | 状态 |
|------|------|------|
| 文章详情 | GET /articles/by-slug/:slug?lang=zh | ✅ 必须 |
| 评论列表 | GET /comments/:articleId?page=1 | ✅ 必须 |
| 相关文章 | GET /articles/:articleId/related?lang=zh | ✅ 必须 |
| 文章点赞状态 | GET /likes/status/:slug | ✅ 必须 |
| 书签状态 | GET /bookmarks/status/:articleId | ✅ 必须 |

**一共 5 次 HTTP 请求**，即使开了 HTTP/2，也还是要等最慢的那个。

### GraphQL 方式

```graphql
query GetArticlePage($slug: String!, $lang: String, $commentPage: Int) {
  articleBySlug(slug: $slug, lang: $lang) {
    id
    title
    content
    coverImage
    publishedAt
    views
    likes
    liked
    bookmarked
    category { id name slug }
    tags { id name slug }
    relatedArticles(limit: 5) {
      id title slug excerpt coverImage
    }
    comments(page: $commentPage) {
      items { id content author createdAt }
      total
    }
  }
}
```

**1 次请求，拿到所有数据**。

---

## 场景 2：CategoryListScreen — 你拿了不需要的字段

### 现在的 REST API

```
GET /api/frontend-blog/categories?lang=zh
```

返回（后端固定返回所有字段）：
```json
{
  "data": [
    {
      "id": 1,
      "name": "技术",
      "slug": "tech",
      "description": "技术相关",
      "coverImage": "https://...",
      "articleCount": 42,
      "color": "#blue",
      "icon": "code",
      "createdAt": "2025-01-01",
      "updatedAt": "2025-06-01"
    }
  ]
}
```

**CategoryListScreen 真正只用到的字段**：
```
id, name, slug, description, articleCount, icon, color
```

**coverImage, createdAt, updatedAt 都是多余传输的**（over-fetching）。

### GraphQL 方式

```graphql
query {
  categories(lang: "zh") {
    id
    name
    slug
    description
    articleCount
    icon
    color
    # coverImage 不写 → 不返回 → 省流量
  }
}
```

**客户端精确指定要什么，不多传一个字节**。

> 对手机 App 来说，省流量 = 省用户话费 = 加载更快。

---

## 场景 3：HomeScreen — 分页更直观

### 现在的 REST 方式

```typescript
const [page, setPage] = useState(1);
const [allArticles, setAllArticles] = useState<FrontendArticle[]>([]);
const { data } = useGetArticlesQuery({ page, pageSize: 10, lang });

useEffect(() => {
  if (data?.items) {
    setAllArticles(prev => [...prev, ...data.items]);
  }
}, [data]);
```

**你需要手动拼装数组、维护 page 状态、处理重复加载。**

### GraphQL 方式（Apollo 内置分页）

```graphql
query GetArticles($page: Int, $pageSize: Int, $lang: String) {
  articles(page: $page, pageSize: $pageSize, lang: $lang) {
    items { id title excerpt coverImage publishedAt likes commentsCount }
    total
    hasMore
  }
}
```

Apollo 有 fetchMore 直接支持累加分页，不需要手动 setAllArticles。

---

## 场景 4：类型安全 — 减少 bug

### 现在的问题

你手动维护 frontend-blog.ts 里的 TypeScript 类型：
```typescript
export interface FrontendArticle {
  id: number;
  slug: string;
  title: string;
}
```

如果后端改了字段名或类型（比如 id 从 number 变 string），你会得到：
- 运行时 bug（直到页面崩溃才发现）
- 需要手动更新 frontend-blog.ts

### GraphQL 方式

用 GraphQL Codegen 自动生成类型：
```bash
npx graphql-codegen
```

```typescript
// 自动生成，无需手动维护
export interface GetCategoriesQuery {
  categories: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
}
```

- 后端 schema 变了 → codegen 报错 → 编译时就发现
- frontend-blog.ts 大部分类型可以删掉

---

## 总结：核心价值

| 问题 | REST 现状 | GraphQL 改进 |
|------|----------|-------------|
| ArticleDetailScreen | 5 次请求 | 1 次请求 |
| 多语言 | 每个语言要单独请求 | 一个 query 带 lang 参数 |
| 流量浪费 | 后端返回所有字段 | 只要需要的字段 |
| 类型安全 | 手动维护 frontend-blog.ts | 自动从 schema 生成 |
| API 文档 | 没有 / 靠人工 | Schema 自带文档 |
| 分页 | 手动拼数组 | fetchMore 内置 |
