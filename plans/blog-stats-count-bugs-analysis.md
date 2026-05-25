# Blog Stats Count Calculation Bug Analysis

## Overview

After analyzing the blog statistics calculation code, I found several issues in how article counts, category counts, tag counts, and comment counts are computed. The main entry point is [`getBlogStats()`](apps/api/src/blog/blog.service.ts:1518) exposed via `GET /frontend/blog/stats`.

---

## Bug 1: `getBlogStats()` counts ALL categories/tags, not just those with published articles

**File:** [`apps/api/src/blog/blog.service.ts`](apps/api/src/blog/blog.service.ts:1518)

```typescript
async getBlogStats() {
  const [totalArticles, totalCategories, totalTags, totalViews, totalComments] = await Promise.all([
    this.prisma.blogArticle.count({ where: { status: ArticleStatus.PUBLISHED } }),
    this.prisma.blogCategory.count(),                         // ❌ Counts ALL
    this.prisma.blogTag.count(),                              // ❌ Counts ALL
    this.prisma.blogArticle.aggregate({ _sum: { viewCount: true } }),
    this.prisma.blogComment.count(),                          // ❌ Counts ALL
  ]);
```

| Field | Current Behavior | Expected? |
|-------|-----------------|-----------|
| `totalArticles` | ✅ Only PUBLISHED | Correct |
| `totalCategories` | ❌ ALL categories (including empty ones with 0 articles) | Should only count categories that have ≥1 published article? |
| `totalTags` | ❌ ALL tags (including empty ones with 0 articles) | Should only count tags that have ≥1 published article? |
| `totalComments` | ❌ ALL comments (PENDING, APPROVED, REJECTED, SPAM) | Should probably only count APPROVED comments |
| `totalViews` | ✅ `_sum` of `viewCount` | Correct |
| `weeklyPublishes` | ✅ Only PUBLISHED in last 7 days | Correct |

**Impact:** If the frontend blog stats page shows these numbers alongside each other, it's misleading to say "50 articles, 8 categories, 63 tags" when 3 of those categories and 20 of those tags have zero published articles.

---

## Bug 2: `getPopularTags()` orders by total article count but filters to PUBLISHED only

**File:** [`apps/api/src/blog/blog.service.ts:1558-1581`](apps/api/src/blog/blog.service.ts:1558)

```typescript
async getPopularTags(limit: number) {
  const tags = await this.prisma.blogTag.findMany({
    orderBy: {
      articles: { _count: 'desc' },   // ⚠️ Orders by ALL articles (DRAFT + PUBLISHED)
    },
    take: limit,
    include: {
      articles: {
        where: { status: 'PUBLISHED' }, // ✅ But only counts PUBLISHED
        select: { id: true },
      },
    },
  });
```

**The Bug:** Prisma's `orderBy: { articles: { _count: 'desc' } }` counts ALL related `BlogArticle` records regardless of status. However, the `include.articles.where` filter only returns PUBLISHED articles. This means:

- **Sort order is computed on total articles (drafts + published)**  
- **Displayed count only shows published articles**

**Example:**
| Tag | DRAFT articles | PUBLISHED articles | Rank by total | Displayed count |
|-----|---------------|-------------------|---------------|-----------------|
| Tag A | 10 | 1 | #1 | 1 ✅ but ranked wrong |
| Tag B | 0 | 5 | #2 | 5 ❌ should be #1 |

**Same bug exists in** [`TagService.getPopularTags()`](apps/api/src/blog/tag/tag.service.ts:181-204).

---

## Bug 3: `commentCount` on `BlogArticle` counts ALL comments including PENDING

**File:** [`apps/api/src/blog/blog.service.ts:1871-1874`](apps/api/src/blog/blog.service.ts:1871)

```typescript
// In createComment()
await this.prisma.blogArticle.update({
  where: { id: article.id },
  data: { commentCount: { increment: 1 } },
});
```

The `commentCount` on `BlogArticle` is incremented immediately when a comment is created, regardless of the comment's moderation status (PENDING, APPROVED, REJECTED, SPAM).

- The frontend article display (`mapArticleForFrontend` at line 342) reads `article.commentCount` directly.
- The `getArticleComments` endpoint (line 2046-2060) correctly filters to only `APPROVED` comments.
- So the displayed comment count may be higher than the actual visible approved comments.

---

## Non-Bug (confirmed correct): Category/Tag article count in list endpoints

**Files:**
- [`BlogService.getCategories()`](apps/api/src/blog/blog.service.ts:1955-1973)
- [`BlogService.getTags()`](apps/api/src/blog/blog.service.ts:1996-2015)
- [`CategoryService.getCategories()`](apps/api/src/blog/category/category.service.ts:104-148)
- [`TagService.getTags()`](apps/api/src/blog/tag/tag.service.ts:127-176)

These correctly filter by `{ where: { status: 'PUBLISHED' } }` in the `include.articles`, so the per-category/tag article counts shown in list/detail endpoints are accurate.

---

## Summary of Fixes Needed

| # | Severity | Location | Issue | Fix |
|---|----------|----------|-------|-----|
| 1 | Medium | [blog.service.ts:1518](apps/api/src/blog/blog.service.ts:1518) `getBlogStats()` counts all categories/tags | Use `_count` relation filter or raw query to count only categories/tags with published articles |
| 2 | Medium | [blog.service.ts:1518](apps/api/src/blog/blog.service.ts:1518) `getBlogStats()` counts all comments | Filter comments by `APPROVED` status |
| 3 | High | [blog.service.ts:1558](apps/api/src/blog/blog.service.ts:1558) `getPopularTags()` sort/filter mismatch | Use Prisma raw query or two-step approach: first get published counts, then sort |
| 4 | High | [tag/tag.service.ts:181](apps/api/src/blog/tag/tag.service.ts:181) `TagService.getPopularTags()` same sort/filter mismatch | Same fix as #3 |
| 5 | Low | [blog.service.ts:1871](apps/api/src/blog/blog.service.ts:1871) `commentCount` increments for all statuses | Either filter increment to only APPROVED, or compute count dynamically on read |

---

## Proposed Implementation Order

1. **Fix `getPopularTags()` in both services** (highest impact - wrong sort order)
2. **Fix `getBlogStats()` counts** (medium impact - misleading dashboard numbers)
3. **Fix `commentCount` behavior** (lowest impact - depends on product requirement)
