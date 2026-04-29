# Fix: i18n Missing Keys + Hydration Error

## Problem 1: MISSING_MESSAGE for `common.backToArticles`

Error on locale `ja`:
```
MISSING_MESSAGE: Could not resolve 'common.backToArticles' in messages for locale 'ja'.
```

**Root cause**: `backToArticles` was only added to `en.json` and `zh.json`, but `ja.json` and `ko.json` were missed.

### Fix
Add `"backToArticles": "..."` to `ja.json` and `ko.json` under the `common` namespace, between `backToTags` and `loading` (alphabetical order).

| File | Value |
|------|-------|
| [`ja.json`](apps/frontend-blog/src/messages/ja.json:12) | `"backToArticles": "記事一覧に戻る"` |
| [`ko.json`](apps/frontend-blog/src/messages/ko.json:12) | `"backToArticles": "글 목록으로 돌아가기"` |

## Problem 2: Persistent Hydration Error (Badge `<a>` vs `<span>`)

## Problem

Persistent hydration mismatch on article detail page:

```
Server HTML: <a href="/en/articles/?category=security">
Client HTML: <span class="inline-flex...">
```

## Root Cause Analysis

After thorough investigation:

1. **Source code is definitively correct** — [`page.client.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx:168) lines 168-178 show `<Badge>` components **without** `<Link>` wrappers. A regex search for `Link.*Badge` across all source files returned 0 results. ✅

2. **No `@/navigation` imports** — the project uses `next/link` directly, not through a custom navigation module. ✅

3. **PWA disabled in dev** — [`next.config.ts`](apps/frontend-blog/next.config.ts:18) line 18: `disable: process.env.NODE_ENV === 'development'` — service worker does NOT intercept requests during development. ✅

4. **Webpack, not Turbopack** — dev script is `next dev` (no `--turbo` flag). ✅

5. **`.next` was deleted and server restarted** — yet error persists. ❌

### Remaining Possible Causes

| Cause | Likelihood | Explanation |
|-------|-----------|-------------|
| **Browser cache** | HIGH | User may have done normal refresh (Cmd+R) instead of hard refresh (Cmd+Shift+R). Browser cached the initial HTML from the OLD server response. |
| **`node_modules/.cache`** | MEDIUM | webpack 5 stores persistent filesystem cache here. Not cleared during the previous attempt (only `.next` was deleted). |
| **`.open-next` stale build** | LOW | Contains production Cloudflare worker bundles with old compiled `.next`. `next dev` shouldn't read this, but worth clearing. |
| **HMR partial recompilation** | LOW | Maybe the client bundle was recompiled but the server bundle wasn't properly refreshed. |

## Execution Plan

### Step 1: Kill dev server
```bash
kill $(lsof -t -i :3000) 2>/dev/null
```

### Step 2: Delete ALL cache directories
```bash
rm -rf apps/frontend-blog/.next
rm -rf apps/frontend-blog/.open-next          # production build artifacts
rm -rf apps/frontend-blog/node_modules/.cache  # webpack persistent cache
```

### Step 3: Restart dev server
```bash
cd /Volumes/MySSD/work/JoyMini_Nest_Monorepo && yarn workspace @lucky/frontend-blog dev
```

### Step 4: Hard refresh browser
User must press **Cmd+Shift+R** (not just Cmd+R) to bypass all browser caching.

### Step 5: Verify
Navigate to the article page and check for hydration errors in browser console.

### Step 6 (Fallback — if still broken)
Add `suppressHydrationWarning` prop to `<Badge>` component in `badge.tsx` as a safety net:

```tsx
return (
  <span
    className={...}
    suppressHydrationWarning
    {...props}
  >
    {children}
  </span>
);
```

This tells React to ignore attribute mismatches during hydration.

### Step 7 (Last resort)
If the error STILL persists after all cache deletion and hard refresh, run a full production build to force clean compilation:

```bash
cd apps/frontend-blog && next build && next start
```
