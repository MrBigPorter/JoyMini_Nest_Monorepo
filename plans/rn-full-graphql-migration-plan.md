# RN Full GraphQL Migration Plan (Option A - 保留 REST，逐步叠加)

> 将 `frontend-blog-mobile` (React Native) 和后端 NestJS blog 模块全面迁移到 GraphQL
> **策略：不删除现有 REST API，逐步叠加 GraphQL，两者共存过渡**

## 1. 当前架构概览

### 前端 (React Native - `/Users/porter/Developer/frontend-blog-mobile`)

| 层级 | 技术 | 文件 |
|------|------|------|
| API 层 | RTK Query (`blogApi`) | `src/api/baseApi.ts` |
| 端点 | RTK Query injectEndpoints | `src/api/endpoints/*.ts` (7 文件) |
| 状态管理 | Redux Toolkit + slices | `src/store/index.ts` + 4 slices |
| 缓存 | RTK Query 自动缓存 + MMKV | `src/lib/storage/index.ts` |
| 实时通信 | SSE (react-native-sse) | `src/lib/hooks/useCommentSSE.ts` |
| 屏幕 | 10 个 Screens | `src/screens/*.tsx` |

### 后端 (NestJS - `apps/api`)

- 纯 REST 架构
- 无 GraphQL 依赖
- Blog 模块控制器: `FrontendBlogController`, `BookmarkController`, `BlogController`
- 使用的守卫: `AdminJwtAuthGuard`, `RolesGuard`, `LikeDeduplicationGuard`

### 当前 REST 端点清单（需迁移）

| 领域 | 端点 | 方法 | 说明 |
|------|------|------|------|
| Articles | `/api/v1/frontend/blog/articles` | GET | 分页列表 |
| Articles | `/api/v1/frontend/blog/featured` | GET | 精选文章 |
| Articles | `/api/v1/frontend/blog/articles/:slug` | GET | 详情 |
| Articles | `/api/v1/frontend/blog/articles/popular` | GET | 热门 |
| Articles | `/api/v1/frontend/blog/articles/:id/related` | GET | 相关 |
| Articles | `/api/v1/frontend/blog/search` | GET | 搜索 |
| Categories | `/api/v1/frontend/blog/categories` | GET | 分类列表 |
| Categories | `/api/v1/frontend/blog/categories/:slug` | GET | 分类详情+文章 |
| Tags | `/api/v1/frontend/blog/tags` | GET | 标签列表 |
| Tags | `/api/v1/frontend/blog/tags/popular` | GET | 热门标签 |
| Tags | `/api/v1/frontend/blog/tags/:slug` | GET | 标签详情+文章 |
| Comments | `/api/v1/frontend/blog/articles/:id/comments` | GET | 评论列表 |
| Comments | `/api/v1/frontend/blog/articles/:id/comments` | POST | 发表评论 |
| Comments | `/api/v1/frontend/blog/comments/:id/status` | GET | 评论状态 |
| Comments | `/api/v1/frontend/blog/comments/:id/replies` | GET | 评论回复 |
| Comments | `/api/v1/frontend/blog/comments/stream` | SSE | 实时评论 |
| Likes | `/api/v1/frontend/blog/articles/:slug/like` | POST | 点赞 |
| Likes | `/api/v1/frontend/blog/articles/:slug/unlike` | POST | 取消点赞 |
| Likes | `/api/v1/frontend/blog/articles/:slug/like-status` | GET | 点赞状态 |
| Bookmarks | `/api/v1/frontend/blog/bookmarks` | GET | 书签列表 |
| Bookmarks | `/api/v1/frontend/blog/articles/:id/bookmark` | POST | 添加书签 |
| Bookmarks | `/api/v1/frontend/blog/articles/:id/bookmark` | DELETE | 删除书签 |
| Bookmarks | `/api/v1/frontend/blog/articles/:id/bookmark-status` | GET | 书签状态 |
| Auth | `/api/v1/auth/login` | POST | 登录 |
| Auth | `/api/v1/auth/register` | POST | 注册 |
| Auth | `/api/v1/auth/email/send-code` | POST | 发送验证码 |
| Auth | `/api/v1/auth/email/login` | POST | 验证码登录 |
| Auth | `/api/v1/auth/refresh` | POST | 刷新令牌 |
| Auth | `/api/v1/auth/logout` | POST | 登出 |
| Auth | `/api/v1/auth/profile` | GET | 用户信息 |
| Auth | `/api/v1/auth/account/data` | DELETE | 清除数据 |

