# Final Fix Plan: 403 Error Handling for admin-blog

## Root Cause Analysis

The console error `AxiosError: Request failed with status code 403` has persisted through multiple fix attempts. After thorough analysis, the root causes are:

### Why previous fixes failed

1. **Fix 1** (return `undefined` in `withRetry`): Caused `Cannot read properties of undefined (reading 'data')` because `delete()` does `res.data.data` on the return value.

2. **Fix 2** (return `error.response` in interceptor): Caused `onSuccess` / success toast because resolving the promise makes the caller think the operation succeeded.

3. **Fix 3** (current: toast in `handleHttpError` + reject): The interceptor rejects -> `withRetry` re-throws -> pages catch and call `console.error('Failed to delete tag:', error)` -> Next.js dev overlay captures and shows the full AxiosError stack trace.

### The REAL problem

The error is logged by the **pages themselves**, not by `handleHttpError`. Every mutation page has:
```typescript
catch (error) {
  console.error('Failed to delete tag:', error);  // THIS causes the console error
}
```

### How admin-next solves it

admin-next's `withRetry` (lines 431-434) catches 403 and **returns `undefined` (no throw)**:
```typescript
if ((error as any)?.response?.status === 403) {
  return undefined as unknown as T;
}
```

This prevents the error from ever propagating to the page. The `console.error` in catch blocks never fires.

admin-next also has silent 403 handling in `handleHttpError` (line 275):
```typescript
if (status === 403) return;  // no toast, no console.error
```

## The Fix

### Strategy: Match admin-next's approach, plus toast + mutation method safety

#### Part 1: [`apps/admin-blog/src/api/http.ts`](apps/admin-blog/src/api/http.ts)

**A. `handleHttpError` (line 291-296)** — Make 403 **silent** (match admin-next):
```typescript
// 403 权限错误：静默处理，不弹 toast 不打印（withRetry 中处理）
if (status === 403) return;
```
*Remove the toast from here; it will be shown in `withRetry` instead.*

**B. `withRetry` (around line 414)** — Add 403 handling BEFORE the retry check (match admin-next):
```typescript
catch (error) {
  lastError = error;

  // 403 权限错误：VIEWER 写操作预期会被拒绝，弹 toast 提示，不抛错
  if ((error as any)?.response?.status === 403) {
    const data = (error as any)?.response?.data;
    const msg = data?.message || 'Forbidden';
    this.toastError(msg);
    return undefined as unknown as T;
  }
  // ... rest of retry logic
}
```

**C. `delete()`, `post()`, `put()`, `patch()` methods** — Handle `undefined` from `withRetry`:
```typescript
public async delete<T = any>(url, config?): Promise<T> {
  const res = await this.withRetry(() =>
    this.instance.delete<ApiResponse<T>>(url, config),
  );
  if (!res) return undefined as unknown as T;
  return res.data.data;
}
```
Same pattern for `post`, `put`, `patch`.

**D. Revert `retryCondition`** — The business error check is not needed since `withRetry` handles 403 first. Revert to plain condition like admin-next.

#### Part 2: Fix pages to check for `undefined` result

After Part 1, mutation calls will return `undefined` instead of throwing for 403. Pages must check `if (result === undefined) return;` before showing success toasts.

| # | File | Mutation | Pattern |
|---|------|----------|---------|
| 1 | [`tags/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/tags/page.tsx:66) | `deleteTag` | try/catch → add `if (!result) return;` |
| 2 | [`categories/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/categories/page.tsx:47) | `deleteCategory` | useMutation onSuccess → change to check result |
| 3 | [`articles/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx:80) | `deleteArticle` | useMutation onSuccess → change to check result |
| 4 | [`articles/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx:93) | `publishArticle` | useMutation onSuccess → change to check result |
| 5 | [`articles/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx:106) | `unpublishArticle` | useMutation onSuccess → change to check result |
| 6 | [`comments/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx:165) | `approveComment` | try/catch → add `if (!result) return;` |
| 7 | [`comments/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx:176) | `rejectComment` | try/catch → add `if (!result) return;` |
| 8 | [`comments/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx:202) | `deleteComment` | try/catch → add `if (!result) return;` |
| 9 | [`articles/create/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx:78) | `createArticle` | try/catch → add `if (!result) return;` |
| 10 | [`BlogCategoryModal.tsx`](apps/admin-blog/src/views/blog/BlogCategoryModal.tsx:44) | create/update | useMutation → change to check result |
| 11 | [`BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx:101) | create/update | useMutation → change to check result |

## Expected Behavior After Fix

| Scenario | Console | Toast | Page Success Toast |
|----------|---------|-------|-------------------|
| VIEWER deletes tag (403) | ❌ No error | ✅ "no permission: blog:tag_manage" | ❌ No |
| VIEWER deletes category (403) | ❌ No error | ✅ "no permission: blog:tag_manage" | ❌ No |
| VIEWER creates/publishes (403) | ❌ No error | ✅ Permission message | ❌ No |
| Normal user deletes (200) | ❌ No error | ❌ No | ✅ "Deleted successfully" |

## Flow Diagram

```
User clicks Delete → API returns HTTP 403
    ↓
Axios response interceptor (error handler)
    ↓  handleHttpError(error) → 403 → silent return (no toast, no console)
    ↓  return Promise.reject(error).catch(() => {})
    ↓
withRetry catch block
    ↓  checks (error as any)?.response?.status === 403
    ↓  YES → toastError(msg) → return undefined
    ↓
delete() receives undefined
    ↓  if (!res) return undefined;
    ↓
Page receives undefined
    ↓  if (!result) return;  ← skips success toast
    ↓  (no catch block fires → no console.error)
```

## Verification Steps

1. Run `cd apps/admin-blog && npx tsc --noEmit` to verify type safety
2. Test with VIEWER role user navigating to Tags/Categories/Articles/Comments
3. Click delete/create/publish — expect toast only, no console error, no success toast
4. Test with ADMIN role user — expect normal success flow unchanged
