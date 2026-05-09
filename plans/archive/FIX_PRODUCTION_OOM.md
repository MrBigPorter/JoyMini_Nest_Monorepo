# Production JavaScript Heap Out of Memory (OOM) Analysis & Fix Plan

## What Happened

The **NestJS backend API** (`lucky-backend-prod`) crashed in production with:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

This is a V8 heap OOM on the **backend** container (not frontend).

## Root Cause Analysis

### 1. Primary Cause: `--max-old-space-size=300` Is Too Tight

From [`compose.prod.yml`](../compose.prod.yml:41):
```yaml
- NODE_OPTIONS=--max-old-space-size=300
```

The GC trace confirms:
```
Mark-Compact 289.0 (302.1) -> 288.9 (302.1) MB
```

Memory is at **289 MB / 302 MB** — within 4% of the artificial limit. The application simply needed more memory than the 300 MB ceiling allows.

### 2. SSE Connection Accumulation (Amplifier)

The SSE endpoint at [`frontend-blog.controller.ts:281`](../apps/api/src/blog/frontend/frontend-blog.controller.ts:281) creates two EventEmitter listeners per connection:

```typescript
this.eventEmitter.on('blog.comment.reply.created', replyHandler);
this.eventEmitter.on('blog.comment.moderated', moderatedHandler);
```

**Problem:** If the client disconnects without a clean TCP FIN (e.g., mobile network drop, browser background tab suspended), the Observable teardown (`return () => {...}`) may not fire, leaving orphan EventEmitter listeners that:
- Hold references to the `subscriber` object
- Prevent the HTTP response object from being GC'd
- Accumulate over time, slowly leaking memory

Each SSE connection also holds:
- An open HTTP response stream
- The `subscriber` object from `new Observable()`
- The closure scope containing `replyHandler` and `moderatedHandler`

### 3. Prisma Memory Footprint

The `blog.service.ts` (3758 lines) is a massive service. Prisma query results with deeply nested `include` relations (articles + category + tags + author) can allocate significant memory per request, especially with the `mapArticleToLocalized()` transformation that creates intermediate objects.

## Action Plan

### Step 1: Increase Heap Limit in compose.prod.yml

**File:** [`compose.prod.yml:41`](../compose.prod.yml:41)

Change:
```yaml
- NODE_OPTIONS=--max-old-space-size=300
```
To:
```yaml
- NODE_OPTIONS=--max-old-space-size=400
```

And increase the container memory limit from 500M to 600M:
```yaml
deploy:
  resources:
    limits:
      memory: 600M
    reservations:
      memory: 200M
```

**Rationale:** 300 MB is simply too low for a NestJS app with Prisma + BullMQ + SSE. The 1GB VPS budget has room:
- OS: ~130 MB
- Nginx: ~30 MB
- Redis: ~150 MB (capped)
- PostgreSQL: ~200 MB
- **Backend: 600 MB (new)**
- Total: ~1110 MB — swap will cover the small overshoot

### Step 2: Add Memory Monitoring & Graceful Shutdown

Add a health check endpoint that reports memory usage, and set up a cron to restart the container if memory exceeds 80% of limit.

**File:** [`compose.prod.yml:51`](../compose.prod.yml:51)

Enhance healthcheck:
```yaml
healthcheck:
  test: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/v1/health >/dev/null 2>&1 || exit 1"]
  interval: 10s
  timeout: 3s
  retries: 10
```

**Plus**, add a memory-aware Node.js shutdown hook in the backend `main.ts` that:
- Sets `--max-old-space-size` to 400 (already done)
- Periodically checks `process.memoryUsage().heapUsed / heapTotal`
- If > 85%, triggers graceful shutdown + container restart

### Step 3: Fix SSE Connection Cleanup

**File:** [`frontend-blog.controller.ts:281-350`](../apps/api/src/blog/frontend/frontend-blog.controller.ts:281)

**Problem:** The SSE teardown relies on the Observable's `return` function, which only fires on explicit unsubscription. HTTP SSE connections may not trigger this properly on abnormal disconnects.

**Fix:** Add a `req.on('close', ...)` handler as a safety net that forces cleanup even if the Observable teardown doesn't fire:

```typescript
commentStream(
  @Query('articleId') articleId?: string,
  @Req() req: Request,
): Observable<MessageEvent> {
  return new Observable<MessageEvent>((subscriber) => {
    const replyHandler = (payload: ...) => { ... };
    const moderatedHandler = (payload: ...) => { ... };
    
    this.eventEmitter.on('blog.comment.reply.created', replyHandler);
    this.eventEmitter.on('blog.comment.moderated', moderatedHandler);
    
    // Safety net: force cleanup on HTTP connection close
    req.on('close', () => {
      this.eventEmitter.off('blog.comment.reply.created', replyHandler);
      this.eventEmitter.off('blog.comment.moderated', moderatedHandler);
      if (!subscriber.closed) {
        subscriber.unsubscribe();
      }
    });
    
    return () => {
      this.eventEmitter.off('blog.comment.reply.created', replyHandler);
      this.eventEmitter.off('blog.comment.moderated', moderatedHandler);
    };
  });
}
```

Also add `@Req() req: Request` to the method parameters.

### Step 4: Add SSE Connection Rate Limiting

Prevent abuse by limiting SSE connections per IP/client. Add throttling:

```typescript
import { ThrottlerGuard } from '@nestjs/throttler';

@Get('comments/stream')
@Sse()
@UseGuards(ThrottlerGuard) // or create a custom SSE throttle guard
@SkipThrottle(false) // ensure throttling is applied
commentStream(...) { ... }
```

### Step 5: Monitor and Optimize Prisma Queries

Review `blog.service.ts` for large queries that may hold memory. Key areas:

1. **`getArticleComments()` at line 1843** - Loads ALL approved comments before tree-building. For articles with thousands of comments, this loads everything into memory at once. Consider loading only root comments + children via recursive CTE or pagination.

2. **`mapArticleToLocalized()` at line 844** - Creates deep copies of article objects. Could use a more memory-efficient mapping.

### Step 6: Add Docker Restart Policy with Backoff

The `restart: unless-stopped` policy will restart immediately, which could cause a crash loop. Add a small healthcheck delay:

Already has `interval: 10s` which provides some backoff.

## Summary Checklist

| # | Action | File | Priority |
|---|--------|------|----------|
| 1 | Increase `--max-old-space-size` from 300 to 400 | `compose.prod.yml` | **Critical** |
| 2 | Increase container memory limit from 500M to 600M | `compose.prod.yml` | **Critical** |
| 3 | Add `req.on('close')` safety net to SSE endpoint | `frontend-blog.controller.ts` | High |
| 4 | Add SSE rate limiting | `frontend-blog.controller.ts` | Medium |
| 5 | Optimize Prisma queries that load all comments | `blog.service.ts` | Medium |
| 6 | Add memory monitoring / alerting | `main.ts` or monitoring | Low |
