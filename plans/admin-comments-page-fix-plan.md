# Admin Comments Page Fix Plan

## Issue Analysis

All issues are in:
- [`apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx`](../apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx) (frontend)
- [`apps/api/src/blog/comment/comment.service.ts`](../apps/api/src/blog/comment/comment.service.ts) (backend Prisma query)
- Potentially [`apps/admin-blog/src/views/blog/BlogCommentModal.tsx`](../apps/admin-blog/src/views/blog/BlogCommentModal.tsx)

---

### Issue 1: "View Article" button has no response

**Location:** Lines 446-449 in `page.tsx`

**Root Cause:** Plain `<button>` element with NO `onClick` handler.

**Fix:** Add `onClick={() => router.push('/blog/articles')}` to navigate to the articles list.

---

### Issue 2: "Reply" button has no response

**Location:** Lines 450-452 in `page.tsx`

**Root Cause:** Plain `<button>` element with NO `onClick` handler.

**Fix:** Add `onClick={() => { setEditingComment(comment); setIsModalOpen(true); }}` to open the `BlogCommentModal` for replying.

---

### Issue 3: Article link navigates to `/blog/articles/undefined/`

**Location:** Line 438-443 in `page.tsx` + Line 190 in `comment.service.ts`

**Root Cause:** The `<a href={`/blog/articles/${comment.article?.slug}`}>` uses `comment.article?.slug`, but the backend Prisma query at [`comment.service.ts:190`](../apps/api/src/blog/comment/comment.service.ts:190) only includes `{ id: true, title: true }` — no `slug` field.

**Backend Fix:** Add `slug: true` to the Prisma include:
```typescript
include: {
  article: { select: { id: true, title: true, slug: true } },
},
```

**Frontend Fix:** No change needed — `comment.article?.slug` will then resolve correctly.

---

### Issue 4: Auto-reply comments don't show the original user comment

**Location:** Lines 431-433 in `page.tsx` + Backend query at `comment.service.ts`

**Root Cause:** When a comment has `isAiGenerated: true` (AI auto-reply), it has a `parentId` pointing to the original user comment. But the backend's `getAllComments` doesn't include the `parent` relation:
```typescript
include: {
  article: { select: { id: true, title: true } },
},
```

So admin only sees `comment.content` (the AI's reply) but not the original comment that the AI replied to.

**Backend Fix:** Add `parent` include to the Prisma query:
```typescript
include: {
  article: { select: { id: true, title: true, slug: true } },
  parent: { select: { id: true, author: true, content: true, createdAt: true } },
},
```

**Frontend Fix:** Add a "parent comment" section before `comment.content` when `comment.parent` exists:
```tsx
{comment.parent && (
  <div className="mb-3 p-3 bg-gray-50 dark:bg-black/10 rounded-lg border border-gray-100 dark:border-white/5">
    <div className="flex items-center gap-2 mb-1">
      <User className="h-3 w-3 text-muted-foreground" />
      <span className="text-xs font-medium text-muted-foreground">
        {comment.parent.author} {t('commented')}:
      </span>
    </div>
    <p className="text-sm text-muted-foreground">{comment.parent.content}</p>
  </div>
)}
```

---

### Issue 5: Delete dialog uses `window.confirm()` instead of ModalManager.open

**Location:** Line 185-198 in `page.tsx`

**Root Cause:** Uses native browser `window.confirm()` which is inconsistent with project conventions.

**Fix:**
1. Add `import { ModalManager } from '@repo/ui';`
2. Replace `window.confirm()` with `ModalManager.open()` following the pattern from [`categories/page.tsx:60-107`](../apps/admin-blog/src/app/(dashboard)/blog/categories/page.tsx:60)

Reference pattern:
```tsx
ModalManager.open({
  title: t('deleteComment'),
  confirmText: t('deleteConfirm'),
  cancelText: t('cancel'),
  renderChildren: (
    <div className="space-y-3">
      <p>{t('deleteConfirmText')}</p>
      <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
        <div className="font-semibold mb-1">{t('actionCannotBeUndone')}</div>
      </div>
    </div>
  ),
  onConfirm: async () => {
    try {
      await blogApi.deleteComment(commentId);
      addToast('success', t('commentDeleted'));
      fetchComments();
    } catch (error) {
      console.error('Failed to delete comment:', error);
      addToast('error', t('deleteFailed'));
    }
  },
});
```

---

## Files to Modify

| File | Changes |
|------|---------|
| [`apps/api/src/blog/comment/comment.service.ts`](../apps/api/src/blog/comment/comment.service.ts) | Add `slug: true` to article select + add `parent` include (around line 190) |
| [`apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx`](../apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx) | Add onClick for View Article (line 446), add onClick for Reply (line 450), add parent comment display (around line 431), replace window.confirm with ModalManager.open (line 186), add ModalManager import |

## Verification

```bash
cd apps/api && yarn type-check
cd apps/admin-blog && yarn type-check && yarn lint
```
