# 后端 Resolver 代码结构（Category PoC）

> 本文展示 GraphQL Resolver 如何复用现有的 `FrontendBlogService`，不重复写数据库逻辑。

---

## 核心原则

**Resolver 不写业务逻辑，直接调用现有的 Service。**

```
REST Controller:    接收 HTTP 请求 → 调用 Service → 返回 JSON
GraphQL Resolver:   接收 GraphQL 查询 → 调用 Service → 返回 Object

                  ↘ 同一个 Service，同一个 Prisma 查询 ↙
```

---

## 当前 REST 链路（不动）

```typescript
// apps/api/src/blog/frontend/frontend-blog.controller.ts:137
@Get('categories')
getFrontendCategories(@Req() req: Request) {
  const locale = this.languageService.resolveLanguage(req);
  return this.frontendBlogService.getFrontendCategories(locale);
}
```

```typescript
// apps/api/src/blog/frontend/frontend-blog.service.ts:138
async getFrontendCategories(locale: string = 'zh') {
  const categories = await this.blogService.getCategories();  // Prisma 查询
  return categories.map((category) =>
    this.mapCategoryForFrontend(category, locale),
  );
}
```

---

## GraphQL Resolver（新增）

```typescript
// apps/api/src/graphql/resolvers/category.resolver.ts
import { Resolver, Query, Args } from '@nestjs/graphql';
import { FrontendBlogService } from '../../blog/frontend/frontend-blog.service';

@Resolver('Category')
export class CategoryResolver {
  constructor(
    private readonly frontendBlogService: FrontendBlogService,
  ) {}

  @Query('categories')
  async getCategories(
    @Args('locale', { type: () => String, defaultValue: 'zh' }) locale: string,
  ) {
    //  直接复用现有的 Service 方法
    //  不重新写 Prisma 查询，不重新写数据转换
    return this.frontendBlogService.getFrontendCategories(locale);
  }

  @Query('categoryBySlug')
  async getCategoryBySlug(
    @Args('slug', { type: () => String }) slug: string,
    @Args('page', { type: () => Number, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Number, nullable: true }) pageSize?: number,
    @Args('locale', { type: () => String, defaultValue: 'zh' }) locale: string,
  ) {
    return this.frontendBlogService.getFrontendCategoryBySlug(slug, {
      page,
      pageSize,
      locale,
    });
  }
}
```

---

## GraphQL Schema（自动生成）

NestJS 使用 `autoSchemaFile` 时会根据 `@ObjectType` 和 `@Field` 装饰器自动生成 `schema.gql`。

你不需要手写 schema 文件，但生成的 schema 会是这样：

```graphql
# 自动生成的 schema.gql

type Category {
  id: ID!
  name: String!
  slug: String!
  description: String!
  coverImage: String!
  articleCount: Int!
}

type CategoryWithArticles {
  id: ID!
  name: String!
  slug: String!
  description: String!
  coverImage: String!
  articleCount: Int!
  articles: ArticlePage!
}

type ArticlePage {
  items: [Article!]!
  total: Int!
  page: Int!
  pageSize: Int!
  totalPages: Int!
}

type Query {
  categories(locale: String!): [Category!]!
  categoryBySlug(
    slug: String!
    page: Int
    pageSize: Int
    locale: String!
  ): CategoryWithArticles
}
```

---

## ObjectType 定义（新增）

为了让 NestJS 自动生成 schema，需要用 `@ObjectType` 装饰器标注类型。

```typescript
// apps/api/src/graphql/models/category.model.ts
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class Category {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field()
  description: string;

  @Field()
  coverImage: string;

  @Field(() => Int)
  articleCount: number;
}
```

```typescript
// apps/api/src/graphql/models/category-with-articles.model.ts
import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Category } from './category.model';
import { ArticlePage } from './article-page.model';

@ObjectType()
export class CategoryWithArticles extends Category {
  @Field(() => ArticlePage)
  articles: ArticlePage;
}
```

```typescript
// apps/api/src/graphql/models/article-page.model.ts
import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Article } from './article.model';

@ObjectType()
export class ArticlePage {
  @Field(() => [Article])
  items: Article[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  pageSize: number;

  @Field(() => Int)
  totalPages: number;
}
```

---

## GraphQL 模块（新增）

```typescript
// apps/api/src/graphql/graphql.module.ts
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { CategoryResolver } from './resolvers/category.resolver';
import { BlogModule } from '../blog/blog.module'; // 引入 BlogModule 以使用 FrontendBlogService

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'apps/api/src/graphql/schema.gql'),
      playground: process.env.NODE_ENV !== 'production',
      introspection: process.env.NODE_ENV !== 'production',
      sortSchema: true,
      path: '/graphql',
    }),
    BlogModule,  // 让 Resolver 能注入 FrontendBlogService
  ],
  providers: [CategoryResolver],
})
export class GraphqlAppModule {}
```

---

## app.module.ts 注册（修改）

在 [`apps/api/src/app.module.ts`](apps/api/src/app.module.ts) 中添加 `GraphqlAppModule`：

```typescript
import { GraphqlAppModule } from './graphql/graphql.module';

@Module({
  imports: [
    // ... 其他模块
    GraphqlAppModule,  // 新增
  ],
})
export class AppModule {}
```

---

## 文件结构预览

```
apps/api/src/graphql/
├── graphql.module.ts              # GraphQL 模块配置
├── schema.gql                     # 自动生成的 schema 文件
├── models/
│   ├── category.model.ts          # Category ObjectType
│   ├── category-with-articles.model.ts
│   ├── article.model.ts           # Article ObjectType
│   └── article-page.model.ts      # 分页类型
└── resolvers/
    └── category.resolver.ts       # Category Resolver
```

---

## 完整数据流

```
1. 前端请求:
   query { categories(locale: "en") { id name slug } }

2. CategoryResolver.getCategories("en")
     ↓ 调用
3. FrontendBlogService.getFrontendCategories("en")
     ↓ 调用
4. BlogService.getCategories()
     ↓ Prisma
5. PostgreSQL → 返回 Category[]
     ↓
6. mapCategoryForFrontend() → 转换格式
     ↓
7. 返回 FrontendCategory[] → GraphQL 自动序列化 → JSON
```

**REST 和 GraphQL 走完全相同的 Service → Prisma 链路，结果一致。**

---

## 与现有 REST 对比

| 方面 | REST Controller | GraphQL Resolver |
|------|----------------|-----------------|
| 入口 | `@Get('categories')` | `@Query('categories')` |
| 参数 | `@Req() req` → 解析 locale | `@Args('locale')` 显式传 |
| 业务逻辑 | 调用 Service | **同样调用 Service** |
| 返回格式 | JSON (自动) | Object (GraphQL 序列化) |
| 缓存 | `@CacheTTL(300)` | 由前端 React Query 控制 |
| 文件数 | 3 文件 (controller/service/module) | 4+ 文件 (resolver/model×N/module) |

---

## 总结

1. **Resolver ≈ Controller 的简化版** — 多了 `@ObjectType` 定义，少了 HTTP 相关处理
2. **不重复写业务逻辑** — 所有 Resolver 调用 `FrontendBlogService` 的方法
3. **不重复写类型** — `@ObjectType` 与前端 `FrontendCategory` 接口一一对应
4. **GraphQL 模块独立** — 不会影响现有 REST 代码
