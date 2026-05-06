# Plan: Fix Canonical URL + Present SEO/Google Indexing Documentation

## Problem Analysis

### Issue 1: Canonical URL in Root Layout is Locale-Agnostic

In [`apps/frontend-blog/src/app/[locale]/layout.tsx:74`](../apps/frontend-blog/src/app/[locale]/layout.tsx:74), the `canonical` URL is hardcoded to the root domain:

```typescript
canonical: process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com',
```

This means:
- Visiting `https://blog.joyminis.com/en` → canonical points to `https://blog.joyminis.com` (root)
- Visiting `https://blog.joyminis.com/zh` → canonical also points to `https://blog.joyminis.com` (root)
- All locale homepages are treated as duplicates of the root

**Impact**: Google may not properly associate each locale version with its correct URL, potentially diluting the SEO value of locale-specific pages.

**Scope**: The `metadata` is exported as a **static object** (not a `generateMetadata` function), so it cannot access `params` to determine the current locale. Only the article page (`page.tsx:90-92`) has its own `generateMetadata` that correctly sets the canonical to `${baseUrl}/${locale}/articles/${slug}`. Other pages (about, categories, tags, bookmarks, search, login) inherit the root canonical from the layout.

### Issue 2: `openGraph.url` Also Hardcoded to Root

Similarly, [`layout.tsx:48`](../apps/frontend-blog/src/app/[locale]/layout.tsx:48):
```typescript
url: process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com',
```
This should also be locale-aware.

### Issue 3: Missing `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` in `.env.production`

[`.env.production`](../apps/frontend-blog/.env.production) does not include the `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` env var. This means the Google Search Console verification meta tag won't be rendered in production builds.

---

## Proposed Fix

### Step 1: Convert Static `metadata` to `generateMetadata` Function

**File**: [`apps/frontend-blog/src/app/[locale]/layout.tsx`](../apps/frontend-blog/src/app/[locale]/layout.tsx:24)

Replace the static `export const metadata: Metadata = { ... }` with a `generateMetadata` function that receives `params` and returns locale-aware metadata.

**Changes**:
1. Remove `export const metadata: Metadata = { ... }` (lines 24-133)
2. Add `export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata>` 
3. Extract `locale` from `params`
4. Make `canonical` dynamic: `${baseUrl}/${locale}`
5. Make `openGraph.url` dynamic: `${baseUrl}/${locale}`
6. Keep `alternates.languages` as-is (already correct)
7. Keep all other metadata fields unchanged

**Before**:
```typescript
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com'),
  alternates: {
    canonical: process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com',  // ❌ root only
    languages: { en: '.../en', zh: '.../zh', ... },  // ✅ correct
  },
  openGraph: {
    url: process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com',  // ❌ root only
    ...
  },
  ...
};
```

**After**:
```typescript
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';
  
  return {
    metadataBase: new URL(baseUrl),
    alternates: {
      canonical: `${baseUrl}/${locale}`,  // ✅ locale-aware
      languages: {
        en: `${baseUrl}/en`,
        zh: `${baseUrl}/zh`,
        ja: `${baseUrl}/ja`,
        ko: `${baseUrl}/ko`,
      },
    },
    openGraph: {
      url: `${baseUrl}/${locale}`,  // ✅ locale-aware
      ...
    },
    ...  // rest unchanged
  };
}
```

### Step 2: Add `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` to `.env.production`

**File**: [`apps/frontend-blog/.env.production`](../apps/frontend-blog/.env.production)

Add the Google Search Console verification code that was obtained during setup:
```
NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=your-verification-code-here
```

> **Note**: The actual value needs to be provided by the user from their Google Search Console setup.

---

## Related SEO / Google Indexing Documentation

The project already has extensive SEO documentation. Here are the relevant files:

### For Operators / SEO Specialists (Chinese-friendly):
| File | Description |
|------|-------------|
| [`docs/blog/development/FRONTEND_BLOG_GOOGLE_INDEXING_GUIDE.md`](../docs/blog/development/FRONTEND_BLOG_GOOGLE_INDEXING_GUIDE.md) | Google Search Console setup, sitemap submission, indexing monitoring (435 lines) |
| [`docs/read/performance/SEO_SUMMARY_CN.md`](../docs/read/performance/SEO_SUMMARY_CN.md) | SEO learning summary in Chinese |
| [`docs/read/performance/SEO_PERFORMANCE_CN.md`](../docs/read/performance/SEO_PERFORMANCE_CN.md) | SEO performance metrics guide in Chinese |

### For Developers / Technical SEO:
| File | Description |
|------|-------------|
| [`docs/blog/development/FRONTEND_BLOG_SEO_TECHNICAL_IMPLEMENTATION.md`](../docs/blog/development/FRONTEND_BLOG_SEO_TECHNICAL_IMPLEMENTATION.md) | Technical SEO implementation (sitemap, robots, metadata, JSON-LD, i18n) (612 lines) |
| [`docs/blog/development/FRONTEND_BLOG_SEO_IMPLEMENTATION_GUIDE.md`](../docs/blog/development/FRONTEND_BLOG_SEO_IMPLEMENTATION_GUIDE.md) | SEO documentation index/navigation (681 lines) |

### Published Blog Articles:
| File | Description |
|------|-------------|
| [`docs/blog/articles/frontend/blog-nextjs-seo-technical-implementation.md`](../docs/blog/articles/frontend/blog-nextjs-seo-technical-implementation.md) | Published article: Next.js SEO from Sitemap to JSON-LD (541 lines) |
| [`docs/blog/articles/frontend/nextjs-ssr-seo-crawler-master-guide.md`](../docs/blog/articles/frontend/nextjs-ssr-seo-crawler-master-guide.md) | Published article: SSR SEO & crawler master guide (431 lines) |

### Chinese-Language Deep Reads:
| File | Description |
|------|-------------|
| [`docs/read/performance/NEXT_SSR_SEO_CRAWLER_MASTER_GUIDE_CN.md`](../docs/read/performance/NEXT_SSR_SEO_CRAWLER_MASTER_GUIDE_CN.md) | SSR SEO crawler master guide in Chinese |

---

## Implementation Steps (for Code Mode)

1. **Edit `layout.tsx`**: Convert `export const metadata` to `generateMetadata` function with locale-aware canonical and openGraph.url
2. **Edit `.env.production`**: Add `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` (user provides the value)
3. **Verify**: Run `yarn workspace @lucky/frontend-blog type-check` to ensure no type errors
4. **Verify**: Run `yarn workspace @lucky/frontend-blog lint` to ensure no lint errors

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| `generateMetadata` in layout might not merge correctly with child page's `generateMetadata` | Next.js 15 App Router handles this correctly - child metadata overrides parent |
| TypeScript errors from the refactor | The function signature matches the existing pattern used in `page.tsx:25-29` |
| Build fails on Cloudflare Workers | The change is purely metadata - no runtime impact. Same pattern already works in article pages |
