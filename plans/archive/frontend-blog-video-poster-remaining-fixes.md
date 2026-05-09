# Plan: Remaining Video + Poster Fixes for Article Detail Page

## Overview

Four remaining gaps identified across 5 previous plans. All are small, well-defined changes.

---

## Gap 1: Backend — Inject Poster into `<video>` Tag During Transcoding

**File**: `apps/api/src/common/media/media.processor.ts`

**Location**: In `handleTranscodeVideo()`, around the URL replacement section (lines 240-244).

**Current code** (lines 240-244):
```typescript
if (articleContent?.content?.includes(originalUrl)) {
  updatedData.content = articleContent.content.split(originalUrl).join(hlsUrl);
  needsUpdate = true;
}
```

**Change**: Before doing URL replacement, add a helper function `injectPosterIntoHtml()` that finds the `<video>` tag containing `originalUrl` and adds `poster="posterUrl"`.

```typescript
function injectPosterIntoHtml(html: string, originalUrl: string, posterUrl: string): string {
  if (!posterUrl || !html.includes(originalUrl)) return html;
  return html.replace(
    /<video([^>]*?src=["'][^"']*originalUrl[^"']*["'][^>]*?)>/gi,
    (match, attrs) => {
      if (/poster\s*=/i.test(match)) return match;
      return `<video${attrs} poster="${posterUrl}">`;
    }
  );
}
```

Then apply to both `content` and `contentLocalized`:
```typescript
if (articleContent?.content?.includes(originalUrl)) {
  let updatedContent = injectPosterIntoHtml(articleContent.content, originalUrl, posterUrl);
  updatedContent = updatedContent.split(originalUrl).join(hlsUrl);
  updatedData.content = updatedContent;
  needsUpdate = true;
}
```

**Why**: After this change, the stored HTML will have `<video ... poster="https://cdn/.../poster.jpg" ...>`. When `ArticleMarkdown` renders it, `video.getAttribute('poster')` will return the poster URL.

**Risk**: Low. The regex only targets `<video>` tags containing the specific originalUrl.

---

## Gap 2: Frontend — Add `meta` Prop to ArticleMarkdown as Poster Fallback

**File**: `apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx`

**Changes needed**:

### 2a. Add `meta` to props interface (line 60-62)
```typescript
import type { ArticleMeta } from '@/lib/types/frontend-blog';

interface ArticleMarkdownProps {
  content: string;
  meta?: ArticleMeta;
}
```

### 2b. Update component signature (line 128)
```typescript
export default function ArticleMarkdown({ content, meta }: ArticleMarkdownProps) {
```

### 2c. In the HTML path `useEffect` (around line 153-154), add fallback logic:
```typescript
// Get poster (from attribute or closest image sibling)
let poster = video.getAttribute('poster') || '';

// Fallback: try to find poster from article meta
if (!poster && meta?.video?.poster) {
  const videoSrc = video.getAttribute('src') || '';
  const sourceSrc = video.querySelector('source')?.getAttribute('src') || '';
  if (videoSrc === meta.video.hlsUrl || sourceSrc === meta.video.hlsUrl) {
    poster = meta.video.poster;
    video.setAttribute('poster', poster);
  }
}
```

**Why**: This is a safety net for articles processed before Gap 1 was deployed. Their stored HTML lacks `poster` attribute, but `meta.video.poster` exists in the database.

**Risk**: Low. Fallback only activates when `poster` attribute is empty AND the video's src matches `meta.video.hlsUrl`.

---

## Gap 3: Frontend — Pass `meta` and Fix Content Selection in `page.client.tsx`

**File**: `apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx`

### 3a. Fix content selection for translated articles (line 290-292)

Current:
```tsx
<ArticleMarkdown
  content={article.contentMd || article.content || ''}
/>
```

Changed to (Plan 3 fix):
```tsx
<ArticleMarkdown
  content={article.content?.includes('<video') && !article.contentMd?.includes('<video')
    ? article.content
    : (article.contentMd || article.content || '')}
  meta={article.meta}
/>
```

### 3b. Add coverImage hero section (Plan 4 Phase 4 + Plan 5)

Between the `<header>` block (line 273) and ArticleMarkdown (line 290), add:

```tsx
{/* Cover image / video — hero section */}
{article.coverImage ? (
  <div className="relative overflow-hidden rounded-xl mb-10 aspect-video">
    {isVideoUrl(article.coverImage) ? (
      article.meta?.video?.hlsUrl ? (
        <HlsVideoPlayer
          hlsUrl={article.meta.video.hlsUrl}
          poster={article.meta.video.poster}
          className="w-full h-full object-cover"
          clickToPlay
        />
      ) : (
        <NativeVideoPlayer
          src={article.coverImage}
          poster={article.meta?.video?.poster}
          className="w-full h-full"
        />
      )
    ) : (
      <BlurhashImage
        src={article.coverImage}
        alt={article.title}
        fill
        priority
        blurhash={article.meta?.images?.blurhash}
        className="object-cover"
        sizes="(max-width: 768px) 100vw, 1024px"
      />
    )}
  </div>
) : null}
```

**New imports needed** (add at top of file):
```typescript
import { isVideoUrl } from '@/lib/utils/media';
import { HlsVideoPlayer } from '@/components/blog/HlsVideoPlayer';
import { NativeVideoPlayer } from '@/components/blog/NativeVideoPlayer';
import { BlurhashImage } from '@/components/blog/BlurhashImage';
```

---

## Execution Order

| # | Step | File | Depends On |
|---|------|------|------------|
| 1 | Inject poster in backend transcoding | [`media.processor.ts`](apps/api/src/common/media/media.processor.ts:240) | None |
| 2 | Add `meta` prop + fallback to ArticleMarkdown | [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:60) | None (independent of #1) |
| 3 | Fix content selection for translated articles | [`page.client.tsx:290`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx:290) | #2 (passes `meta`) |
| 4 | Add coverImage hero section | [`page.client.tsx:273`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx:273) | None (independent) |

Steps 2, 3, 4 are frontend-only and can be deployed together. Step 1 is backend-only.

---

## Verification

1. Upload video in admin Quill editor → verify transcoding completes
2. Check DB: `content` should have `<video poster="...">` attribute
3. Frontend article detail: verify poster shows as video cover before click
4. Switch locale to English → verify video still shows (not hidden in translated content)
5. Article with `coverImage` (image URL): verify hero image renders between header and markdown
6. Article with `coverImage` (video URL): verify hero video renders with poster
7. Existing articles (processed before this fix): verify poster fallback from `meta.video.poster` works after client refetch
