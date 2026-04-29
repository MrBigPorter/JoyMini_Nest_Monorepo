# Fix: Editing Imported Articles Crashes with Prisma "Expected N records to be connected, found only 0"

## Root Cause

The articles list in [`page.tsx:510-516`](../apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx:510) transforms tag objects `[{id, name}, ...]` into **localized name strings** `["Tag1", "Tag2", ...]` for display in the SmartTable.

When the user clicks "Edit", [`handleEditArticle()`](../apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx:215) passes the full article (with string tags) to `BlogArticleModal`.

In [`BlogArticleModal.tsx:328-336`](../apps/admin-blog/src/views/blog/BlogArticleModal.tsx:328), `fetchAndInit` processes tags:
- Since they're strings (not `{id}` objects), the map function returns them **as-is**
- So `tagIds` becomes `["Tag1", "Tag2", ...]` — tag **names**, not database **IDs**

When the user saves, [`blog.service.ts:642`](../apps/api/src/blog/blog.service.ts:642) in `updateArticle()` does:
```typescript
set: dto.tagIds.map((id) => ({ id }))
```
Prisma tries to find tags by `id = "Tag1"` which fails → `Expected 5 records to be connected, found only 0`.

## Fix: 2 files to modify

### File 1: `apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx`

**1a. Add `tagIds` to the `Article` type** (line 49):
```typescript
tags?: string[];
tagIds?: string[];  // NEW: preserve original tag DB IDs
```

**1b. Preserve tag IDs in the list transformation** (lines 500-518):

Add `tagIds` alongside the existing `tags` transformation:
```typescript
const transformedList = (response.list || []).map(
  (article: Article) => ({
    ...article,
    views: article.viewCount || 0,
    comments: article.commentCount || 0,
    readTime: article.readTime || '5 min',
    // Preserve original tag DB IDs for the edit modal
    tagIds: (article.tags || [])
      .map((tag: any) =>
        typeof tag === 'object' && tag !== null && 'id' in tag
          ? tag.id
          : tag,
      )
      .filter(Boolean),
    // Display-friendly string tags
    tags: (article.tags || [])
      .map((tag: string | { name?: any; id?: string }) =>
        typeof tag === 'string'
          ? tag
          : renderLocalizedText(tag.name, lang, tag.id || ''),
      )
      .filter(Boolean),
  }),
);
```

### File 2: No changes needed in `BlogArticleModal.tsx`

The [`fetchAndInit`](../apps/admin-blog/src/views/blog/BlogArticleModal.tsx:328) already handles `tagIds`:
```typescript
tagIds: Array.isArray(mappedArticle?.tagIds)
  ? mappedArticle.tagIds.map((t: any) =>
      typeof t === 'object' && t !== null && 'id' in t ? t.id : t,
    )
  : ...
```

Since we now pass `tagIds` as `["abc123", "def456", ...]` from the list, the modal will find `mappedArticle.tagIds` and use the actual DB IDs. The `map` function will return them as-is (since they're strings, not objects).

## Verification

1. Run `yarn workspace @lucky/admin-blog tsc --noEmit` — type check
2. Open an imported article in the edit modal, verify tags load correctly
3. Save the article — should succeed instead of throwing 500
