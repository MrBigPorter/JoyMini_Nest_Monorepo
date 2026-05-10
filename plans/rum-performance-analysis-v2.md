# RUM Performance Issues Analysis v2 — JoyMini Blog

> Based on latest RUM Web Vitals data. This plan builds on the previous fixes from `plans/archive/rum-performance-optimization-analysis.md`.

---

## Current RUM Data Summary

| Issue | Element | LCP | Page | Status |
|-------|---------|-----|------|--------|
| 1 | `img.object-cover` (hero cover via `/cdn-cgi/image/`) | **4,644ms** | `/zh/articles/nextjs-admin-middleware-jwt/` | 🔴 Not resolved |
| 2 | `img.object-cover` (hero cover) | **3,396ms** | `/zh/` (homepage) | 🔴 Partially addressed |
| 3 | `video poster` (raw JPEG, no CF resize) | **5,795ms** | `/zh/` (homepage) | 🔴 Not resolved |
| 4 | `video poster` (raw JPEG, no CF resize) | **3,080ms** | `/en/articles/joymini-blog-platform/` | 🔴 Not resolved |
| 5 | **CLS 0.294** — `section.mt-16` layout shift | n/a | `/zh/articles/测试/` | 🔴 Not addressed |
| 6 | `TypeError` (Node.js streams) | n/a | Backend | 🔴 Not diagnosed |

---

## Problem Analysis

### Problem 1: Video Poster Images Bypass Cloudflare Image Resizing

**Observation**: All problematic poster URLs are raw:
```
img.joyminis.com/uploads/blog/videos/.../poster.jpg        ← NO /cdn-cgi/image/
```

While cover images use:
```
img.joyminis.com/cdn-cgi/image/width=640,quality=75,f=auto,fit=scale-down/uploads/blog/.../image.png  ← WITH Cloudflare resize
```

**Root Cause**: The video poster URL is stored directly in the article metadata as the raw R2 URL. When used in `<video poster="...">` or `HlsVideoPlayer`, it bypasses `cloudflareImageLoader` entirely since `<video>` elements don't use Next.js `<Image>` which is the only path that triggers the Cloudflare transform.

**Impact**:
- No automatic format conversion (`f=auto` cannot serve WebP/AVIF)
- No responsive sizing — browsers download the full 1280px poster even on mobile
- No quality optimization from Cloudflare edge
- Raw JPEG likely larger than optimized version (~150-300KB+)

### Problem 2: Article Detail Page Has No Image Preload (SSR)

**Observation**: The homepage (`page.tsx`) injects `<link rel="preload">` for the hero cover image and video poster. But the article detail page (`/articles/[slug]/page.client.tsx`) does NOT inject any preload links.

**Relevant code**: [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx) — no SSR preload logic exists.

**Impact**: Browser discovers the cover image (and video poster) only after parsing the full HTML/CSS/JS, rather than being hinted immediately. This adds ~500-1500ms to LCP.

### Problem 3: Article Cover Image Width=640 Is Too Small for Hero

**Observation**: On the article detail page, the cover image is served at `width=640` despite being a hero image that fills the full content width (~800-1000px on desktop).

**Root Cause**: In [`next.config.ts`](apps/frontend-blog/next.config.ts) line 166, `deviceSizes` starts at `[480, 640, ...]`. Next.js picks the closest match which is 640px. The article page's cover image should use a larger size.

**Impact**: Image is slightly blurry/pixelated on larger screens. More importantly, if an image needs to be re-downloaded at a higher resolution later, that's wasted bandwidth and LCP delay.

### Problem 4: CLS 0.294 on Article Pages

**Observation**: Layout shift of 0.294 (target < 0.1) on the article page at `/zh/articles/测试/`.

**Affected element**: `div.min-h-screen.bg-background > div.max-w-5xl.mx-auto > section.mt-16`

**Root Cause**: The article content in `ArticleMarkdown` renders images without explicit width/height dimensions. In `ArticleMarkdown.tsx` line 508-521, the `img` component has `width={800} height={450}` but these are default fallback values. The HTML content path (Quill editor output) at line 332-351 uses `dangerouslySetInnerHTML` with `wrapWideContent()` which wraps `<img>` in a div but does NOT add explicit dimensions. Images without dimensions cause layout shift as they load.

### Problem 5: Backend TypeError in Node.js Streams

**Observation**: Stack trace shows:
```
moduleworker → _final → node-internal:streams_writable → prefinish
```

This appears to be a Node.js internal error related to writable streams being finalized. Likely causes:
- An image/video processing pipeline where a write stream is closed prematurely
- A response stream that ended unexpectedly during media processing
- Not a frontend issue but should be checked if it affects the blog content delivery

---

## Proposed Fixes

### Fix 1: Route Video Poster Images Through Cloudflare Image Resizing

**Priority**: P0 — directly impacts LCP by 3-6 seconds

Instead of storing the raw `poster.jpg` URL, the poster should be served via `/cdn-cgi/image/` on the img.joyminis.com CDN, the same way cover images are.

**Approach A (Recommended)**: Create a utility function `getOptimizedPosterUrl(posterUrl, width, quality)` that generates a Cloudflare `/cdn-cgi/image/` URL for posters, similar to `cloudflareImageLoader`. Apply this in:
- [`HlsVideoPlayer.tsx`](apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx) — transform the `effectivePoster` URL
- [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx) — transform poster URLs in video elements

**Approach B (Alternative)**: Store the `/cdn-cgi/image/` URL directly in the database at processing time. More invasive but avoids runtime transformation.

**Files to modify**:
- `apps/frontend-blog/src/lib/utils/cloudflareImageLoader.ts` — add `getOptimizedImageUrl()` export for non-Image components
- `apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx` — transform poster URL via CF loader
- `apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx` — transform video poster URLs
- `apps/frontend-blog/src/components/blog/HeroSection.tsx` — already passes `posterWebp`, but also transform the fallback JPEG poster