## 2. 整体策略

```
不删除任何现有代码，GraphQL 逐步叠加，REST 保留作为回退。
最终状态：REST 和 GraphQL 共存，前端可选择使用任一协议。
```

### 迁移原则

1. **后端**: 新增 `GraphQLModule` + Resolvers，不修改任何 REST Controllers
2. **前端**: 新增 `ApolloClient` + GraphQL hooks，逐步替换屏幕中的 RTK Query hooks
3. **状态**: Redux 保留 auth/bookmark/like 的 UI 状态，数据缓存由 Apollo Cache 接管
4. **实时通信**: SSE 保留，GraphQL Subscription 作为可选增强

## 3. 迁移步骤清单

### Phase 1: 后端 GraphQL 基础设施

#### Step 1.1 - 安装依赖

后端 `/Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/api/package.json` 新增:

```
@nestjs/graphql (^13)
@nestjs/apollo (^13)
@apollo/server (^4)
graphql (^16)
```

#### Step 1.2 - 新建 GraphQL 模块

新增文件目录 `apps/api/src/graphql/`:

| 文件 | 说明 |
|------|------|
| `graphql.module.ts` | 配置 Apollo Server, code-first 模式, autoSchemaFile |
| `models/article.model.ts` | Article GraphQL 类型定义 |
| `models/category.model.ts` | Category GraphQL 类型定义 |
| `models/tag.model.ts` | Tag GraphQL 类型定义 |
| `models/comment.model.ts` | Comment GraphQL 类型定义 |
| `models/auth.model.ts` | AuthToken, UserProfile 等类型定义 |
| `models/common.model.ts` | PaginatedResponse, ApiResponse 等通用类型 |
| `resolvers/articles.resolver.ts` | 文章查询 (list, detail, featured, popular, related, search) |
| `resolvers/categories.resolver.ts` | 分类查询 (list, detail+articles) |
| `resolvers/tags.resolver.ts` | 标签查询 (list, popular, detail+articles) |
| `resolvers/comments.resolver.ts` | 评论 (list, create, status, replies, subscription) |
| `resolvers/likes.resolver.ts` | 点赞 (like, unlike, status) |
| `resolvers/bookmarks.resolver.ts` | 书签 (list, add, remove, status) |
| `resolvers/auth.resolver.ts` | 认证 (login, register, logout, profile, refresh, clearData) |

关键点:
- Resolver 调用现有的 `BlogService`, `FrontendBlogService`, `BookmarkService` 等
- 复用现有的 Guards (`LikeDeduplicationGuard`)
- GraphQL 端口与 REST 共用 (默认 `/graphql`)

#### Step 1.3 - 注册到 AppModule

```typescript
// apps/api/src/app.module.ts
@Module({
  imports: [
    // 原有的所有模块...,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/graphql/schema.gql'),
      sortSchema: true,
      playground: true,  // 开发环境启用
    }),
    // ...其他模块
  ],
})
```

### Phase 2: 前端 GraphQL 基础设施

#### Step 2.1 - 安装依赖

`frontend-blog-mobile/package.json` 新增:

```
生产依赖:
  @apollo/client (^3.13)
  graphql (^16)

开发依赖:
  @graphql-codegen/cli (^5)
  @graphql-codegen/typescript (^4)
  @graphql-codegen/typescript-operations (^4)
  @graphql-codegen/typescript-react-apollo (^4)
```

#### Step 2.2 - 新建 GraphQL 目录结构

新建 `src/graphql/`:

