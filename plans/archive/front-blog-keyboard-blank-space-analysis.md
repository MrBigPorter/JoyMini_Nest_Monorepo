# Front Blog Keyboard Blank Space Analysis & Fix

## Problem

When clicking on an input field (search input, comment textarea, login fields) in [`frontend-blog`](../../apps/frontend-blog) on mobile, the bottom navigation bar visibly "rises up" but leaves a large blank/white space below it.

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

## Fix — Already Implemented

### Modification 1: Keyboard Detection in `updateSafeArea`

**File**: [`apps/frontend-blog/src/components/BottomNavigation.tsx`](../../apps/frontend-blog/src/components/BottomNavigation.tsx)

Added keyboard detection logic in `updateSafeArea()`:
- If `safeAreaBottom > 200px` (typical toolbar toggle is ~44-60px, keyboard is ~300-400px), consider keyboard open
- When keyboard is open → `return` early, don't update `--safe-area-bottom`
- Keep the default `env(safe-area-inset-bottom)` value from `globals.css`
- Added 80px safety cap to prevent any edge case

### Behavior after fix

| Event | Before (bug) | After (fix) |
|-------|-------------|-------------|
| Click input → keyboard opens | `--safe-area-bottom` = ~412px → huge blank space | `--safe-area-bottom` unchanged → **no blank space** |
| Keyboard closes | `--safe-area-bottom` resets via `visualViewport.resize` | `--safe-area-bottom` resets via `visualViewport.resize` → **normal** |
| Safari toolbar toggle | `--safe-area-bottom` updates normally | Still updates normally (value < 200px) |

## Enhancement — Keyboard Close Auto-scroll (Planned)

### Problem

When the keyboard opens on iOS, Safari auto-scrolls the page to make the focused input visible above the keyboard. However, when the keyboard closes, **iOS does NOT scroll back** — the page stays in the scrolled-up position, leaving the user looking at the middle of the page with a blank area where the keyboard used to be.

### Solution

Track the scroll position before the keyboard opens, and restore it when the keyboard closes.

**Approach**:
1. Add a `focusin` event listener that saves `window.scrollY` when any `input`/`textarea` receives focus
2. Track keyboard open/close state using `wasKeyboardOpen` ref
3. In `updateSafeArea()`, when keyboard transitions from open → closed:
   - Restore the saved scroll position using `window.scrollTo()` with smooth scrolling
   - Use `requestAnimationFrame` to ensure layout is ready

### Implementation Details

**Add imports**: Add `useRef` to the React import

**Add state/refs** (inside component, after `isClient` state):
```typescript
const wasKeyboardOpen = useRef(false);
const scrollYBeforeKeyboard = useRef(0);
```

**Add focusin listener** (new useEffect):
```typescript
// Save scroll position before keyboard opens
useEffect(() => {
  const handleFocusIn = (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      scrollYBeforeKeyboard.current = window.scrollY;
    }
  };
  document.addEventListener('focusin', handleFocusIn);
  return () => document.removeEventListener('focusin', handleFocusIn);
}, []);
```

**Modify updateSafeArea** to add scroll restoration on keyboard close:
```typescript
const isKeyboardOpen = safeAreaBottom > 200;
if (isKeyboardOpen) {
  wasKeyboardOpen.current = true;
  return; // Don't update CSS variable
}

// Keyboard just closed — restore scroll position
if (wasKeyboardOpen.current) {
  wasKeyboardOpen.current = false;
  requestAnimationFrame(() => {
    window.scrollTo({
      top: scrollYBeforeKeyboard.current,
      behavior: 'smooth',
    });
  });
}
```

### Files to Modify

| File | Change |
|------|--------|
| [`apps/frontend-blog/src/components/BottomNavigation.tsx`](../../apps/frontend-blog/src/components/BottomNavigation.tsx) | Add `useRef` to imports, add refs, add `focusin` listener, add scroll restoration in `updateSafeArea()` |
