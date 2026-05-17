# Disable PWA on Dev Environment (blog-dev.joyminis.com)

## Problem
Service Worker (PWA/next-pwa) is enabled on the dev deployment (`test` branch → `blog-dev.joyminis.com` → Cloudflare Workers). When users visit the site, the browser registers a Service Worker that intercepts API requests and proxies them to `https://api.joyminis.com`, causing API calls to hit production even when the frontend page is served locally via Cloudflare Tunnel.

## Root Cause
- `next.config.ts` PWA `disable` condition: only disables when `NODE_ENV === 'development'`
- Cloudflare Workers builds with `NODE_ENV=production`, so PWA is always enabled on CF Workers
- Dev deployment (`test` branch) uses `NEXT_PUBLIC_APP_ENV=preview` (set in CI build step)

## Fix: Simplify next.config.ts

**File:** [`apps/frontend-blog/next.config.ts`](apps/frontend-blog/next.config.ts)

Change the `disable` condition from:
```typescript
disable:
  process.env.NODE_ENV === 'development' &&
  process.env.NEXT_PWA_ENABLE !== 'true',
```

To:
```typescript
disable:
  process.env.NODE_ENV === 'development' ||
  process.env.NEXT_PUBLIC_APP_ENV === 'preview',
```

Logic:
- `NODE_ENV=development` → local Docker dev → disabled
- `NEXT_PUBLIC_APP_ENV=preview` → `test` branch CF Workers deploy → disabled
- Neither → `main` branch production deploy → enabled (unchanged)

## Revert CI Workflow Changes

The `NEXT_PWA_ENABLE` env vars added to the CI workflows are unnecessary and should be removed:

1. [`.github/workflows/deploy-blog-cloudflare.yml`](.github/workflows/deploy-blog-cloudflare.yml) — remove `NEXT_PWA_ENABLE` line
2. [`.gitlab/deploy-blog.yml`](.gitlab/deploy-blog.yml) — remove `NEXT_PWA_ENABLE` line

## Result

| Environment | PWA |
|---|---|
| Local Docker (NODE_ENV=development) | ❌ Disabled |
| blog-dev.joyminis.com (APP_ENV=preview) | ❌ Disabled |
| blog.joyminis.com (APP_ENV=production) | ✅ Enabled |

No unnecessary complexity — just use the existing `NEXT_PUBLIC_APP_ENV` that's already set in CI.
