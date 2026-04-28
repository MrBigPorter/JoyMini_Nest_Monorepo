# Fix i18n Key Mismatches in Blog Components

## 1. Answer: "为什么 admin-next 不报错？"

After deep investigation of the source code of `use-intl` (the underlying library of `next-intl`), here's the definitive answer:

**Both admin-next and admin-blog DO show the same MISSING_MESSAGE errors.** They have identical code:

| Component                | admin-blog                   | admin-next            |
| ------------------------ | ---------------------------- | --------------------- |
| `useTranslation.ts`      | Same hook with `raw()` check | Same hook             |
| `i18n/request.ts`        | Same flatten + merge logic   | Same logic            |
| Locale JSON files        | Same content                 | Same content          |
| Blog components          | Same wrong short keys        | Same wrong short keys |
| `next-intl` version      | `^4.9.1`                     | `^4.9.1`              |
| `NextIntlClientProvider` | No `onError` override        | No `onError` override |

The default `onError` in `use-intl` (file: [`initializeConfig-B5qJiBCm.js`](apps/admin-blog/node_modules/use-intl/dist/esm/development/initializeConfig-B5qJiBCm.js:17)) is:

```javascript
function defaultOnError(error) {
  console.error(error); // <-- logs to browser console
}
```

So if you open both apps' browser consoles and navigate to the blog pages, **both will show MISSING_MESSAGE errors**. The user likely only checked admin-blog's console.

## 2. Root Cause

The 3 blog component files use **short unprefixed keys** like `t('modalTitle')`, but the locale JSON files only have **prefixed keys** like `blog_comments_modalTitle`.

### Error flow (per wrong key call):

```
t('modalTitle')  [custom hook useTranslation]
  → tNext.raw('modalTitle')  [use-intl raw()]
    → resolvePath() throws "Could not resolve 'modalTitle'..."
    → getFallbackFromErrorAndNotify()
      → onError(error)   ← MISSING_MESSAGE logged to console
      → returns 'modalTitle' (fallback string)
  → typeof raw === 'string'  → TRUE (it's 'modalTitle')
  → tNext('modalTitle')  [use-intl translateFn]
    → resolvePath() throws again
    → getFallbackFromErrorAndNotify()
      → onError(error)   ← MISSING_MESSAGE logged AGAIN
      → returns 'modalTitle'
  → returns 'modalTitle'
```

So for each wrong key, the error appears **twice** in console, and the UI shows the raw key name as text.

### Which keys are correct vs wrong?

**Correct keys** (exist flat in `request.ts` merged messages):

- `t('cancel')`, `t('update')`, `t('publish')`, `t('status')` — these exist in `translations` section

**Wrong keys** (don't exist in any locale file):

- BlogCommentModal: `modalTitle`, `pending`, `approved`, `rejected`, `spam`, `replyOptional`, `replyPlaceholder`
- ArticleForm: `title`, `titlePlaceholder`, `content`, `excerpt`, `excerptPlaceholder`, `featuredImage`, `recommendedSize`
- BlogArticleModal: `failedLoadData`, `failedUploadImage`, `draft`, `published`, `archived`, `modalTitleEdit`, `modalTitleCreate`, `category`, `selectCategory`, `tags`, `featured`, `featuredDescription`

## 3. Fix Strategy

Fix the component code in **both** apps (they have identical issues).

### Files to modify (6 total):

| #   | File                                                                                                         | Changes          |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | [`apps/admin-blog/src/views/blog/BlogCommentModal.tsx`](apps/admin-blog/src/views/blog/BlogCommentModal.tsx) | Fix 7 keys       |
| 2   | [`apps/admin-blog/src/views/blog/ArticleForm.tsx`](apps/admin-blog/src/views/blog/ArticleForm.tsx)           | Fix 7 keys       |
| 3   | [`apps/admin-blog/src/views/blog/BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx) | Fix ~13 keys     |
| 4   | [`apps/admin-next/src/views/blog/BlogCommentModal.tsx`](apps/admin-next/src/views/blog/BlogCommentModal.tsx) | Same fixes as #1 |
| 5   | [`apps/admin-next/src/views/blog/ArticleForm.tsx`](apps/admin-next/src/views/blog/ArticleForm.tsx)           | Same fixes as #2 |
| 6   | [`apps/admin-next/src/views/blog/BlogArticleModal.tsx`](apps/admin-next/src/views/blog/BlogArticleModal.tsx) | Same fixes as #3 |

### Key mapping

#### BlogCommentModal.tsx

| Wrong key          | Correct key                      | Line (admin-blog) |
| ------------------ | -------------------------------- | ----------------- |
| `modalTitle`       | `blog_comments_modalTitle`       | 106               |
| `pending`          | `blog_comments_pending`          | 114               |
| `approved`         | `blog_comments_approved`         | 115               |
| `rejected`         | `blog_comments_rejected`         | 116               |
| `spam`             | `blog_comments_spam`             | 117               |
| `replyOptional`    | `blog_comments_replyOptional`    | 122               |
| `replyPlaceholder` | `blog_comments_replyPlaceholder` | 127               |

#### ArticleForm.tsx

| Wrong key            | Correct key                           | Line (admin-blog) |
| -------------------- | ------------------------------------- | ----------------- |
| `title`              | `blog_articleForm_title`              | 145               |
| `titlePlaceholder`   | `blog_articleForm_titlePlaceholder`   | 146               |
| `content`            | `blog_articleForm_content`            | 152               |
| `excerpt`            | `blog_articleForm_excerpt`            | 173               |
| `excerptPlaceholder` | `blog_articleForm_excerptPlaceholder` | 174               |
| `featuredImage`      | `blog_articleForm_featuredImage`      | 180               |
| `recommendedSize`    | `blog_articleForm_recommendedSize`    | 195               |

#### BlogArticleModal.tsx

| Wrong key             | Correct key                        | Line (admin-blog) |
| --------------------- | ---------------------------------- | ----------------- |
| `failedLoadData`      | `blog_article_failedLoadData`      | 81                |
| `failedUploadImage`   | `blog_article_failedUploadImage`   | 476               |
| `draft`               | `blog_article_draft`               | 502               |
| `published`           | `blog_article_published`           | 503               |
| `archived`            | `blog_article_archived`            | 504               |
| `modalTitleEdit`      | `blog_article_modalTitleEdit`      | 517               |
| `modalTitleCreate`    | `blog_article_modalTitleCreate`    | 517               |
| `category`            | `blog_article_category`            | 707               |
| `selectCategory`      | `blog_article_selectCategory`      | 708               |
| `tags`                | `blog_article_tags`                | 713               |
| `featured`            | `blog_article_featured`            | 744               |
| `featuredDescription` | `blog_article_featuredDescription` | 746               |

## 4. Implementation Steps

1. Fix [`BlogCommentModal.tsx`](apps/admin-blog/src/views/blog/BlogCommentModal.tsx) — replace 7 wrong keys with correct prefixed keys
2. Fix [`ArticleForm.tsx`](apps/admin-blog/src/views/blog/ArticleForm.tsx) — replace 7 wrong keys with correct prefixed keys
3. Fix [`BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx) — replace ~13 wrong keys
4. Apply same fixes to admin-next's blog components
5. Run `yarn workspace @lucky/admin-blog type-check` and lint to verify
6. Run `yarn workspace @lucky/admin-next type-check` and lint to verify
