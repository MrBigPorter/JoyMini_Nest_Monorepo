# Fix `blog.joyminis.com` Google Search Console Indexing Issues

## Problem Summary

Google Search Console reports the following issues for `blog.joyminis.com`:

1. **"Excluded by 'noindex' tag"** — Article pages (e.g. `/zh/articles/redis-distributed-lock-system/`) and tag pages contain `<meta name="robots" content="noindex">`
2. **"Crawled - currently not indexed"** (40 pages) — Google crawled but chose not to index (duplicate/quality)
3. **"Discovered - currently not indexed"** — Normal backlog
4. **"HTTPS not evaluated"** (11 pages) — Some URLs found as `http://` instead of `https://`

## Root Cause Analysis

### Root Cause 1: Article `noindex` from error fallback

In [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.tsx:111-127`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.tsx:111):

```typescript
// generateMetadata() — try block
robots: { index: true, follow: true },  // ✅ Normal

// generateMetadata() — catch/error block (lines 124-127)
robots: {
  index: false,   // ❌ When API fails, sets noindex
  follow: false,
},
```

The function [`getCachedArticle()`](apps/frontend-blog/src/lib/cached/article.ts:12) catches all errors and returns `null`. When `null`, `generateMetadata` throws `new Error('Article not found')`, which triggers the `noindex` fallback.

**Impact**: If the backend API is slow or temporarily unavailable during `generateMetadata()` execution (which happens on every ISR revalidation or first visit), Googlebot receives a page with `noindex` in the HTML head. Once Google caches this, the page is excluded from search results permanently until re-crawled.

### Root Cause 2: Tag/Category pages missing explicit `robots` metadata

- [`apps/frontend-blog/src/app/[locale]/tags/[slug]/page.tsx:13-32`](apps/frontend-blog/src/app/[locale]/tags/[slug]/page.tsx:13) — `generateMetadata()` only sets `alternates`, **no `robots` property**
- [`apps/frontend-blog/src/app/[locale]/categories/[slug]/page.tsx:13-32`](apps/frontend-blog/src/app/[locale]/categories/[slug]/page.tsx:13) — Same issue, no `robots` metadata
- [`apps/frontend-blog/src/app/[locale]/search/page.tsx`](apps/frontend-blog/src/app/[locale]/search/page.tsx) — No `generateMetadata()` at all, no `robots`

Without explicit `robots`, Next.js may not output any robots meta tag, which is usually fine (Google defaults to index/follow). However, if the parent layout's robots metadata is somehow not inherited correctly during ISR/build, Google could see the page without a robots directive and treat it differently.

### Root Cause 3: HTTP URLs discovered by Google

Several URLs appear as `http://blog.joyminis.com/...` instead of `https://`. This could come from:
- External sites linking with `http://`
- Old sitemap submissions with `http://`
- The `NEXT_PUBLIC_SITE_URL` env var potentially being set to `http://` in some environments

All canonical URLs in the codebase default to `https://blog.joyminis.com`, but if `NEXT_PUBLIC_SITE_URL` is misconfigured in a deployment environment, it could generate `http://` canonical URLs.

### Root Cause 4: Cross-locale duplicate content

Articles are served in 6 locales (`zh`, `en`, `ja`, `ko`, `fr`, `de`). While hreflang annotations exist, Google may still see 6 near-identical pages and choose to index only a subset, leaving 40+ pages as "crawled but not indexed."

---

## Fix Plan

### Step 1: Fix article `noindex` fallback — Make error state indexable

**File**: [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.tsx)

**Change**: In the error fallback of `generateMetadata()`, change `robots` from `index: false` to `index: true`. The article page still renders meaningful UI (skeleton/error state) even when the API fails, so it should remain indexable to avoid Google's "excluded by noindex tag" penalty.

```diff
  // Error fallback (line 121-129)
  return {
    title: 'Article Not Found',
    description: 'The requested article could not be found.',
    robots: {
-     index: false,
-     follow: false,
+     index: true,
+     follow: true,
    },
  };
```

**Rationale**: It's better to have an article page indexed (even if temporarily showing a fallback) than to have Google permanently exclude it. Once the API recovers, the page will serve full content on the next ISR revalidation.

### Step 2: Add explicit `robots` metadata to tag and category detail pages

**File**: [`apps/frontend-blog/src/app/[locale]/tags/[slug]/page.tsx`](apps/frontend-blog/src/app/[locale]/tags/[slug]/page.tsx)

**Change**: Add explicit `robots: { index: true, follow: true }` to `generateMetadata()`:

```typescript
// In generateMetadata(), after alternates:
return {
  alternates: { ... },
  robots: {
    index: true,
    follow: true,
  },
};
```

**File**: [`apps/frontend-blog/src/app/[locale]/categories/[slug]/page.tsx`](apps/frontend-blog/src/app/[locale]/categories/[slug]/page.tsx)

Same change as above.

### Step 3: Add `generateMetadata()` with `robots: noindex` to search page

**File**: [`apps/frontend-blog/src/app/[locale]/search/page.tsx`](apps/frontend-blog/src/app/[locale]/search/page.tsx)

**Change**: Search result pages with query params create infinite URL variations, which cause duplicate content issues. Add `generateMetadata()` with `robots: { index: false, follow: true }`:

```typescript
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';

  return {
    title: 'Search | Tarsier Labs',
    robots: {
      index: false,   // Don't index search result pages
      follow: true,    // But follow links on the page
    },
    alternates: {
      canonical: `${baseUrl}/${locale}/search`,
    },
  };
}
```

### Step 4: Verify `NEXT_PUBLIC_SITE_URL` uses HTTPS in all environments

**Files to check**:
- [`apps/frontend-blog/.env.development`](apps/frontend-blog/.env.development) — Does NOT set `NEXT_PUBLIC_SITE_URL`
- Deployment configs (Cloudflare, Docker)

**Action**: Ensure `NEXT_PUBLIC_SITE_URL` is set to `https://blog.joyminis.com` in all production environments. If not set, the code correctly defaults to `https://blog.joyminis.com`, but verify no staging environment accidentally overrides it to `http://`.

Check:
- [`deploy/blog-cloudflare.sh`](deploy/blog-cloudflare.sh) — Does NOT set `NEXT_PUBLIC_SITE_URL` explicitly
- GitHub Actions / GitLab CI configs for the environment variable

### Step 5: Add robots `max-image-preview:large` and `max-snippet:-1` to all pages

**File**: [`apps/frontend-blog/src/app/[locale]/layout.tsx`](apps/frontend-blog/src/app/[locale]/layout.tsx:93)

The locale layout already has these settings. Ensure they cascade properly to all child pages that don't override `robots`.

### Step 6: Improve article fetch resilience

**File**: [`apps/frontend-blog/src/lib/cached/article.ts`](apps/frontend-blog/src/lib/cached/article.ts)

Currently, `getCachedArticle()` catches errors and returns `null`. This is used by both `generateMetadata()` and the page component. If we can't fetch the article, we should still render the page as indexable rather than marking it `noindex`.

This is already addressed by Step 1 above, but for additional resilience, consider adding a retry mechanism:

```typescript
export const getCachedArticle = cache(
  async (slug: string, locale: string, retries = 1): Promise<FrontendArticle | null> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await serverGet<FrontendArticle>(
          `/v1/frontend/blog/articles/${slug}`,
          { lang: locale },
        );
      } catch (error) {
        if (attempt < retries) {
          // Wait 500ms before retrying
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        console.error('[getCachedArticle] Failed to fetch article:', error);
        return null;
      }
    }
    return null;
  },
);
```

This is an **optional enhancement** — the primary fix is Step 1.

### Step 7: Add HTTP→HTTPS redirect handling

The blog is deployed to Cloudflare Pages which typically handles HTTP→HTTPS redirects automatically. However, to ensure consistency:

1. Check Cloudflare Dashboard for "Always Use HTTPS" setting under SSL/TLS
2. Verify the `Strict-Transport-Security` header in [`next.config.ts:222`](apps/frontend-blog/next.config.ts:222) is correct (it already is: `max-age=63072000; includeSubDomains; preload`)

**Additional fix**: Add the `x-robots-tag: noindex, nofollow` header check — ensure the Cloudflare Worker or Pages function isn't accidentally setting this header for any path.

### Step 8: Submit updated sitemap and request re-crawling

After deploying fixes:
1. Verify `https://blog.joyminis.com/robots.txt` is correct
2. Verify `https://blog.joyminis.com/sitemap.xml` lists all locale sitemaps
3. In Google Search Console, use URL Inspection Tool to test fixed URLs
4. Request re-crawling of affected pages

---

## Files Modified Summary

| # | File | Change |
|---|------|--------|
| 1 | [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.tsx) | Change `robots: { index: false, follow: false }` → `{ index: true, follow: true }` in error fallback |
| 2 | [`apps/frontend-blog/src/app/[locale]/tags/[slug]/page.tsx`](apps/frontend-blog/src/app/[locale]/tags/[slug]/page.tsx) | Add `robots: { index: true, follow: true }` to `generateMetadata()` |
| 3 | [`apps/frontend-blog/src/app/[locale]/categories/[slug]/page.tsx`](apps/frontend-blog/src/app/[locale]/categories/[slug]/page.tsx) | Add `robots: { index: true, follow: true }` to `generateMetadata()` |
| 4 | [`apps/frontend-blog/src/app/[locale]/search/page.tsx`](apps/frontend-blog/src/app/[locale]/search/page.tsx) | Add `generateMetadata()` with `robots: { index: false, follow: true }` |
| 5 | [`apps/frontend-blog/.env.development`](apps/frontend-blog/.env.development) | (Optional) Add `NEXT_PUBLIC_SITE_URL` if needed |
| 6 | [`apps/frontend-blog/src/lib/cached/article.ts`](apps/frontend-blog/src/lib/cached/article.ts) | (Optional) Add retry logic for fetch resilience |

## Verification

1. **Build test**: `yarn workspace @lucky/frontend-blog build` — ensure no type/build errors
2. **Local test**: Run the blog locally and verify:
   - Article pages have `<meta name="robots" content="index,follow">` in HTML head
   - Tag pages have `<meta name="robots" content="index,follow">`
   - Category pages have `<meta name="robots" content="index,follow">`
   - Search pages have `<meta name="robots" content="noindex,follow">` or equivalent
3. **Deploy**: Deploy to Cloudflare Pages
4. **GSC**: After deployment, use URL Inspection Tool to test specific URLs, then request re-crawling
5. **Monitor**: Check GSC Index Coverage report in 1-2 weeks for improvement
