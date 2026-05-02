# Home Page KeepAlive via React Context Provider

## Problem

When navigating from the home page (with accumulated articles up to page 3) to an article detail page and back, the home page component unmounts and re-mounts. All React state (`allArticles`, `page`, `isInitialCategory`) is lost.

On re-mount:
- `allArticles` resets to SSR `initialData?.items || []` (page 1 only, max 10 articles)
- `page` is restored from URL (`?page=3`) but the accumulation effect doesn't fire (prevPageRef === page)
- Result: user sees only page 1's articles even though URL says page 3

## Solution: KeepAlive via Layout-Level Context

### Why this works

In Next.js App Router, `layout.tsx` **persists across navigations** within its route segment.

 The `[locale]/layout.tsx` wraps both:
- Home page: `[locale]/page.client.tsx`
- Article detail: `[locale]/articles/[slug]/page.client.tsx`

When navigating home ↔ detail, the layout stays mounted. A React Context provider inside the layout keeps its state alive. When home page re-mounts, it reads the preserved state from context.

```mermaid
flowchart TD
    subgraph "Navigation: Home -> Detail -> Back"
        A[Home Page mounted] -->|allArticles=[page1+2+3]| B[Context Provider<br/>state alive]
        B -->|navigate to /articles/x| C[Article Detail mounted]
        C -->|Home Page unmounts<br/>BUT Context stays| B
        C -->|router.back| D[Home Page re-mounted]
        D -->|reads allArticles from Context| E[UI shows full accumulated list]
        E -->|scroll restored from sessionStorage| F[User sees page 3 position]
    end

    subgraph "Context Provider location"
        G[layout.tsx<br/>stays mounted] --> H[HomePageStateProvider]
        H --> I[state: allArticles, page,<br/>isInitialCategory]
        H --> J[children: pages swap here]
    end
```

### Files to change

| File | Action | Description |
|------|--------|-------------|
| `apps/frontend-blog/src/lib/providers/HomePageStateProvider.tsx` | **NEW** | Context + Provider + hook |
| `apps/frontend-blog/src/app/[locale]/layout.tsx` | **MODIFY** | Wrap children with provider |
| `apps/frontend-blog/src/app/[locale]/page.client.tsx` | **MODIFY** | Use context instead of local state |

---

## Step 1: Create `HomePageStateProvider`

**Path:** `apps/frontend-blog/src/lib/providers/HomePageStateProvider.tsx`

**Context shape:**
```typescript
interface HomePageState {
  allArticles: FrontendArticle[];
  page: number;
  isInitialCategory: boolean;
  setAllArticles: React.Dispatch<React.SetStateAction<FrontendArticle[]>>;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  setIsInitialCategory: (v: boolean) => void;
  resetState: () => void; // resets allArticles=[], page=1, isInitialCategory=false
}
```

**Provider component:**
- Wraps `children` with `HomePageContext.Provider`
- Manages `useState` for `allArticles`, `page`, `isInitialCategory`
- Exposes `resetState()` callback

**`useHomePageContext()` hook:**
- Calls `useContext(HomePageContext)`
- Throws if used outside provider

---

## Step 2: Modify `[locale]/layout.tsx`

**Path:** `apps/frontend-blog/src/app/[locale]/layout.tsx`

**Change:** Import `HomePageStateProvider` and wrap the `<PageTransition>{children}</PageTransition>` block with it.

```typescript
import { HomePageStateProvider } from '@/lib/providers/HomePageStateProvider';

// Inside the JSX:
<HomePageStateProvider>
  <PageTransition>{children}</PageTransition>
</HomePageStateProvider>
```

**Why here:** The layout persists across home ↔ detail navigation, so the provider stays mounted.

---

## Step 3: Modify `page.client.tsx`

**Path:** `apps/frontend-blog/src/app/[locale]/page.client.tsx`

**Changes:**

### 3a. Import the hook
```typescript
import { useHomePageContext } from '@/lib/providers/HomePageStateProvider';
```

### 3b. Replace state with context

**Before (local state):**
```typescript
const [allArticles, setAllArticles] = useState<FrontendArticle[]>(
  () => initialData?.items || [],
);

const [page, setPage] = useState(() => {
  const p = searchParams.get('page');
  return p ? Math.max(1, Number(p)) : 1;
});

const isInitialCategory = useRef(true);
```

**After (context state, with initialData fallback):**
```typescript
const {
  allArticles,
  page,
  isInitialCategory,
  setAllArticles,
  setPage,
  setIsInitialCategory,
  resetState,
} = useHomePageContext();

// On first mount (no accumulated data yet), seed from SSR initialData
useEffect(() => {
  if (allArticles.length === 0 && initialData?.items?.length) {
    setAllArticles(initialData.items);
  }
}, []); // only on mount
```

### 3c. Initialize `page` from URL only if context is empty

```typescript
// On first mount, sync page from URL if context hasn't been initialized
useEffect(() => {
  if (page === 1) {
    const p = searchParams.get('page');
    if (p) {
      setPage(Math.max(1, Number(p)));
    }
  }
}, []);
```

### 3d. Update category change handler

**Before:**
```typescript
isInitialCategory.current = false;
setAllArticles([]);
setPage(1);
```

**After:**
```typescript
setIsInitialCategory(false);
resetState(); // resets allArticles=[], page=1
```

### 3e. Remove `isInitialCategory.current` references

Replace all `isInitialCategory.current` with just `isInitialCategory` (it's already a boolean from context).

### 3f. Keep remaining logic unchanged

- `selectedCategoryId` — local state, restored from URL on mount ✓
- Accumulation effect (`prevPageRef`) — stays as-is ✓
- Scroll restoration — stays as-is ✓
- URL sync effect — stays as-is ✓
- Auto-prefetch sentinel — stays as-is ✓

---

## Edge Cases Handled

| Case | Behavior |
|------|----------|
| **First visit (no context)** | `allArticles` is empty → seeded from SSR `initialData` |
| **Hard refresh** | Context lost → same as first visit |
| **Direct URL entry with page=3** | `allArticles` empty → seeded from SSR initialData, then `page` set to 3 from URL → accumulation effect fetches pages 2+3 |
| **Category switch** | `resetState()` clears everything, new query fires |
| **Tab re-click (same category)** | No-op guard still works (no URL change) |
| **Back from detail** | Context alive → `allArticles` still has accumulated data → UI renders immediately |
| **Multiple locale layouts** | Each `[locale]/layout.tsx` has its own context instance → isolated per locale |

## Verification Steps

1. `tsc --noEmit` — zero type errors
2. `yarn workspace @lucky/frontend-blog lint` — zero lint errors
3. Manual test:
   - Load home page → Load More to page 3 → click article → navigate back
   - **Expected:** All 30 articles visible, scroll restored to previous position
   - Switch category → click Load More → navigate to article → back
   - **Expected:** Category state preserved, accumulated articles visible
   - Hard refresh with `?page=3&category=xxx` in URL
   - **Expected:** Page initializes from URL params correctly
