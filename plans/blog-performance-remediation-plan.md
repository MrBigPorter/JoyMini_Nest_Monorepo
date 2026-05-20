# Blog Performance Remediation Plan

> **Status: ✅ All P0–P2 items implemented (2025-05-20)**
> - P3-A (Cloudflare Dashboard CDN cache TTL) requires manual configuration — see below.

## Overview

This plan addresses all 5 categories of issues identified across Lighthouse + PageSpeed Insights audits. Each item links to exact source files, lines, and provides a clear fix strategy.

---

## P0 — Immediate Fixes (High Impact, Low Risk)

### P0-A: Remove `maximum-scale=1` Viewport Lock

**Issue:** [`[locale]/layout.tsx`](../../apps/frontend-blog/src/app/[locale]/layout.tsx:149) sets `maximumScale: 1` and `userScalable: false`, preventing pinch-to-zoom on mobile.

**Action:** Remove `maximumScale` and `userScalable` from the `viewport` export. Keep `width: 'device-width'`, `initialScale: 1`, `viewportFit: 'cover'`, and `themeColor`.

**File:** [`apps/frontend-blog/src/app/[locale]/layout.tsx:149-159`](../../apps/frontend-blog/src/app/[locale]/layout.tsx:149)

```diff
 export const viewport: Viewport = {
   width: 'device-width',
   initialScale: 1,
-  maximumScale: 1,
-  userScalable: false,
   viewportFit: 'cover',
   themeColor: [...],
 };
```

---

### P0-B: Resize Logo PNG to Actual Display Size

**Issue:** [`Header.tsx:199-205`](../../apps/frontend-blog/src/components/Header.tsx:199) uses `/logo.png` which is 500×500 px but displayed at 32×32 px (~20x wasted pixels).

**Action:** Replace the 500×500 logo with a properly sized 64×64 px version (2x for Retina). Two options:
1. **Recommended:** Generate a 64×64 `logo-small.png` and reference that. Keep the 500×500 for other uses if needed.
2. Use Next.js `<Image>` with `sizes="32px"` — but the custom Cloudflare loader will still fetch a transformed image, so simpler to just ship a smaller file.

**Files:**
- [`apps/frontend-blog/src/components/Header.tsx:199-205`](../../apps/frontend-blog/src/components/Header.tsx:199) (mobile logo)
- [`apps/frontend-blog/src/components/Header.tsx:246-252`](../../apps/frontend-blog/src/components/Header.tsx:246) (desktop logo)
- Logo asset: [`apps/frontend-blog/src/public/logo.png`](../../apps/frontend-blog/src/public/logo.png) — replace with 64×64 version

---

## P1 — Code Changes (Medium Risk, Require Testing)

### P1-A: Add Smaller `deviceSizes` Entry for Mobile Cover Images

**Issue:** Cover images served from `img.joyminis.com` via Cloudflare Image Resizing use `deviceSizes: [480, 640, 768, 1024, 1280]` ([`next.config.ts:168`](../../apps/frontend-blog/next.config.ts:168)). On a 375px mobile viewport, the card occupies ~90vw = 337px, but the smallest available size is 480px — forcing download of a larger-than-needed image.

**Action:** Add `333` to the `deviceSizes` array (or replace 480 with a tighter set).

**File:** [`apps/frontend-blog/next.config.ts:168`](../../apps/frontend-blog/next.config.ts:168)

```diff
- deviceSizes: [480, 640, 768, 1024, 1280],
+ deviceSizes: [333, 480, 640, 768, 1024, 1280],
```

**Also Review:** The `sizes` prop in [`ArticleCard.tsx:280`](../../apps/frontend-blog/src/components/blog/ArticleCard.tsx:280) says `(max-width: 768px) 90vw`. On a 375px phone, 90vw = 337px. With the new 333 device size, the browser will now correctly request a 333px-wide image instead of 480px.

---

