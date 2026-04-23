# Blog Management i18n Analysis

## Overview

Analysis of all Blog Management pages in `apps/admin-next/src/app/(dashboard)/blog/` and related view components for i18n completeness.

## 1. Already i18n'd ✅

| Page/Component                           | Pattern                                | Status                                                                                                |
| ---------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `blog/page.tsx` (Dashboard)              | `t('blog_dashboard_${key}')`           | ✅ Has hardcoded breadcrumbs `['Blog', 'Dashboard']`                                                  |
| `blog/articles/page.tsx` (Articles List) | `t('blog_articles_${key}')`            | ✅ Fully i18n'd                                                                                       |
| `blog/comments/page.tsx` (Comments)      | `t('blog_comments_${key}')`            | ✅ Uses flat keys `t('untitled')`, `t('allArticles')`, `t('loadFailed')` — need to verify these exist |
| `blog/tags/page.tsx` (Tags)              | `t('${key}')` directly                 | ✅ Has hardcoded breadcrumbs `['Blog', 'Tags']`                                                       |
| `blog/categories/page.tsx` (Categories)  | `t('blog_categories_${key}')`          | ✅ Has hardcoded text in `renderChildren` delete confirmation                                         |
| `blog/translation-progress/page.tsx`     | Delegates to `BlogTranslationProgress` | ✅ Fully i18n'd                                                                                       |
| `BlogTranslationProgress.tsx`            | `t('blog_translation_${key}')`         | ✅ Fully i18n'd                                                                                       |
| `BlogCategoryModal.tsx`                  | `useTranslation()` directly            | ✅ Fully i18n'd                                                                                       |
| `BlogArticleModal.tsx`                   | `t('blog_article_${key}')`             | ✅ Mostly i18n'd, has some hardcoded strings                                                          |

## 2. NOT i18n'd ❌

### 2.1 `BlogTagModal.tsx` — Completely Missing i18n

- **File**: [`apps/admin-next/src/views/blog/BlogTagModal.tsx`](apps/admin-next/src/views/blog/BlogTagModal.tsx)
- Uses `<Modal>` directly (NOT `ModalManager.open()`) → `useTranslation()` works fine
- Hardcoded strings:
  - `title={`${isEditing ? 'Edit' : 'Create'} Tag`}` (line 143)
  - `'Name'` (line 149)
  - `'Enter tag name'` (line 154)
  - `'Slug'` (line 158-159)
  - `'e.g., technology'` (line 160)
  - `'Color'` (line 164-165)
  - `'#3b82f6'` (line 166)
  - `'Description'` (line 169-170)
  - `'Optional description'` (line 171)
  - `'Cancel'` (line 181)
  - `'Create'` / `'Update'` (line 184)
- **New keys needed**: ~12 keys with prefix `blog_tag_`

### 2.2 `BlogCommentModal.tsx` — Completely Missing i18n

- **File**: [`apps/admin-next/src/views/blog/BlogCommentModal.tsx`](apps/admin-next/src/views/blog/BlogCommentModal.tsx)
- Uses `<Modal>` directly → `useTranslation()` works fine
- Hardcoded strings:
  - `title="Moderate Comment"` (line 104)
  - `'Status'` (line 110)
  - `'Pending'`, `'Approved'`, `'Rejected'`, `'Spam'` (lines 112-115)
  - `'Reply (optional)'` (line 120)
  - `'Add a public reply to the comment'` (line 125)
  - `'Cancel'` (line 135)
  - `'Update'` (line 138)
- **New keys needed**: ~10 keys with prefix `blog_comment_`

### 2.3 `ArticleForm.tsx` — Completely Missing i18n

