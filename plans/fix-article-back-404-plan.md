# Fix: Frontend Blog - 404 when clicking "Back to Articles" from Article Detail

## Root Cause Analysis

The article listing page is the **home page** at `/[locale]/page.tsx` - there is **no dedicated page** at `/[locale]/articles/`.

### Directory Structure (apps/frontend-blog/src/app/[locale]/)
```
[locale]/
├── page.tsx                    ← Article listing (home page)
├── page.client.tsx
├── articles/
│   ├── [slug]/
│   │   ├── page.tsx            ← Article detail page ✓
│   │   └── page.client.tsx     ← Contains broken "Back to Articles" link
│   └── ❌ MISSING: page.tsx    ← No page at /[locale]/articles/
├── categories/
├── tags/
├── bookmarks/
├── search/
└── ...
```

### The Bug

In [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx:157):

```typescript
// Line 5 - imports standard next/link
import Link from 'next/link';

// Line 157 - "Back to Articles" link targets non-existent route
<Link href={`/${locale}/articles`} ...>
```

The `href` points to `/[locale]/articles`, but this route has **no `page.tsx`** file, so Next.js returns a 404.

### Also Affected

The **error/not-found state** (lines 94-118) in the same file also has a "Back to Articles" link at line 109 that points to the same non-existent route:

```typescript
// Line 109
<Link href={`/${locale}/articles`} ...>
```

### Why This Happened

The route `[locale]/articles/` was only created as a **container directory** for the `[slug]` article detail pages. Previously there may have been a dedicated articles listing page here, but it was consolidated into the home page (`[locale]/page.tsx`). The "Back to Articles" link was not updated to reflect this change.

## Fix Plan

### Step 1: Fix the "Back to Articles" link in page.client.tsx

Change the link from `/${locale}/articles` → `/${locale}` (home page, which IS the article listing).

**File**: [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx)

Two locations to fix:

1. **Line 109** (inside the error/not-found state):
   - From: `` href={`/${locale}/articles`} ``
   - To: `` href={`/${locale}`} ``

2. **Line 157** (main "Back to Articles" link above article content):
   - From: `` href={`/${locale}/articles`} ``
   - To: `` href={`/${locale}`} ``

### Step 2: Use next-intl's `<Link>` for consistency (optional but recommended)

The component currently imports `Link` from `next/link` (line 5). The rest of the codebase uses next-intl's `Link` from `@/navigation`, which handles locale prefixing automatically.

Consider replacing:
```typescript
import Link from 'next/link';  // line 5
```
with:
```typescript
import { Link } from '@/navigation';  // from next-intl
```

Then the href would simply be:
```tsx
<Link href="/articles">{tc('backToArticles')}</Link>
```

This is more consistent with the rest of the codebase (e.g., [`ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx:224) uses `Link from '@/navigation'` with href `/articles/${article.slug}`).

However, since the component currently uses `useLocale()` and `useTranslations()` from next-intl, the simpler approach (Step 1 only) would work fine.

### Step 3: (Optional) Create a redirect at /[locale]/articles/page.tsx

As a safety net, create a page at `[locale]/articles/page.tsx` that redirects to the home page:

```typescript
import { redirect } from '@/navigation';

export default function ArticlesRedirect() {
  redirect('/');
}
```

This ensures that even if someone directly navigates to `/[locale]/articles`, they'll be redirected to the home page instead of seeing a 404.

## Files to Modify

| File | Change |
|------|--------|
| [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx) | Fix href in both "Back" links (lines 109, 157) |
| [`apps/frontend-blog/src/app/[locale]/articles/page.tsx`](apps/frontend-blog/src/app/[locale]/articles/page.tsx) | **NEW FILE** - Redirect to home (optional) |

## Testing

1. Navigate to `/[locale]` (home page - article listing)
2. Click any article card to go to `/[locale]/articles/[slug]`
3. Click "Back to Articles" link → should navigate back to home page (not 404)
4. Also test the error state: visit a non-existent slug → click "Back to Articles" → should go to home page