| 文件 | 说明 |
|------|------|
| `apollo-client.ts` | Apollo Client 配置: httpLink, authLink, errorLink, cache |
| `codegen.ts` | GraphQL Code Generator 配置 |
| `fragments.ts` | 公共 fragments |
| `queries/articles.graphql` | 文章查询 |
| `queries/categories.graphql` | 分类查询 |
| `queries/tags.graphql` | 标签查询 |
| `queries/comments.graphql` | 评论查询 |
| `mutations/comments.graphql` | 评论变更 |
| `mutations/likes.graphql` | 点赞变更 |
| `mutations/bookmarks.graphql` | 书签变更 |
| `mutations/auth.graphql` | 认证变更 |
| `subscriptions/comments.graphql` | 评论订阅 |

#### Step 2.3 - Apollo Client 配置核心逻辑

```typescript
// src/graphql/apollo-client.ts 核心逻辑
// 从 baseApi.ts 迁移以下功能:
// 1. Auth token injection (Authorization header)
// 2. Accept-Language header (i18n)
// 3. 401 → token refresh → retry
// 4. API timing recording (perf monitor)
// 5. Error logging

const authLink = setContext((_, { headers }) => {
  const token = storage.getString('auth_access_token');
  return {
    headers: {
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Accept-Language': getCurrentLanguage(),
    },
  };
});

const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
  if (networkError && 'statusCode' in networkError && networkError.statusCode === 401) {
    // token refresh logic (same as baseApi.ts)
  }
});
```

### Phase 3: 逐个领域迁移 Screen (按照依赖关系)

#### Step 3.1 - 只读查询（无副作用，风险最低）

**第一站: Categories 和 Tags**

因为 Categories 和 Tags 是纯只读查询，最容易迁移验证。

| Screen/Component | 当前 RTK Query | 替换为 GraphQL |
|-----------------|----------------|----------------|
| `CategoryListScreen.tsx` | `useGetCategoriesQuery(lang)` | `useGetCategoriesQuery({variables: {lang}})` |
| `CategoryArticlesScreen.tsx` | `useGetCategoryBySlugQuery(...)` | `useGetCategoryBySlugQuery(...)` |
| `HomeScreen.tsx` (CategoryFilter) | 通过组件内部调用 | 通过 GraphQL |
| `TagChip.tsx` (组件) | 间接使用 | 通过 GraphQL |

**第二站: Articles (HomeScreen, 核心)**

| Screen | 当前 RTK Query | 替换为 GraphQL |
|--------|---------------|----------------|
| `HomeScreen.tsx` | `useGetArticlesQuery` | `useArticlesQuery` + `fetchMore` for pagination |
| `ArticleListScreen.tsx` | `useGetArticlesQuery` | `useArticlesQuery` |
| `SearchScreen.tsx` | `useSearchArticlesQuery` | `useSearchArticlesQuery` |
| `ArchiveScreen.tsx` | `useGetArticlesQuery` | `useArticlesQuery` |
| `ArticleDetailScreen.tsx` | `useGetArticleBySlugQuery`, `useGetRelatedArticlesQuery` | 对应的 GraphQL queries |

**第三站: Comments (有 SSE)**

| Screen/Hook | 当前 RTK Query | 替换为 GraphQL |
|------------|---------------|----------------|
| `useCommentsInfiniteQuery.ts` | `useLazyGetCommentsQuery` | Apollo `useQuery` + `fetchMore` |
| `CommentItem.tsx` | 间接使用 | 通过 hooks |
| `useCommentSSE.ts` | SSE `EventSource` | 保留 SSE OR 迁移到 GraphQL Subscription |

**第四站: Likes (有乐观更新)**

| Screen | 当前 RTK Query | 替换为 GraphQL |
|--------|---------------|----------------|
| `ArticleDetailScreen.tsx` | `useLikeArticleMutation`, `useUnlikeArticleMutation`, `useCheckLikeStatusQuery` | 对应的 GraphQL mutations |
| `HomeScreen.tsx` | 每篇文章的 like 状态 | 通过 article.likes 字段获取 |

