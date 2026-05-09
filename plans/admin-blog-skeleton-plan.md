# Admin Blog Skeleton Loading States — Implementation Plan

## 1. Goal

Add skeleton/shimmer loading placeholders to admin-blog pages that currently show a blank or unstyled state while data is loading. Upgrade pages that use a basic spinner (`Loader2`) to more contextual skeleton layouts.

---

## 2. Current State Summary

| Page | Path | Current Loading | Needed |
|------|------|-----------------|--------|
| **Dashboard** | `blog/page.tsx` | `Loader2` spinner (lines 181-192) | Upgrade to skeleton |
| **Articles List** | `blog/articles/page.tsx` | None (SmartTable internal only) | Add skeleton |
| **Article Preview** | `blog/articles/[slug]/page.tsx` | `Loader2` + Card (lines 185-206) | Upgrade to skeleton |
| **Create Article** | `blog/articles/create/page.tsx` | None (submit button only) | **Add skeleton** |
| **Categories** | `blog/categories/page.tsx` | None (SmartTable internal only) | Add skeleton |
| **Comments** | `blog/comments/page.tsx` | `Loader2` spinner (lines 216-227) | Upgrade to skeleton |
| **Tags** | `blog/tags/page.tsx` | `Loader2` spinner (lines 85-96) | Upgrade to skeleton |
| **Import** | `blog/import/page.tsx` | Inline processing overlays | Add page-load skeleton |
| **Translation Issues** | `blog/translation-issues/page.tsx` | ✅ Already has Skeleton (via view) | None |
| **Translation Progress** | `blog/translation-progress/page.tsx` | ✅ Already has Skeleton (via view) | None |

---

## 3. Existing Skeleton Pattern

Both [`BlogTranslationIssues.tsx`](apps/admin-blog/src/views/blog/BlogTranslationIssues.tsx:11) and [`BlogTranslationProgress.tsx`](apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx:59) define an identical local Skeleton component:

```tsx
const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse bg-gray-200 dark:bg-white/10 rounded ${className}`} />
);
```

**No shared Skeleton component exists** in [`UIComponents.tsx`](apps/admin-blog/src/components/UIComponents.tsx).

---

## 4. Implementation Strategy

### Phase A: Extract shared `Skeleton` component

Add a reusable `Skeleton` component to [`UIComponents.tsx`](apps/admin-blog/src/components/UIComponents.tsx) with:

- `className?: string` — for width/height/sizing
- `variant?: 'text' | 'card' | 'circle' | 'rect'` — common shape presets
- Default: same `animate-pulse bg-gray-200 dark:bg-white/10 rounded` pattern

This avoids duplicating the component across every file and makes maintenance easier.

### Phase B: Replace local Skeleton definitions

Update [`BlogTranslationIssues.tsx`](apps/admin-blog/src/views/blog/BlogTranslationIssues.tsx:11) and [`BlogTranslationProgress.tsx`](apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx:59) to import `Skeleton` from `UIComponents` instead of defining it locally.

### Phase C: Add/upgrade skeletons per page

---

## 5. Detailed File Changes

### 5.1 [`UIComponents.tsx`](apps/admin-blog/src/components/UIComponents.tsx)

Add after imports (~line 30-35), before the Breadcrumbs component:

```tsx
// Shared Skeleton component
interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'card' | 'circle' | 'rect';
}

export const Skeleton: React.FC<SkeletonProps> = ({ 
  className = '', 
  variant = 'text' 
}) => {
  const baseClasses = 'animate-pulse bg-gray-200 dark:bg-white/10 rounded';
  const variantClasses: Record<string, string> = {
    text: 'h-4 w-full',
    card: 'h-32 w-full',
    circle: 'h-10 w-10 rounded-full',
    rect: 'h-20 w-full',
  };
  const variantClass = variantClasses[variant] || variantClasses.text;
  return (
    <div className={`${baseClasses} ${variantClass} ${className}`} />
  );
};
```

---

### 5.2 [`BlogTranslationIssues.tsx`](apps/admin-blog/src/views/blog/BlogTranslationIssues.tsx)

- **Line 2**: Add import: `import { Skeleton } from '@/components/UIComponents';`
- **Lines 11-15**: Remove local `const Skeleton = ...` definition
- **Lines 408-413**: The existing skeleton usage remains, now referencing the shared component

---

### 5.3 [`BlogTranslationProgress.tsx`](apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx)

- **Line 1-5**: Add import: `import { Skeleton } from '@/components/UIComponents';`
- **Lines 59-63**: Remove local `const Skeleton = ...` definition
- All existing skeleton usages remain, now referencing the shared component

---

### 5.4 [`blog/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/page.tsx) — Dashboard

