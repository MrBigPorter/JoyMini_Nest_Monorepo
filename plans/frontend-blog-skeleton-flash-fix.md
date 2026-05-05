# Frontend Blog Skeleton Flash Fix — Root Cause Resolution

## Problem

A hydration mismatch error occurred on the blog homepage where the **server** rendered `ArticleListSkeleton` (grid layout) but the **client** rendered the empty state ("暂无文章") during hydration. This caused Next.js to throw a hydration error and could produce a visible UI flash.

## Root Cause

The component rendered based on **context state** (`allArticles` from `HomePageStateProvider`) which starts empty (`[]`) on both server and client. SSR data existed in the `initialData` prop, but was only used by React Query — not directly in rendering. The skeleton detection logic tried to "bridge the gap" with conditional expressions (`isFetching`, `hasInitialData`, `isBackNavigation`), but any subtle timing difference in React Query behavior between SSR and client first frame caused a mismatch.

The core issue: **rendering from context + guessing the right UI state**, instead of directly using the SSR prop data that's guaranteed to be consistent across server and client.

## Fix: SSR-First Rendering

Instead of complex skeleton detection logic, use SSR `initialData` directly in rendering as a fallback when context is empty:

```typescript
const displayArticles: FrontendArticle[] = allArticles.length > 0
  ? allArticles                                    // Context populated (Load More, backward nav)
  : (isInitialCategory && !isBackNavigation 
      ? (initialData?.items || [])                 // SSR data as fallback
      : []);                                       // Category switch, no data yet
```

**Why this works:**
- **SSR:** `allArticles` is `[]`, `isInitialCategory=true`, `isBackNavigation=false` → `displayArticles = initialData.items` → server renders actual articles (not skeleton)
- **Client first frame:** Same conditions → same `displayArticles` → identical output → **hydration match**
- **After hydration:** The `useEffect` seeds context with `initialData.items` → `allArticles` populated → `displayArticles = allArticles` (same data, no flash)
- **Backward navigation:** `allArticles.length > 0` → `displayArticles = allArticles` → shows accumulated data immediately
- **Category switch:** `isInitialCategory=false` → `displayArticles = []` → falls through to skeleton/empty

### Changes Made

**File:** [`apps/frontend-blog/src/app/[locale]/page.client.tsx`](apps/frontend-blog/src/app/[locale]/page.client.tsx)

1. **Replaced the over-engineered skeleton detection logic** (removed `hasInitialData`, `hasCurrentData`, complex `showSkeleton`) with a single `displayArticles` computed value
2. **Simplified `showSkeleton`** to `isFetching && displayArticles.length === 0` — only shows when data is loading and nothing to display
3. **Simplified early returns** — full-page skeleton when `displayArticles.length === 0 && isFetching`, error when `error && displayArticles.length === 0`
4. **Replaced `allArticles` with `displayArticles`** in all rendering code (JSX, bookmark IDs)

### Edge Cases Verified

| Scenario | SSR | Client first frame | After hydration |
|----------|-----|-------------------|-----------------|
| Fresh page load (with data) | Articles from `initialData` | Articles from `initialData` | Articles from context (same) |
| Fresh page load (no data, error) | `displayArticles=[]`, `isFetching=true` | Same → full skeleton | Error state |
| Category switch | N/A (client-only) | N/A | `displayArticles=[]`, `isFetching=true` → skeleton |
| Backward navigation (article → home) | N/A (context preserved) | `displayArticles=allArticles` | Articles from context |
| Load More | N/A | N/A | `displayArticles=allArticles` (with accumulated data) |
