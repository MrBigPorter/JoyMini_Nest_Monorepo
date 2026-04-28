# Admin Next.js Cloudflare Worker Size — Actionable Plan (Updated)

## Problem

Deploying `admin-next` to Cloudflare Workers fails with:

> "Your Worker exceeded the size limit of 3 MiB"

## Current Status After Code Fixes

### Changes Made (Steps 1-2)

1. **Fixed Sentry static re-export** → dynamic wrapper in [`instrumentation.ts:103`](../apps/admin-next/src/instrumentation.ts:103)
2. **Added Sentry/OTel deps to `outputFileTracingExcludes`** in [`next.config.ts:83-88`](../apps/admin-next/next.config.ts:83)

### Build Result

```
Total Upload: 11,733.47 KiB / gzip: 3,129.61 KiB
```

**Previous deployment:** 11,808 KiB — only **~75 KiB saved**. Still far exceeds 3 MiB limit.

### Why the fix didn't reduce size significantly

The Sentry static re-export fix was correct, but the `withSentryConfig` webpack plugin (applied at [`next.config.ts:192`](../apps/admin-next/next.config.ts:192)) still injects Sentry code via webpack during `next build`. This creates a 936K Sentry chunk (`4358.js`) that `@opennextjs/cloudflare`'s esbuild bundler then bundles into the single `handler.mjs`.

Even removing Sentry entirely would only save ~1 MiB, leaving ~10.5 MiB — still way over 3 MiB.

### Bundle Breakdown (Next.js server chunks)

| Chunk     | Size       | Contents                                                  |
| --------- | ---------- | --------------------------------------------------------- |
| `2130.js` | 1.6 MiB    | Main app code (next-intl, UI components, pages)           |
| `2079.js` | 1.1 MiB    | App code (framer-motion, recharts, @tanstack/react-table) |
| `4358.js` | 936 KiB    | Sentry (injected by withSentryConfig webpack plugin)      |
| `5484.js` | 492 KiB    | App code                                                  |
| `3759.js` | 448 KiB    | App code                                                  |
| Others    | ~1.5 MiB   | Various chunks                                            |
| **Total** | **~6 MiB** | Before opennextjs esbuild bundling                        |

After opennextjs esbuild bundles everything + node_modules → **11.46 MiB**

## Solution

### Option A: Upgrade Cloudflare Workers Plan (RECOMMENDED)

The app code itself is ~10 MiB. Code optimization alone cannot reduce it to 3 MiB.

| Plan         | Limit   | Price   | Fits?          |
| ------------ | ------- | ------- | -------------- |
| Free         | 3 MiB   | $0      | ❌ (11.46 MiB) |
| Workers Paid | 10 MiB  | $5/mo   | ❌ (11.46 MiB) |
| Workers+     | 100 MiB | $25+/mo | ✅             |

**Action:** Upgrade to Workers Paid ($5/mo, 10 MiB) AND further optimize to get under 10 MiB, OR Workers+ for more headroom.

### Option B: Further Code Optimization

If upgrading to Workers Paid (10 MiB limit), we need to cut ~1.5 MiB:

1. **Remove `withSentryConfig` entirely** — saves ~936 KiB (Sentry chunk)
   - Move Sentry init to only use dynamic `import()` in `register()`
   - Remove `withSentryConfig` wrapper, keep only `withNextIntl` and `withBundleAnalyzer`
   - Risk: Sentry source map upload won't work automatically

2. **Audit heavy dependencies** — potential savings:
   - `framer-motion` (~200 KiB in server bundle) — use `dynamic(() => import(...), { ssr: false })`
   - `recharts` (~150 KiB) — already dynamically imported in analytics page
   - `react-quill-new` (~300 KiB) — already dynamically imported in RichTextEditor

3. **Remove unused Sentry instrumentation packages** — `@sentry/instrumentation-*` packages (openai, langchain, etc.) are not needed for admin panel

### Option C: Switch to Cloudflare Pages

Cloudflare Pages has a **25 MiB function size limit on the free plan**. This would be the simplest solution:

- Change deployment target from Workers to Pages
- Update wrangler.jsonc configuration
- No code changes needed

## Recommendation

**Short-term:** Upgrade Cloudflare Workers to Paid plan ($5/mo, 10 MiB) + remove `withSentryConfig` to get under 10 MiB.

**Long-term:** Consider Cloudflare Pages (25 MiB free limit) for more headroom without monthly cost.

## Rollback

If needed, revert the two changes made:

1. [`instrumentation.ts`](../apps/admin-next/src/instrumentation.ts) — restore static re-export
2. [`next.config.ts`](../apps/admin-next/src/next.config.ts) — remove Sentry/OTel from outputFileTracingExcludes
