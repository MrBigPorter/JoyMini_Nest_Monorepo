# Fix: Admin Article Preview Shows Raw Markdown Strings

## Bug Report

> "上传后的文章有问题啊，预览全部是字符串"

## Root Cause Analysis

### Database Schema Design

Prisma schema has two content fields:
- `content` / `contentLocalized` — stores **HTML** (from WYSIWYG editor)
- `contentMd` / `contentMdLocalized` — stores **Markdown** (source format)

### The Problem

**[`batchImportArticles()`](apps/api/src/blog/blog.service.ts:297)** stores markdown content into the **wrong field**:

```typescript
// Current (WRONG): puts markdown into 'content' field
...this.buildLocalizedData({ zh: item.content }, 'content'),
```

This should be:
1. `renderMarkdown(item.content)` → HTML → store in `content`/`contentLocalized`
2. Raw `item.content` → markdown → store in `contentMd`/`contentMdLocalized`

### Why Old Articles Work

Old articles are created via the **RichTextEditor** (ReactQuill WYIWYG), which produces **HTML** (e.g. `<h2>Title</h2><p>text</p>`). This HTML is stored in `content`/`contentLocalized`, and `dangerouslySetInnerHTML` renders it correctly.

### Data Flow Comparison

```
Old Article (via editor):
  RichTextEditor → HTML → createArticle() → buildLocalizedData(html, 'content') → content = HTML ✓
  → GET /admin/blog/articles/slug/:slug → mapArticleToLocalized() → content = HTML
  → dangerouslySetInnerHTML → renders correctly ✓

Imported Article (via batch import):
  Markdown file → parseFrontmatter() → batchImportArticles() → buildLocalizedData(md, 'content') → content = Markdown ✗
  → GET /admin/blog/articles/slug/:slug → mapArticleToLocalized() → content = Markdown
  → dangerouslySetInnerHTML → shows raw text ✗
```

### Frontend Blog Handles Both

[`mapArticleForFrontend()`](apps/api/src/blog/frontend/frontend-blog.service.ts:351-352) returns BOTH:
```typescript
result.content = this.getLocalizedString(article, 'content', locale);   // HTML
result.contentMd = this.getLocalizedString(article, 'contentMd', locale); // Markdown
```

The frontend [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:11) uses `ReactMarkdown` which can render both HTML and markdown, so it works regardless.

## Fix: Backend `batchImportArticles()` Only

### File to Modify

**`apps/api/src/blog/blog.service.ts`** — `batchImportArticles()` method (lines 297-405)

### Changes

In both the **create** branch (line 357-374) and **update** branch (line 316-328) of `batchImportArticles()`, replace:

```typescript
// Current (line 322, 368):
...this.buildLocalizedData({ zh: item.content }, 'content'),

// With:
...this.buildLocalizedData(
  { zh: this.renderMarkdown(item.content) },
  'content',
),
...this.buildLocalizedData(
  { zh: item.content },
  'contentMd',
),
```

The same change in both branches:
- **Create branch** (line ~368): Store rendered HTML in `content`, raw markdown in `contentMd`
- **Update branch** (line ~322): Same for updates

### Why This Fix Works

| Concern | Impact |
|---------|--------|
| Admin preview (`dangerouslySetInnerHTML`) | Now gets HTML → renders correctly ✓ |
| Frontend blog (`ReactMarkdown`) | Gets HTML from `content` field → `ReactMarkdown` handles HTML fine ✓ |
| Frontend blog markdown access | `contentMd` field now populated → available if needed ✓ |
| Schema consistency | Now matches design: `content`=HTML, `contentMd`=markdown ✓ |
| No new dependencies | `renderMarkdown()` already exists (line 55) ✓ |
| No frontend changes | No packages to install, no UI changes ✓ |

### Edge Cases

| Case | Handling |
|------|----------|
| `item.content` is empty | `renderMarkdown('')` returns `''` — `buildLocalizedData` returns `{}` for null/undefined, empty string gets wrapped normally |
| Content has HTML mixed in markdown | `marked.parse()` handles both |
| Null/undefined content | `renderMarkdown()` already handles null/undefined (returns `''`) |
| Already imported articles (existing data) | Won't be retroactively fixed; only new imports will work correctly. If needed, run a one-time migration script |
