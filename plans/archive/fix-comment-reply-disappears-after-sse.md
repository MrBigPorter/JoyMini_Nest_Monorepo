# Fix: Comment Reply Disappears After SSE Reply Event

## Root Cause Analysis

### Problem

When a user replies to a comment, the reply appears in the UI immediately (via optimistic update), but then disappears after ~5 seconds.

### Full Flow Trace

```
1. User submits reply → usePostComment mutation fires
2. onMutate: temp comment (temp-xxx) inserted into React Query cache as ROOT comment
3. API: POST /v1/frontend/blog/articles/{slug}/comments → returns real comment ID
4. onSuccess: temp ID → real ID in cache, starts commentStatusManager polling
5. Backend queues AI moderation job (BullMQ, 1s delay)
6. AI moderation approves → DB updated to APPROVED
7. Backend emits TWO SSE events:
   a. blog.comment.moderated → { commentId, articleId, status: 'approved' }
   b. blog.comment.reply.created → { articleId, parentId, replyId, content, ... }
8. Frontend SSE handler receives events:
   a. moderated → commentStatusManager.updateByRealId() → no visual change
   b. reply → insertReplyIntoCache() inserts reply as child of parent
      → THEN schedules invalidateQueries after 5 seconds
9. ⚠️ 5 seconds later: invalidateQueries triggers refetch
   → Backend PublicCacheInterceptor returns STALE cached response (60s TTL)
   → Cached response doesn't include the new comment
   → React Query cache is REPLACED with stale data
   → Comment DISAPPEARS from UI
```

### Root Cause

**The `invalidateQueries` call in [`useCommentSSE.ts`](apps/frontend-blog/src/lib/hooks/useCommentSSE.ts:88-93) is the culprit.**

After the SSE `reply` event handler successfully inserts the reply into the cache via `insertReplyIntoCache`, it schedules `invalidateQueries` after 5 seconds:

```typescript
// Line 86-94 in useCommentSSE.ts
const inserted = insertReplyIntoCache(queryClient, cacheKey, replyData);
if (inserted) {
  setTimeout(() => {
    queryClient.invalidateQueries({
      queryKey: ['comments', 'infinite', cacheKey],
      refetchType: 'active',
    });
  }, 5000);
}
```

This triggers a network refetch to `GET /v1/frontend/blog/articles/{slug}/comments`. However, the backend endpoint has:

1. **`@CacheTTL(60)`** — 60-second server-side cache via `cache-manager`
2. **`@UseInterceptors(PublicCacheInterceptor)`** — intercepts GET requests and caches responses using a composite key of `path + query + locale + platform`

The [`PublicCacheInterceptor`](apps/api/src/common/cache/public-cache.interceptor.ts:27-73) creates cache keys like:
```
v1|GET|/frontend/blog/articles/{slug}/comments?page=1&pageSize=20|en|h5
```

Since the initial page load cached this response (without the new comment), and the 60-second TTL hasn't expired, the `invalidateQueries` refetch returns the **stale cached response** that doesn't include the newly approved reply. React Query then replaces its cache with this stale data, causing the comment to vanish.

### Why This Only Affects Replies (Not Top-Level Comments)

- **Top-level comments**: Only the `moderated` SSE event is emitted. No `reply` event → no `invalidateQueries` → no refetch → comment stays visible.
- **Replies**: Both `moderated` AND `reply` events are emitted. The `reply` event triggers `invalidateQueries` → stale cache refetch → comment disappears.

### Secondary Issue: Duplicate Comment Positions

The optimistic update places the reply as a **root-level comment** (because the temp comment has no parent context). The SSE `reply` event then inserts it as a **child** of the parent. After the refetch (if it worked correctly), the server returns the correct tree structure. But since the refetch returns stale data, the reply is lost entirely.

---

## Fix Strategy

### Primary Fix: Remove `invalidateQueries` from SSE Reply Handler

The `insertReplyIntoCache` function already correctly inserts the reply into the React Query cache. The subsequent `invalidateQueries` is:

1. **Redundant** — the data is already in the cache
2. **Harmful** — it triggers a refetch that returns stale backend-cached data
3. **Unnecessary** — SSE provides real-time updates, so the cache stays in sync

**Action**: Remove the `setTimeout` + `invalidateQueries` block from [`useCommentSSE.ts`](apps/frontend-blog/src/lib/hooks/useCommentSSE.ts:86-94).

### Secondary Fix: Update `total` Count in `insertReplyIntoCache`

After removing the refetch, the comment count (`total` field in paginated response) won't be updated. We should increment the `total` of the first page when inserting a reply.

**Action**: In [`insertReplyIntoCache`](apps/frontend-blog/src/lib/hooks/useCommentSSE.ts:169-276), also update `old.pages[0].total += 1` when a reply is successfully inserted.

### Optional Enhancement: Backend Cache Invalidation

For defense in depth, we could also invalidate the backend cache when a comment is approved. However, this is more complex and the primary fix should be sufficient since SSE keeps the frontend cache in sync.

---

## Changes Required

### File 1: [`apps/frontend-blog/src/lib/hooks/useCommentSSE.ts`](apps/frontend-blog/src/lib/hooks/useCommentSSE.ts)

**Change A**: Remove the `setTimeout` + `invalidateQueries` block (lines 86-94).

**Change B**: In `insertReplyIntoCache`, update the `total` count when a reply is inserted.

**Before (lines 86-94):**
```typescript
const inserted = insertReplyIntoCache(queryClient, cacheKey, replyData);
if (inserted) {
  setTimeout(() => {
    queryClient.invalidateQueries({
      queryKey: ['comments', 'infinite', cacheKey],
      refetchType: 'active',
    });
  }, 5000);
}
```

**After:**
```typescript
insertReplyIntoCache(queryClient, cacheKey, replyData);
// No invalidateQueries needed — insertReplyIntoCache already updates the cache
// and SSE provides real-time updates. Refetching would return stale backend-cached data.
```

**Before (in `insertReplyIntoCache`, around line 270):**
```typescript
anyInserted = true;
return { ...old, pages: updatedPages };
```

**After:**
```typescript
anyInserted = true;
// Also update the total count to keep comment count accurate
if (old.pages[0]) {
  return {
    ...old,
    pages: [
      { ...old.pages[0], total: (old.pages[0].total || 0) + 1 },
      ...old.pages.slice(1),
    ],
  };
}
return { ...old, pages: updatedPages };
```

---

## Verification

1. Submit a reply to a comment
2. Verify the reply appears immediately (optimistic update)
3. Wait for AI moderation to complete (SSE events)
4. Verify the reply remains visible after 5+ seconds (no disappearance)
5. Verify the comment count is updated correctly
6. Test with top-level comments to ensure no regression
7. Test page refresh to confirm the reply persists in the database
