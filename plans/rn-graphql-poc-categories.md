# PoC: Categories-only GraphQL Migration

> 先做一个小范围 PoC 验证 GraphQL 链路是否可行
> 只迁移 Categories 一个领域，其余保持不变

## PoC 范围

### 后端（~5 文件）
1. 安装 GraphQL 依赖
2. 创建 `GraphQLModule` 配置
3. 创建 `Category` GraphQL 类型模型
4. 创建 `CategoriesResolver` (list + bySlug)
5. 注册到 `AppModule`

### 前端（~7 文件）
1. 安装 Apollo Client 依赖
2. 创建 `apollo-client.ts` 配置（含 auth link + error link）
3. 创建 `categories.graphql` query 定义
4. 创建 GraphQL Codegen 配置
5. 修改 `CategoryListScreen.tsx` 使用 Apollo useQuery
6. 修改 `CategoryArticlesScreen.tsx` 使用 Apollo useQuery
7. 验证：CategoryList 和 CategoryArticles 用 GraphQL 获取数据

### 不变的部分
- REST 控制器全部保留
- RTK Query 保留（其他屏幕继续用）
- Redux 不变
- SSE 不变
- Auth 不变

## 成功标准
1. CategoryListScreen 通过 GraphQL 正常显示分类列表
2. CategoryArticlesScreen 通过 GraphQL 正常显示分类文章
3. REST API 仍然可用
4. 切换语言时数据正确刷新
5. 下拉刷新正常工作

## 文件清单

### 后端新增
| 文件 | 说明 |
|------|------|
| `apps/api/src/graphql/graphql.module.ts` | Apollo Server 配置 |
| `apps/api/src/graphql/models/category.model.ts` | Category GraphQL 类型 |
| `apps/api/src/graphql/resolvers/categories.resolver.ts` | 分类查询 Resolver |

### 后端修改
| 文件 | 说明 |
|------|------|
| `apps/api/package.json` | 添加 GraphQL 依赖 |
| `apps/api/src/app.module.ts` | 注册 GraphQLModule |

### 前端新增
| 文件 | 说明 |
|------|------|
| `src/graphql/apollo-client.ts` | Apollo Client 配置 |
| `src/graphql/queries/categories.graphql` | Categories 查询 |
| `codegen.ts` | 可选，Codegen 配置 |

### 前端修改
| 文件 | 说明 |
|------|------|
| `package.json` | 添加 Apollo Client 依赖 |
| `src/screens/CategoryListScreen.tsx` | 替换为 Apollo useQuery |
| `src/screens/CategoryArticlesScreen.tsx` | 替换为 Apollo useQuery |

（如果不用 Codegen，直接就 gql 模板写在内联也行，更简单）

## GraphQL Schema (PoC 范围)

```graphql
type Category {
  id: ID!
  name: String!
  slug: String!
  description: String!
  coverImage: String!
  articleCount: Int!
  color: String
  icon: String
  articles(filter: ArticleFilterInput): PaginatedArticles
}

type PaginatedArticles {
  items: [Article!]!
  total: Int!
  page: Int!
  pageSize: Int!
  totalPages: Int!
}

type Article {
  id: ID!
  slug: String!
  title: String!
  excerpt: String!
  coverImage: String!
  views: Int!
  likes: Int!
  commentsCount: Int!
  publishedAt: String!
  category: Category
  tags: [Tag!]
}

type Tag {
  id: ID!
  name: String!
  slug: String!
}

input ArticleFilterInput {
  page: Int
  pageSize: Int
  lang: String
}

type Query {
  categories(lang: String): [Category!]!
  categoryBySlug(slug: String!, page: Int, pageSize: Int, lang: String): Category!
}
```

## 实施步骤

```
Step 1: 后端装依赖 + 配置 GraphQLModule
Step 2: 后端创建 Category model + CategoriesResolver
Step 3: 前端装依赖 + 创建 ApolloClient
Step 4: 前端创建 categories.graphql query
Step 5: 前端修改 CategoryListScreen
Step 6: 前端修改 CategoryArticlesScreen
Step 7: 运行验证
```
