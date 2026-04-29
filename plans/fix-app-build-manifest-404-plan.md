# Fix `/_next/app-build-manifest.json` 404 on blog-dev.joyminis.com

## Root Cause Analysis

### The Problem

`https://blog-dev.joyminis.com/_next/app-build-manifest.json` returns HTTP 404.

### Architecture Context

The app is deployed via [`@opennextjs/cloudflare`](apps/frontend-blog/package.json:53) v1.17.1 as a Cloudflare Worker. The build output (`.open-next/`) contains:

- **`app-build-manifest.json`** does exist in the server bundle at [`.open-next/server-functions/default/apps/frontend-blog/.next/app-build-manifest.json`](apps/frontend-blog/.open-next/server-functions/default/apps/frontend-blog/.next/app-build-manifest.json)
- The worker at [`.open-next/cloudflare-templates/worker.js`](apps/frontend-blog/.open-next/cloudflare-templates/worker.js) handles all requests by first passing them through the middleware handler, then to the Next.js server handler
- Static assets (`_next/static/*`) are served from the [`ASSETS`](apps/frontend-blog/wrangler.jsonc:18-21) binding

### The Bug: Middleware Matcher Too Narrow

The middleware matcher in [`middleware.ts`](apps/frontend-blog/middleware.ts:91-97):

```ts
matcher: [
  '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
]
```

This only excludes `_next/static` and `_next/image` from middleware processing. The request `/_next/app-build-manifest.json` does NOT match either exclusion, so **the middleware intercepts it**.

### What the Middleware Does

1. Detects the locale (e.g., `en`)
2. Checks if the path has a locale prefix — `/_next/app-build-manifest.json` does **not**
3. **Redirects** to `/${detectedLocale}/_next/app-build-manifest.json` (e.g., `/en/_next/app-build-manifest.json`)
4. The browser follows the redirect to `/en/_next/app-build-manifest.json`
5. This time the middleware passes it through (has locale prefix)
6. The Next.js server handler doesn't know this path — **returns 404**

### The Fix

Broaden the middleware matcher to exclude **all** `_next/*` paths, not just `_next/static` and `_next/image`. This is the correct approach because:

- No `_next/*` path should ever get a locale prefix — they are internal Next.js build artifacts
- Other `_next/*` files like `_next/build-manifest.json`, `_next/react-loadable-manifest.json` could also be affected

## Changes Required

### 1. Update Middleware Matcher in [`middleware.ts`](apps/frontend-blog/middleware.ts)

| Current | Fixed |
|---------|-------|
| `'/((?!api\|_next/static\|_next/image\|favicon.ico\|robots.txt\|sitemap.xml).*)'` | `'/((?!api\|_next\|favicon.ico\|robots.txt\|sitemap.xml).*)'` |

Replace `_next/static|_next/image` with just `_next` to exclude **all** `_next/*` subpaths.

### Verification Steps

1. **Rebuild** the blog: `yarn workspace @lucky/frontend-blog build`
2. **Local test**: Start the dev server and verify `/_next/app-build-manifest.json` returns 200
3. **Deploy** to Cloudflare preview (test branch) via the GitHub workflow
4. **Verify on blog-dev**: `curl -I https://blog-dev.joyminis.com/_next/app-build-manifest.json` should return `200 OK`
5. **Verify no regression**: Browse the site and ensure locale-based routing still works correctly for all page routes

### Risk Assessment

- **Low risk**: All `_next/*` paths are internal Next.js build artifacts that should never be localized. The middleware should never touch them.
- **No breaking change**: The middleware already correctly excludes `_next/static` and `_next/image` — this just expands the exclusion to cover all `_next` paths.