**Current state (lines 181-192):** Shows `Loader2` spinner centered.

**Replace with:** Skeleton layout matching the dashboard structure:
- 4 stat cards with `Skeleton variant="card"`
- Table skeleton with 5 `Skeleton variant="text"` rows
- 2 article cards with `Skeleton variant="rect"`

```tsx
// Replace the spinner block (lines ~181-192) with:
{isLoading ? (
  <div className="space-y-6">
    {/* Stats Cards Skeleton */}
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <div className="p-4 space-y-3">
            <Skeleton variant="text" className="w-24" />
            <Skeleton variant="text" className="w-16 h-8" />
            <Skeleton variant="text" className="w-20" />
          </div>
        </Card>
      ))}
    </div>
    {/* Recent Articles Table Skeleton */}
    <Card>
      <div className="p-4 space-y-4">
        <Skeleton variant="text" className="w-40 h-6" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} variant="text" className="h-12" />
          ))}
        </div>
      </div>
    </Card>
  </div>
) : ...}
```

---

### 5.5 [`blog/articles/[slug]/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx) — Article Preview

**Current state (lines 185-206):** Shows `Loader2` spinner inside a Card.

**Replace with:** Skeleton matching the article preview layout:
- Title skeleton
- Meta info (category, tags) skeleton
- Content skeleton with multiple text lines

```tsx
// Replace the loading block (lines ~185-206) with:
{loading && (
  <div className="space-y-6">
    <PageHeader title={<Skeleton variant="text" className="w-48 h-8" />} />
    <Card>
      <div className="p-6 space-y-6">
        <Skeleton variant="rect" className="h-48 w-full rounded-lg" />
        <Skeleton variant="text" className="h-8 w-3/4" />
        <div className="flex gap-2">
          <Skeleton variant="text" className="w-20 h-6" />
          <Skeleton variant="text" className="w-16 h-6" />
        </div>
        <div className="space-y-2">
          <Skeleton variant="text" />
          <Skeleton variant="text" className="w-5/6" />
          <Skeleton variant="text" className="w-4/6" />
          <Skeleton variant="text" className="w-3/4" />
        </div>
      </div>
    </Card>
  </div>
)}
```

---

### 5.6 [`blog/comments/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx) — Comments

**Current state (lines 216-227):** Shows `Loader2` spinner centered.

**Replace with:** Skeleton matching the comments page layout:
- 4 stat cards skeleton
- Search/filter bar skeleton
- Comments list skeleton with individual comment cards

```tsx
// Replace the spinner block (lines ~216-227) with:
{isLoading && comments.length === 0 ? (
  <div className="space-y-6">
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <div className="p-4 space-y-2">
            <Skeleton variant="text" className="w-20" />
            <Skeleton variant="text" className="w-12 h-8" />
          </div>
        </Card>
      ))}
    </div>
    <Card>
      <div className="p-4 space-y-4">
        <div className="flex gap-2">
          <Skeleton variant="text" className="w-32 h-10" />
          <Skeleton variant="text" className="w-40 h-10" />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="border-b last:border-0 pb-4 space-y-2">
            <Skeleton variant="text" className="w-3/4" />
            <Skeleton variant="text" className="w-1/2" />
            <Skeleton variant="text" className="w-24 h-6" />
          </div>
        ))}
      </div>
    </Card>
  </div>
) : comments.length === 0 && !isLoading ? ...}
```

---

### 5.7 [`blog/tags/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/tags/page.tsx) — Tags

