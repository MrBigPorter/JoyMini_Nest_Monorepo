# Fix: `NextIntlClientProvider` context not found in `HomePageClient`

## Error

```
Error: Failed to call `useTranslations` because the context from `NextIntlClientProvider`
was not found.

This can happen because:
1) You intended to render this component as a Server Component, the render failed,
   and therefore React attempted to render the component on the client instead.
```

Occurs in [`HomePageClient`](apps/frontend-blog/src/app/[locale]/page.client.tsx:31) at `useTranslations()` call.

## Root Cause Analysis

### Component Hierarchy (Correct)

```
RootLayout (server)
  └─ Providers (client: QueryClient, GoogleOAuth, ThemeProvider)
      └─ LocaleLayout (server, async)
          └─ NextIntlClientProvider (client, rendered by server)
              └─ I18nProvider (client)
                  └─ PageTransition (client)
                      └─ children
                          └─ HomePage (server)
                              └─ HomePageClient (client)  ← calls useTranslations()
```

The `NextIntlClientProvider` IS correctly placed in [`LocaleLayout`](apps/frontend-blog/src/app/[locale]/layout.tsx:180) wrapping `children`. Architecture is right.

### Why Context is Missing

The error message's **reason #1** is key: the Server Component rendering **failed during SSR**, and Next.js fell back to rendering on the client side only. In this client-only fallback, the `NextIntlClientProvider` context (normally established by the server-rendered `LocaleLayout`) is absent.

**Likely SSR failure chain:**

1. [`HomePage`](apps/frontend-blog/src/app/[locale]/page.tsx:39) server component calls `serverGet('/v1/frontend/blog/articles', ...)`
2. [`serverGet`](apps/frontend-blog/src/lib/serverFetch.ts:36) uses `fetch()` to call the API
3. If the API server is not running / unreachable (common in dev), the fetch throws
4. [`serverGet` re-throws](apps/frontend-blog/src/lib/serverFetch.ts:65) after logging
5. [`HomePage`'s try-catch](apps/frontend-blog/src/app/[locale]/page.tsx:37-69) catches it and renders `HomePageClient` with empty data → **SSR succeeds**
6. HOWEVER: if the error occurs **before** the try-catch (e.g., module import failure, `'server-only'` boundary issue with Turbopack), or if **another file** like `generateMetadata` on a different page throws during SSR, the whole rendering chain breaks

**Most likely actual trigger:** A Turbopack module-graph issue where `server-only` code from `serverFetch.ts` is incorrectly included in the client bundle, causing an import error that breaks SSR before the try-catch can handle it.

## Diagnosis & Fix Plan

### Step 1: Check Terminal for Server Errors

The user's dev server terminal likely shows server-side errors that reveal the exact SSR failure. This is the most important diagnostic step.

### Step 2: Verify next-intl Installation

Check for duplicate `next-intl` instances (can cause context mismatch between provider and consumer).

### Step 3: Fix SSR Failure in HomePage Server Component

Three possible approaches:

**Option A:** Make the API fetch truly fault-tolerant by catching all possible errors at the import/module level, not just the fetch level.

**Option B:** If `serverGet` fails due to `'server-only'` boundary issues, refactor to a pattern that doesn't use `'server-only'` imports that confuse Turbopack.

**Option C:** Restructure `HomePage` to use `next-intl/server`'s `getTranslations()` for SSR-safe i18n, instead of relying solely on client-side `useTranslations()`.

### Step 4: Add Safe Fallback for `useTranslations`

Add a defensive wrapper for `useTranslations` in client components so they don't crash when context is unavailable (e.g., during client fallback).

### Step 5: (If Needed) Restructure Provider Hierarchy

Move `NextIntlClientProvider` higher in the tree, possibly into a client-side wrapper in `RootLayout`, to ensure it's always available even during client fallback.
