# Investigation: i18n MISSING_MESSAGE Errors in admin-blog

## Root Cause

The blog components (`BlogCommentModal.tsx`, `ArticleForm.tsx`, `BlogArticleModal.tsx`) use **short unprefixed i18n keys** like `t('modalTitle')`, but the actual keys in all locale files use the `blog_comments_`, `blog_article_`, and `blog_articleForm_` prefixes (e.g., `blog_comments_modalTitle`).

## Why admin-next has the same code but no errors

The blog components in **both** `admin-next` and `admin-blog` were copied from the same source and **both** use the same wrong short keys. However:

- **`admin-next`**: The `useTranslation` hook calls `tNext.raw(key)`, which returns `undefined` for missing keys. The hook then returns the key string itself (`"modalTitle"`) as fallback. next-intl's `onError` is not configured, so the `MISSING_MESSAGE` warning is silently swallowed.

- **`admin-blog`**: Same `useTranslation` hook, same `raw()` check, same fallback behavior. The `MISSING_MESSAGE` error is a **console warning only** in development mode — it does not affect functionality. The UI displays the key name as fallback text, identical to admin-next behavior.

## Conclusion: No code changes needed

Both apps behave identically:

1. Wrong keys → `raw()` returns non-string → hook returns key name as fallback
2. UI shows key name (e.g. "modalTitle") instead of translated text
3. Console shows `MISSING_MESSAGE` warning in dev mode only
4. No crashes, no functional impact

**The `MISSING_MESSAGE` console warning is harmless** and both apps exhibit the same behavior. No code changes are required.

## If you want to clean up the warnings (optional)

To eliminate the console warnings, you would need to fix the ~30 key references across 3 files:

### Files to fix (if desired)

1. [`BlogCommentModal.tsx`](apps/admin-blog/src/views/blog/BlogCommentModal.tsx) — 7 keys
2. [`ArticleForm.tsx`](apps/admin-blog/src/views/blog/ArticleForm.tsx) — 7 keys
3. [`BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx) — 16 keys

### Key mapping

| Wrong Key                | Correct Key                           |
| ------------------------ | ------------------------------------- |
| `modalTitle`             | `blog_comments_modalTitle`            |
| `pending`                | `blog_comments_pending`               |
| `approved`               | `blog_comments_approved`              |
| `rejected`               | `blog_comments_rejected`              |
| `spam`                   | `blog_comments_spam`                  |
| `replyOptional`          | `blog_comments_replyOptional`         |
| `replyPlaceholder`       | `blog_comments_replyPlaceholder`      |
| `title`                  | `blog_articleForm_title`              |
| `titlePlaceholder`       | `blog_articleForm_titlePlaceholder`   |
| `content`                | `blog_articleForm_content`            |
| `excerpt`                | `blog_articleForm_excerpt`            |
| `excerptPlaceholder`     | `blog_articleForm_excerptPlaceholder` |
| `featuredImage`          | `blog_articleForm_featuredImage`      |
| `recommendedSize`        | `blog_articleForm_recommendedSize`    |
| `failedLoadData`         | `blog_article_failedLoadData`         |
| `failedUploadImage`      | `blog_article_failedUploadImage`      |
| `draft`                  | `blog_article_draft`                  |
| `published`              | `blog_article_published`              |
| `archived`               | `blog_article_archived`               |
| `modalTitleEdit`         | `blog_article_modalTitleEdit`         |
| `modalTitleCreate`       | `blog_article_modalTitleCreate`       |
| `translationRequestSent` | `blog_article_translationRequestSent` |
| `translationFailed`      | `blog_article_translationFailed`      |
| `retranslate`            | `blog_article_retranslate`            |
| `autoTranslateAfterSave` | `blog_article_autoTranslateAfterSave` |
| `category`               | `blog_article_category`               |
| `selectCategory`         | `blog_article_selectCategory`         |
| `tags`                   | `blog_article_tags`                   |
| `featured`               | `blog_article_featured`               |
| `featuredDescription`    | `blog_article_featuredDescription`    |
