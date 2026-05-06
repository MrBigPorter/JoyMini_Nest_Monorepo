# Fix: OOM in `detectIncompleteTranslations` Endpoint

## Problem

Calling `GET /api/v1/admin/blog/translation/detect-incomplete?lang=en` causes Node.js heap OOM crash on production (1GB VPS).

**Root Cause**: [`detectIncompleteTranslations()`](apps/api/src/blog/blog.service.ts:3213) uses `prisma.blogArticle.findMany()` without pagination, loading ALL non-draft articles with redundant large text fields simultaneously. This exceeds the 256MB `--max-old-space-size` limit configured in [`compose.prod.yml:41`](compose.prod.yml:41).

**Memory Waste**: The query selects both `content` (rendered HTML) AND `contentMd` (raw Markdown), plus both `contentLocalized` AND `contentMdLocalized` (each contains 6 languages). That's **14 copies** of each article's content in memory.

---

## Fix Plan

### 1. Paginate the Article Query (Primary Fix)

Replace the single `findMany()` with a cursor-based pagination loop, processing articles in batches of e.g. **10** per iteration. After each batch, intermediate results are freed by V8's GC when the loop iteration scope ends.

**Current code** (line 3214-3231):
```typescript
const articles = await this.prisma.blogArticle.findMany({
  where: { status: { not: 'DRAFT' } },
  select: { /* 11 fields including redundant ones */ },
});

for (const article of articles) { /* process all */ }
```

**New approach**:
```typescript
const BATCH_SIZE = 10;
let cursor: string | null = null;
let hasMore = true;
const incompleteArticles = [];
let totalProcessed = 0;

while (hasMore) {
  const batch = await this.prisma.blogArticle.findMany({
    where: { status: { not: 'DRAFT' } },
    select: { /* optimized field list */ },
    take: BATCH_SIZE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { id: 'asc' },
  });

  if (batch.length === 0) { hasMore = false; break; }

  for (const article of batch) {
    // ... quality detection logic (unchanged) ...
  }

  totalProcessed += batch.length;
  cursor = batch[batch.length - 1].id;
  hasMore = batch.length === BATCH_SIZE;
}
```

### 2. Reduce Redundant Selected Fields

Remove these fields that are unnecessary for quality detection:

| Current Field | Keep? | Reason |
|---|---|---|
| `id` | ✅ Yes | Required for identification |
| `slug` | ✅ Yes | Required |
| `title` | ✅ Yes | Fallback for missing localized |
| `titleLocalized` | ✅ Yes | Primary source for translated title |
| `content` | ❌ **Remove** | HTML rendered content — not needed for text analysis |
| `contentLocalized` | ❌ **Remove** | HTML translated content — not needed for Markdown analysis |
| `contentMd` | ✅ Yes | Raw Markdown source — what we analyze |
| `contentMdLocalized` | ✅ Yes | Translated Markdown — what we compare against |
| `excerpt` | ✅ Yes | For completeness |
| `excerptLocalized` | ✅ Yes | For completeness |
| `translationStatus` | ✅ Yes | For status reference |

**Removing `content` and `contentLocalized` alone cuts per-article memory by ~60%** (eliminates 12 copies of rendered HTML: 2 formats × 6 languages).

### 3. Also Fix `retranslateIncompleteArticles`

[`retranslateIncompleteArticles()`](apps/api/src/blog/blog.service.ts:3318) calls `detectIncompleteTranslations()` internally, so fixing the parent method automatically fixes this one too. No separate changes needed.

### 4. No API Contract Change

The return type remains exactly the same:
```typescript
{
  total: number;
  incompleteCount: number;
  completionRate: string;
  incompleteArticles: Array<{...}>;
}
```

### 5. Secondary: Bump Memory Limit (Optional)

As a safety net, consider increasing `--max-old-space-size` from 256MB to **384MB** in [`compose.prod.yml:41`](compose.prod.yml:41), and the Docker `memory: 300M` limit to `memory: 400M` in [`compose.prod.yml:46`](compose.prod.yml:46). This gives headroom for other concurrent operations.

---

## Files to Modify

| File | Change |
|---|---|
| [`apps/api/src/blog/blog.service.ts`](apps/api/src/blog/blog.service.ts) | Rewrite `detectIncompleteTranslations()` with pagination loop + reduce selected fields |
| [`compose.prod.yml`](compose.prod.yml) | Optional: increase memory limits (lines 41, 46) |

## Files NOT to Modify

| File | Reason |
|---|---|
| [`apps/api/src/blog/blog.controller.ts`](apps/api/src/blog/blog.controller.ts) | API endpoint contract unchanged |
| `BlogTranslationQualityDetection.tsx` (frontend) | No API response format change |
