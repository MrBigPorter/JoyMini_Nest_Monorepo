# Fix iOS Bottom Nav Gap During Scroll

## Problem

When scrolling on iOS Safari, the bottom navigation bar shows a **large gap underneath it** — the area below the nav becomes visible during rubber-band overscroll, creating an unsightly gap effect.

## Root Cause Analysis

Two factors combine to cause this bug:

### Factor 1: `overscroll-behavior` mismatch

| Element | Setting | Effect |
|---------|---------|--------|
| `html, body` | `overscroll-behavior: none` | Body bounce is **disabled** |
| `main` | `overscroll-behavior-y: auto` | Main content **ALLOWS** rubber-band overscroll |

`globals.css` line 128 sets `main { overscroll-behavior-y: auto; }`, which overrides the body-level protection. When the user scrolls past the bottom of the `<main>` content, iOS Safari's rubber-band effect pulls the page up, exposing the area behind the bottom nav.

### Factor 2: Semi-transparent bottom nav

`BottomNavigation.tsx` line 243:
```tsx
<nav className="... bg-background/80 backdrop-blur-md ...">
```

The nav is only **80% opaque** with a `backdrop-blur-md` effect. During overscroll:
- The fixed nav stays at `bottom: 0`
- The main content rubber-bands upward
- The 20% transparency + backdrop blur creates a visible gap/artifact where the body background shows through

## Fix (2 File Changes)

### Change 1: `apps/frontend-blog/src/app/globals.css` — Line 128

**Before:**
```css
main {
  overscroll-behavior-y: auto;
  -webkit-overflow-scrolling: touch;
}
```

**After:**
```css
main {
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
}
```

This prevents the iOS rubber-band overscroll on the `<main>` content area. `contain` allows internal scrolling within elements but prevents the page-level bounce.

### Change 2: `apps/frontend-blog/src/components/BottomNavigation.tsx` — Line 243

**Before:**
```tsx
<nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-t border-border">
```

**After:**
```tsx
<nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border">
```

This makes the bottom nav **fully opaque** so even if any edge-case scroll behavior occurs, there's no transparency bleed-through.

## Verification

1. Open the app on an iOS device (or iOS Simulator in Xcode)
2. Navigate to the home page and scroll to the bottom
3. Scroll past the content to trigger rubber-band overscroll
4. **Expected**: No gap appears below the bottom nav
5. Verify on Android Chrome as well to confirm no regression
6. Verify on desktop Safari/Chrome to confirm no regression (nav is hidden on `md:`)