**Current state (lines 85-96):** Shows `Loader2` spinner centered.

**Replace with:** Skeleton matching the tags page layout:
- Tag cards/items skeleton with tag badges

```tsx
// Replace the spinner block (lines ~85-96) with:
{isLoading && tags.length === 0 ? (
  <div className="space-y-6">
    <Card>
      <div className="p-4 space-y-3">
        <Skeleton variant="text" className="w-32 h-6" />
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Skeleton key={i} variant="text" className="w-24 h-8 rounded-full" />
          ))}
        </div>
      </div>
    </Card>
    <Card title={<Skeleton variant="text" className="w-40" />}>
      <div className="p-4 space-y-2">
        <Skeleton variant="text" />
        <Skeleton variant="text" className="w-5/6" />
        <Skeleton variant="text" className="w-2/3" />
      </div>
    </Card>
  </div>
) : ...}
```

---

### 5.8 [`blog/articles/create/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx) — Create Article

**Current state:** No loading state at all for initial page load (categories/tags fetch).

**Add:** Skeleton while categories/tags are loading:

```tsx
// In the form area (around line ~204), wrap in loading condition:
{isLoading ? (
  <div className="space-y-6">
    <PageHeader title={<Skeleton variant="text" className="w-40 h-8" />} />
    <Card>
      <div className="p-6 space-y-6">
        <Skeleton variant="text" className="w-full h-10" />
        <Skeleton variant="rect" className="h-40 w-full" />
        <Skeleton variant="text" className="w-1/2 h-10" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} variant="text" className="w-20 h-8 rounded-full" />
          ))}
        </div>
        <Skeleton variant="rect" className="h-64 w-full" />
      </div>
    </Card>
  </div>
) : (
  // existing form content
)}
```

The `isLoading` state already exists (declared via `useState(false)` around line 33). It just needs to be set to `true` before the fetch call in the `useEffect` (line 137) and reset to `false` after.

---

### 5.9 [`blog/articles/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx) — Articles List

**Current state:** No skeleton; relies on SmartTable's internal BaseTable loading.

**Add:** A skeleton shown while the page initializes (before SmartTable mounts):

```tsx
// Before the SmartTable rendering (around line ~567), add:
{isInitialLoading ? (
  <Card>
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton variant="text" className="w-32 h-6" />
        <Skeleton variant="text" className="w-24 h-8" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-4 items-center">
            <Skeleton variant="text" className="w-12 h-12" />
            <div className="flex-1 space-y-1">
              <Skeleton variant="text" className="w-3/4" />
              <Skeleton variant="text" className="w-1/2" />
            </div>
            <Skeleton variant="text" className="w-20 h-6" />
          </div>
        ))}
      </div>
    </div>
  </Card>
) : (
  // existing Card with SmartTable
)}
```

---

### 5.10 [`blog/categories/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/categories/page.tsx) — Categories

**Current state:** No skeleton; relies on SmartTable's internal BaseTable loading.

**Add:** A skeleton for the Categories Usage Tips Card and the category list area:

```tsx
// Before the SmartTable rendering (around line ~240), add:
{isLoading ? (
  <div className="space-y-6">
    <Card title={<Skeleton variant="text" className="w-32" />}>
      <div className="p-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4 items-center">
            <Skeleton variant="text" className="w-8 h-8" />
            <div className="flex-1 space-y-1">
              <Skeleton variant="text" className="w-1/2" />
              <Skeleton variant="text" className="w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </Card>
    <Card title={<Skeleton variant="text" className="w-40" />}>
      <div className="p-4 space-y-2">
        <Skeleton variant="text" />
        <Skeleton variant="text" className="w-5/6" />
      </div>
    </Card>
  </div>
) : (
  // existing content
)}
```

---

### 5.11 [`blog/import/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/import/page.tsx) — Import

**Current state (lines 796-804):** Shows a "loading" overlay during file processing but has no page-level skeleton.

**Add:** A skeleton for the initial page state before files are loaded:

