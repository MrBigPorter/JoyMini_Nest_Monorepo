# Fix: SSE `MaxListenersExceededWarning` — Listener Leak Analysis

## Problem

Backend logs show `MaxListenersExceededWarning` — the `EventEmitter2` listener count for `blog.comment.reply.created` grows monotonically (3 → 4 → 5 → ... → 12) without decreasing, indicating SSE connection listeners are leaking.

## Root Cause Analysis

### Backend: [`frontend-blog.controller.ts`](../apps/api/src/blog/frontend/frontend-blog.controller.ts:285)

Each SSE connection registers two listeners on the global `EventEmitter2`:
```ts
this.eventEmitter.on('blog.comment.reply.created', replyHandler);   // line 357
this.eventEmitter.on('blog.comment.moderated', moderatedHandler);   // line 358
```

Cleanup is triggered by `req.on('close', forceCleanup)` (line 310), which removes the listeners. **However**, if the HTTP connection doesn't properly close (e.g., browser tab closed abruptly, or frontend EventSource not properly terminated), the `close` event never fires and listeners leak.

### Frontend: [`useCommentSSE.ts`](../apps/frontend-blog/src/lib/hooks/useCommentSSE.ts:141)

The cleanup calls `reg.es.close()` which should trigger HTTP close on the backend. But in React StrictMode (dev), the component mounts → unmounts → remounts rapidly. Each cycle creates a new `EventSource` connection. If the old connection's TCP FIN packet hasn't reached the backend before the new connection is established, the backend's `close` event for the old connection may be delayed or lost.

Additionally, the `articleId` parameter can change (e.g., from slug to DB ID when `articleDbId` loads), causing the effect to re-run with a new key, creating yet another SSE connection.

## Fix Plan

### Fix 1 (Backend): Increase `EventEmitter2` max listeners

The `EventEmitter2` is a global event bus — having many listeners for different SSE connections is expected. Increase the limit to avoid the warning.

**File:** [`apps/api/src/blog/frontend/frontend-blog.controller.ts`](../../apps/api/src/blog/frontend/frontend-blog.controller.ts)

In the constructor, add:
```ts
this.eventEmitter.setMaxListeners(100);
```

This is safe because:
- Each listener is properly scoped to a specific SSE subscriber
- Listeners are removed on connection close
- 100 is a reasonable upper bound for concurrent SSE connections

### Fix 2 (Frontend): Stabilize `articleId` to prevent unnecessary re-connections

**File:** [`apps/frontend-blog/src/components/blog/CommentList.tsx`](../apps/frontend-blog/src/components/blog/CommentList.tsx:320)

Wrap the `articleDbId || articleId` expression in `useMemo` or `useRef` to prevent the value from changing after initial mount:

```tsx
const sseArticleId = useMemo(() => articleDbId || articleId, [articleDbId, articleId]);
useCommentSSE(sseArticleId, articleId);
```

Or better, use `useRef` to lock the value on first render:
```tsx
const sseArticleIdRef = useRef(articleDbId || articleId);
useCommentSSE(sseArticleIdRef.current, articleId);
```

This prevents the effect from re-running when `articleDbId` loads asynchronously, avoiding duplicate SSE connections.

### Fix 3 (Backend): Add heartbeat timeout for stale connection cleanup

**File:** [`apps/api/src/blog/frontend/frontend-blog.controller.ts`](../../apps/api/src/blog/frontend/frontend-blog.controller.ts)

Add a heartbeat interval that periodically sends a comment to the client. If the client doesn't respond (or the response stream is broken), force-cleanup the connection. This is a more robust safety net.

```ts
const heartbeatTimer = setInterval(() => {
  try {
    subscriber.next({ data: { type: 'heartbeat' } } as MessageEvent);
  } catch {
    forceCleanup();
    clearInterval(heartbeatTimer);
  }
}, 30000); // every 30 seconds

// In forceCleanup:
clearInterval(heartbeatTimer);
```

## Summary of Changes

| # | File | Change | Priority |
|---|------|--------|----------|
| 1 | `apps/api/src/blog/frontend/frontend-blog.controller.ts` | Add `setMaxListeners(100)` in constructor | High |
| 2 | `apps/frontend-blog/src/components/blog/CommentList.tsx` | Stabilize SSE articleId with `useRef` | Medium |
| 3 | `apps/api/src/blog/frontend/frontend-blog.controller.ts` | Add heartbeat timeout for stale connection cleanup | Low (nice-to-have) |
