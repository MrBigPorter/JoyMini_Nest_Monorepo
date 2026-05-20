# Fix Hydration Error on About Page

## Root Cause Analysis

### The Error
- **Hydration mismatch** on `<AboutFounderAvatar>` → `<BlurhashImage>` → `<Image>` (next/image)
- Cloudflare Image Resizing URL `srcSet` attribute differs between server and client render
- Component stack: `AboutPage` → `AboutFounderAvatar` → `BlurhashImage` → `Image → img`

### Why This Happens
1. **Turbopack dev mode** generates slightly different `srcSet` width lists server-side vs client-side for the same `next/image` component — this is a **known Turbopack issue** already documented in the code at [`BlurhashImage.tsx:187-191`](../../apps/frontend-blog/src/components/blog/BlurhashImage.tsx:187)
2. **`suppressHydrationWarning` IS already present** on both branches of `<Image>` (fill mode at line 192, non-fill at line 205)
3. The user reports this appeared **after** adding the Privacy Policy page (modifying `about/page.tsx` footer)

### Why It Appeared Now (Hypothesis)
My changes to `about/page.tsx` (adding a Privacy Policy link to the footer) triggered **Turbopack HMR cache invalidation**. This caused:
- The client-side JavaScript bundle to be re-compiled with new code
- But the server-rendered HTML might have been served from a cached/stale version
- Result: server HTML vs client React tree produced different `srcSet` attributes
- `suppressHydrationWarning` on `next/image` should suppress this, but might not be properly forwarded in Next.js 15.2.4 + React 19

## Fix Strategy (2-step)

### Step 1: Clean Cache & Restart (Non-Code Fix)
Turbopack caches compiled modules. A stale cache can cause inconsistent server/client rendering.
- Remove `.next` directory
- Restart dev server
- Verify if the error resolves (most likely it will)

### Step 2: Code Fix — Apply `suppressHydrationWarning` to Wrapper Div
If cache clean doesn't fix it, the `suppressHydrationWarning` on `next/image` isn't being properly forwarded to the `<img>` element. We need a more robust approach:

- Add `suppressHydrationWarning` to the **outer wrapper `<div>`** in [`BlurhashImage.tsx:169`](../../apps/frontend-blog/src/components/blog/BlurhashImage.tsx:169)
- This provides double coverage: wrapper div suppresses warnings on its own attributes, while `<Image>` still forwards to `<img>`
- The `className` prop on the wrapper div incorporates the `className` prop passed from parent — if this differs between server/client, the wrapper div itself could have mismatches

**Actual code change in `BlurhashImage.tsx`:**
```tsx
// Line 169 - before:
<div className={`relative overflow-hidden h-full w-full ${className}`}>

// Line 169 - after:
<div
  className={`relative overflow-hidden h-full w-full ${className}`}
  suppressHydrationWarning
>
```

### Verification
1. Clean `.next` directory
2. Restart dev server
3. Navigate to `/en/about`
4. Check browser console for hydration errors
5. Verify the AboutFounderAvatar renders correctly

## Files to Modify
- `apps/frontend-blog/src/components/blog/BlurhashImage.tsx` — Add `suppressHydrationWarning` to wrapper `<div>`
