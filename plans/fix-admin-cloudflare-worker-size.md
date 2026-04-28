# Fix: Admin Cloudflare Worker Size Limit Exceeded

## Problem

The Cloudflare Worker deployment for `lucky-admin-next-prod` fails because the worker script exceeds the **3 MiB free plan limit**. The server handler bundle is **11,410.30 KiB (~11.14 MiB)**.

## Root Cause Analysis

### Primary: Sentry static re-export in `instrumentation.ts`

File: [`apps/admin-next/src/instrumentation.ts:93`](../apps/admin-next/src/instrumentation.ts:93)

```typescript
export { captureRequestError as onRequestError } from "@sentry/nextjs";
```

This is a **static re-export** that forces the bundler (`opennextjs-cloudflare`) to include the **entire `@sentry/nextjs` module** in the server bundle at build time. This pulls in:

- `@sentry/node` → `@opentelemetry/instrumentation` → webpack → full Node.js toolchain
- Estimated impact: **~5+ MiB** added to the bundle

The `register()` function above uses **dynamic `import()`** for Sentry init (which is good), but the static re-export on line 93 bypasses all tree-shaking.

### Secondary: `@repo/ui` barrel imports

The UI package (`packages/ui/package.json`) has heavy dependencies:

- `react-quill-new` (rich text editor)
- `framer-motion` (animation library)
- `react-day-picker` (date picker)
- `react-dropzone` (file upload)

When server components import from `@repo/ui` barrel (`import { Button } from '@repo/ui'`), the bundler may include all re-exported modules. The `next.config.ts` already has `optimizePackageImports: ['@repo/ui', ...]` which helps, but the barrel pattern still risks pulling in unused heavy deps.

### Tertiary: `framer-motion` in SSR-rendered components

`framer-motion` is imported in several `'use client'` components that are server-rendered (SSR pass):

- [`Sidebar.tsx`](../apps/admin-next/src/components/layout/Sidebar.tsx:14)
- [`MainContent.tsx`](../apps/admin-next/src/components/layout/MainContent.tsx:5)
- [`Modal.tsx`](../apps/admin-next/src/components/ui/Modal.tsx:5)
- [`Button.tsx`](../apps/admin-next/src/components/ui/Button.tsx:4)
- [`Login.tsx`](../apps/admin-next/src/views/Login.tsx:16)
- [`RegisterApply.tsx`](../apps/admin-next/src/views/RegisterApply.tsx:8)
- [`UIComponents.tsx`](../apps/admin-next/src/components/UIComponents.tsx:17)

While these are client components, the SSR pass still bundles `framer-motion` into the server handler.

## Solution

### Step 1: Fix Sentry static re-export (HIGH IMPACT)

Replace the static re-export with a **dynamic wrapper function** that only imports Sentry when an error actually occurs.

**File to modify:** [`apps/admin-next/src/instrumentation.ts`](../apps/admin-next/src/instrumentation.ts)

**Change:**

```typescript
// BEFORE (line 93):
export { captureRequestError as onRequestError } from "@sentry/nextjs";

// AFTER:
export async function onRequestError(
  error: Error,
  request: Request,
  context: { routerKind: string; routeType: string; routeKey: string },
) {
  try {
    const { captureRequestError } = await import("@sentry/nextjs");
    return captureRequestError(error, request, context);
  } catch {
    // Sentry not available — silently ignore
  }
}
```

**Expected impact:** Reduces bundle by **~5+ MiB** by preventing the entire `@sentry/nextjs` Node.js SDK from being bundled at build time.

### Step 2: Upgrade Cloudflare Workers plan (NECESSARY)

Even after Step 1, the remaining bundle (~6 MiB) may still exceed the 3 MiB free limit.

**Action:** Upgrade Cloudflare Workers plan from **Free (3 MiB)** to **Paid ($5+/mo, up to 10 MiB)** or **Workers Paid (up to 100 MiB)**.

- URL: https://dash.cloudflare.com/<account_id>/workers/plans
- The Workers Paid plan at $5/month allows up to **10 MiB** per worker
- If still over 10 MiB, consider Workers+ for up to **100 MiB**

### Step 3: Add Sentry OpenTelemetry deps to `outputFileTracingExcludes` (MEDIUM IMPACT)

Add Sentry's Node.js/OpenTelemetry dependencies to the existing exclusion list in [`apps/admin-next/next.config.ts:57-80`](../apps/admin-next/next.config.ts:57).

**File to modify:** [`apps/admin-next/next.config.ts`](../apps/admin-next/next.config.ts)

**Change:** Add to the `outputFileTracingExcludes['*']` array:

```typescript
'./node_modules/@sentry/node/**',
'./node_modules/@sentry/opentelemetry/**',
'./node_modules/@opentelemetry/**',
'./node_modules/require-in-the-middle/**',
```

### Step 4: Audit and optimize heavy client dependencies (LOW-MEDIUM IMPACT)

**4a. `react-quill-new`** — Already dynamically imported in [`RichTextEditor.tsx:61`](../apps/admin-next/src/components/blog/RichTextEditor.tsx:61). No action needed.

**4b. `recharts`** — Already dynamically imported in analytics page. No action needed.

**4c. `framer-motion`** — Consider wrapping with `dynamic(() => import(...), { ssr: false })` for components where animations are purely cosmetic (e.g., Button, Modal). However, this is a lower priority since the SSR bundle of framer-motion is relatively small (~50-100 KiB).

**4d. `react-markdown` + `remark-gfm`** — Used in [`BlogArticleContent.tsx`](../apps/admin-next/src/app/blog/articles/[slug]/BlogArticleContent.tsx:3). Consider dynamic import if this page is rarely accessed.

### Step 5: Consider `@sentry/core` for edge runtime (OPTIONAL, MEDIUM IMPACT)

Instead of `@sentry/nextjs` (which bundles everything), use `@sentry/core` directly for the edge runtime. This is a larger refactor but would give the smallest possible Sentry footprint.

## Execution Order

| #   | Task                                                    | File(s)                                  | Impact                     | Effort |
| --- | ------------------------------------------------------- | ---------------------------------------- | -------------------------- | ------ |
| 1   | Fix Sentry static re-export → dynamic wrapper           | `apps/admin-next/src/instrumentation.ts` | High (~5 MiB saved)        | Small  |
| 2   | Upgrade Cloudflare Workers plan                         | Cloudflare Dashboard                     | Required (3 MiB → 10+ MiB) | Small  |
| 3   | Add Sentry deps to `outputFileTracingExcludes`          | `apps/admin-next/next.config.ts`         | Medium                     | Small  |
| 4   | Audit heavy client deps (framer-motion, react-markdown) | Various components                       | Low-Medium                 | Medium |
| 5   | Consider `@sentry/core` for edge runtime                | `apps/admin-next/src/instrumentation.ts` | Medium                     | Large  |

## Verification

After implementing the changes:

1. Run `yarn workspace @lucky/admin-next build` locally to verify the build succeeds
2. Check the `.open-next/server-functions/default/apps/admin-next/handler.mjs` file size
3. Deploy to Cloudflare Workers and verify the deployment succeeds
4. Verify Sentry error reporting still works (test with a deliberate error)

## Rollback

If the deployment still fails after optimization:

1. Revert the `instrumentation.ts` changes
2. Keep the Cloudflare plan upgrade (it's needed regardless)
3. Consider switching to Cloudflare Pages (25 MiB function limit on free plan) as an alternative deployment target
