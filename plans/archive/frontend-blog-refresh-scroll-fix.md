# Frontend Blog: Page Refresh Scroll Position Fix

## Problem

**Reported**: "刷新页面，页面应该在顶部才对吧，现在我如何刷新页面都保持位置了"

**Translation**: On page refresh (F5/Cmd+R), the browser preserves the scroll position instead of scrolling to top.

## Root Cause

**This is NOT caused by our `popLayout` fix or any code change.**

The issue is the **browser's native `history.scrollRestoration = 'auto'`** behavior (default in Chrome/Safari/Edge):

1. User scrolls down the home page
2. User refreshes the page (F5/Cmd+R)
3. Browser automatically saves the current scroll position before unload
4. On reload, browser restores scroll position after the page renders
5. Result: page appears to "stay" at the same scroll position

**Why this appears new**: Before our hooks-error fix, the `mode="wait"` race condition caused DOM corruption (`removeChild` errors) during navigation. This unstable DOM state may have prevented the browser from successfully saving/restoring scroll position. Now that the DOM is stable, the browser's native scroll restoration works correctly — revealing this pre-existing behavior.

**Verification**: The existing custom scroll restoration in [`page.client.tsx:254-270`](../../apps/frontend-blog/src/app/%5Blocale%5D/page.client.tsx) is **NOT** responsible for this. Its condition is:
```typescript
if (isBackNavigation && savedScrollY && !scrollRestoredRef.current) {
    window.scrollTo(0, Number(savedScrollY));
}
```

On page refresh, `isBackNavigation` is `false` (module-level `_direction` defaults to `'forward'`), so the custom restoration never fires.

## Solution

Add `history.scrollRestoration = 'manual'` as an inline script in the root layout's `<head>`. This:

1. Runs **synchronously before the browser attempts scroll restoration** (before first paint)
2. Prevents the browser from automatically saving/restoring scroll position on refresh
3. Does **NOT** affect our custom scroll restoration (back navigation via `sessionStorage` + `window.scrollTo()`)
4. Is the **standard recommended practice** when implementing custom scroll restoration

### File to Modify

[`apps/frontend-blog/src/app/layout.tsx:38`](../../apps/frontend-blog/src/app/layout.tsx) — Add a new `<script>` block in `<head>`:

```typescript
<script
  dangerouslySetInnerHTML={{
    __html: `
      (function() {
        try {
          if ('scrollRestoration' in history) {
            history.scrollRestoration = 'manual';
          }
        } catch(e) {}
      })();
    `,
  }}
/>
```

### Why This Works

| Mechanism | Behavior |
|-----------|----------|
| Browser native scroll restoration (`auto`) | ✅ Prevented by `manual` |
| Custom back-navigation scroll restoration (`sessionStorage` + `window.scrollTo()`) | ✅ Still works — explicit DOM call |
| Page refresh → scroll to top | ✅ Now works — no restoration means page starts at 0 |
| SPA navigation scroll behavior | ✅ Unaffected — Next.js handles this |

### Safety

- The inline script runs immediately during HTML parsing, before the browser fires `pageshow`/`DOMContentLoaded` where scroll restoration typically happens
- The script is wrapped in try/catch and feature-checked for older browser compatibility
- No impact on existing scroll restoration logic

## Verification

```bash
# 1. Type-check
yarn workspace @lucky/frontend-blog tsc --noEmit

# 2. Manual test — scroll down → F5 refresh → verify scroll to top
# 3. Manual test — scroll down → navigate to article → back → verify scroll restored
# 4. Manual test — rapid navigation → verify no console errors
```
