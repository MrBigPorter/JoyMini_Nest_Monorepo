# Cloudflare Free Tier Optimization Plan

## Context

Project runs on Cloudflare Free plan. Two sources of data:
1. User's analysis of Cloudflare Free tier limitations
2. Cloudflare Web Analytics dump for `blog.joyminis.com`

## Key Findings from Cloudflare Web Analytics

- **INP**: 100% Good ✅
- **CLS**: 93% Good (7% flagged for `section.mt-160`)
- **LCP**: P75 = 2,096ms, P90/P99 pushing past 3,000ms ⚠️
- **LCP culprit**: `poster.webp` image (3,460ms / 2,872ms) inside `HlsVideoPlayer`

### Root Cause: `opacity-0` / Poster Swap After Hydration

In [`HlsVideoPlayer.tsx`](/apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx), the `clickToPlay` mode has a critical LCP issue:

| Phase | `showPlayOverlay` | Video Element | Poster |
|-------|------------------|---------------|--------|
| SSR | `false` | `<video poster="url" ...>` | Native poster (LCP candidate ✅) |
| After hydration | `true` | `<video poster={undefined} class="opacity-0">` | CSS `background-image` on parent ❌ |
| User clicks play | `false` | `<video poster="url" ...>` | Back to native poster (LCP reset ⚠️) |

The browser registers the native `<video poster>` as LCP candidate during SSR. After hydration, the poster is **removed** from the video and moved to a CSS background — the LCP registration is lost. When the user clicks play, it re-registers, causing the 3,460ms spike.

## Revised Action Plan

### Task 1: CDN Preconnect Hints (Root Layout)

**File:** [`apps/frontend-blog/src/app/layout.tsx`](/apps/frontend-blog/src/app/layout.tsx)

Add to `<head>`:
```html
<link rel="preconnect" href="https://img.joyminis.com" crossorigin />
<link rel="dns-prefetch" href="https://img.joyminis.com" />
```

**Why:** Browser needs DNS + TCP + TLS to fetch from CDN. Without preconnect, adds ~100-300ms cold-start latency before any image loads.

**Risk:** Low. Standard HTML features.

---

### Task 2: Fix HlsVideoPlayer — Never Remove Native Poster (CRITICAL)

**File:** [`apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx`](/apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx)

**Current behavior (broken):**
```tsx
// After hydration — removes poster from video element!
poster={showPlayOverlay ? undefined : effectivePoster}
```

**Fix:** Always keep `poster={effectivePoster}` on the `<video>` element, even in clickToPlay overlay mode. The play overlay can sit on top of the video without hiding it.

**Changes:**
1. Line 377: Change `poster={showPlayOverlay ? undefined : effectivePoster}` → `poster={effectivePoster}`
2. Line 375-376: Remove `showPlayOverlay ? 'opacity-0' : ''` from video className
3. The play overlay already has `absolute inset-0 z-20` — it sits on top of the visible video correctly
4. Keep CSS background as a fallback but don't rely on it for LCP

**Why this fixes LCP:**
- Browser sees `<video poster="url">` from SSR through hydration, never losing the LCP candidate
- No transition/opacity delay
- No poster swap between native and CSS background

**Risk:** Low. The play button overlay already covers the video, so visual appearance is unchanged.

---

### Task 3: Article Detail SSR — Include Video Poster Preload

**File:** [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.tsx`](/apps/frontend-blog/src/app/%5Blocale%5D/articles/%5Bslug%5D/page.tsx)

Currently preloads cover image only (line 172-178). Add video poster preload:

```tsx
const preloadedVideoPoster = article?.meta?.video?.poster
  ? getOptimizedImageUrl({ src: article.meta.video.poster, width: 1200, quality: 75 })
  : undefined;
```

Then inject a second `<link rel="preload">` after the existing one.

**Payload cost:** ~200 bytes (one URL string). `meta` is already retained in RSC payload.

---

### Task 4: Responsive Poster Image in ArticleCard

**File:** [`apps/frontend-blog/src/components/blog/ArticleCard.tsx`](/apps/frontend-blog/src/components/blog/ArticleCard.tsx) (passes props to `HlsVideoPlayer`)

Currently, the poster is always loaded at 1200px width (line 57 in HlsVideoPlayer.tsx). On mobile viewports, this is overkill.

Since `<video poster>` doesn't support `srcset`, the fix is to pass a `mobilePoster` prop or add a `<link rel="preload" media="(max-width: 768px)" ...>` with a smaller variant via SSR.

However, Cloudflare Image Resizing can serve responsive images via URL parameters. The simplest approach:
- Use `sizes` attribute concept via `imageSizes` prop on HlsVideoPlayer
- Generate multiple preload links for different viewport sizes

**Simpler alternative:** Just ensure preload size is reasonable (800px for mobile-first). The SSR preload in page.tsx already handles desktop scenarios.

**Deferred:** This is a nice-to-have. The core fix is Task 2.

---

### Task 5: Sentry beforeSend Filtering

**Files:**
- [`apps/frontend-blog/src/instrumentation-client.ts`](/apps/frontend-blog/src/instrumentation-client.ts)

Add `beforeSend` callback:
1. Filter `chrome-extension://` errors
2. Tag Cloudflare transient network errors for monitoring

---

### Task 6: Admin Batch Operation Chunking

**Files:**
- New: `apps/admin-blog/src/lib/utils/batchProcessor.ts`
- Modify: [`BlogTranslationQualityDetection.tsx`](/apps/admin-blog/src/views/blog/BlogTranslationQualityDetection.tsx)
- Modify: [`BlogTranslationQualityDetectionStream.tsx`](/apps/admin-blog/src/views/blog/BlogTranslationQualityDetectionStream.tsx)
- Modify: [`BlogTranslationIssues.tsx`](/apps/admin-blog/src/views/blog/BlogTranslationIssues.tsx)

Create `processBatch()` utility that:
- Splits items into chunks of 3-5
- Processes sequentially with 1s delay between batches
- Retries failures with exponential backoff (2s → 4s → 8s)
- Shows progress indicator

---

## Implementation Order

1. **Task 2** (Fix poster swap) — The critical LCP fix. Single file, highest impact.
2. **Task 1** (Preconnect) — Easy win, reduces initial connection latency.
3. **Task 3** (Article poster preload) — Completes the poster preload coverage.
4. **Task 6** (Admin chunking) — Prevents 504 errors on batch operations.
5. **Task 5** (Sentry filtering) — Reduces noise.
6. **Task 4** (Responsive poster) — Nice-to-have, deferred.

## Risk Assessment

| Task | Risk | Mitigation |
|------|------|------------|
| 2. Fix poster swap | Low | Play overlay already covers video; visual unchanged |
| 1. Preconnect | Low | Standard HTML, widely supported |
| 3. Article poster preload | Low | ~200 bytes added to RSC payload |
| 6. Admin chunking | Medium | Test with small batches first |
| 5. Sentry filtering | Near-zero | beforeSend is non-blocking |
| 4. Responsive poster | Low | Deferred, optional |
