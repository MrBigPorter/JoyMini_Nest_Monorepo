# Fix: Remove `?page=N` from URL + Dedup Protection

## Problem

Refreshing page at `?page=3` causes duplicate article keys because:
1. SSR always fetches page 1 ([`page.tsx:42`](../apps/frontend-blog/src/app/[locale]/page.tsx:42))
2. The seed effect wrongly restores `page` from URL, causing `allArticles` to seed page 1 data then append page 1 data again

## Decision

**Remove `?page=N` from URL entirely.** On refresh, always show page 1. The KeepAlive context preserves page state across SPA navigation (`router.back()`, link clicks), so pagination is maintained during normal use. Refresh is the only case that resets to page 1.

## Changes

### Change 1: Remove `?page=N` read from seed effect

[`page.client.tsx:94-112`](../apps/frontend-blog/src/app/[locale]/page.client.tsx:94-112)

Remove the logic that reads `?page` from URL and sets context page:

```diff
  useEffect(() => {
    if (initialSeedDone.current) return;
    initialSeedDone.current = true;

    if (allArticles.length === 0 && initialData?.items?.length) {
      setAllArticles(initialData.items);
    }
-
-   if (page === 1) {
-     const p = searchParams.get('page');
-     if (p) {
-       setPage(Math.max(1, Number(p)));
-     }
-   }
  }, []);
```

### Change 2: Remove `?page=N` write from URL sync effect

[`page.client.tsx:122-144`](../apps/frontend-blog/src/app/[locale]/page.client.tsx:122-144)

Remove the `page` sync logic from the URL sync effect. Keep `category` sync:

```diff
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (selectedCategoryId) {
      params.set('category', selectedCategoryId);
    } else {
      params.delete('category');
    }
-
-   if (page > 1) {
-     params.set('page', String(page));
-   } else {
-     params.delete('page');
-   }

    const newSearch = params.toString();
    const currentSearch = searchParams.toString();

    if (newSearch !== currentSearch) {
      router.replace(`?${newSearch}`, { scroll: false });
    }
  }, [selectedCategoryId, page, searchParams, router]);
```

### Change 3: Add defensive dedup in accumulation effect

[`page.client.tsx:186-196`](../apps/frontend-blog/src/app/[locale]/page.client.tsx:186-196)

Add ID-based deduplication in the functional updater to prevent any future regressions:

```diff
  useEffect(() => {
    if (page > 1 && prevPageRef.current !== page) {
-     setAllArticles((prev) => [...prev, ...articles]);
+     setAllArticles((prev) => {
+       const existingIds = new Set(prev.map(a => a.id));
+       const newArticles = articles.filter(a => !existingIds.has(a.id));
+       return [...prev, ...newArticles];
+     });
      prevPageRef.current = page;
    } else if (page === 1 && articles.length > 0) {
      setAllArticles(articles);
      prevPageRef.current = page;
    }
  }, [articles, page]);
```

## Files to Modify

| File | Changes |
|------|---------|
| [`apps/frontend-blog/src/app/[locale]/page.client.tsx`](../apps/frontend-blog/src/app/[locale]/page.client.tsx) | 3 changes described above |

## Note

The hydration error fix in [`PageTransition.tsx`](../apps/frontend-blog/src/components/PageTransition.tsx) was already applied in a previous step (added `initial` prop to non-animation branch).
