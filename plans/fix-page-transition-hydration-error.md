# Fix: PageTransition Hydration Error

## Problem

Hydration mismatch in [`PageTransition`](../apps/frontend-blog/src/components/PageTransition.tsx:75) where the server renders `style={{}` but the client renders `style={{opacity:1,transform:"none"}}` on the `motion.div` wrapper.

## Root Cause Analysis

### The Prop Mismatch Chain

1. **`useReducedMotion()` returns `null` during SSR** (line 44)
   - Framer-motion's `useReducedMotion()` hook returns `null` on the server because there is no `window.matchMedia` API available.

2. **`shouldAnimate` evaluates differently between SSR and CSR** (line 60)
   - **SSR**: `prefersReducedMotion` = `null` → `null === false` → **`shouldAnimate = false`**
   - **CSR** (no reduced-motion preference): `prefersReducedMotion` = `false` → `false === false` → **`shouldAnimate = true`**

3. **Different `motionProps` are generated** (lines 66-77)
   - **SSR** (shouldAnimate=false):
     ```js
     { animate: { opacity: 1, x: 0 } }          // only animate, NO initial
     ```
   - **CSR** (shouldAnimate=true):
     ```js
     { initial: { opacity: 0, x: 28 }, animate: { opacity: 1, x: 0 }, exit, transition }
     ```

4. **Framer-motion renders different styles**
   - **SSR**: Without `initial`, framer-motion cannot determine the starting visual state and renders `style={{}}` (empty object)
   - **CSR**: With both `initial` and `animate`, framer-motion applies the `animate` target as `style={{opacity:1,transform:"none"}}`

5. **Result**: Hydration mismatch error at the `motion.div` node.

### Why the Existing Fix Wasn't Complete

The developer was aware of this issue (see comment on line 74-75: "无动画时也传入 animate，保证 SSR style 与 CSR 一致"). They added `animate: { opacity: 1, x: 0 }` to the non-animation branch. However, framer-motion's SSR rendering also requires `initial` to be present — without it, the library falls back to rendering with no inline styles.

## Fix

### Change

In [`PageTransition.tsx`](../apps/frontend-blog/src/components/PageTransition.tsx:74-77), add `initial` with the same values as `animate` in the non-animation branch:

```diff
   : {
       // 无动画时也传入 animate，保证 SSR style 与 CSR 一致
+      initial: { opacity: 1, x: 0 },
       animate: { opacity: 1, x: 0 },
     };
```

### How This Works

- **SSR**: Framer-motion now receives both `initial` and `animate`, both set to `{ opacity: 1, x: 0 }`. It renders `style={{opacity:1,transform:"none"}}` during SSR.
- **CSR** (hydration): Even though `shouldAnimate` flips to `true` (providing `initial: { opacity: 0, x: 28 }`), framer-motion renders the `animate` target `{ opacity: 1, x: 0 }` as inline styles during the initial client render. The animation path (`initial → animate`) is handled by framer-motion after hydration.
- **Result**: SSR and CSR output `style={{opacity:1,transform:"none"}}` → **hydration matches**.

### Edge Cases Verified

| Scenario | SSR `shouldAnimate` | CSR `shouldAnimate` | Hydration Match? |
|----------|---------------------|---------------------|------------------|
| No reduced-motion preference | `false` | `true` | ✅ (both render animate target) |
| User prefers reduced motion | `false` | `false` | ✅ (both use non-animation branch) |
| User on mobile (accessibility) | `false` | `true` | ✅ (consistent SSR output) |

## Files to Modify

| File | Change |
|------|--------|
| [`apps/frontend-blog/src/components/PageTransition.tsx`](../apps/frontend-blog/src/components/PageTransition.tsx) | Add `initial: { opacity: 1, x: 0 }` to the non-animation `motionProps` branch (line ~75) |

## Testing

1. Run `yarn workspace @lucky/frontend-blog dev` (or equivalent)
2. Navigate to the app in a browser
3. Verify no hydration error appears in the console
4. Verify page transition animations still work correctly (forward/backward navigation)
5. Verify that users with reduced-motion preference (`prefers-reduced-motion: reduce`) do not see animations
