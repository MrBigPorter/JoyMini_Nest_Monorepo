# Frontend Blog Hydration Error Fix V2 — Root Cause Resolution

## Problem Recap

Hydration mismatch error occurred where:
- **Server rendered:** Article grid (`className="grid gap-6 md:grid-cols-2"`)
- **Client rendered:** Empty state skeleton (`className="text-center py-20"`)

Error at line 511: `if (displayArticles.length === 0 && isFetching)`

## Root Cause

The previous fix attempted to use `displayArticles` from `initialData`, but **still relied on `isFetching`** in conditional branches (lines 402, 405-407). This caused hydration mismatch because:

1. **SSR:** `isFetching = false` (no concept of "fetching" on server)
2. **Client first render:** `isFetching = true` (React Query defaults to fetching on mount)

This made the condition `displayArticles.length === 0 && isFetching` evaluate differently:
- SSR: `false` → renders articles
- Client: `true` → renders skeleton → **HYDRATION MISMATCH**

## Solution: Hydration-Aware Rendering

Introduced `isHydrated` state to distinguish SSR/hydration phase from post-hydration interactions:

### Key Changes

1. **Added `isHydrated` state** (line 71):
   ```typescript
   const [isHydrated, setIsHydrated] = useState(false);
   ```

2. **Mark hydration complete in first useEffect** (line 111):
   ```typescript
   useEffect(() => {
     if (initialSeedDone.current) return;
     initialSeedDone.current = true;
     setIsHydrated(true);  // ← Runs only on client, not SSR
     // ...rest of seed logic
   }, []);
   ```

3. **Modified skeleton logic to be hydration-aware** (line 408):
   ```typescript
   const showSkeleton = isHydrated && isFetching && displayArticles.length === 0;
   ```

4. **Modified full-page skeleton condition** (line 411-413):
   ```typescript
   if (isHydrated && displayArticles.length === 0 && isFetching) {
     return <HomePageSkeleton />;
   }
   ```

## How It Works

### Phase 1: SSR
- `isHydrated = false` (useState initial value)
- `displayArticles = initialData.items` (has data)
- `showSkeleton = false && ... = false` → skipped
- Full-page skeleton check: `false && ... = false` → skipped
- **Renders:** Article grid ✅

### Phase 2: Client First Render (Hydration)
- `isHydrated = false` (useEffect hasn't run yet)
- `displayArticles = initialData.items` (same as SSR)
- `showSkeleton = false && ... = false` → skipped
- Full-page skeleton check: `false && ... = false` → skipped
- **Renders:** Article grid ✅
- **Result:** Identical to SSR → **HYDRATION MATCH** ✅

### Phase 3: Post-Hydration
- `useEffect` runs → `setIsHydrated(true)`
- Now `isFetching` can safely be used in conditions
- `showSkeleton = true && isFetching && displayArticles.length === 0`
- Category switches, Load More, etc. all work normally

## Edge Cases Verified

| Scenario | SSR | Client (hydration) | Post-hydration |
|----------|-----|-------------------|----------------|
| Fresh load with data | Articles (isHydrated=false) | Articles (isHydrated=false) | Articles (isHydrated=true) → **MATCH** ✅ |
| Fresh load, no data | Articles from initialData or empty | Same | Skeleton if fetching ✅ |
| Category switch | N/A | N/A | Skeleton → new articles ✅ |
| Backward nav | N/A | Articles from context | Articles from context ✅ |
| Load More | N/A | N/A | Append articles ✅ |

## Key Insight

**During SSR and hydration, React Query's dynamic state (`isFetching`, `isLoading`) is unreliable for rendering decisions.** By deferring reliance on these flags until after hydration (`isHydrated = true`), we eliminate the mismatch at its source.

The `displayArticles` SSR-first logic (using `initialData`) was correct, but insufficient alone — we also needed to prevent `isFetching`-based early returns during the critical SSR → client hydration transition.

## Files Modified

- `apps/frontend-blog/src/app/[locale]/page.client.tsx`
  - Lines 71: Added `isHydrated` state
  - Line 111: Mark hydration complete in useEffect
  - Line 408: Modified `showSkeleton` to check `isHydrated`
  - Lines 411-413: Modified full-page skeleton early return to check `isHydrated`

