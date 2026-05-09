# Front Blog Keyboard Blank Space Analysis

## Problem

When clicking on an input field (search input, comment textarea, login fields) in [`frontend-blog`](../apps/frontend-blog) on mobile, the bottom navigation bar visibly "rises up" but leaves a large blank/white space below it.

## Root Cause

The bug is in [`updateSafeArea()` in BottomNavigation.tsx](../apps/frontend-blog/src/components/BottomNavigation.tsx:22-36).

### How it works (intended)

The `visualViewport` API is used to dynamically calculate the **iOS Safari bottom chrome height** (toolbar + home indicator area) because the static `env(safe-area-inset-bottom)` CSS value doesn't update when Safari's toolbars show/hide during scrolling.

```javascript
const safeAreaBottom = window.innerHeight - (vv.height + vv.offsetTop);
document.documentElement.style.setProperty(
  '--safe-area-bottom',
  `${Math.max(safeAreaBottom, 0)}px`,
);
```

### What goes wrong when keyboard opens

1. User focuses an input → virtual keyboard opens on mobile
2. `window.visualViewport` fires `resize` event
3. `vv.height` drops significantly (e.g., from 812px to ~400px)
4. `safeAreaBottom` is calculated as `812 - (400 + ~0) = ~412px`
5. `--safe-area-bottom` is set to `412px` (essentially the **keyboard height**)

### CSS cascade

The CSS variables in [`globals.css`](../apps/frontend-blog/src/app/globals.css:5-14) then propagate this value:

```css
--safe-area-bottom: env(safe-area-inset-bottom, 0px);   /* overwritten to 412px */
--nav-height: calc(56px + var(--safe-area-bottom));      /* becomes ~468px */
--content-padding-bottom: var(--nav-height);              /* becomes ~468px */
```

This affects two areas:

1. **Main content padding** ([`[locale]/layout.tsx` line 198](../apps/frontend-blog/src/app/[locale]/layout.tsx:198)):
   ```html
   <main className="pb-[var(--content-padding-bottom)] min-h-[100dvh]">
   ```
   → Gets `padding-bottom: 468px`, creating a huge blank space at the bottom of the page.

2. **Bottom nav spacer** ([`BottomNavigation.tsx` line 373](../apps/frontend-blog/src/components/BottomNavigation.tsx:373)):
   ```html
   <div style={{ height: 'var(--safe-area-bottom)' }} />
   ```
   → Gets `height: 412px`, extending the nav background far below the visible buttons.

### Why the bottom nav "rises up"

On iOS Safari, `position: fixed` elements are positioned relative to the **layout viewport**, not the **visual viewport**. When the keyboard opens:

- The layout viewport height (`window.innerHeight`) stays the same
- The visual viewport shrinks
- The keyboard overlays on top of the layout viewport

The `--safe-area-bottom` gets set to ~412px, making the nav element itself 468px tall (56px buttons + 412px spacer). The actual navigation buttons (top 56px of this) happen to appear at the right visual position because they're pushed up by the large spacer below them. This makes it look like the nav "rose up" to sit above the keyboard, but there's a huge blank area below.

## Visual Explanation

```
┌─────────────────────────────┐
│                             │
│      Page Content           │
│                             │
│                             │
│                             │
├─────────────────────────────│
│  [nav buttons] (56px)      │ ← Bottom nav visible area
├─────────────────────────────│ ← Keyboard top edge
│                             │
│  Keyboard area (~350px)     │ ← This is where the keyboard sits
│                             │
├─────────────────────────────│
│  Blank spacer (~412px)      │ ← The --safe-area-bottom spacer INSIDE nav
│                             │     behind the keyboard, extending nav downward
├─────────────────────────────│ ← Layout viewport bottom (fixed bottom-0 anchor)
│  Background ext (100px)     │
└─────────────────────────────┘
```

The blank space the user sees is actually the **main content's padding-bottom** (~468px) plus the **nav's internal spacer**, making the page content area much taller than needed, creating a visible void between content and the bottom of the visible screen area.

## Solution Options

### Option A: Keyboard detection (Recommended)

Detect when the keyboard is open and skip updating `--safe-area-bottom` during that time.

**How**: Add a heuristic to distinguish keyboard open from toolbar toggle:
- If `vv.height` drops by more than ~200px (typical keyboard height), assume keyboard is open
- During keyboard open, don't update `--safe-area-bottom`
- Reset `--safe-area-bottom` to its default (`env(safe-area-inset-bottom)`) when keyboard closes

**Pros**: Simple, widely compatible, no new APIs needed
**Cons**: Heuristic might have edge cases

### Option B: Use `navigator.virtualKeyboard` API

Modern browsers (Chrome 94+, Safari 16.4+) support the [`VirtualKeyboard` API](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard).

```javascript
if ('virtualKeyboard' in navigator) {
  navigator.virtualKeyboard.overlaysContent = true;
  navigator.virtualKeyboard.addEventListener('geometrychange', (e) => {
    const { height } = e.target.boundingRect;
    // height > 0 means keyboard is open
  });
}
```

**Pros**: Accurate keyboard detection
**Cons**: Not available in all browsers Safari versions; requires polyfill for older devices

### Option C: Cap `--safe-area-bottom` to a maximum value

Set a reasonable maximum (e.g., 50-80px) for the safe area bottom, since the actual Safari chrome should never exceed this.

```javascript
const safeAreaBottom = Math.min(
  window.innerHeight - (vv.height + vv.offsetTop),
  80, // max expected chrome height
);
```

**Pros**: Simple one-line fix
**Cons**: Could cut off legitimate safe area on unusual devices

### Option D: Reset on blur

Listen for `blur` events on inputs to reset `--safe-area-bottom` when focus leaves form elements.

**Pros**: Directly tied to user interaction
**Cons**: Doesn't prevent the initial incorrect calculation when keyboard opens

## Recommended Approach: Option A (Keyboard Detection)

I recommend **Option A** as the primary fix with **Option C** as a safety cap.

The fix modifies [`updateSafeArea()`](../apps/frontend-blog/src/components/BottomNavigation.tsx:22-36) to:
1. Detect keyboard open by checking if visual viewport height dropped by > 200px relative to full height
2. Skip updating `--safe-area-bottom` when keyboard is detected
3. Fall back to `env(safe-area-inset-bottom)` when keyboard is open
4. Cap the safe area value at 80px as a safety measure

### Additional consideration

The `--safe-area-bottom` CSS variable is declared on `:root` in [`globals.css`](../apps/frontend-blog/src/app/globals.css:8) with a default value of `env(safe-area-inset-bottom, 0px)`. When the component updates it via `document.documentElement.style.setProperty`, it creates an inline style that overrides the CSS variable. When keyboard closes and the resize event fires again with the correct visual viewport height, the value should return to normal. But there could be a timing issue where the keyboard resize event sequence doesn't restore it properly.

## Files to Modify

| File | Change |
|------|--------|
| [`apps/frontend-blog/src/components/BottomNavigation.tsx`](../apps/frontend-blog/src/components/BottomNavigation.tsx) | Add keyboard detection logic in `updateSafeArea()`, add keyboard open/close event listeners |

No CSS changes needed — the fix is purely in the JavaScript logic that sets `--safe-area-bottom`.
