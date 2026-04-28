# Translation Key Audit - Complete Analysis

## Summary

A systematic audit of ALL translation keys used across the admin-blog app has been completed. The audit compared every `t()` call in the source code against all keys defined in the 6 locale JSON files.

**Result: Only 1 missing key was found.**

## The Missing Key

### `translations.update`

- **File**: [`apps/admin-blog/src/views/blog/BlogCommentModal.tsx`](apps/admin-blog/src/views/blog/BlogCommentModal.tsx:140)
- **Usage**: `t('update')` on line 140 (submit button text)
- **Pattern**: Direct `t()` call → resolves to `translations.update`
- **Status**: NOT DEFINED in any locale file

### Why it's missing

The [`BlogCommentModal`](apps/admin-blog/src/views/blog/BlogCommentModal.tsx:42) uses `const { t } = useTranslation()` (direct access to `translations.*` namespace). It calls `t('update')` which looks up `translations.update`. This key does not exist in any locale file.

Note: `blog_article_update` IS defined (used by BlogArticleModal's scoped t), but that's a different key.

## What Was Checked (All Passed)

### Direct `t()` calls → `translations.*` namespace

| File | Keys Used | Status |
|------|-----------|--------|
| [`Sidebar.tsx`](apps/admin-blog/src/components/layout/Sidebar.tsx) | `dashboard`, `content`, `tools`, `system`, `articles`, `categories`, `tags`, `comments`, `create_article`, `edit_article`, `translation_progress`, `translation_issues`, `settings` | ✅ All defined |
| [`Header.tsx`](apps/admin-blog/src/components/layout/Header.tsx) | `header_switchToLightMode`, `header_switchToDarkMode`, `header_settings`, `header_loggingOut`, `header_logout` | ✅ All defined |
| [`BlogCategoryModal.tsx`](apps/admin-blog/src/views/blog/BlogCategoryModal.tsx) | `categories_modalTitleCreate`, `categories_modalTitleEdit`, `categories_name`, `categories_namePlaceholder`, `categories_slug`, `categories_slugPlaceholder`, `categories_description`, `categories_descriptionPlaceholder`, `categories_cancel`, `categories_create`, `categories_update` | ✅ All defined |
| [`BlogTagModal.tsx`](apps/admin-blog/src/views/blog/BlogTagModal.tsx) | `tags_modalTitleCreate`, `tags_modalTitleEdit`, `tags_name`, `tags_namePlaceholder`, `tags_slug`, `tags_slugPlaceholder`, `tags_color`, `tags_colorPlaceholder`, `tags_description`, `tags_descriptionPlaceholder`, `tags_cancel`, `tags_create`, `tags_update` | ✅ All defined |
| [`BlogCommentModal.tsx`](apps/admin-blog/src/views/blog/BlogCommentModal.tsx) | `status`, `cancel`, `blog_comments_modalTitle`, `blog_comments_pending`, `blog_comments_approved`, `blog_comments_rejected`, `blog_comments_spam`, `blog_comments_replyOptional`, `blog_comments_replyPlaceholder`, **`update`** | ❌ **`update` missing** |
| [`tags/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/tags/page.tsx) | All `blog_tags_*` keys | ✅ All defined |
| [`translation-issues/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/translation-issues/page.tsx) | `translation_issues`, `translation_issues_desc`, `tools` | ✅ All defined |
| [`BaseTable.tsx`](apps/admin-blog/src/components/scaffold/BaseTable.tsx) | `common_noData` | ✅ Defined |
| [`Pagination.tsx`](apps/admin-blog/src/components/scaffold/Pagination.tsx) | `common_total`, `common_previous`, `common_pageOf`, `common_next` | ✅ All defined |

### Scoped `t()` calls (prefixed keys)

| File | Prefix | Keys Used | Status |
|------|--------|-----------|--------|
| [`BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx) | `blog_article_*` | `failedLoadData`, `failedUploadImage`, `draft`, `published`, `archived`, `modalTitleCreate`, `modalTitleEdit`, `translationRequestSent`, `translationFailed`, `retranslate`, `autoTranslateAfterSave`, `category`, `selectCategory`, `tags`, `status`, `featured`, `featuredDescription`, `cancel`, `update`, `publish` | ✅ All defined |
| [`ArticleForm.tsx`](apps/admin-blog/src/views/blog/ArticleForm.tsx) | `blog_articleForm_*` | `title`, `titlePlaceholder`, `content`, `excerpt`, `excerptPlaceholder`, `featuredImage`, `recommendedSize` | ✅ All defined |
| [`BlogTranslationIssues.tsx`](apps/admin-blog/src/views/blog/BlogTranslationIssues.tsx) | `blog_translation_*` | 25+ keys | ✅ All defined |
| [`BlogTranslationProgress.tsx`](apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx) | `blog_translation_*` | 60+ keys | ✅ All defined |
| [`create/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx) | `blog_createArticle_*` | 25+ keys | ✅ All defined |
| [`blog/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/page.tsx) | `blog_dashboard_*` | 30+ keys | ✅ All defined |
| [`articles/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx) | `blog_articles_*` | 30+ keys | ✅ All defined |
| [`categories/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/categories/page.tsx) | `blog_categories_*` | 25+ keys | ✅ All defined |
| [`comments/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx) | `blog_comments_*` | 20+ keys | ✅ All defined |

### Nested namespace keys

| File | Namespace | Keys Used | Status |
|------|-----------|-----------|--------|
| [`TranslationProgressCard.tsx`](apps/admin-blog/src/views/blog/components/TranslationProgressCard.tsx) | `blogCard.*` | 15 keys | ✅ All defined |
| [`settings/locales/page.tsx`](apps/admin-blog/src/app/(dashboard)/settings/locales/page.tsx) | `systemConfig.*` | `tabLocales`, `pageDescription`, `localeLoading`, `localeTip1-4` | ✅ All defined |
| [`Login.tsx`](apps/admin-blog/src/views/Login.tsx) | `login.*` | 18 keys | ✅ All defined |

## Action Items

### 1. Add `"update": "Update"` to all 6 locale files

Insert `"update": "Update"` in the `translations` namespace of each locale file, maintaining alphabetical order (after `"tools"` or near other action verbs like `"save"`, `"edit"`, `"delete"`).

Files to modify:
- [`apps/admin-blog/src/i18n/en.json`](apps/admin-blog/src/i18n/en.json)
- [`apps/admin-blog/src/i18n/zh.json`](apps/admin-blog/src/i18n/zh.json)
- [`apps/admin-blog/src/i18n/ja.json`](apps/admin-blog/src/i18n/ja.json)
- [`apps/admin-blog/src/i18n/ko.json`](apps/admin-blog/src/i18n/ko.json)
- [`apps/admin-blog/src/i18n/fr.json`](apps/admin-blog/src/i18n/fr.json)
- [`apps/admin-blog/src/i18n/de.json`](apps/admin-blog/src/i18n/de.json)

### 2. Verify type-check + lint pass

Run `yarn workspace @lucky/admin-blog type-check` and `yarn workspace @lucky/admin-blog lint` to ensure no regressions.

### 3. Verify language switching works end-to-end

Test that switching between all 6 locales works correctly in the UI.
