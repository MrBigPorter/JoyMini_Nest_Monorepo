# Hydration Error Investigation: HlsVideoPlayer posterWebp

## Problem

The hydration error in `HlsVideoPlayer.tsx` persists **even after**:
- Full `.next` directory deletion (`rm -rf apps/frontend-blog/.next`)
- Dev server restart
- Testing in incognito/private browsing mode

The React component tree still shows `posterWebp="https://im..."` being passed to `<HlsVideoPlayer>`, confirming **old compiled JavaScript is still being served**.

## Source Code Verification

All 3 component files have been verified to contain **zero** `posterWebp` references:

| File | Status |
|------|--------|
| [`HlsVideoPlayer.tsx`](../apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx) | ✅ No `posterWebp` in props interface (lines 7-18), destructuring (lines 28-36), or component body |
| [`HeroSection.tsx`](../apps/frontend-blog/src/components/blog/HeroSection.tsx) | ✅ Passes only `hlsUrl`, `poster`, `className`, `videoClassName`, `autoPlay`, `muted` (lines 75-87) |
| [`ArticleCard.tsx`](../apps/frontend-blog/src/components/blog/ArticleCard.tsx) | ✅ Passes only `hlsUrl`, `poster`, `className`, `videoClassName`, `clickToPlay` (lines 189-202) |
| [`page.tsx` (home)](../apps/frontend-blog/src/app/%5Blocale%5D/page.tsx) | ✅ No `posterWebp` variable (lines 105-122) |
| [`frontend-blog.ts`](../apps/frontend-blog/src/lib/types/frontend-blog.ts) | ✅ `posterWebp` removed from `ArticleMeta.video` interface (line 28) |

Only remaining reference is a **comment** in [`articles/[slug]/page.tsx:165`](../apps/frontend-blog/src/app/%5Blocale%5D/articles/%5Bslug%5D/page.tsx#165):
```tsx
// NOTE: Video poster URLs (meta.video.poster/posterWebp) are NOT available
```

## Configuration Findings

| Item | Detail |
|------|--------|
| **Dev command** | `next dev` (no explicit `--turbo` flag, but Next.js 15 uses Turbopack by default) |
| **Turborepo dev cache** | `"cache": false` in [`turbo.json`](../turbo.json#L22) — dev cache is disabled |
| **`node_modules/.cache/`** | Only contains `jiti/` — no `turbo/` or `next/` directories |
| **PWA/SW** | Disabled in dev mode ([`next.config.ts:21-22`](../apps/frontend-blog/next.config.ts#L21-L22)) |
| **Port** | Default (3000), no custom port configured |

## Root Cause Hypotheses (Priority Order)

### Hypothesis 1: Stale Dev Server Process (MOST LIKELY)

The old `next dev` process was **not fully killed** before deleting `.next` and restarting.

**How this happens:**
1. User Ctrl+C in terminal → shell process exits, but Node.js child process may survive
2. User deletes `.next/` → old process still has file handles, recreates files from memory cache
3. User starts new `next dev` in new terminal → but port 3000 is still held by old process
4. Actually the new process fails to bind, so the old one (which never died) continues serving old code

**Fix:** Force-kill ALL Node.js processes before restarting.

### Hypothesis 2: Turbopack In-Memory + Disk Cache Hybrid

Turbopack may have an **in-memory compilation cache** tied to the process. If process wasn't cleanly restarted:
- Old process recreates `.next/` from its in-memory cache after we delete it
- New process sees the recreated `.next/` and uses the stale output

**Fix:** Same as Hypothesis 1 — clean process kill + cache deletion.

### Hypothesis 3: The Actual Hydration Error is NOT About posterWebp

The React DevTools showing `posterWebp` may be **stale DevTools display** (not auto-refreshed). The real hydration error could be about the `poster` URL produced by `getOptimizedImageUrl()`.

The `getOptimizedImageUrl()` function at [`cloudflareImageLoader.ts:28-77`](../apps/frontend-blog/src/lib/utils/cloudflareImageLoader.ts) uses `new URL(src)` — which is available on both server and client. However, if the `src` URL is slightly different between server render and client render, the output would differ.

But this wouldn't explain `posterWebp` appearing in the component tree.

### Hypothesis 4: Symlink or Mount Issue

The project is on `/Volumes/MySSD/` — an external/exFAT drive. File deletion on exFAT may not be instantaneous. After `rm -rf`, the old process might recreate files before the deletion fully propagates.

## Investigation & Fix Plan

### Step 1: Confirm Process Status
```bash
# Check what's listening on port 3000
lsof -i :3000

# Check all next dev processes
ps aux | grep "next dev" | grep -v grep
```

### Step 2: Full Clean Kill
```bash
# Kill ALL node processes (or be more targeted)
pkill -f "next dev" || true
# Wait for release
sleep 2
# Verify port is free
lsof -i :3000
```

### Step 3: Delete All Cache
```bash
rm -rf apps/frontend-blog/.next
# Also clean any Turbopack cache
rm -rf node_modules/.cache
```

### Step 4: Restart Cleanly
```bash
yarn workspace @lucky/frontend-blog dev
```

### Step 5: Verify in Incognito
- Open Chrome/Firefox incognito window
- Navigate to `http://localhost:3000`
- Open DevTools Console → check for hydration errors
- Open Components tab → verify NO `posterWebp` in HlsVideoPlayer props

### Step 6: If Still Fails — Alternative Root Cause
If the error persists after clean kill+restart:
- Check if the actual error is about the `poster` URL (not `posterWebp`)
- The `+`/`-` diff in the hydration error may show identical URLs (truncated in error message)
- Consider wrapping `effectivePoster` in `useState`/`useEffect` to avoid server/client differences

## Key Files Reference

| File | Purpose |
|------|---------|
| [`HlsVideoPlayer.tsx`](../apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx) | Component with hydration error (line 262 = `<video>` element) |
| [`cloudflareImageLoader.ts`](../apps/frontend-blog/src/lib/utils/cloudflareImageLoader.ts) | `getOptimizedImageUrl()` — transforms poster URL, may produce different results server vs client |
| [`next.config.ts`](../apps/frontend-blog/next.config.ts) | Build/dev configuration, PWA settings |
| [`turbo.json`](../turbo.json) | Turborepo config — dev cache disabled |
| [`frontend-blog.ts`](../apps/frontend-blog/src/lib/types/frontend-blog.ts) | Type definitions — `posterWebp` removed |
