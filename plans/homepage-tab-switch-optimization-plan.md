# Homepage Tab Switch Optimization Plan

## Problem Analysis

### Issue 1: First-time tab switch shows empty state + loading spinner ("skeleton")

**Root Cause**: In [`page.client.tsx`](../apps/frontend-blog/src/app/[locale]/page.client.tsx:95-99), `handleCategoryChange` immediately clears `allArticles = []` before the new query data arrives:

```typescript
const handleCategoryChange = useCallback((categoryId?: string) => {
    setSelectedCategoryId(categoryId);
    setPage(1);
    setAllArticles([]);    // ← This clears the grid immediately
}, []);
```

Since the new category's query key (`['homeArticles', locale, { categoryId: 'xyz' }]`) has never been fetched, React Query transitions to a loading state with `data = undefined`. The component then shows the empty state (line 238-258) + a loading spinner overlay (line 162-185), creating a flash of emptiness.

**Relevant code path**:
1. Tab clicked → `handleCategoryChange('xyz')`
2. `allArticles = []`, `selectedCategoryId = 'xyz'`, `page = 1`
3. Query key changes → `isLoading = true`, `data = undefined`
4. `articles = []` (from undefined data)
5. Conditional at line 118: `isLoading && !hasInitialData && !hasCurrentData` → **false** (hasInitialData is still true from SSR)
6. So no skeleton, but the empty state renders at line 238

### Issue 2: Switching back causes images to re-render from placeholder, but text stays

**Root Cause**: When switching back to "All" (or any previously-visited tab):

1. `handleCategoryChange(undefined)` fires → `setAllArticles([])` → **all ArticleCard components unmount**
2. React Query returns cached data synchronously (same render tick)
3. `useEffect` fires → `setAllArticles(articles)` → cards remount with same `key={article.id}`
4. **But they're NEW component instances**, so internal state is reset:
   - [`BlurhashImage`](../apps/frontend-blog/src/components/blog/BlurhashImage.tsx:63-65): `isLoaded = false`, `placeholderUrl = ''`
   - Blurhash placeholder decodes and renders
   - Next.js `<Image>`'s `onLoad` fires → `isLoaded = true` → opacity transition from 0 to 1

Text doesn't "re-render" because:
- Text content (title, excerpt) comes from props → immediately available from cache → renders instantly on mount
- No internal state needed for text rendering

Images show the full lifecycle because:
- `BlurhashImage` has **internal loading state** that resets on unmount/remount
- Even though the image URL is the same and the browser has it cached, the component doesn't know that
- It must wait for the `onLoad` event > set `isLoaded = true` > opacity transition

---

## Optimization Plan

### Optimization 1: Add `placeholderData: keepPreviousData`

**File**: [`apps/frontend-blog/src/app/[locale]/page.client.tsx`](../apps/frontend-blog/src/app/[locale]/page.client.tsx:47-61)

**Change**: Add `placeholderData: keepPreviousData` to the `useQuery` call.

**Effect**: When the category changes to an uncached query key, React Query keeps the previous page's data as placeholder. The old articles remain visible while the new query loads, eliminating the empty state flash.

```typescript
import { keepPreviousData } from '@tanstack/react-query';

const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: useLocalizedQueryKey('homeArticles', {
        page,
        pageSize: PAGE_SIZE,
        categoryId: selectedCategoryId,
    }),
    queryFn: () => frontendBlogApi.getArticles({...}),
    placeholderData: keepPreviousData,  // ← ADD THIS
    staleTime: 5 * 60 * 1000,
});
```

### Optimization 2: Remove `setAllArticles([])` from `handleCategoryChange`

**File**: [`apps/frontend-blog/src/app/[locale]/page.client.tsx`](../apps/frontend-blog/src/app/[locale]/page.client.tsx:95-99)

**Change**: Remove `setAllArticles([])` from the category change handler. Let the `useEffect` manage article list transitions based on the actual fetched data.

```typescript
const handleCategoryChange = useCallback((categoryId?: string) => {
    setSelectedCategoryId(categoryId);
    setPage(1);
    // Do NOT clear allArticles here — let useeffect + keepPreviousData handle it
}, []);
```

**Effect**: When switching back to a cached tab:
1. Cards are NOT unmounted (allArticles stays the same during the render where query params change)
2. React Query returns cached data synchronously
3. The `useEffect` fires and sees `prevCategoryRef.current !== selectedCategoryId`
4. `setAllArticles(articles)` → but since `articles` contains the same data with same IDs, React reconciles in-place
5. **BlurhashImage components maintain their mounted state** → `isLoaded` stays `true` → **no placeholder flash**

### Optimization 3 (Bonus): Add CSS `content-visibility` for offscreen cards

**File**: [`apps/frontend-blog/src/components/blog/ArticleCard.tsx`](../apps/frontend-blog/src/components/blog/ArticleCard.tsx:112-113)

**Change**: Add `content-visibility: auto` to the card container to improve rendering performance for offscreen articles.

```tsx
<div className="group relative bg-white dark:bg-slate-900 rounded-lg ..."
     style={{ contentVisibility: 'auto' }}>
```

**Note**: This is a minor optimization; the main improvements come from Optimizations 1 and 2.

---

## Flow Comparison

### Before (Current Behavior)

```
User clicks "All" tab (switching back)
  │
  ├─ handleCategoryChange(undefined)
  │   ├─ setAllArticles([])           ← Cards unmount, BlurhashImage state lost
  │   ├─ setSelectedCategoryId(undefined)
  │   └─ setPage(1)
  │
  ├─ Render: allArticles=[], empty state shown
  │
  ├─ useEffect fires: articles from cache available
  │   └─ setAllArticles(articles)     ← Cards remount
  │       └─ BlurhashImage: isLoaded=false → decode blurhash → show placeholder
  │           └─ onLoad fires → isLoaded=true → opacity transition
  │
  └─ Result: text instant, images flash from placeholder
```

### After (Optimized Behavior)

```
User clicks "All" tab (switching back)
  │
  ├─ handleCategoryChange(undefined)
  │   ├─ setSelectedCategoryId(undefined)   ← No allArticles clearing
  │   └─ setPage(1)
  │
  ├─ React Query: cached data returned as placeholderData (synchronous)
  │
  ├─ useEffect fires: articles from cache
  │   └─ setAllArticles(articles)     ← React reconciles in-place
  │       └─ Same keys → same DOM nodes → BlurhashImage keeps isLoaded=true
  │
  └─ Result: text instant, images stay loaded, no flash
```

---

## Files to Modify

| File | Change |
|------|--------|
| [`apps/frontend-blog/src/app/[locale]/page.client.tsx`](../apps/frontend-blog/src/app/[locale]/page.client.tsx) | Add `keepPreviousData` import + `placeholderData` option |
| [`apps/frontend-blog/src/app/[locale]/page.client.tsx`](../apps/frontend-blog/src/app/[locale]/page.client.tsx) | Remove `setAllArticles([])` from `handleCategoryChange` |
| [`apps/frontend-blog/src/components/blog/ArticleCard.tsx`](../apps/frontend-blog/src/components/blog/ArticleCard.tsx) | (Optional) Add `content-visibility: auto` |
