# Fix: Google OAuth `/auth/google/login/` Returns 404 on Production

## Problem

When a user clicks "Login with Google" on `https://blog.joyminis.com`, the frontend redirects to:

```
https://blog.joyminis.com/auth/google/login/?redirect_uri=...&state=...&client=web
```

This returns a **404 Not Found**.

## Root Cause

The frontend blog is deployed on **Cloudflare Pages** (not the nginx proxy). The OAuth initiation endpoint `/auth/google/login/` exists on the **NestJS backend** (served at `api.joyminis.com`), but the frontend redirects to the **blog domain** (`blog.joyminis.com`) using a relative path.

### Flow Breakdown

1. **Frontend** ([`apps/frontend-blog/src/app/[locale]/login/page.client.tsx:70`](../apps/frontend-blog/src/app/[locale]/login/page.client.tsx:70)):
   - User clicks "Login with Google"
   - Redirects to: `/auth/google/login?redirect_uri=...&state=...&client=web`
   - This resolves to `https://blog.joyminis.com/auth/google/login/`

2. **Cloudflare Pages** handles `blog.joyminis.com`:
   - It serves the Next.js static output
   - `/auth/google/login/` is not a Next.js page → **404**

3. **NestJS Backend** ([`apps/api/src/client/auth/oauth-deeplink.controller.ts:51`](../apps/api/src/client/auth/oauth-deeplink.controller.ts:51)):
   - `GET /auth/google/login` exists in `OAuthDeepLinkController`
   - Full path: `GET /api/v1/auth/google/login` (with global prefix)
   - Served at `https://api.joyminis.com/auth/google/login`

4. **Nginx** ([`nginx/nginx.prod.conf:185`](../nginx/nginx.prod.conf:185)):
   - `location ^~ /auth/` proxies to `http://backend:3000/api/v1$request_uri`
   - Only configured for `server_name api.joyminis.com`

### Why Dev Works

In the dev nginx config ([`nginx/nginx.dev.conf:26`](../nginx/nginx.dev.conf:26)), `blog-dev.joyminis.com` and `dev-api.joyminis.com` share the same `server_name` block, so the `/auth/` location catches the request regardless of which domain is used.

## Solution

Change the OAuth redirect URL in the frontend from a **relative path** to an **absolute URL** pointing to the API domain.

### Files to Modify

**File:** [`apps/frontend-blog/src/app/[locale]/login/page.client.tsx`](../apps/frontend-blog/src/app/[locale]/login/page.client.tsx)

### Change 1: Google OAuth (line 70)

**Before:**
```typescript
window.location.href = `/auth/google/login?${params.toString()}`;
```

**After:**
```typescript
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/api$/, '') || '';
window.location.href = `${apiBaseUrl}/auth/google/login?${params.toString()}`;
```

### Change 2: Facebook OAuth (line 173)

**Before:**
```typescript
window.location.href = `/auth/facebook/login?${params.toString()}`;
```

**After:**
```typescript
window.location.href = `${apiBaseUrl}/auth/facebook/login?${params.toString()}`;
```

### Why `NEXT_PUBLIC_API_BASE_URL`?

- **Production** ([`apps/frontend-blog/.env.production:4`](../apps/frontend-blog/.env.production:4)): `NEXT_PUBLIC_API_BASE_URL=https://api.joyminis.com/api`
  - After removing `/api` suffix: `https://api.joyminis.com`
  - Result: `https://api.joyminis.com/auth/google/login` ✅

- **Development** ([`apps/frontend-blog/.env.development:4`](../apps/frontend-blog/.env.development:4)): `NEXT_PUBLIC_API_BASE_URL=/api`
  - After removing `/api` suffix: `''` (empty)
  - Result: `/auth/google/login` (relative, same as before) ✅

This ensures backward compatibility with the dev environment.

## Verification

After deployment:
1. Click "Login with Google" on `https://blog.joyminis.com`
2. Should redirect to `https://api.joyminis.com/auth/google/login/?redirect_uri=...`
3. Nginx `/auth/` location proxies to backend
4. Backend redirects to Google's OAuth page
5. Google redirects back to `https://api.joyminis.com/auth/google/callback`
6. Backend callback handler redirects to `https://blog.joyminis.com/oauth/callback?token=...`
