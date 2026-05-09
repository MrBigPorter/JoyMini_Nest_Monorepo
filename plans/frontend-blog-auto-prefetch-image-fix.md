# Plan: Fix Auto-Prefetch Image Warming for Load More

## Problem

When clicking "Load More" (or auto-prefetch triggers on scroll), the next page's articles' cover images take too long to load. The auto-prefetch mechanism already exists but **doesn't effectively warm the browser cache**.

## Root Cause

The existing auto-prefetch at [`page.client.tsx:324-332`](apps/frontend-blog/src/app/[locale]/page.client.tsx:324) fetches **raw** cover image URLs with `no-cors`:

```ts
const coverUrls = data.items
  .map((a: FrontendArticle) => a.coverImage)
  .filter(Boolean);
for (const url of coverUrls) {
  fetch(url as string, { mode: 'no-cors' }).catch(() => {});
}
```

But Next.js `<Image>` with the custom [`cloudflareImageLoader`](apps/frontend-blog/src/lib/utils/cloudflareImageLoader.ts) transforms the URL to a **different** path:

| URL Type | Example |
|----------|---------|
| **Raw URL** (what prefetch fetches) | `https://img.joyminis.com/path/image.jpg` |
| **Loader URL** (what `<Image>` actually loads) | `https://img.joyminis.com/cdn-cgi/image/width=640,quality=65,f=auto,fit=scale-down/path/image.jpg` |

Since these are different URLs, the browser HTTP cache and Service Worker cache have **different keys**. Prefetching the raw URL does nothing for the actual image load.

Also, `mode: 'no-cors'` returns an opaque response that can't be read — while the SW `static-image-assets` caching rule accepts status `0` (opaque), it still caches under the wrong (raw) URL key.

## Solution

**Prefetch the loader-transformed URLs instead of raw URLs**, so they match what `<Image>` actually requests.

### What to change

In [`page.client.tsx`](apps/frontend-blog/src/app/[locale]/page.client.tsx:313-337), replace the raw-image `no-cors` fetch block with transformed URL fetches using the same `cloudflareImageLoader` function:

**Before:**
```ts
// Warm SW cache by fetching cover images
const coverUrls = data.items
  .map((a: FrontendArticle) => a.coverImage)
  .filter(Boolean);
for (const url of coverUrls) {
  fetch(url as string, { mode: 'no-cors' }).catch(() => {
    // Silent — SW will cache what it can
  });
}
```

**After:**
```ts
// Warm browser + SW cache by prefetching loader-transformed image URLs
// This ensures the cache keys match what Next.js <Image> actually requests
const imageSizes = [480, 640]; // deviceSizes matching ArticleCard viewport
const defaultQuality = 65;     // ArticleCard default for non-priority images

for (const article of data.items) {
  if (!article.coverImage) continue;
  
  // Prefetch at common breakpoints so the cache is hit regardless of viewport
  for (const width of imageSizes) {
    const transformedUrl = cloudflareImageLoader({
      src: article.coverImage,
      width,
      quality: defaultQuality,
    });
    // Use cors mode so the response is readable and properly cacheable
    fetch(transformedUrl, { mode: 'cors' }).catch(() => {});
  }
}
```

### New import needed

Add to the imports at the top of [`page.client.tsx`](apps/frontend-blog/src/app/[locale]/page.client.tsx):

```ts
import cloudflareImageLoader from '@/lib/utils/cloudflareImageLoader';
```

### Why this works

1. **Matching cache keys** — The prefetched URL `https://img.joyminis.com/cdn-cgi/image/width=480,quality=65,f=auto,fit=scale-down/path/image.jpg` is exactly what `<Image>` will request when rendering that article's card
2. **No `no-cors` needed** — Cloudflare CDN supports CORS, so `cors` mode returns a proper response that the SW can cache correctly (status 200, not opaque 0)
3. **Multiple breakpoints** — Prefetching at 480px (mobile) and 640px (desktop) covers both grid columns sizes; Next.js will pick whichever matches first from the HTTP cache
4. **Service Worker integration** — The `StaleWhileRevalidate` runtime caching rule for `static-image-assets` will cache these transformed URLs, so even offline access works

## Effect on user experience

| Scenario | Before | After |
|----------|--------|-------|
| Auto-scroll prefetch triggers | Fetches raw URL — cache miss when `<Image>` loads | Fetches transformed URL — cache hit when `<Image>` loads ✅ |
| Click "Load More" | Images load from CDN cold | Images load from browser cache or SW cache ✅ |
| Slow network (3G) | Images appear progressively, slow | Images appear instantly from cache ✅ |

## No changes needed

- The sentinel IntersectionObserver logic remains unchanged
- The API data prefetch (`prefetchQuery`) remains unchanged
- The `rootMargin: '400px'` head start is sufficient when cache warming actually works
