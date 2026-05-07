# Consolidated Fix Plan

Three issues to address in the frontend-blog application. All are independent and can be implemented in any order.

---

## Issue 1: Frontend Blog Language Reset on Navigation

### Root Cause
In [`page.client.tsx`](apps/frontend-blog/src/app/[locale]/articles/%5Bslug%5D/page.client.tsx:108), `handleBack()` uses [`router.back()`](apps/frontend-blog/src/app/[locale]/articles/%5Bslug%5D/page.client.tsx:112) from [`next/navigation`](apps/frontend-blog/src/app/[locale]/articles/%5Bslug%5D/page.client.tsx:6) (not locale-aware). When a user:
1. Starts at `/en/` (homepage)
2. Opens article → `/en/articles/slug` (history: `/en/`, `/en/articles/slug`)
3. Switches language to Japanese → `router.replace(pathname, { locale: 'ja' })` **replaces** the previous history entry with `/ja/articles/slug`
4. History becomes: `/en/`, `/ja/articles/slug` (the original `/en/articles/slug` was replaced)
5. Clicks back → `router.back()` navigates to `/en/` (English!) instead of the current locale `/ja/`

### Fix (2 changes in 1 file)

**File:** [`page.client.tsx`](apps/frontend-blog/src/app/[locale]/articles/%5Bslug%5D/page.client.tsx)

1. **Change import** (line 6): `import { useParams, useRouter } from 'next/navigation'` → `import { useParams } from 'next/navigation'` + `import { useRouter } from '@/navigation'`

2. **Change `handleBack`** (lines 108-115): Replace `router.back()` with `router.push('/')` because `@/navigation`'s `router.push('/')` automatically prepends the current locale (navigates to `/{currentLocale}/`).
   ```typescript
   const handleBack = useCallback(() => {
     setNavDirection('backward');
     router.push('/');
   }, [router]);
   ```

> **Scroll position preservation**: Already handled by existing `sessionStorage` + `useLayoutEffect` mechanism in [`page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.client.tsx:239-253).

---

## Issue 2: Article Card Height Inconsistency (Missing Excerpt)

### Root Cause
In [`ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx:304-308), the excerpt `<p>` renders conditionally with `!compact` but does **not** enforce a minimum height:
```typescript
{!compact && (
  <p className="break-words text-slate-600 dark:text-slate-400 text-sm leading-relaxed line-clamp-2 mt-1">
    {article.excerpt}
  </p>
)}
```

When `article.excerpt` is `null`/`undefined`/empty, the `<p>` renders with zero text height. In the bookmarks page's 3-column grid ([`lg:grid-cols-3`](apps/frontend-blog/src/app/%5Blocale%5D/bookmarks/page.client.tsx:151)), cards without excerpt are visibly shorter than adjacent cards with excerpt.

### Fix (1 CSS class addition)

