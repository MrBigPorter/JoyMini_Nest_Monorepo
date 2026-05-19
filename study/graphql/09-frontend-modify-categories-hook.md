# Step 5：前端修改 Categories Hook 使用 GraphQL

> 新增 GraphQL 查詢定義，修改 `useFrontendCategories` Hook，使其可選擇使用 GraphQL 或 REST。

---

## 核心原則

**不刪除 REST 代碼，只在現有 Hook 中增加 GraphQL 路徑。**

```
修改前:  Component → useQuery → frontendBlogApi.getCategories() → REST
修改後:  Component → useQuery → graphqlApi.getCategories()    → GraphQL
                                frontendBlogApi.getCategories() → REST (仍可用)
```

---

## 5.1 新增 GraphQL 查詢定義

新建 `apps/frontend-blog/src/lib/api/graphql/queries.ts`：

```typescript
import { gql } from '@/lib/api/apollo-client';

// ─── Category 查詢 ──────────────────────────────────

export const GET_CATEGORIES = gql`
  query GetCategories($locale: String!) {
    categories(locale: $locale) {
      id
      name
      slug
      description
      coverImage
      articleCount
    }
  }
`;

export const GET_CATEGORY_BY_SLUG = gql`
  query GetCategoryBySlug(
    $slug: String!
    $page: Int
    $pageSize: Int
    $locale: String!
  ) {
    categoryBySlug(slug: $slug, page: $page, pageSize: $pageSize, locale: $locale) {
      id
      name
      slug
      description
      coverImage
      articleCount
      articles {
        items {
          id
          title
          slug
          excerpt
          coverImage
          publishedAt
        }
        total
        page
        pageSize
        totalPages
      }
    }
  }
`;
```

**對應的後端 Resolver**（已在 [Step 2](06-backend-resolver-structure.md) 定義）：

| GraphQL Query | Resolver 方法 | 調用的 Service |
|--------------|--------------|---------------|
| `categories(locale: String!)` | `CategoryResolver.getCategories()` | `FrontendBlogService.getFrontendCategories()` |
| `categoryBySlug(slug, page, pageSize, locale)` | `CategoryResolver.getCategoryBySlug()` | `FrontendBlogService.getFrontendCategoryBySlug()` |

---

## 5.2 新增 GraphQL API 封裝

新建 `apps/frontend-blog/src/lib/api/graphql/categoryApi.ts`：

```typescript
import { createApolloClient } from '@/lib/api/apollo-client';
import { GET_CATEGORIES, GET_CATEGORY_BY_SLUG } from './queries';
import type { FrontendCategory, FrontendCategoryWithArticles } from '@/lib/types/frontend-blog';

export const categoryGraphqlApi = {
  getCategories: async (locale: string): Promise<FrontendCategory[]> => {
    const client = createApolloClient();
    const { data } = await client.query<{ categories: FrontendCategory[] }>({
      query: GET_CATEGORIES,
      variables: { locale },
    });
    return data.categories;
  },

  getCategoryBySlug: async (
    slug: string,
    params?: { page?: number; pageSize?: number; locale?: string },
  ): Promise<FrontendCategoryWithArticles | null> => {
    const client = createApolloClient();
    const { data } = await client.query<{
      categoryBySlug: FrontendCategoryWithArticles | null;
    }>({
      query: GET_CATEGORY_BY_SLUG,
      variables: {
        slug,
        page: params?.page ?? 1,
        pageSize: params?.pageSize ?? 10,
        locale: params?.locale ?? 'zh',
      },
    });
    return data.categoryBySlug;
  },
};
```

---

## 5.3 修改 `useFrontendCategories` Hook

在 [`apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) 中，**不刪除任何代碼**，只添加一個可選的 `useGraphql` 參數：

```typescript
// 在文件頂部新增導入
import { categoryGraphqlApi } from '@/lib/api/graphql/categoryApi';

// 修改後的 Hook（只添加 useGraphql 參數，其他邏輯不變）
export function useFrontendCategories(
  initialData?: FrontendCategory[],
  useGraphql?: boolean,  // ← 新增：可選切換 GraphQL
) {
  const locale = useCurrentLocale();

  return useQuery({
    queryKey: ['frontendCategories', locale, useGraphql ? 'graphql' : 'rest'],
    queryFn: async () => {
      if (useGraphql) {
        // ─── GraphQL 路徑 ─────────────────────────
        // 直接返回 GraphQL 查詢結果
        // IndexedDB 緩存保持不變，由 REST 路徑負責寫入
        return categoryGraphqlApi.getCategories(locale);
      }

      // ─── 現有 REST 路徑（完全不變） ──────────────
      const networkPromise = frontendBlogApi.getCategories(locale);

      networkPromise
        .then((data) => {
          if (data?.length) {
            syncCategories(data, locale);
          }
        })
        .catch(() => {});

      const cached = await getCachedCategories(locale);

      if (cached.length > 0) {
        return cached;
      }

      return networkPromise;
    },
    staleTime: 60 * 60 * 1000,
    networkMode: 'offlineFirst',
    initialData,
  });
}
```

**關鍵點**：
1. `queryKey` 增加了 `'graphql'` / `'rest'` 區分，避免緩存衝突
2. GraphQL 路徑**不寫入 IndexedDB**（保持 REST 路徑的 IndexedDB 寫入邏輯）
3. `useGraphql` 默認為 `false` / `undefined`，現有調用完全不受影響

---

## 5.4 在組件中使用

在 [`apps/frontend-blog/src/app/[locale]/page.client.tsx`](apps/frontend-blog/src/app/[locale]/page.client.tsx) 中，傳入 `useGraphql: true`：

```typescript
// 修改前
const { data: categories } = useFrontendCategories(initialCategories);

// 修改後
const { data: categories } = useFrontendCategories(initialCategories, true);
//                                          傳入 useGraphql = true ↑↑↑
```

---

## 修改文件總結

| 文件 | 操作 | 行數變化 |
|------|------|---------|
| `src/lib/api/graphql/queries.ts` | **新增** | ~35 行 |
| `src/lib/api/graphql/categoryApi.ts` | **新增** | ~35 行 |
| `src/lib/hooks/useFrontendArticles.ts` | **修改** | +~15 行 |
| `src/app/[locale]/page.client.tsx` | **修改** | 改 1 行 |

---

## 下一步

Hook 修改完成後 → [Step 6：前端修改 Categories 頁面 SSR](10-frontend-modify-categories-ssr.md)
