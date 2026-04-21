# 🌐 国际化架构设计

## 🎯 核心原则

### 黄金法则

1. **单一真相来源**: 整个系统只有一个地方读取当前语言 (`useCurrentLocale`)
2. **零认知负担**: 业务开发者不需要知道国际化机制存在
3. **无法出错**: 系统强制注入，没有办法忘记处理语言
4. **URL优先**: 语言优先级: URL参数 > Cookie > Accept-Language > 默认值

### 简化架构

```
业务组件层     → 零国际化代码
本地化层       → QueryKey工厂自动注入locale
HTTP客户端层   → 统一请求拦截器
服务端中间件   → 语言检测优先级
```

---

## 🔧 实施方案

### 1. 语言检测与传递

**核心文件**: `src/lib/utils/locale.ts`

```typescript
// 单一真相来源
export const useCurrentLocale = () => {
  const params = useParams();
  const cookieLocale = useCookieLocale();
  return (params.locale as string) || cookieLocale || DEFAULT_LOCALE;
};
```

**HTTP客户端**: `src/lib/api/http.ts`

```typescript
// 自动添加语言参数
instance.interceptors.request.use((config) => {
  const lang = getLanguage(); // 从URL/Cookie/Header获取
  config.params = { ...config.params, lang };
  config.headers["Accept-Language"] = lang;
  return config;
});
```

### 2. 查询缓存与语言绑定

**QueryKey工厂**: `src/lib/api/queryKeys.ts`

```typescript
// 自动注入locale到所有查询
export const useLocalizedQueryKey = (namespace: string, ...args: any[]) => {
  const locale = useCurrentLocale();
  return [namespace, locale, ...args];
};
```

**使用示例**:

```typescript
const { data } = useQuery({
  queryKey: useLocalizedQueryKey("articles", { page: 1 }),
  queryFn: () => api.getArticles({ page: 1 }),
});
```

### 3. 服务端预渲染

**页面组件**: `app/[locale]/page.tsx`

```typescript
export default async function HomePage({ params }: Props) {
  const locale = params.locale;

  // 服务端预取数据
  const initialData = await frontendBlogApi.getArticles({
    lang: locale, // 显式传递语言参数
    page: 1,
    pageSize: 10,
  });

  return <HomePageClient initialData={initialData} locale={locale} />;
}
```

**客户端组件**: `app/[locale]/page.client.tsx`

```typescript
export function HomePageClient({ initialData, locale }: Props) {
  const currentLocale = useCurrentLocale();

  const { data } = useQuery({
    queryKey: useLocalizedQueryKey("homeArticles", { page: 1 }),
    queryFn: () =>
      frontendBlogApi.getArticles({
        lang: currentLocale, // 显式传递
        page: 1,
        pageSize: 10,
      }),
    initialData, // 服务端预取数据
  });

  // 使用数据渲染
}
```

---

## ⚠️ 常见问题与解决方案

### Q: 为什么切换语言后内容没有更新？

**根因分类**:
| 层级 | 问题 | 解决方案 |
|------|------|----------|
| 查询层 | QueryKey不包含locale | 使用`useLocalizedQueryKey` |
| HTTP层 | 拦截器覆盖lang参数 | 检查`http.ts`逻辑 |
| 服务端 | initialData没有更新 | 传递正确的locale参数 |

### Q: http.ts已经设置了Accept-Language header，还需要手动传入lang参数吗？

**需要**。http.ts的`getLanguage()`方法在SSR环境下会返回默认语言'zh'，除非显式传递lang参数。最佳实践是始终显式传递lang参数，确保语言一致性。

### Q: 首页收藏状态显示不正确？

**问题**: articleIds来源问题。服务端传递的`initialArticleIds`需要在客户端优先使用。

**错误**:

```typescript
const articleIds = articles.map((article) => article.id) || [];
```

**正确**:

```typescript
const initialIds = initialArticleIds || [];
const dynamicIds = articles.map((article) => article.id) || [];
const articleIds = initialIds.length > 0 ? initialIds : dynamicIds;
```

### Q: 批量获取收藏状态的API存在吗？

**存在**。`frontendBlogApi.batchCheckBookmarkStatus`可以一次获取所有文章的收藏状态。`useBatchBookmarkStatusMap`已经使用这个API。

---

## 🎯 首页简化方案

### 问题发现

过度复杂的架构反而破坏了React Query的缓存机制：

**复杂架构（不推荐）**:

```typescript
// 4层抽象：适配器 + 服务 + 工厂 + Hook
const initialData = await getPlatformArticles({
  locale,
  page: 1,
  pageSize: 10,
});
const { data } = usePlatformArticlesInfiniteQuerySimple({ initialData });
```

**简化架构（推荐）**:

```typescript
// 1层：直接API调用 + React Query原生缓存
const initialData = await frontendBlogApi.getArticles({
  lang: locale, // 显式传递语言参数
  page: 1,
  pageSize: 10,
});

const { data } = useQuery({
  queryKey: useLocalizedQueryKey("homeArticles", { page: 1 }),
  queryFn: () =>
    frontendBlogApi.getArticles({
      lang: currentLocale,
      page: 1,
      pageSize: 10,
    }),
  initialData,
});
```

### 关键原则

1. **保持简单**: 避免过度抽象破坏React Query缓存
2. **显式语言**: 始终显式传递lang参数
3. **正确缓存**: queryKey必须包含语言参数
4. **服务端预取**: 使用initialData模式，避免闪烁

---

## 📝 文章详情页简化示例

### 服务端组件 (`page.tsx`)

```typescript
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import ArticlePageClient from './page.client';

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: routeLocale, slug } = await params;
  const locale = routeLocale;

  try {
    // 简化架构：直接API调用，避免复杂平台感知抽象
    const article = await frontendBlogApi.getArticleBySlug(slug, locale);

    return (
      <ArticlePageClient initialData={article} locale={locale} slug={slug} />
    );
  } catch (error) {
    console.error('Article page server error:', error);

    return <ArticlePageClient initialData={null} locale={locale} slug={slug} />;
  }
}
```

### 客户端组件 (`page.client.tsx`)

```typescript
export function ArticlePageClient({ initialData, locale, slug }: Props) {
  const currentLocale = useCurrentLocale();

  const { data: article } = useFrontendArticleBySlug(slug, initialData);

  // 使用文章数据渲染
  return (
    <div>
      <h1>{article?.title}</h1>
      {/* 其他内容 */}
      <BookmarkButton
        articleId={article.id}
        size="sm"
        showLabel={false}
      />
    </div>
  );
}
```

### Hook实现 (`useFrontendArticleBySlug`)

```typescript
export function useFrontendArticleBySlug(slug: string, initialData?: any) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ["frontendArticle", slug, locale],
    queryFn: () => frontendBlogApi.getArticleBySlug(slug, locale),
    staleTime: 60 * 60 * 1000, // 1小时缓存
    enabled: !!slug,
    initialData,
  });
}
```

## 📝 评论系统简化示例

### Hook实现 (`useCommentsInfiniteQuery.ts`)

```typescript
export function useCommentsInfiniteQuery(
  articleId: string,
  options?: {
    pageSize?: number;
    enabled?: boolean;
  },
) {
  const { pageSize = 20, enabled = true } = options || {};
  const locale = useCurrentLocale(); // 添加语言参数

  return useInfiniteQuery({
    queryKey: ["comments", "infinite", articleId, locale, { pageSize }], // QueryKey包含locale
    queryFn: async ({ pageParam = 1 }) => {
      // 简化架构：直接API调用，避免复杂平台感知抽象
      const response = await frontendBlogApi.getComments(articleId, {
        page: pageParam,
        pageSize,
      });

      return {
        items: response.items || [],
        total: response.total || 0,
        page: response.page || pageParam,
        pageSize: response.pageSize || pageSize,
        totalPages: response.totalPages || 0,
      };
    },
    // ... 其他配置
  });
}
```

### 组件使用 (`CommentList.tsx`)

```typescript
function CommentList({ articleId }: CommentListProps) {
  const {
    items: comments,
    isLoading,
    hasMore,
    loadMore,
  } = useCommentsInfiniteQuerySimple(articleId);

  // 使用评论数据渲染
  return (
    <div>
      {comments.map((comment) => (
        <Comment key={comment.id} comment={comment} articleId={articleId} />
      ))}
      {hasMore && (
        <button onClick={() => loadMore()}>
          {isLoading ? '加载中...' : '加载更多评论'}
        </button>
      )}
    </div>
  );
}
```

### 关键改进

1. **QueryKey包含locale**: 确保语言切换时评论缓存正确失效
2. **简化架构**: 直接API调用，避免复杂平台感知抽象
3. **HTTP拦截器**: 依赖`http.ts`自动添加`Accept-Language` header
4. **缓存一致性**: 与首页、文章详情页保持相同的简化架构

## 📞 技术支持

**核心文件参考**:

1. `useCurrentLocale.ts` - 单一数据源实现
2. `queryKeys.ts` - QueryKey工厂实现
3. `http.ts` - HTTP客户端语言优先级实现
4. `page.client.tsx` - 首页简化实现示例
5. `articles/[slug]/page.tsx` - 文章详情页简化示例
6. `useCommentsInfiniteQuery.ts` - 评论系统简化示例

**验证步骤**:

1. 切换语言时检查网络请求是否发出
2. 检查请求的`lang`参数是否正确
3. 检查React Query DevTools中QueryKey是否包含locale
4. 检查initialData是否没有被重新验证
5. 评论列表在语言切换时是否正确更新