- **File**: [`apps/admin-next/src/views/blog/ArticleForm.tsx`](apps/admin-next/src/views/blog/ArticleForm.tsx)
- Rendered inside `BlogArticleModal` → has React context → `useTranslation()` works fine
- Hardcoded strings:
  - `'Title is required'` (line 18, Zod schema — deferred)
  - `'Content is required'` (line 19, Zod schema — deferred)
  - `'Title'` (line 123)
  - `'Enter article title'` (line 125)
  - `'Content'` (line 130)
  - `'Excerpt'` (line 149)
  - `'Brief summary of the article'` (line 151)
  - `'Featured Image'` (line 157)
  - `'Recommended 800x800px'` (line 172)
- **New keys needed**: ~7 UI keys with prefix `blog_articleForm_`

### 2.4 `blog/articles/create/page.tsx` — Completely Missing i18n

- **File**: [`apps/admin-next/src/app/(dashboard)/blog/articles/create/page.tsx`](<apps/admin-next/src/app/(dashboard)/blog/articles/create/page.tsx>)
- Standalone page → `useTranslation()` works fine
- Hardcoded strings:
  - `'Article created successfully'` (line 52)
  - `'Failed to create article'` (line 56)
  - `'Failed to upload editor image'` (line 82)
  - `'Failed to load categories/tags'` (line 101)
  - `title="Create New Article"` (line 128)
  - `description="Write a new blog article"` (line 129)
  - `breadcrumbs={['Blog', 'Articles', 'Create']}` (line 132)
  - `buttonText="Save Article"` (line 133)
  - `secondaryButtonText="Cancel"` (line 143)
  - `tertiaryButtonText="Publish Article"` (line 145)
  - `'Article Content'` (line 155)
  - `'Article Title *'` (line 161)
  - `'Enter article title'` (line 162)
  - `'Article Excerpt'` (line 168)
  - `'Enter article excerpt (optional)'` (line 170)
  - `'Category *'` (line 177)
  - `'Select category'` (line 178)
  - `'Tags'` (line 187)
  - `'Article Content *'` (line 220)
  - `'Write your article content here...'` (line 221)
  - `'Article content is required'` (line 226)
  - `'Rich text editor with image upload support'` (line 231)
  - `'# Heading'`, `'**Bold**'`, `'*Italic*'` (lines 243, 254, 265)
  - `'Cancel'` (line 277)
  - `'Saving...'` (line 286)
  - `'Save Article'` (line 286)
- **New keys needed**: ~25 keys with prefix `blog_createArticle_`

### 2.5 `BlogArticleModal.tsx` — Partially Missing i18n

- **File**: [`apps/admin-next/src/views/blog/BlogArticleModal.tsx`](apps/admin-next/src/views/blog/BlogArticleModal.tsx)
- Already uses `useTranslation()` with `t('blog_article_${key}')` pattern
- But has hardcoded strings:
  - `'Failed to load categories/tags'` (line 70)
  - `'Failed to upload image'` (line 345)
  - `'Category'` (line 485)
  - `'Select category'` (line 486)
  - `'Tags'` (line 490)
  - `'Draft'`, `'Published'`, `'Archived'` (lines 371-373, status options)
  - `title={`${isEditing ? 'Edit' : 'Create'} Article`}` (line 386)
  - `'Cancel'` (line 525)
  - `'Update'` / `'Publish'` (line 528)
- **New keys needed**: ~10 keys with prefix `blog_article_` (add to existing namespace)

## 3. Missing Keys in Already-i18n'd Pages

### 3.1 Blog Dashboard — Hardcoded Breadcrumbs

- Line ~110: `breadcrumbs={['Blog', 'Dashboard']}`
- **Fix**: Use `t('blog_dashboard_breadcrumbBlog')` and `t('blog_dashboard_breadcrumbDashboard')` or similar

### 3.2 Blog Tags — Hardcoded Breadcrumbs

- Line 105: `breadcrumbs={['Blog', 'Tags']}`
- **Fix**: Use `t('blog_tags_breadcrumbBlog')` and `t('blog_tags_breadcrumbTags')` or similar

### 3.3 Blog Categories — Hardcoded Delete Confirmation