### Fix 2: Add SSR Preload for Article Detail Page Cover Image

**Priority**: P0 — reduces LCP by ~500-1500ms

Add SSR preload logic to the article detail page, similar to what homepage already does.

**Files to modify**:
- `apps/frontend-blog/src/app/[locale]/articles/[slug]/page.tsx` (server component) — inject `<link rel="preload">` for cover image and video poster, using `cloudflareImageLoader` to ensure URL matches

### Fix 3: Fix CLS on Article Pages

**Priority**: P1 — CLS 0.294 is above the "Good" threshold of 0.1

**Root cause A — HTML content images lack dimensions**: The `wrapWideContent()` function in `ArticleMarkdown.tsx` wraps `<img>` in a div but does not guarantee intrinsic dimensions. For the HTML content path (Quill editor), images need explicit width/height attributes or CSS aspect-ratio.

**Root cause B — Content loading**: The article content is loaded client-side after mount. When the content arrives, it can shift the layout below it. The `min-h-[400px]` on the content div provides some protection but apparently not enough.

**Files to modify**:
- `apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx` — in `wrapWideContent()`, ensure images have `width` and `height` attributes or apply `aspect-ratio` CSS to `article-media-wrapper`
- `apps/frontend-blog/src/app/globals.css` — add CSS rules for `.article-media-wrapper img` to set `aspect-ratio`

### Fix 4: Optimize Article Cover Image Width on Detail Page

**Priority**: P1 — improves visual quality and prevents re-download

Pass a larger `sizes` attribute to the cover image on the article detail page, ensuring Cloudflare Image Resizing serves it at an appropriate width (at least 1200px for desktop).

**Files to modify**:
- `apps/frontend-blog/src/app/[locale]/articles/[slug]/page.tsx` — if using `<Image>`, update `sizes` prop
- Currently the article page uses `<Image>` in `page.client.tsx` line 226 for the author avatar only, NOT for the cover image. The cover image is rendered inside `ArticleMarkdown` content. This means the cover image is loaded via `<img>` inside markdown HTML, NOT via Next.js `<Image>`, so `cloudflareImageLoader` is NOT applied to it on article pages.

**Wait — this is a critical finding!** The article cover image on the detail page is embedded in the markdown/HTML content, not rendered with Next.js `<Image>`. This means:
1. It bypasses `cloudflareImageLoader` entirely
2. It's loaded as a raw full-resolution image or at whatever size the `<img>` tag specifies
3. Cloudflare Image Resizing is not applied

This needs to be a P0 fix.

### Fix 5: Ensure Article Cover Image Uses Cloudflare Image Resizing

**Priority**: P0 — article cover images are LCP candidates

On the article detail page, the cover image is rendered as part of the article content (in `ArticleMarkdown`). It should be rendered with Next.js `<Image>` to get Cloudflare Image Resizing, or manually transformed via `cloudflareImageLoader`.

**Files to modify**:
- Either add a cover image section ABOVE the markdown content using `<Image>` with `cloudflareImageLoader`
- Or transform the `<img>` src in `ArticleMarkdown`'s HTML content path
- Or both

### Fix 6: Investigate Backend TypeError

**Priority**: P2 — may be noise (aborted connections) but should be checked

Check if the `TypeError` in Node.js streams correlates with image/video processing or API request aborts. If it's the latter, it's the same "Connection closed" issue already handled.

---

## Implementation Order

| Step | Fix | Files | Complexity |
|------|-----|-------|------------|
| 1 | **P0**: Route video posters through CF Image Resizing | `cloudflareImageLoader.ts`, `HlsVideoPlayer.tsx`, `ArticleMarkdown.tsx`, `HeroSection.tsx` | Medium |
| 2 | **P0**: Article cover image through CF Image Resizing | `ArticleMarkdown.tsx` or article page layout | Medium |
| 3 | **P0**: SSR preload for article detail page | `articles/[slug]/page.tsx` | Low |
| 4 | **P1**: Fix CLS on article pages | `ArticleMarkdown.tsx`, `globals.css` | Low |
| 5 | **P1**: Optimize hero image width on article pages | Article page component | Low |
| 6 | **P2**: Investigate backend TypeError | API server logs | Low |

---

## Architecture: Image Delivery Pipeline (Current vs Proposed)

### Current Flow (Cover Images)
```
R2 Storage → img.joyminis.com/r2/path/image.png
                ↓
         Next.js <Image> (src=r2/path/image.png)
                ↓
         cloudflareImageLoader(src, width, quality)
                ↓
         img.joyminis.com/cdn-cgi/image/width=...,quality=...,f=auto,fit=scale-down/r2/path/image.png
                ↓
         Cloudflare edge: resize + format convert (AVIF/WebP/JPEG)
```

### Current Flow (Video Posters) — BROKEN
```
R2 Storage → img.joyminis.com/r2/path/poster.jpg
                ↓
         <video poster="r2/path/poster.jpg">
                ↓
         NO Cloudflare Image Resizing applied ❌
                ↓
         Raw JPEG downloaded at full resolution (large file, slow LCP)
```

### Proposed Flow (Video Posters) — FIXED
```
R2 Storage → img.joyminis.com/r2/path/poster.jpg
                ↓
         HlsVideoPlayer / ArticleMarkdown
                ↓
         getOptimizedImageUrl(posterUrl, width, quality)
                ↓
         img.joyminis.com/cdn-cgi/image/width=1280,quality=75,f=auto,fit=scale-down/r2/path/poster.jpg
                ↓
         Cloudflare edge: resize + format convert (AVIF/WebP/JPEG)
```