### P1-B: Add `preload="none"` to Hero Section Video

**Issue:** The [`HeroSection.tsx:88-96`](../../apps/frontend-blog/src/components/blog/HeroSection.tsx:88) renders a `<video>` element with `preload="metadata"`, which still fetches video headers and first frame. This video becomes the LCP element, blocking bandwidth from more critical content.

**Action:** Change `preload="metadata"` to `preload="none"` on the raw `<video>` in HeroSection. Also ensure the poster image is preloaded (already partially done via `getOptimizedImageUrl` in the SSR preload links at [page.tsx:79-85](../../apps/frontend-blog/src/app/[locale]/page.tsx:79)).

**Files:**
- [`apps/frontend-blog/src/components/blog/HeroSection.tsx:95`](../../apps/frontend-blog/src/components/blog/HeroSection.tsx:95) — raw video `preload="metadata"` → `preload="none"`
- [`apps/frontend-blog/src/components/blog/HeroSection.tsx:75-87`](../../apps/frontend-blog/src/components/blog/HeroSection.tsx:75) — HlsVideoPlayer already uses `clickToPlay` / `preload="none"` in clickToPlay mode; confirm it's not eagerly loading

---

### P1-C: Lazy-Load Cloudflare Insights Beacon with `strategy="lazyOnload"` Equivalent

**Issue:** Cloudflare Insights beacon is loaded in [`layout.tsx:83-87`](../../apps/frontend-blog/src/app/layout.tsx:83) with `defer` — this is good, but the script still competes for bandwidth during the critical window.

**Action:** Move the Cloudflare Insights `<script>` to a separate `'use client'` component that loads it dynamically via `next/dynamic` with `ssr: false`, or use a `useEffect` in a client component to inject the script after `requestIdleCallback` or after LCP is done.

**Alternative:** Use the Next.js `<Script>` component with `strategy="lazyOnload"`:

```tsx
import Script from 'next/script';
// In a client component:
<Script
  src="https://static.cloudflareinsights.com/beacon.min.js"
  data-cf-beacon='{"token": "1ad32917390d4dda86d53395209e19a5"}'
  strategy="lazyOnload"
/>
```

**File:** [`apps/frontend-blog/src/app/layout.tsx:83-87`](../../apps/frontend-blog/src/app/layout.tsx:83) — extract to a lazy-loaded client component

---

### P1-D: Fix Heading Hierarchy — Change Article Card Titles from `<h3>` to `<h2>`

**Issue:** Page structure is `<h1>` → (no `<h2>`) → `<h3>` for article card titles in [`ArticleCard.tsx:332`](../../apps/frontend-blog/src/components/blog/ArticleCard.tsx:332). This breaks the document outline.

**Context check:** The HeroSection at [`HeroSection.tsx:146`](../../apps/frontend-blog/src/components/blog/HeroSection.tsx:146) already uses `<h2>` for the hero article title. Side articles in HeroSection at line 263 use `<h3>` — this is correct (they are children of the hero `<h2>` section).

The article cards in the main listing (below the hero) start directly after the page `<h1>` with no `<h2>` section heading between them. However, there IS a section with CategoryFilter and the `<h1>` page title, so the article cards effectively need a wrapping `<h2>` section heading, OR the card titles themselves should be `<h2>`.

**Action:** Change the article card title element from `<h3>` to `<h2>` in [`ArticleCard.tsx`](../../apps/frontend-blog/src/components/blog/ArticleCard.tsx).

**File:** [`apps/frontend-blog/src/components/blog/ArticleCard.tsx:332`](../../apps/frontend-blog/src/components/blog/ArticleCard.tsx:332)

```diff
- <h3 className="...">{article.title}</h3>
+ <h2 className="...">{article.title}</h2>
```

**Note:** Also check HeroSection side articles ([`HeroSection.tsx:263`](../../apps/frontend-blog/src/components/blog/HeroSection.tsx:263)) — these are already `<h3>` and correctly nested under the hero `<h2>`.

