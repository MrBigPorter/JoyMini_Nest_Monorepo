# Fix: Chunk 404 for MobileSettingsContent dynamic import & Privacy Entrance

## Root Cause Analysis

### Issue 1: Chunk `_c376f49a._.js` 404
- **Location**: [`Header.tsx:29-42`](apps/frontend-blog/src/components/Header.tsx)
- **Mechanism**: [`MobileSettingsContent`](apps/frontend-blog/src/components/mobile/MobileSettingsContent.tsx) is loaded via `next/dynamic()` with `{ ssr: false }`
- **Problem**: The dev server's Turbopack bundler generates a content-hash-based chunk name (`_c376f49a._.js`). When the source file changes, the hash changes, producing a different chunk name. However, the parent bundle (`Header.tsx`'s chunk) may still reference the OLD hash from a previous compilation, causing a 404.
- **Evidence**: The chunk `_c376f49a._.js` does NOT exist in `apps/frontend-blog/.next/static/chunks/`
- **Also affected**: [`MobileSettingsDrawer`](apps/frontend-blog/src/components/mobile/MobileSettingsDrawer.tsx) is also dynamically imported with the same pattern (line 29-35), potentially at risk

### Issue 2: Privacy Entrance Not Found (Mobile)
- **Location**: [`MobileSettingsContent.tsx:267-280`](apps/frontend-blog/src/components/mobile/MobileSettingsContent.tsx)
- **Mechanism**: The privacy policy link ("🔒 Privacy Policy" with Shield icon) is at the bottom of the mobile settings drawer
- **Problem**: Because the `MobileSettingsContent` chunk fails to load (Issue 1), the component never renders → the privacy link is invisible on mobile
- **Desktop path** ([`Header.tsx:342-347`](apps/frontend-blog/src/components/Header.tsx)): This uses a static `Link` imported from `@/navigation`, which works fine on desktop

### Connection
**Issue 1 directly causes Issue 2 on mobile.** Fixing the chunk loading will restore the privacy link visibility.

## Solution

### Phase 1: Immediate Fix — Clear cache + Restart
Kill the running dev server, clear `.next` cache, and restart.

### Phase 2: Structural Fix — Remove `next/dynamic` for MobileSettingsContent
Replace `next/dynamic()` with a direct import. This permanently eliminates the separate chunk and prevents future occurrence.

**Why this is safe:**
- `MobileSettingsContent.tsx` uses `'use client'` and guards browser API access with `typeof document !== 'undefined'` (line 52), making it SSR-safe
- It's only rendered when `mobileSettingsOpen === true` (inside the drawer), so it won't affect initial load performance on desktop where the drawer stays closed
- The component is 285 lines and shares dependencies already loaded by Header.tsx (lucide-react icons, next-intl hooks, framer-motion from drawer), so bundle size impact is minimal

### Phase 3: Additional Privacy Entry Points (Optional)
Add a privacy link in the **About page footer** (already planned per `privacy-link-login-area-placement.md` line 52) as a fallback entry point.

## Changes Required

### Step 1: Kill dev server + clear cache
1. Kill the running `next dev` process (PID from `ps aux | grep next`)
2. Delete `apps/frontend-blog/.next/` directory
3. Delete `apps/frontend-blog/node_modules/.cache/` (if exists)
4. Restart dev server: `cd /Volumes/MySSD/work/JoyMini_Nest_Monorepo && yarn workspace @lucky/frontend-blog dev`

### Step 2: Convert dynamic imports to direct imports in Header.tsx
**File**: [`apps/frontend-blog/src/components/Header.tsx`](apps/frontend-blog/src/components/Header.tsx)

1. Remove these 3 `dynamic()` declarations (lines 25-42):
   ```typescript
   // REMOVE:
   const SearchModal = dynamic(() => import('./search/SearchModal').then(...), { ssr: false });
   const MobileSettingsDrawer = dynamic(() => import('./mobile/MobileSettingsDrawer').then(...), { ssr: false });
   const MobileSettingsContent = dynamic(() => import('./mobile/MobileSettingsContent').then(...), { ssr: false });
   ```
2. Remove the `dynamic` import from line 4:
   ```typescript
   // BEFORE: import dynamic from 'next/dynamic';
   // AFTER: (remove this import entirely)
   ```
3. Add static imports for all 3 components:
   ```typescript
   import { SearchModal } from './search/SearchModal';
   import { MobileSettingsDrawer } from './mobile/MobileSettingsDrawer';
   import { MobileSettingsContent } from './mobile/MobileSettingsContent';
   ```
4. Keep the usage at lines 444-457 as-is — no changes needed there.

### Step 3: Add privacy link to About page footer (fallback)
**File**: [`apps/frontend-blog/src/app/[locale]/about/page.tsx`](apps/frontend-blog/src/app/[locale]/about/page.tsx)
- Add a privacy policy link in the footer section (already noted in plan line 52)

## Verification
1. Restart dev server → no more `_c376f49a._.js` 404 errors in console
2. On mobile: tap settings gear → drawer opens → privacy link visible at bottom
3. On desktop: privacy link visible in header right area (between language switcher and login button)
4. Navigate to `/privacy` → privacy page renders correctly
