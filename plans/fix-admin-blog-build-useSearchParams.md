# Fix: `useSearchParams()` Missing Suspense Boundary — Build Failure

## Root Cause Analysis

The OpenNext.js Cloudflare build fails during static generation (prerendering) of the `/blog/articles` page with:

```
useSearchParams() should be wrapped in a suspense boundary at page "/blog/articles"
```

### Component Tree (simplified)

```
RootLayout (server component, app/layout.tsx:61)
  └─ Providers (client component, components/Providers.tsx:32)
       ├─ AutoLoginHandler (client component — uses useSearchParams())
       ├─ ChunkReloadHandler
       ├─ ToastContainer
       └─ children → /blog/articles/page.tsx
```

### Why it fails

1. `AutoLoginHandler` at [`apps/admin-blog/src/components/AutoLoginHandler.tsx:14`](apps/admin-blog/src/components/AutoLoginHandler.tsx:14) calls `useSearchParams()` from `next/navigation`
2. `AutoLoginHandler` is rendered directly inside [`Providers`](apps/admin-blog/src/components/Providers.tsx:46) **without** a `<Suspense>` boundary
3. During `opennextjs-cloudflare build`, Next.js statically generates all routes. `useSearchParams()` reads from the browser URL — which doesn't exist during prerendering
4. Next.js throws unless the component is wrapped in `<Suspense>`. Since there's no boundary, the build crashes

### Affected routes

All 18 static pages are affected because `Providers` wraps the entire app in the root layout. `/blog/articles` is the first one that triggers the error during `useSearchParams()` hydration.

---

## Fix Plan

### Single change: [`apps/admin-blog/src/components/Providers.tsx`](apps/admin-blog/src/components/Providers.tsx)

Wrap `<AutoLoginHandler />` in a React `<Suspense>` boundary with `fallback={null}`.

**Current (line 46):**
```tsx
<AutoLoginHandler />
```

**Fixed:**
```tsx
<Suspense fallback={null}>
  <AutoLoginHandler />
</Suspense>
```

Add the import: `import React, { Suspense, useEffect, useState } from 'react';`

### Why this works

- `<Suspense fallback={null}>` tells Next.js: "it's OK if this component can't render during SSR/prerendering — just show nothing until the client takes over"
- `AutoLoginHandler` returns `null` anyway (it's a side-effect-only component), so the `fallback={null}` is a no-op visually
- Once the page hydrates on the client, the Suspense boundary resolves and `AutoLoginHandler` runs its `useEffect` normally

### No other files need changes

| File | Status | Reason |
|------|--------|--------|
| `AutoLoginHandler.tsx` | No change needed | Component logic is correct |
| `app/layout.tsx` | No change needed | Root layout is fine |
| `app/(dashboard)/layout.tsx` | No change needed | Auth check is server-side |
| `app/(dashboard)/blog/articles/page.tsx` | No change needed | Page doesn't use `useSearchParams` directly |
| `views/Login.tsx` | No change needed | Login page uses `useSearchParams` but is client-side only, not statically generated |

---

## Verification

After applying the fix, run:

```bash
cd apps/admin-blog && yarn build
```

Or in CI:

```bash
yarn workspace @lucky/admin-blog build
```

The build should complete all 18 static pages without the `useSearchParams` error.
