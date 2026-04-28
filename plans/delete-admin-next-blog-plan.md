# Plan: Remove All Blog Content from `admin-next`

## Overview

Remove all blog-related code from the `apps/admin-next` application. The blog functionality exists in a separate dedicated app (`apps/admin-blog`), so this is safe to remove.

## Files/Directories to Delete

### 1. App Router Pages (Dashboard)

- `apps/admin-next/src/app/(dashboard)/blog/` — Entire directory
  - `page.tsx` (Blog Dashboard)
  - `articles/page.tsx` (Article List)
  - `articles/create/page.tsx` (Create Article)
  - `categories/page.tsx` (Category Management)
  - `tags/page.tsx` (Tag Management)
  - `comments/page.tsx` (Comment Management)
  - `translation-progress/page.tsx` (Translation Progress)

### 2. App Router Pages (Public/Blog)

- `apps/admin-next/src/app/blog/` — Entire directory
  - `articles/[slug]/page.tsx` (Public Article Page)
  - `articles/[slug]/BlogArticleContent.tsx` (Article Content Component)

### 3. View Components

- `apps/admin-next/src/views/blog/` — Entire directory
  - `ArticleForm.tsx`
  - `BlogArticleModal.tsx`
  - `BlogCategoryModal.tsx`
  - `BlogCommentModal.tsx`
  - `BlogTagModal.tsx`
  - `BlogTranslationProgress.tsx`
  - `components/TranslationProgressCard.tsx`

### 4. Blog-specific Components

- `apps/admin-next/src/components/blog/` — Entire directory
  - `Html5VideoBlot.ts`
  - `LanguageSwitch.tsx`
  - `LocalizedFieldEditor.tsx`
  - `LocalizedStatusButtons.tsx`
  - `LocalizedText.tsx`
  - `MarkdownImportModal.tsx`
  - `RichTextEditor.css`
  - `RichTextEditor.tsx`

### 5. Blog-specific Hooks

- `apps/admin-next/src/hooks/useBlogForm.ts`
- `apps/admin-next/src/hooks/useBlogFormSubmit.ts`
- `apps/admin-next/src/hooks/useBlogLocalizedForm.ts`
- `apps/admin-next/src/hooks/useLocalizedForm.ts` (only used by blog modals)
- `apps/admin-next/src/hooks/useLocalizedFormV2.ts` (only used by blog modals)

### 6. Blog Schema

- `apps/admin-next/src/schema/blog.ts`

### 7. Blog-only Utilities

- `apps/admin-next/src/utils/localizedText.ts` (only used by blog pages)
- `apps/admin-next/src/utils/localizedForm.ts` (only used by blog modals)
- `apps/admin-next/src/utils/translationQuality.ts` (not imported by any file)

## Files to Modify (Remove Blog References)

### 8. Routes - `apps/admin-next/src/routes/index.ts`

Remove blog route entries (lines 164-220):
- `/blog` (main blog route)
- `/blog/articles`
- `/blog/articles/create`
- `/blog/articles/edit/[id]`
- `/blog/categories`
- `/blog/tags`
- `/blog/comments`
- `/blog/translation-progress`

### 9. API - `apps/admin-next/src/api/index.ts`

Remove the entire `blogApi` object (lines ~1160-1518) including:
- Article CRUD APIs
- Category CRUD APIs
- Tag CRUD APIs
- Comment CRUD APIs
- Translation APIs
- Statistics API

### 10. CategoriesClient - `apps/admin-next/src/components/categories/CategoriesClient.tsx`

Remove the `BlogCategoryModal` import and all its usage (it's a product category component that incorrectly imports blog category modal).

### 11. SettingsClient - `apps/admin-next/src/components/settings/SettingsClient.tsx`

Remove blog-related config meta keys (lines 53-67):
- `blog.translation.defaultSourceLang`
- `blog.translation.sourceLangDetection`
- `blog.translation.fallbackChain`

### 12. Test File - `apps/admin-next/src/__tests__/views/CategoryManagement.test.tsx`

Remove the `BlogCategoryModal` mock (lines 28-32).

### 13. i18n Files - All locale JSONs

Remove blog-related translation keys from all files:
- `apps/admin-next/src/i18n/en.json`
- `apps/admin-next/src/i18n/zh.json`
- `apps/admin-next/src/i18n/ja.json`
- `apps/admin-next/src/i18n/ko.json`
- `apps/admin-next/src/i18n/fr.json`
- `apps/admin-next/src/i18n/de.json`

Keys to remove:
- `blog` (sidebar nav)
- `articles`, `categories`, `tags`, `comments` (nav)
- `create_article`, `edit_article` (nav)
- `translation_progress` (nav)
- `blogCard` section
- `blog_articleForm_*` keys
- `blog_tags_*` keys
- `blog_categories_*` keys
- `breadcrumbBlog`, `breadcrumbArticles`, `breadcrumbCategories`, `breadcrumbTags`, `breadcrumbComments`
- `loadingBlogDashboard`
- `welcomeToBlogSystem`
- `commentApproved`, `commentRejected`, `commentDeleted`
- `translationRequestSent`
- `newArticle`
- Translation-related keys in `blogCard` section

## Execution Order

1. Delete directories (steps 1-7 — no dependencies)
2. Modify routes (step 8)
3. Modify API (step 9)
4. Modify CategoriesClient (step 10)
5. Modify SettingsClient (step 11)
6. Modify test file (step 12)
7. Clean up i18n keys (step 13)
8. Type-check and lint to verify no broken imports remain