```tsx
// Replace the loading block (lines ~796-804) with:
{loading && articles.length === 0 && !importResult ? (
  <div className="space-y-6">
    <PageHeader title={<Skeleton variant="text" className="w-48 h-8" />} />
    <Card>
      <div className="p-8 flex flex-col items-center gap-4">
        <Skeleton variant="rect" className="w-full h-40 rounded-xl" />
        <Skeleton variant="text" className="w-64" />
        <Skeleton variant="text" className="w-40 h-10" />
      </div>
    </Card>
  </div>
) : ...}
```

---

## 6. Optional: SmartTable Skeleton Enhancement

[`SmartTable.tsx`](apps/admin-blog/src/components/scaffold/SmartTable/SmartTable.tsx) currently uses `BaseTable` which has its own spinner. For a more polished UX, we could add a table-row skeleton mode where each row is a shimmer placeholder instead of showing a spinner. However, this is a **lower priority** and could be a follow-up task since:

1. SmartTable is a reusable component used in Articles, Categories, and possibly other pages
2. Modifying BaseTable is more complex and may affect other modules
3. The page-level skeletons proposed above already cover the initial load visibility gap

**Recommendation:** Skip SmartTable skeleton for now. Focus on page-level skeletons only.

---

## 7. Implementation Order

| Step | File | Description | Priority |
|------|------|-------------|----------|
| 1 | [`UIComponents.tsx`](apps/admin-blog/src/components/UIComponents.tsx) | Add shared `Skeleton` component | High |
| 2 | [`BlogTranslationIssues.tsx`](apps/admin-blog/src/views/blog/BlogTranslationIssues.tsx) | Replace local Skeleton with import | Medium |
| 3 | [`BlogTranslationProgress.tsx`](apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx) | Replace local Skeleton with import | Medium |
| 4 | [`blog/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/page.tsx) | Dashboard: upgrade spinner → skeleton | High |
| 5 | [`blog/articles/[slug]/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx) | Preview: upgrade spinner → skeleton | High |
| 6 | [`blog/comments/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx) | Comments: upgrade spinner → skeleton | High |
| 7 | [`blog/tags/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/tags/page.tsx) | Tags: upgrade spinner → skeleton | High |
| 8 | [`blog/articles/create/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx) | Create Article: add skeleton | High |
| 9 | [`blog/articles/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx) | Articles List: add skeleton | Medium |
| 10 | [`blog/categories/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/categories/page.tsx) | Categories: add skeleton | Medium |
| 11 | [`blog/import/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/import/page.tsx) | Import: add page-load skeleton | Low |

---

## 8. Mermaid Flow

```mermaid
flowchart TD
    A[Start] --> B[Step 1: Add Skeleton to UIComponents.tsx]
    B --> C[Step 2-3: Replace local Skeletons with import]
    C --> D{Page has existing loading?}
    D -->|Yes - Spinner Loader2| E[Upgrade to contextual skeleton]
    D -->|No loading state| F[Add page-load skeleton]
    E --> E1[Dashboard page.tsx]
    E --> E2[Article Preview [slug]/page.tsx]
    E --> E3[Comments page.tsx]
    E --> E4[Tags page.tsx]
    F --> F1[Create Article page.tsx]
    F --> F2[Articles List page.tsx]
    F --> F3[Categories page.tsx]
    F --> F4[Import page.tsx]
    E1 & E2 & E3 & E4 & F1 & F2 & F3 & F4 --> G[Type-check + lint]
    G --> H[Done]
```

---

## 9. Risks & Considerations

1. **Import path**: The `@/components/UIComponents` alias must be verified. If it doesn't resolve, use relative path `../../components/UIComponents`.
2. **Dark mode**: All skeletons already include `dark:bg-white/10` for dark mode compatibility.
3. **Animation**: The `animate-pulse` class from Tailwind provides the shimmer effect. No additional CSS needed.
4. **Race conditions**: Skeletons are controlled by existing `isLoading` / `loading` state variables. No new race conditions introduced.
5. **SmartTable concern**: The Articles List and Categories pages use SmartTable which has internal loading. The skeletons proposed are for the *outer page* before SmartTable mounts. Once SmartTable renders, it manages its own loading internally.
