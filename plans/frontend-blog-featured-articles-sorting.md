# Frontend Blog: Featured Article Sorting Fix

## Problem

The admin blog correctly shows featured articles at the top after the backend `orderBy` change in [`blog.service.ts`](../apps/api/src/blog/blog.service.ts:777). However, the **frontend blog** (public-facing) still does not show featured articles pinned to the top.

## Root Cause Analysis

The [`getArticles`](../apps/api/src/blog/blog.service.ts:777) now sorts by `[{ featured: 'desc' }, { createdAt: 'desc' }]`, which is called by both admin and frontend blog paths. However, the frontend blog has **three issues**:

### Issue 1: Backend doesn't expose `featured` field to frontend
The [`mapArticleForFrontend`](../apps/api/src/blog/frontend/frontend-blog.service.ts:324-342) method maps articles for the public API but **omits** the `featured` field. The frontend never knows which articles are featured.

### Issue 2: Frontend type missing `featured` field
The [`FrontendArticle`](../apps/frontend-blog/src/lib/types/frontend-blog.ts:31-61) TypeScript interface doesn't have a `featured` property.

### Issue 3: No client-side sorting
The [`displayArticles`](../apps/frontend-blog/src/app/[locale]/page.client.tsx:395-400) renders articles in whatever order they arrive from API/IndexedDB cache, without any client-side sorting.

### Caching layers exacerbating the issue
Even if the backend returns correctly sorted data, three caching layers prevent the frontend from seeing it:
1. **NestJS server cache**: [`@CacheTTL(300)`](../apps/api/src/blog/frontend/frontend-blog.controller.ts:36) — 5-minute server-side cache
2. **TanStack Query cache**: [`staleTime: 5 * 60 * 1000`](../apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts:93) — 5-minute client cache
3. **IndexedDB local-first strategy**: [`getCachedArticles()`](../apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts:77) reads from IndexedDB before network

## Solution: 3 Changes (Most Robust Approach)

### Change 1: Backend — Expose `featured` in frontend response
**File:** [`frontend-blog.service.ts`](../apps/api/src/blog/frontend/frontend-blog.service.ts:331-342)

Add `featured: article.featured ?? false` to the `mapArticleForFrontend` result object.

```diff
 const result: any = {
   id: article.id,
   slug: article.slug,
+  featured: article.featured ?? false,
   title: this.getLocalizedString(article, 'title', locale),
```

### Change 2: Frontend — Add `featured` to type
**File:** [`frontend-blog.ts`](../apps/frontend-blog/src/lib/types/frontend-blog.ts:31-61)

Add `featured?: boolean` to the `FrontendArticle` interface (optional to handle cached data without the field).

```diff
 export interface FrontendArticle {
   id: string;
   slug: string;
+  featured?: boolean;
   title: string;
```

### Change 3: Frontend — Client-side sorting
**File:** [`page.client.tsx`](../apps/frontend-blog/src/app/[locale]/page.client.tsx:395-400)

Sort `displayArticles` so articles with `featured: true` appear first. This is the **most important fix** — it works regardless of cache state.

```diff
 const displayArticles: FrontendArticle[] =
   allArticles.length > 0
-    ? allArticles
+    ? [...allArticles].sort((a, b) => {
+        const aFeatured = a.featured ?? false;
+        const bFeatured = b.featured ?? false;
+        return (bFeatured ? 1 : 0) - (aFeatured ? 1 : 0);
+      })
     : isInitialCategory && !isBackNavigation
       ? initialData?.items || []
       : [];
```

## Verification

After implementing, restart the API dev server to clear the NestJS cache:

```bash
# Stop the API dev process, then:
cd /Volumes/MySSD/work/JoyMini_Nest_Monorepo && yarn workspace @lucky/api dev
```

Then hard-refresh the frontend blog page to clear IndexedDB caches.