**File:** [`ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx:305)

Add `min-h-[3rem]` to the excerpt paragraph's className. This reserves enough vertical space for approximately 2 lines of `text-sm` text, maintaining uniform card height regardless of excerpt presence.

```diff
- <p className="break-words text-slate-600 dark:text-slate-400 text-sm leading-relaxed line-clamp-2 mt-1">
+ <p className="break-words text-slate-600 dark:text-slate-400 text-sm leading-relaxed line-clamp-2 mt-1 min-h-[3rem]">
```

> **Why `min-h-[3rem]`?** `text-sm` = 14px, `leading-relaxed` ≈ 1.625, so 14 × 1.625 × 2 lines ≈ 45.5px. `3rem` = 48px ≈ 2 lines worth of space.

---

## Issue 3: Real-time Comment Replies via SSE

### Context
Currently, when a user submits a comment:
- AI moderation runs via BullMQ processor
- If approved and score < 30, an auto-reply is generated after 30s delay
- The [frontend polls](apps/frontend-blog/src/lib/utils/commentStatus.ts:150) via `setInterval` for the **comment's own approval status**
- But **new replies** (AI auto-replies or admin replies) are NOT pushed — users must refresh to see them

The backend already has SSE infrastructure: `@Sse()` decorator used in [`blog.controller.ts`](apps/api/src/blog/blog.controller.ts:428) and `EventEmitter2` is globally registered.

### Backend Changes

#### 3a. Add EventEmitter to `blog-ai.processor.ts`

**File:** [`blog-ai.processor.ts`](apps/api/src/blog/processors/blog-ai.processor.ts)

- Inject `EventEmitter2` into `BlogAiProcessor`
- After creating the auto-reply (line 906), emit an event:
  ```typescript
  this.eventEmitter.emit('blog.comment.reply.created', {
    articleId: comment.articleId,
    parentId: comment.id,
    reply: { ...createdReply },
  });
  ```

#### 3b. Create SSE endpoint in `FrontendBlogController`

**File:** [`frontend-blog.controller.ts`](apps/api/src/blog/frontend/frontend-blog.controller.ts)

Add a new `@Sse()` endpoint:
```typescript
import { Sse, MessageEvent } from '@nestjs/common';
import { Observable, fromEvent } from 'rxjs';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Get('articles/:slug/comments/stream')
@Sse()
streamCommentReplies(
  @Param('slug') slug: string,
): Observable<MessageEvent> {
  return new Observable<MessageEvent>((subscriber) => {
    const handler = (payload: { articleId: string; parentId: string; reply: any }) => {
      subscriber.next({
        data: payload,
      } as MessageEvent);
    };

    this.eventEmitter.on('blog.comment.reply.created', handler);
    
    return () => {
      this.eventEmitter.off('blog.comment.reply.created', handler);
    };
  });
}
```

> Need to look up the article's ID from slug → this requires injecting `BlogService`.

Alternatively, use articleId directly in the URL: `GET /v1/frontend/blog/comments/stream?articleId=xxx`

#### 3c. Also emit event for admin replies

**File:** [`comment.controller.ts`](apps/api/src/blog/comment/comment.controller.ts) or [`comment.service.ts`](apps/api/src/blog/comment/comment.service.ts)

When an admin creates/updates a comment with a reply, also emit `blog.comment.reply.created`.

### Frontend Changes

#### 3d. Create `useCommentSSE` hook

**File:** [`apps/frontend-blog/src/lib/hooks/useCommentSSE.ts`](apps/frontend-blog/src/lib)

Adapt from the existing [`useSSE.ts`](apps/admin-blog/src/hooks/useSSE.ts) in admin-blog:

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useCommentSSE(articleId: string) {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!articleId) return;

    const url = `${process.env.NEXT_PUBLIC_API_URL}/v1/frontend/blog/articles/${articleId}/comments/stream`;
    const es = new EventSource(url, { withCredentials: true });

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Invalidate comments cache to trigger re-fetch
        queryClient.invalidateQueries({
          queryKey: ['comments', 'infinite', articleId],
        });
      } catch {
        // Ignore non-JSON messages
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects by default
    };

    eventSourceRef.current = es;

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [articleId, queryClient]);

  return null;
}
```

#### 3e. Integrate into `CommentList.tsx`

**File:** [`CommentList.tsx`](apps/frontend-blog/src/components/blog/CommentList.tsx)

Add the hook call at the top of the component:
```typescript
import { useCommentSSE } from '@/lib/hooks/useCommentSSE';

export default function CommentList({ articleId }: CommentListProps) {
  useCommentSSE(articleId);
  // ... rest of component
}
```

When SSE pushes a new reply event, `queryClient.invalidateQueries` triggers a background refetch of the comments list, showing the new reply in real-time.

---

## Summary of Changes

| # | File | Change Type | Complexity |
|---|------|-------------|------------|
| 1 | `frontend-blog/.../articles/[slug]/page.client.tsx` | 2 lines changed | Low |
| 2 | `frontend-blog/.../ArticleCard.tsx` | 1 CSS class added | Low |
| 3a | `api/.../blog-ai.processor.ts` | Inject EventEmitter + emit event | Medium |
| 3b | `api/.../frontend-blog.controller.ts` | New @Sse() endpoint | Medium |
| 3c | `api/.../comment.service.ts` | Emit event on admin reply | Medium |
| 3d | `frontend-blog/.../useCommentSSE.ts` | New hook file | Medium |
| 3e | `frontend-blog/.../CommentList.tsx` | 3 lines added (import + hook) | Low |
