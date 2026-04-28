# Fix Article Preview 404 - Implementation Plan

## Problem

Clicking the "Preview" button on the blog articles listing page returns a 404. The preview link at [`articles/page.tsx:390`](<apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx>) points to `/blog/articles/${article.slug}`, but there is no `[slug]/page.tsx` route under the [`(dashboard)/blog/articles/`](<apps/admin-blog/src/app/(dashboard)/blog/articles/>) directory. Only `page.tsx` (listing) and `create/page.tsx` (create) exist.

## Root Cause

The admin-blog Next.js app has no dynamic route segment to handle individual article previews within the dashboard context. The frontend-blog has a public article page at `[locale]/articles/[slug]/page.tsx`, but that's a separate app on a different domain.

## Solution

Create a `[slug]/page.tsx` route under the existing `(dashboard)/blog/articles/` directory to render article previews within the admin dashboard layout.

### Architecture

```mermaid
flowchart LR
    A[Articles Listing] -->|Click Preview| B[/blog/articles/:slug]
    B --> C[blogApi.getArticleBySlug]
    C --> D[API: /v1/admin/blog/articles/slug/:slug]
    D --> E[Render Preview Page]
    E --> F[Back to Articles List]
```

The preview page sits within the `(dashboard)` route group, so it inherits:

- Authentication & authorization (middleware + layout guards)
- Dashboard layout (Sidebar + Header)
- Consistent styling with the rest of the admin app

### Files to Create

#### 1. `apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx`

A `'use client'` page component that:

- **Params**: Uses `useParams()` from `next/navigation` to extract `slug`
- **Locale**: Uses `useLanguage()` to get current locale for localized content fields
- **Translation**: Uses `useTranslation()` for dashboard UI text
- **Data Fetching**: Uses `useRequest` from `ahooks` to call `blogApi.getArticleBySlug(slug)`
- **States**: Handles loading (skeleton/spinner), error (retry), and not-found (empty state)
- **Preview Rendering**:
  - `PageHeader` with breadcrumbs (Content > Articles > Article Title)
  - Back link to `/blog/articles`
  - Featured image via `SmartImage` (if available)
  - Article title (localized via `getLocalizedValue`)
  - Metadata row: author, published date, category, status badge, reading time
  - Article content rendered as HTML using `dangerouslySetInnerHTML` (sanitized with `DOMPurify`)
  - Excerpt section (if available)

**Key imports** (consistent with existing patterns):

| Import                                          | Source                             | Usage                     |
| ----------------------------------------------- | ---------------------------------- | ------------------------- |
| `useParams`                                     | `next/navigation`                  | Get slug from route       |
| `useRequest`                                    | `ahooks`                           | Fetch article data        |
| `blogApi`                                       | `@/api`                            | API call                  |
| `useTranslation`                                | `@/hooks/useTranslation`           | Dashboard i18n            |
| `useLanguage`, `getLocalizedValue`              | `@/hooks/LanguageProvider`         | Locale-aware content      |
| `Card`, `Badge`                                 | `@/components/UIComponents`        | Layout components         |
| `PageHeader`                                    | `@/components/scaffold/PageHeader` | Page header + breadcrumbs |
| `SmartImage`                                    | `@/components/ui/SmartImage`       | Featured image            |
| `Button`                                        | `@repo/ui`                         | Action buttons            |
| `DOMPurify`                                     | `dompurify`                        | Sanitize HTML content     |
| `ArrowLeft`, `Eye`, `Clock`, `Calendar`, `User` | `lucide-react`                     | Icons                     |

### Files to Modify

#### 2-7. Translation Keys in All 6 Locale Files

Add `blog_articles_backToList` key to the `translations` namespace:

| File                                          | Key                        | Value                      |
| --------------------------------------------- | -------------------------- | -------------------------- |
| [`en.json`](apps/admin-blog/src/i18n/en.json) | `blog_articles_backToList` | `Back to Articles`         |
| [`zh.json`](apps/admin-blog/src/i18n/zh.json) | `blog_articles_backToList` | `返回文章列表`             |
| [`ja.json`](apps/admin-blog/src/i18n/ja.json) | `blog_articles_backToList` | `記事一覧に戻る`           |
| [`ko.json`](apps/admin-blog/src/i18n/ko.json) | `blog_articles_backToList` | `게시물 목록으로 돌아가기` |
| [`fr.json`](apps/admin-blog/src/i18n/fr.json) | `blog_articles_backToList` | `Retour aux articles`      |
| [`de.json`](apps/admin-blog/src/i18n/de.json) | `blog_articles_backToList` | `Zurück zu den Artikeln`   |

Place these alphabetically alongside the other `blog_articles_*` keys (after `blog_articles_author` on ~line 273 of en.json).

### Preview Page Layout

```
┌─────────────────────────────────────────────────┐
│  PageHeader: Content > Articles > [Article Title] │
├─────────────────────────────────────────────────┤
│  ← Back to Articles  (link to /blog/articles)    │
├─────────────────────────────────────────────────┤
│  Card:                                            │
│  ┌─────────────────────────────────────────────┐ │
│  │  [Featured Image - SmartImage]              │ │
│  │                                             │ │
│  │  # Article Title (localized)                │ │
│  │                                             │ │
│  │  Author | Published Date | Category | Badge │ │
│  │  ─────────────────────────────────────────  │ │
│  │  Article Content (sanitized HTML via        │ │
│  │  dangerouslySetInnerHTML)                   │ │
│  │                                             │ │
│  │  ┌─ Excerpt ─────────────────────────────┐  │ │
│  │  │  Article excerpt text...              │  │ │
│  │  └───────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

## Implementation Steps (Execution Order)

1. Create directory `apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/`
2. Create `page.tsx` with the preview component
3. Add `blog_articles_backToList` key to all 6 locale JSON files
4. Restart the dev server to pick up the new route + JSON changes
5. Verify: navigate to `/blog/articles/<any-valid-slug>` and confirm it renders