**第五站: Bookmarks (有乐观更新)**

| Screen | 当前 RTK Query | 替换为 GraphQL |
|--------|---------------|----------------|
| `ArticleDetailScreen.tsx` | `useAddBookmarkMutation`, `useRemoveBookmarkMutation` | 对应的 GraphQL mutations |
| `HomeScreen.tsx` | `useAddBookmarkMutation`, `useRemoveBookmarkMutation` | 对应的 GraphQL mutations |
| `BookmarksScreen.tsx` | Redux `bookmarksSlice` | Apollo `useQuery` |

**第六站: Auth (敏感操作，最后迁移)**

| Screen/Component | 当前 RTK Query | 替换为 GraphQL |
|-----------------|----------------|----------------|
| `AuthScreen.tsx` | `useLoginMutation`, `useRegisterMutation`, `useSendEmailCodeMutation`, `useLoginWithEmailCodeMutation` | 对应的 GraphQL mutations |
| `baseApi.ts` (refresh) | `refreshToken` endpoint | GraphQL mutation |
| `Providers.tsx` | `useGetProfileQuery` | GraphQL query |
| `useOAuth.ts` | Auth mutations | GraphQL mutations |

### Phase 4: Apollo Cache 策略配置

#### 缓存归一化

```typescript
const cache = new InMemoryCache({
  typePolicies: {
    Article: {
      keyFields: ['id'],
    },
    Query: {
      fields: {
        articles: {
          // 分页合并策略 - 替代现有 allArticles state
          keyArgs: ['filter.lang', 'filter.categoryId', 'filter.tagId'],
          merge(existing, incoming) {
            if (!existing) return incoming;
            return {
              ...incoming,
              items: [...existing.items, ...incoming.items],
            };
          },
        },
        comments: {
          keyArgs: ['articleId'],
          merge(existing, incoming) {
            if (!existing) return incoming;
            return {
              ...incoming,
              items: [...existing.items, ...incoming.items],
            };
          },
        },
      },
    },
  },
});
```

#### 乐观更新示例 (Likes)

```typescript
// 替代现有 toggleLikeOptimistic + useLikeArticleMutation 模式
const [likeArticle] = useLikeArticleMutation();

const handleLike = () => {
  likeArticle({
    variables: { slug: article.slug },
    optimisticResponse: {
      likeArticle: {
        __typename: 'LikeResponse',
        liked: true,
        likeCount: article.likes + 1,
      },
    },
    update: (cache, { data }) => {
      cache.modify({
        id: cache.identify({ __typename: 'Article', id: article.id }),
        fields: {
          likes: () => data?.likeArticle?.likeCount ?? article.likes + 1,
        },
      });
    },
  });
};
```

## 4. 迁移顺序总览（推荐执行顺序）

```
Week 1-2: 后端基础设施 + Categories/Tags Resolvers
Week 2-3: Articles Resolvers + Apollo Client 前端基础设施
Week 3-4: 前端迁移 Categories/Tags Screens
Week 4-5: 前端迁移 HomeScreen + ArticleListScreen (核心)
Week 5-6: 前端迁移 ArticleDetailScreen + Comments
Week 6-7: Likes + Bookmarks （含乐观更新逻辑）
Week 7-8: Auth （含 token 刷新链路验证）
Week 8: 清理 + 性能优化 + 测试
```

## 5. 影响分析与注意事项

### 5.1 乐观更新 (Optimistic UI)
- 现有 Redux slices `bookmarksSlice` + `likesSlice` 管理乐观更新
- Apollo Client 的 `optimisticResponse` + `update` callback 可直接替代
- **建议**: 迁移期间保留 Redux slices，GraphQL 迁移完成后评估是否移除

### 5.2 Token 刷新
- `baseApi.ts` 的 401 → refresh → retry 逻辑需要迁移到 Apollo Link
- 迁移到 `onError` link 中，复用 `storage` 和 refresh 逻辑

### 5.3 性能监控
- `src/lib/perf/apiTiming.ts` 需要适配 Apollo Link
- 新增 Apollo Link 来记录每个请求的耗时

