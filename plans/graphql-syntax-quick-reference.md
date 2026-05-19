# GraphQL 常用语法速查 — 以 Categories 为例

> 对比你项目中的 REST API，看看 GraphQL 怎么写

---

## 1. Query（查询数据）

### REST 写法（你现在的）
```
GET /api/frontend-blog/categories?lang=zh
```

响应：
```json
{
  "data": [
    {
      "id": "1",
      "name": "技术",
      "slug": "tech",
      "description": "技术相关文章",
      "articleCount": 42
    }
  ]
}
```

### GraphQL 写法
**请求**（发 POST 到 `/graphql`）：
```graphql
query GetCategories($lang: String) {
  categories(lang: $lang) {
    id
    name
    slug
    description
    articleCount
    icon
  }
}
```

**变量**：
```json
{ "lang": "zh" }
```

**响应**：
```json
{
  "data": {
    "categories": [
      {
        "id": "1",
        "name": "技术",
        "slug": "tech",
        "description": "技术相关文章",
        "articleCount": 42,
        "icon": "code"
      }
    ]
  }
}
```

> 💡 **关键区别**：REST 返回固定结构，GraphQL **客户端指定要什么字段**，不多不少。

---

## 2. Query with params（带参数查询）

### 按 slug 查分类 + 分页文章

```graphql
query GetCategoryBySlug($slug: String!, $page: Int, $pageSize: Int, $lang: String) {
  categoryBySlug(slug: $slug, page: $page, pageSize: $pageSize, lang: $lang) {
    id
    name
    slug
    description
    articles {
      items {
        id
        title
        excerpt
        coverImage
        publishedAt
        likes
        commentsCount
      }
      total
      page
      pageSize
    }
  }
}
```

**变量**：
```json
{
  "slug": "tech",
  "page": 1,
  "pageSize": 10,
  "lang": "zh"
}
```

> 💡 **关键区别**：GraphQL **一次请求**就能拿到「分类信息 + 文章列表 + 分页信息」，REST 通常要分两三次请求。

---

## 3. Mutation（修改数据）

### 对比 REST POST
```
POST /api/frontend-blog/likes/like
Body: { "slug": "my-article" }
```

### GraphQL Mutation
```graphql
mutation LikeArticle($slug: String!) {
  likeArticle(slug: $slug) {
    id
    slug
    likes
    liked
  }
}
```

**变量**：
```json
{ "slug": "my-article" }
```

**响应**：
```json
{
  "data": {
    "likeArticle": {
      "id": "123",
      "slug": "my-article",
      "likes": 128,
      "liked": true
    }
  }
}
```

> 💡 **关键区别**：Mutation 执行完后可以**直接返回更新后的数据**，不一定要再查一次。

---

## 4. Fragments（复用字段片段）

当多个地方需要同样的字段时，用 Fragment 避免重复：

```graphql
fragment CategoryFields on Category {
  id
  name
  slug
  description
  articleCount
  icon
  color
}

# 然后复用
query GetCategories {
  categories {
    ...CategoryFields
  }
}

query GetCategoryBySlug($slug: String!) {
  categoryBySlug(slug: $slug) {
    ...CategoryFields
    articles { ... }
  }
}
```

---

## 5. 前端用法（Apollo Client）

### 对比 RTK Query vs Apollo

| 场景 | RTK Query | Apollo Client |
|------|-----------|---------------|
| 定义查询 | `builder.query(...)` | `gql` template + `useQuery` |
| 调用 | `useGetCategoriesQuery(lang)` | `useQuery(GET_CATEGORIES, { variables: { lang } })` |
| 加载状态 | `{ data, isLoading, isError }` | `{ data, loading, error }` |
| 刷新 | `refetch()` | `refetch()` |

### Apollo 示例

```tsx
import { gql, useQuery } from '@apollo/client';

const GET_CATEGORIES = gql`
  query GetCategories($lang: String) {
    categories(lang: $lang) {
      id
      name
      slug
      description
      articleCount
      icon
    }
  }
`;

function CategoryList() {
  const { data, loading, error, refetch } = useQuery(GET_CATEGORIES, {
    variables: { lang: 'zh' },
  });

  if (loading) return <Loading />;
  if (error) return <Error />;

  return data.categories.map(cat => (
    <Text>{cat.name}</Text>
  ));
}
```

---

## 6. 你的 Categories PoC 要用的完整示例

### Schema 定义（后端）

```graphql
type Query {
  # 获取所有分类
  categories(lang: String): [Category!]!
  
  # 获取单个分类 + 分页文章
  categoryBySlug(slug: String!, page: Int, pageSize: Int, lang: String): Category!
}

type Category {
  id: ID!
  name: String!
  slug: String!
  description: String!
  coverImage: String!
  articleCount: Int!
  color: String
  icon: String
}
```

### 前端会发的 Query

```graphql
# CategoryListScreen 用的
query GetCategories($lang: String) {
  categories(lang: $lang) {
    id
    name
    slug
    description
    articleCount
    icon
    color
  }
}

# CategoryArticlesScreen 用的
query GetCategoryBySlug($slug: String!, $page: Int, $pageSize: Int, $lang: String) {
  categoryBySlug(slug: $slug, page: $page, pageSize: $pageSize, lang: $lang) {
    ...CategoryFields
    articles {
      items {
        id
        slug
        title
        excerpt
        coverImage
        publishedAt
        likes
        commentsCount
      }
      total
      page
      pageSize
      totalPages
    }
  }
}

fragment CategoryFields on Category {
  id
  name
  slug
  description
  articleCount
  icon
  color
}
```

---

## 总结

| 概念 | REST | GraphQL |
|------|------|---------|
| 获取数据 | GET 固定 URL | Query + 选字段 |
| 修改数据 | POST/PUT/DELETE | Mutation |
| 多个资源 | 多次请求 / N+1 | 一次 Query 嵌套 |
| 返回字段 | 后端决定 | 客户端决定 |
| 类型系统 | 无 / 手动定义 | Schema 强制类型 |

需要我接着切换到 **Code 模式** 开始实施 PoC 吗？
