# Fix: Empty Categories Page & ISR Revalidation Failure

## Root Cause Analysis

The categories page shows empty data due to **two compounding issues**:

### Issue 1 (Primary): SSG Build Failure + React Query Stale Cache

- [`page.tsx:40-43`](apps/frontend-blog/src/app/%5Blocale%5D/categories/page.tsx) — During CI/CD build, `serverGet()` tries to call `https://api.joyminis.com/api/v1/frontend/blog/categories` from the GitHub Actions runner
- The API is unreachable from the runner → `catch` silently returns `initialData: []`
- [`useFrontendCategories(initialData)`](apps/frontend-blog/src/app/%5Blocale%5D/categories/page.client.tsx:23) — React Query receives `initialData: []`
- [`staleTime: 60 * 60 * 1000`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts:133) — 1-hour staleTime caches `[]` as "fresh"
- The page stays empty even after ISR re-renders with real data, because React Query ignores stale `initialData`

### Issue 2 (Secondary): ISR Revalidation Broken on ALL Pages

Cloudflare logs show the error across ALL pages:
```
Failed to revalidate stale page /zh/tags/ Error: IgnorableError: 
No service binding for cache revalidation worker
```

**Root cause:** [`DOQueueHandler`](apps/frontend-blog/.open-next/.build/durable-objects/queue.js:109-113) constructor requires `env.WORKER_SELF_REFERENCE`:
```javascript
constructor(ctx, env) {
    this.service = env.WORKER_SELF_REFERENCE;
    if (!this.service)
        throw new IgnorableError("No service binding for cache revalidation worker");
}
```

The [`wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc:58-65) is missing the `services` binding for `WORKER_SELF_REFERENCE` in all sections (root, production, staging). Without this, the Durable Object cannot be constructed, so **all ISR revalidation silently fails**.

## Fixes

### Fix 1: Remove `initialData` from `useFrontendCategories()` (Immediate)

**File:** [`apps/frontend-blog/src/app/[locale]/categories/page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/categories/page.client.tsx)

**Change:** Remove `initialData` parameter from `useFrontendCategories()` call on line 23.

```typescript
// Before:
const { data: categories, isLoading, error } = useFrontendCategories(initialData);

// After:
const { data: categories, isLoading, error } = useFrontendCategories();
```

**Effect:** Makes the categories page behave like the homepage — always fetches fresh data client-side, bypassing both SSG build failure and React Query cache lock.

### Fix 2: Add `INTERNAL_API_URL` to CI/CD (Defensive)

**File:** [`.github/workflows/deploy-blog-cloudflare.yml`](.github/workflows/deploy-blog-cloudflare.yml)

**Change:** Add `INTERNAL_API_URL: ${{ secrets.NEXT_PUBLIC_API_BASE_URL }}` to the build env section.

**Effect:** Prevents SSG build-time `serverGet()` failures in future builds.

### Fix 3: Add `INTERNAL_API_URL` to wrangler.jsonc (Defensive)

**File:** [`apps/frontend-blog/wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc)

**Change:** Add `"INTERNAL_API_URL": "https://api.joyminis.com/api"` to `vars` in root, production, and staging sections.

**Effect:** Enables API calls from within the Cloudflare Worker runtime.

### Fix 4: Add `WORKER_SELF_REFERENCE` Service Binding (Critical for ISR)

**File:** [`apps/frontend-blog/wrangler.jsonc`](apps/frontend-blog/wrangler.jsonc)

**Change:** Add a `services` binding pointing the worker to itself. This is required by [`DOQueueHandler`](apps/frontend-blog/.open-next/.build/durable-objects/queue.js:111) to internally fetch pages for ISR revalidation.

Add to root section, production env, and staging env:
```json
"services": [
  {
    "binding": "WORKER_SELF_REFERENCE",
    "service": "lucky-blog-prod"  // or "lucky-blog-staging" for staging
  }
]
```

**Note:** The service name differs per environment (`lucky-blog-prod` for root/production, `lucky-blog-staging` for staging).

**Effect:** Enables ISR revalidation on ALL pages — new content and edits will automatically trigger page regeneration.

## Data Flow Diagram

```mermaid
flowchart TD
    subgraph "Current Broken Flow"
        A[CI/CD Build] --> B[serverGet API call]
        B --> C[Fails - API unreachable]
        C --> D[catch returns initialData: []]
        D --> E[Build SSG with empty data]
        E --> F[Deploy to Cloudflare]
        F --> G[User visits /categories]
        G --> H[React Query caches [] for 1hr]
        H --> I[Empty page shown]
        
        G --> J[ISR trigger]
        J --> K[queue.send to DOQueueHandler]
        K --> L[DO constructor fails<br/>No WORKER_SELF_REFERENCE]
        L --> M[IgnorableError - revalidation fails]
    end

    subgraph "After Fix 1 Only"
        N[User visits /categories] --> O[useFrontendCategories<br/>NO initialData]
        O --> P[Client-side fetch API]
        P --> Q[Real data from API]
        Q --> R[Categories shown correctly]
    end

    subgraph "After Fix 4 Only"
        S[ISR trigger] --> T[queue.send]
        T --> U[DOQueueHandler<br/>with WORKER_SELF_REFERENCE]
        U --> V[service.fetch internal revalidation]
        V --> W[Page regenerated with fresh data]
        W --> X[Cache updated]
    end

    subgraph "After Both Fixes"
        Y[Clean system] --> Z[SSG fallback works<br/>ISR works<br/>Client fetch works]
    end
```

## Execution Order

1. **Fix 1** — `page.client.tsx` (immediate: categories page starts working)
2. **Fix 4** — `wrangler.jsonc` service binding (critical: ISR works on all pages)
3. **Fix 2** — CI/CD env vars (defensive: prevents future build failures)
4. **Fix 3** — wrangler.jsonc vars (defensive: API URL available in worker)
5. **Deploy** — Run GitHub Actions to deploy updated worker
6. **Verify** — Check categories page, check Cloudflare logs for ISR errors

## Verification

1. Visit `/zh/categories/` and confirm categories are displayed
2. Check Cloudflare logs — no more "No service binding" errors
3. Edit/publish a new article and confirm ISR revalidates the page
