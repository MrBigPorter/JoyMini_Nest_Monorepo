# SSE Streaming Architecture for `detect-incomplete` Endpoint

## Overview

Replace the current request-response API with Server-Sent Events SSE streaming, so the frontend receives progressive results as each batch of articles is processed.

---

## Architecture

```
Frontend                         Backend (NestJS)
   │                                 │
   │  GET /api/v1/admin/blog/        │
   │  translation/detect-incomplete/ │
   │  stream?lang=en                 │
   │─────────────────────────────────►│
   │                                 │
   │  SSE: event: progress           │
   │  data: { processed: 10,         │
   │  │      total: 50, ... }        │
   │◄─────────────────────────────────│
   │                                 │
   │  SSE: event: progress           │
   │  data: { processed: 20,         │
   │  │      total: 50, ... }        │
   │◄─────────────────────────────────│
   │                                 │
   │  ...                            │
   │                                 │
   │  SSE: event: complete           │
   │  data: { total: 50,             │
   │  │      incompleteCount: 3,     │
   │  │      completionRate: 94,     │
   │  │      incompleteArticles:[...]│
   │  │    }                         │
   │◄─────────────────────────────────│
```

---

## Backend Changes

### 1. Controller - New SSE Endpoint

File: [`apps/api/src/blog/blog.controller.ts`](apps/api/src/blog/blog.controller.ts)

Add a new endpoint alongside the existing one:

```typescript
import { Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Get('translation/detect-incomplete/stream')
@Sse()
@ApiBearerAuth()
@ApiOperation({ summary: 'SSE流式检测翻译不完整的文章' })
detectIncompleteStream(
  @Query('lang') targetLang: string = 'en'
): Observable<MessageEvent> {
  return this.blogService.detectIncompleteTranslationsStream(targetLang);
}
```

Keep the original endpoint for backwards compatibility or deprecate it.

### 2. Service - Stream Method

File: [`apps/api/src/blog/blog.service.ts`](apps/api/src/blog/blog.service.ts)

New method using RxJS Observable:

```typescript
import { Observable } from 'rxjs';

async detectIncompleteTranslationsStream(
  targetLang: string = 'en'
): Promise<Observable<MessageEvent>> {
  return new Observable<MessageEvent>((subscriber) => {
    (async () => {
      const BATCH_SIZE = 10;
      const incompleteArticles = [];
      let totalProcessed = 0;
      let cursor: string | null = null;
      let hasMore = true;

      // First, get total count
      const total = await this.prisma.blogArticle.count({
        where: { status: { not: 'DRAFT' } },
      });

      while (hasMore) {
        const batch = await this.prisma.blogArticle.findMany({
          where: { status: { not: 'DRAFT' } },
          select: {
            id: true, slug: true, title: true,
            titleLocalized: true, contentMd: true,
            contentMdLocalized: true, excerpt: true,
            excerptLocalized: true, translationStatus: true,
          },
          take: BATCH_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          orderBy: { id: 'asc' },
        });

        if (batch.length === 0) { hasMore = false; break; }

        for (const article of batch) {
          // ... same detection logic as Plan A ...
        }

        totalProcessed += batch.length;
        cursor = batch[batch.length - 1].id;
        hasMore = batch.length === BATCH_SIZE;

        // Emit progress event after each batch
        subscriber.next({
          type: 'progress',
          data: {
            processed: totalProcessed,
            total,
            incompleteSoFar: incompleteArticles.length,
          },
        } as MessageEvent);
      }

      // Emit final complete event
      subscriber.next({
        type: 'complete',
        data: {
          total: totalProcessed,
          incompleteCount: incompleteArticles.length,
          completionRate: (
            ((totalProcessed - incompleteArticles.length) / totalProcessed) * 100
          ).toFixed(2),
          incompleteArticles,
        },
      } as MessageEvent);

      subscriber.complete();
    })().catch((err) => subscriber.error(err));
  });
}
```

### 3. Keep Original Method

Keep the original [`detectIncompleteTranslations()`](apps/api/src/blog/blog.service.ts:3213) method for `retranslateIncompleteArticles()` which still calls it synchronously.

---

## Frontend Changes

### 1. Hook or Utility

Create a custom hook for SSE consumption:

```typescript
// apps/admin-blog/src/hooks/useSSE.ts
export function useDetectIncompleteSSE(lang: string) {
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const start = useCallback(() => {
    const eventSource = new EventSource(
      `/api/v1/admin/blog/translation/detect-incomplete/stream?lang=${lang}`
    );

    eventSource.addEventListener('progress', (e) => {
      setProgress(JSON.parse(e.data));
    });

    eventSource.addEventListener('complete', (e) => {
      setResults(JSON.parse(e.data));
      eventSource.close();
    });

    eventSource.onerror = (err) => {
      setError(err);
      eventSource.close();
    };

    return () => eventSource.close();
  }, [lang]);

  return { start, progress, results, error };
}
```

### 2. Update Frontend Component

File: [`apps/admin-blog/src/views/blog/BlogTranslationQualityDetection.tsx`](apps/admin-blog/src/views/blog/BlogTranslationQualityDetection.tsx)

- Replace `fetch`/`axios` call with `useDetectIncompleteSSE` hook
- Add progress bar showing `processed / total`
- Display results incrementally as they arrive
- Handle loading / error states

---

## Data Flow

```
┌─────────────┐    HTTP/SSE     ┌──────────────┐    Prisma    ┌──────────┐
│  Frontend   │◄───────────────│  NestJS API  │◄───────────│PostgreSQL│
│  (Next.js)  │    events       │  Controller  │   batches   │          │
└─────────────┘                 │      +       │             └──────────┘
                                │  Service     │
                                └──────────────┘
                                            │
                                            │ calls
                                            ▼
                                     ┌──────────┐
                                     │  Quality  │
                                     │ Detection │
                                     │  (regex)  │
                                     └──────────┘
```

---

## Files to Modify

| File | Change |
|---|---|
| [`apps/api/src/blog/blog.controller.ts`](apps/api/src/blog/blog.controller.ts) | Add new `@Sse()` endpoint |
| [`apps/api/src/blog/blog.service.ts`](apps/api/src/blog/blog.service.ts) | Add `detectIncompleteTranslationsStream()` method |
| [`apps/admin-blog/src/hooks/useSSE.ts`](apps/admin-blog/src/hooks/useSSE.ts) | New file: SSE hook |
| [`BlogTranslationQualityDetection.tsx`](apps/admin-blog/src/views/blog/BlogTranslationQualityDetection.tsx) | Replace fetch with SSE hook, add progress bar |

---

## Notes

- SSE is unidirectional server→client, simpler than WebSocket
- NestJS `@Sse()` returns `Observable<MessageEvent>` natively
- The original endpoint stays intact for `retranslateIncompleteArticles`
- SSE connections may timeout with proxies/nginx; configure `proxy_read_timeout` if needed