- Line 62: `"Are you sure you want to delete category "` in `renderChildren`
- **Fix**: Use `t('blog_categories_deleteConfirmText')` with params

### 3.4 Blog Comments — Flat Keys Check

- Uses `t('untitled')`, `t('allArticles')`, `t('loadFailed')` — these are flat keys in `translations` section
- Need to verify these exist in locale files

## 4. Deferred: Zod Validation Messages

- **File**: [`apps/admin-next/src/schema/blog.ts`](apps/admin-next/src/schema/blog.ts)
- **articleSchema**: 5 hardcoded messages
- **categorySchema**: 6 hardcoded messages
- **tagSchema**: 7 hardcoded messages
- **commentModerationSchema**: 1 hardcoded message
- **Total**: ~19 hardcoded Zod messages
- **Approach**: Custom `zodErrorMap` (cross-cutting concern, same as bannerShema.ts and ActSectionSchema.ts)

## 5. Summary

| Category                       | New Keys Needed | Files to Modify                             |
| ------------------------------ | --------------- | ------------------------------------------- |
| BlogTagModal UI                | ~12             | 1 component + 6 locale files                |
| BlogCommentModal UI            | ~10             | 1 component + 6 locale files                |
| ArticleForm UI                 | ~7              | 1 component + 6 locale files                |
| Create Article page UI         | ~25             | 1 page + 6 locale files                     |
| BlogArticleModal missing keys  | ~10             | 1 component + 6 locale files                |
| Missing keys in existing pages | ~5              | 3 pages + 6 locale files                    |
| Zod validation (deferred)      | ~19             | 1 schema file + 6 locale files              |
| **Total**                      | **~88 keys**    | **8 component/page files + 6 locale files** |

## 6. Implementation Phases

### Phase A: Add all new locale keys to all 6 locale files

- Add `blog_tag_*` keys (~12)
- Add `blog_comment_*` keys (~10)
- Add `blog_articleForm_*` keys (~7)
- Add `blog_createArticle_*` keys (~25)
- Add missing `blog_article_*` keys (~10)
- Add missing keys for existing pages (~5)
- **Total**: ~69 new keys per locale file × 6 locales

### Phase B: i18n BlogTagModal.tsx

- Add `import { useTranslation } from '@/hooks/useTranslation';`
- Add `const { t } = useTranslation();`
- Replace all hardcoded strings with `t('blog_tag_xxx')`

### Phase C: i18n BlogCommentModal.tsx

- Add `import { useTranslation } from '@/hooks/useTranslation';`
- Add `const { t } = useTranslation();`
- Replace all hardcoded strings with `t('blog_comment_xxx')`

### Phase D: i18n ArticleForm.tsx

- Add `import { useTranslation } from '@/hooks/useTranslation';`
- Add `const { t } = useTranslation();`
- Replace all hardcoded strings with `t('blog_articleForm_xxx')`

### Phase E: i18n Create Article page

- Add `import { useTranslation } from '@/hooks/useTranslation';`
- Add scoped `t()` function
- Replace all hardcoded strings with `t('blog_createArticle_xxx')`

### Phase F: i18n BlogArticleModal.tsx missing keys

- Add missing `blog_article_*` keys to locale files
- Replace hardcoded strings in component

### Phase G: Fix missing keys in already-i18n'd pages

- Blog Dashboard: replace hardcoded breadcrumbs
- Blog Tags: replace hardcoded breadcrumbs
- Blog Categories: replace hardcoded delete confirmation text
- Blog Comments: verify flat keys exist

### Phase H: Verification

- Run `yarn workspace @lucky/admin-next type-check`
- Run `yarn workspace @lucky/admin-next lint`
- Run `yarn workspace @lucky/admin-next prettier`

### Phase I: Zod Validation i18n (Deferred)

- Create `zodErrorMap` utility
- Apply to all blog schemas
- Same approach as bannerShema.ts and ActSectionSchema.ts
