# Fix All `react-hooks/exhaustive-deps` Warnings in admin-blog

## Risk Analysis Summary

All fixes are **low risk**. Here's the detailed breakdown:

### ✅ Safe Fixes (Straightforward, no side effects)

| #   | File                                                                                           | Warning                                       | Fix                                                          | Risk                                         |
| --- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| 1   | [`create/page.tsx`](<../apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx:32>) | useEffect missing `t`                         | Wrap `t` in `useCallback([globalT])`, add to `[addToast, t]` | LOW — `globalT` is already memoized          |
| 2   | [`articles/page.tsx`](<../apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx:71>)      | `t` changes on every render                   | Wrap `t` in `useCallback([globalT])`                         | LOW — same pattern as BlogArticleModal       |
| 3   | [`articles/page.tsx`](<../apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx:524>)     | useCallback missing `lang`                    | Add `lang` to `[]` → `[lang]`                                | LOW — `lang` only changes on locale switch   |
| 4   | [`comments/page.tsx`](<../apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx:42>)      | useEffect missing fetchArticles/fetchComments | Wrap both in `useCallback`, add to deps                      | LOW — debounce timer already handles re-runs |
| 5   | [`blog/page.tsx`](<../apps/admin-blog/src/app/(dashboard)/blog/page.tsx:35>)                   | useEffect missing fetchDashboardData          | Wrap `t` + `fetchDashboardData` in `useCallback`             | LOW — only runs on mount + locale switch     |
| 6   | [`tags/page.tsx`](<../apps/admin-blog/src/app/(dashboard)/blog/tags/page.tsx:34>)              | useEffect missing fetchTags                   | Wrap `fetchTags` in `useCallback`                            | LOW — debounce timer already handles re-runs |

### ⚠️ Intentional Exclusions (eslint-disable with comments)

| #   | File                                                                                      | Warning                                  | Fix                                       | Reason                                                                                                         |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 7   | [`RichTextEditor.tsx`](../apps/admin-blog/src/components/blog/RichTextEditor.tsx:115)     | useEffect missing `value`                | Add `// eslint-disable-next-line` comment | `hasInitialized.current` ref prevents re-runs; adding `value` to deps would trigger false re-checks            |
| 8   | [`RichTextEditor.tsx`](../apps/admin-blog/src/components/blog/RichTextEditor.tsx:230,388) | useCallback missing `onChange`           | Add `// eslint-disable-next-line` comment | `onChange` is a parent prop that may change every render; adding it could cause infinite loops                 |
| 9   | [`BlogCommentModal.tsx`](../apps/admin-blog/src/views/blog/BlogCommentModal.tsx:56)       | getDefaultValues changes on every render | Add `// eslint-disable-next-line` comment | `getDefaultValues` IS properly wrapped in `useCallback([editingComment])`; the dependency is correct by design |

## Files to Modify

1. `apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx`
2. `apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx`
3. `apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx`
4. `apps/admin-blog/src/app/(dashboard)/blog/page.tsx`
5. `apps/admin-blog/src/app/(dashboard)/blog/tags/page.tsx`
6. `apps/admin-blog/src/components/blog/RichTextEditor.tsx`
7. `apps/admin-blog/src/views/blog/BlogCommentModal.tsx`