### 5.4 分页策略
- 现有 `allArticles` state 手动管理分页积累
- Apollo `fetchMore` + `typePolicies.field.merge` 自动处理

### 5.5 i18n 语言参数
- 通过 Apollo `setContext` link 注入 `Accept-Language` header
- 或者在每个 query 中作为 variable 传递

### 5.6 现有 `baseApi.ts` 保留策略
```
迁移过程中 baseApi.ts 保留不动
每个屏幕迁移完成后，验证 GraphQL 正常工作
所有屏幕迁移完成后再清理 baseApi.ts 及相关 RTK Query 代码
```

## 6. 文件变更清单

### 后端新增文件 (~20 个)

```
apps/api/src/graphql/
├── graphql.module.ts
├── models/
│   ├── article.model.ts
│   ├── category.model.ts
│   ├── tag.model.ts
│   ├── comment.model.ts
│   ├── auth.model.ts
│   └── common.model.ts
└── resolvers/
    ├── articles.resolver.ts
    ├── categories.resolver.ts
    ├── tags.resolver.ts
    ├── comments.resolver.ts
    ├── likes.resolver.ts
    ├── bookmarks.resolver.ts
    └── auth.resolver.ts
```

### 后端修改文件 (~2 个)

```
apps/api/package.json          - 添加 GraphQL 依赖
apps/api/src/app.module.ts     - 注册 GraphQLModule
```

### 前端新增文件 (~18 个)

```
src/graphql/
├── apollo-client.ts
├── codegen.ts
├── fragments.ts
├── generated.ts            (自动生成)
├── queries/
│   ├── articles.graphql
│   ├── categories.graphql
│   ├── tags.graphql
│   └── comments.graphql
├── mutations/
│   ├── comments.graphql
│   ├── likes.graphql
│   ├── bookmarks.graphql
│   └── auth.graphql
└── subscriptions/
    └── comments.graphql
```

### 前端修改文件 (~12 个)

```
package.json                              - 添加依赖
src/store/index.ts                        - 保留，无需变更（RTK Query 保留）
src/lib/perf/apiTiming.ts                 - 适配 Apollo Link
src/lib/hooks/useCommentsInfiniteQuery.ts - 替换为 Apollo fetchMore
src/lib/hooks/useCommentSSE.ts            - 可选迁移到 Subscription
src/screens/HomeScreen.tsx                - 替换 hooks
src/screens/ArticleDetailScreen.tsx       - 替换 hooks
src/screens/ArticleListScreen.tsx         - 替换 hooks
src/screens/SearchScreen.tsx              - 替换 hooks
src/screens/BookmarksScreen.tsx           - 替换 hooks
src/screens/CategoryListScreen.tsx        - 替换 hooks
src/screens/CategoryArticlesScreen.tsx    - 替换 hooks
src/screens/ArchiveScreen.tsx             - 替换 hooks
```

### 前端无需删除的文件

```
src/api/baseApi.ts              - 保留（过渡期共存）
src/api/endpoints/*.ts          - 保留（过渡期共存）
src/store/slices/authSlice.ts   - 保留
src/store/slices/bookmarksSlice.ts - 保留（乐观更新用）
src/store/slices/likesSlice.ts  - 保留（乐观更新用）
src/store/slices/uiSlice.ts     - 保留
```

## 7. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| RTK Query 迁移到 Apollo 的数据获取模式变化 | 中 | REST 保留作为回退，逐步迁移 |
| SSE → Subscription 的 WebSocket 连接管理 | 低 | SSE 保留，不强制迁移 Subscription |
| 乐观更新逻辑复杂 (bookmarks, likes) | 高 | 保留 Redux slices，迁移完成后清理 |
| 分页缓存合并策略配置错误 | 中 | 详细测试 typePolicies merge |
| 认证 token 刷新链路 | 高 | 完整复用 baseApi.ts 现有逻辑 |
| 新旧协议并行维护成本 | 中 | 明确迁移截止点，避免长期双维护 |
