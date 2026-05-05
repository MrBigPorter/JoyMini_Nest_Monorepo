# Comment System Fix Plan

## Root Cause Analysis

### Issue 1: Comments don't appear on frontend screen

**Flow Trace**:

```
CommentList.tsx
  └─ usePostComment(articleId)  ← articleId = article.slug
       └─ frontendBlogApi.postComment(articleId, data)
            └─ POST /api/v1/frontend/blog/articles/{slug}/comments
                 └─ FrontendBlogController.createComment()
                      └─ BlogService.createComment(slug, dto)
                           ├─ Creates comment with status: 'PENDING'
                           ├─ Increments article.commentCount
                           └─ Queues AI moderation job (1s delay)

  └─ onSuccess → invalidateQueries(['comments', 'infinite', articleId, locale])
       └─ Refetch → GET /api/v1/frontend/blog/articles/{slug}/comments
            └─ BlogService.getArticleComments(slug)
                 └─ WHERE status: 'APPROVED'  ← PENDING comments excluded!
                      └─ Returns empty → user sees nothing
```

**Key Problem**: `usePostComment` has **no optimistic update** (`onMutate`). The mutation just does `invalidateQueries` on success, but the refetch GET endpoint only returns `APPROVED` comments. A newly submitted `PENDING` comment is invisible.

The `Comment` component has code for `temp-` prefixed IDs (optimistic pattern at line 63), but the mutation never creates one — there's no `onMutate` in the mutation. So there's **zero immediate feedback** to the user.

### Issue 2: Admin blog has no comment records

**Flow Trace**:

```
Admin comments/page.tsx
  └─ blogApi.getComments({}) → GET /api/v1/admin/blog/comments
       └─ CommentController.getAllComments()
            └─ CommentService.getAllComments()
                 └─ Prisma findMany (no status filter)
                      └─ Returns ALL comments regardless of status
```

The admin endpoint returns **all** comments (PENDING, APPROVED, REJECTED, SPAM). If admin shows empty, it means the `blogComment` table is empty — comments are **not being persisted**.

### Combined Root Cause

Since admin shows empty AND frontend shows no comments, the most likely cause is: **comments aren't being created in the database at all**.

Possible failure points:
1. **POST endpoint returns error silently** — The `usePostMutation` `onError` handler shows a toast, but the `http.post` response interceptor in `http.ts` returns `res.data.data` directly. If the API wraps errors differently, the error might be swallowed.
2. **JWT Auth Guard blocks unauthenticated requests** — The POST endpoint at `FrontendBlogController.createComment()` has `@UseGuards(JwtAuthGuard)`. If the frontend auth token is invalid/missing, the request returns 401 and the mutation enters `onError`. The user may not notice the error toast.
3. **DTO validation failure** — The `ValidationPipe` has `forbidNonWhitelisted: true` and `whitelist: true`. If the request body contains unexpected fields, it fails validation silently.

---

## Investigation Steps (to confirm root cause)

### Step 1: Check if POST comment endpoint works

- Open browser DevTools Network tab
- Submit a comment on the frontend blog
- Look for the POST request to `/api/v1/frontend/blog/articles/{slug}/comments`
- Check the response status code and body

### Step 2: Check the API server logs

- Check NestJS backend logs for the comment POST request
- Look for any validation errors, 401 auth errors, or 404 article-not-found errors

### Step 3: Check the admin comment page response

- Open admin browser DevTools Network tab
- Navigate to `/blog/comments`
- Check the GET `/api/v1/admin/blog/comments` response
- Verify if the response actually returns empty `items` or if the request fails

---

## Fix Plan (once root cause is confirmed)

### Fix A: Add optimistic update to `usePostComment`

**File**: `apps/frontend-blog/src/lib/hooks/useComments.ts`

Add `onMutate` to the mutation that:
1. Generates a temp ID (e.g., `temp-${Date.now()}`)
2. Creates a temporary comment object with `id: tempId`, `status: 'PENDING'`, and `author: 'Anonymous'`
3. Injects it into the React Query cache for `['comments', 'infinite', articleId, locale]`
4. Returns context for rollback in `onError`

Also update `useCommentsAdapter.ts` if needed to handle temp comments properly.

### Fix B: Add immediate comment status polling

**File**: `apps/frontend-blog/src/lib/utils/commentStatus.ts`

The `commentStatusManager` already exists and handles polling. Ensure that after `usePostComment` succeeds:
1. The real comment ID (returned from POST API) is registered with `commentStatusManager`
2. Polling starts immediately to check when status changes from PENDING → APPROVED
3. When approved, the temp comment gets updated with the real data

### Fix C: Backend — optionally return PENDING comments with a flag

Alternatively, the GET endpoint could return PENDING comments created by the current user (identified by JWT token), so the frontend doesn't need to poll. But this is more complex.

### Fix D: Verify admin CommentModule dependencies

**File**: `apps/api/src/blog/comment/comment.module.ts`

If the admin endpoint doesn't work, verify `PrismaModule` is available. Since `PrismaModule` is `@Global()`, it should be available. But check if there are any circular dependency issues with `AiModule`.

---

## Files to Modify

| File | Change |
|------|--------|
| `apps/frontend-blog/src/lib/hooks/useComments.ts` | Add `onMutate` for optimistic update in `usePostComment` |
| `apps/frontend-blog/src/lib/utils/commentStatus.ts` | Ensure polling integration with real comment ID from POST response |
| `apps/frontend-blog/src/components/blog/CommentList.tsx` | Minor adjustments if needed for temp comment display |

## Verification

1. Submit a comment → should appear immediately as "pending review" badge
2. Check admin blog → should show the comment as PENDING
3. After AI moderation approves → comment badge changes to "approved"
4. On page refresh → comment is shown normally (no temp prefix)
