# Step 6：前端修改 Categories 頁面 SSR

> 修改 [`apps/frontend-blog/src/app/[locale]/page.tsx`](apps/frontend-blog/src/app/[locale]/page.tsx) 中的 SSR 數據預取，使用 `serverFetchGraphql` 替代 `serverGet` 獲取分類。

---

## 核心原則

**REST 的 SSR 路徑完全保留，只增加 GraphQL 路徑。通過配置或環境變量切換。**

```
修改前:  serverGet /v1/frontend/blog/categories → REST
修改後:  serverFetchGraphql { categories(locale) } → GraphQL (可切換)
         serverGet /v1/frontend/blog/categories → REST (仍可用)
```

---

## 6.1 新增 SSR GraphQL 查詢

在 [`apps/frontend-blog/src/lib/api/graphql/queries.ts`](apps/frontend-blog/src/lib/api/graphql/queries.ts) 中添加 SSR 專用查詢：

```typescript
// ─── SSR 專用查詢（只請求需要的字段，減少傳輸量） ──

export const GET_CATEGORIES_SSR = gql`
  query GetCategoriesSsr($locale: String!) {
    categories(locale: $locale) {
      id
      name
      slug
    }
  }
`;
```

**為什麼要 SSR 專用查詢？**
- 首頁的 `CategoryFilter` 只需要 `id`、`name`、`slug` 三個字段
- SSR 請求越小，HTML 生成越快，TTFB 越低
- GraphQL 的優勢就在於「只請求需要的字段」

---

## 6.2 修改 `page.tsx`

在 [`apps/frontend-blog/src/app/[locale]/page.tsx`](apps/frontend-blog/src/app/[locale]/page.tsx:56) 中：

```typescript
// 新增導入
import { serverFetchGraphql } from '@/lib/api/apollo-client';
import { GET_CATEGORIES_SSR } from '@/lib/api/graphql/queries';

export default async function HomePage({ params, searchParams }) {
  const { locale: routeLocale } = await params;
  const urlSearchParams = await searchParams;
  const locale = routeLocale;
  const categoryId = typeof urlSearchParams.category === 'string'
    ? urlSearchParams.category
    : undefined;

  try {
    const [initialData, initialCategories] = await Promise.all([
      // ─── Articles：仍使用 REST ───────────────
      // （Articles 的 GraphQL 遷移在 Phase 2）
      serverGet<FrontendPaginatedResponse<FrontendArticle>>(
        '/v1/frontend/blog/articles',
        { lang: locale, page: 1, pageSize: 10, categoryId },
      ),

      // ─── Categories：改為 GraphQL ────────────
      serverFetchGraphql<{ categories: FrontendCategory[] }>(
        GET_CATEGORIES_SSR,
        { locale },
      )
        .then((data) => data.categories)
        .catch(() => [] as FrontendCategory[]),
    ]);

    // ... 其餘代碼不變
```

---

## 6.3 Server Component 數據流對比

```
REST SSR:
  page.tsx → serverGet('/v1/frontend/blog/categories') → axios → Controller → Service → Prisma → JSON
                                                                 ↓
GraphQL SSR:
  page.tsx → serverFetchGraphql(GET_CATEGORIES_SSR) → native fetch → Resolver → Service → Prisma → JSON
                               ↑                                    ↑
                         共用同一套 Service，同一套 Prisma 查詢
```

---

## 6.4 SSR 預取 + CSR Hook 的配合

```
SSR（Server Component）:
  serverFetchGraphql(GET_CATEGORIES_SSR, { locale })
  → 返回 { id, name, slug } 給 CategoryFilter
  → 作為 initialData 傳給 Client Component

CSR（Client Component）:
  useFrontendCategories(initialCategories, true)
  → 使用 useGraphql = true
  → React Query 先使用 initialData 渲染
  → 然後用 Apollo Client 查詢完整數據（含 description, coverImage, articleCount）
  → 更新緩存
```

---

## 修改文件總結

| 文件 | 操作 | 說明 |
|------|------|------|
| `src/lib/api/graphql/queries.ts` | **修改** | 添加 `GET_CATEGORIES_SSR` |
| `src/app/[locale]/page.tsx` | **修改** | 替換 `serverGet` → `serverFetchGraphql` |

---

## 下一步

SSR 修改完成後 → [Step 7：驗證 REST + GraphQL 共存](11-verify-rest-graphql-coexistence.md)