---

## P2 — Code Changes (Lower Risk, Nice-to-Have)

### P2-A: Lazy-Load Sentry Client-Side Bundle

**Issue:** [`instrumentation-client.ts`](../../apps/frontend-blog/src/instrumentation-client.ts) eagerly initializes Sentry on every page load, adding ~30-50 KB to the main JS bundle and executing Sentry's initialization logic during the critical rendering path (blocking time ~920ms per audit).

**Action:** Delay Sentry initialization using `requestIdleCallback` or wait for `window.requestAnimationFrame` after LCP:

```ts
// In instrumentation-client.ts
if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  requestIdleCallback(() => Sentry.init({...}), { timeout: 3000 });
} else {
  setTimeout(() => Sentry.init({...}), 3000);
}
```

**File:** [`apps/frontend-blog/src/instrumentation-client.ts:53`](../../apps/frontend-blog/src/instrumentation-client.ts:53)

---

### P2-B: Reduce Hero Section Auto-Rotate Interval Overhead

**Issue:** The 5-second auto-rotate timer in [`HeroSection.tsx:33-37`](../../apps/frontend-blog/src/components/blog/HeroSection.tsx:33) creates unnecessary React re-renders every 5s, causing layout thrashing even if the user never interacts.

**Action:** Increase interval to 8-10 seconds, or pause the timer when the tab is not visible (document.hidden).

**File:** [`apps/frontend-blog/src/components/blog/HeroSection.tsx:36`](../../apps/frontend-blog/src/components/blog/HeroSection.tsx:36)

```diff
- setInterval(() => { ... setActiveIndex(...) }, 5000);
+ setInterval(() => { ... setActiveIndex(...) }, 8000);
```

---

### P2-C: JS Bundle Splitting — Investigate Large Chunks

**Issue:** Audit reports individual JS chunks near 1MB. The [`next.config.ts`](../../apps/frontend-blog/next.config.ts) already has `optimizePackageImports` but lacks manual chunk splitting.

**Action:** Add `experimental.webpackBuildWorker` and/or manual `splitChunks` config in the webpack block to separate heaviest dependencies:

```ts
// In next.config.ts webpack config
config.optimization.splitChunks = {
  chunks: 'all',
  cacheGroups: {
    sentry: { test: /[\\/]node_modules[\\/]@sentry[\\/]/, name: 'sentry', chunks: 'all' },
    vendor: { test: /[\\/]node_modules[\\/](react|react-dom|next)[\\/]/, name: 'vendor', chunks: 'all' },
    ui: { test: /[\\/]node_modules[\\/](framer-motion|lucide-react|hls\.js)[\\/]/, name: 'ui-libs', chunks: 'all' },
  },
};
```

**File:** [`apps/frontend-blog/next.config.ts:315`](../../apps/frontend-blog/next.config.ts:315)

**Note:** Run `ANALYZE=true yarn build` first to confirm which chunks are largest before implementing.

---

## P3 — External/Cloudflare Configuration (No Code Change)

### P3-A: Extend CDN Cache TTL on `img.joyminis.com`

**Issue:** Cloudflare CDN serves images with only 4-hour `Cache-Control` max-age. Browsers re-validate every 4 hours.

**Action:** In Cloudflare Dashboard → Rules → Page Rules (or Cache Rules), add a rule for `img.joyminis.com/*`:
- **Cache Level:** Standard
- **Edge Cache TTL:** 1 year (or at minimum 30 days)
- **Browser Cache TTL:** 1 year

Alternatively, configure via `wrangler` or Cloudflare API if using Workers.

---

## Implementation Record

| # | Task | Status | Files Modified |
|---|------|--------|----------------|
| P0-A | Remove `maximum-scale=1` from viewport | ✅ | [`[locale]/layout.tsx`](../../apps/frontend-blog/src/app/[locale]/layout.tsx:149) |
| P0-B | Resize logo PNG to 64×64 | ✅ | [`public/logo.png`](../../apps/frontend-blog/src/public/logo.png) (10317 bytes, 64×64) |
| P1-A | Add 333 to `deviceSizes` | ✅ | [`next.config.ts`](../../apps/frontend-blog/next.config.ts:168) |
| P1-B | Hero video `preload="none"` | ✅ | [`HeroSection.tsx`](../../apps/frontend-blog/src/components/blog/HeroSection.tsx:95), line 220 |
| P1-C | Lazy-load CF Insights beacon | ✅ | [`CloudflareInsights.tsx`](../../apps/frontend-blog/src/components/CloudflareInsights.tsx) (new), [`layout.tsx`](../../apps/frontend-blog/src/app/layout.tsx:87) |
| P1-D | ArticleCard `<h3>` → `<h2>` | ✅ | [`ArticleCard.tsx`](../../apps/frontend-blog/src/components/blog/ArticleCard.tsx:332) |
| P2-A | Defer Sentry init via `requestIdleCallback` | ✅ | [`instrumentation-client.ts`](../../apps/frontend-blog/src/instrumentation-client.ts:53) |
| P2-B | Hero auto-rotate 5s → 8s | ✅ | [`HeroSection.tsx`](../../apps/frontend-blog/src/components/blog/HeroSection.tsx:36) |
| P2-C | `splitChunks` cacheGroups for vendor JS | ✅ | [`next.config.ts`](../../apps/frontend-blog/next.config.ts:365) |
| P3-A | CDN cache TTL on `img.joyminis.com` | ⏳ Manual | Cloudflare Dashboard → Rules → Cache Rules |

---

## Summary: Priority Execution Timeline

| Priority | Task | Effort | Impact | Category |
|----------|------|--------|--------|----------|
| **P0-A** | Remove `maximum-scale=1` from viewport | 5 min | ♿ A11y + Lighthouse 100 | Accessibility |
| **P0-B** | Replace oversized logo PNG (500×500 → 64×64) | 10 min | ⚡ ~20KB savings | Images |
| **P1-A** | Add 333px to `deviceSizes` for mobile images | 5 min | ⚡ Mobile image ~30% smaller | Images |
| **P1-B** | Set `preload="none"` on hero video | 10 min | ⏳ LCP improvement | LCP |
| **P1-C** | Lazy-load Cloudflare Insights beacon | 15 min | ⏳ ~920ms TBT reduction | Third-party |
| **P1-D** | Fix heading hierarchy (h3→h2 in ArticleCard) | 5 min | 🔍 SEO outline fix | SEO |
| **P2-A** | Defer Sentry init via requestIdleCallback | 15 min | ⏳ TBT reduction | JS Bundle |
| **P2-B** | Reduce hero auto-rotate interval | 5 min | ⚡ Minor CPU reduction | LCP |
| **P2-C** | Investigate + split large JS chunks | 30 min | 📦 Chunk size reduction | JS Bundle |
| **P3-A** | Configure 1-year CDN cache on img.joyminis.com | 10 min | ⚡ ~99% cache hit rate | CDN |

---

## Dependency Graph

```
P0-A (viewport) ← independent
P0-B (logo) ← independent
P1-A (deviceSizes) ← P3-A (img CDN cache already set)
P1-B (video preload=none) ← independent but relies on SSR preload (already exists)
P1-C (CF Insights lazy) ← independent
P1-D (heading h3→h2) ← independent but affects both ArticleCard + HeroSection
P2-A (Sentry defer) ← independent
P2-B (hero interval) ← independent  
P2-C (split chunks) ← requires `yarn analyze` to gather data first
P3-A (CDN cache in dashboard) ← independent
```

All P0 and P1 tasks are independent and can be executed in parallel. P2-C requires a prior analysis step (`yarn analyze`).
