# Fix: Remove Internal Language Switchers from Modals/Forms

## Problem

Modals and forms have internal language switching buttons that call the **global** `setLocale()`. This is redundant with the header language switcher and causes confusion.

## Solution

Remove the internal language switcher UI from all modals/forms. Users use the header's language dropdown to switch locale, and the form content follows automatically via `useLocalizedForm`'s locale-change effect.

### Why This Works

1. `useLocalizedForm` / `useLocalizedFormV2` store all locale values in a `storageRef` (useRef)
2. `router.refresh()` (triggered by global `setLocale`) does NOT unmount client components — refs persist
3. When `locale` changes, `useLocalizedForm`'s `useEffect([locale])` reads from `storageRef` and switches form content
4. No data loss for modals (content from API) or create pages (typed content preserved in refs)

## Changes Required

### 1. [`BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx)

Remove the inline language switcher buttons (lines ~586-598):
```tsx
{/* ❌ Remove this entire block */}
<div className="flex gap-2">
  {availableLocaleCodes.map((lang) => (
    <Button
      key={lang}
      type="button"
      variant={currentLocale === lang ? 'primary' : 'outline'}
      size="sm"
      onClick={() => handleLocaleChange(lang as Locale)}
    >
      {lang.toUpperCase()}
    </Button>
  ))}
</div>
```

Also remove the `handleLocaleChange` wrapper (lines ~489-509) since it's no longer needed.

### 2. [`create/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx)

Remove the `<LanguageSwitch />` component (line 265):
```tsx
{/* ❌ Remove this */}
<LanguageSwitch />
```

Remove the import:
```tsx
// ❌ Remove
import { LanguageSwitch } from '@/components/blog/LanguageSwitch';
```

### 3. [`BlogTagModal.tsx`](apps/admin-blog/src/views/blog/BlogTagModal.tsx)

Remove the `<LanguageSwitch />` component (line 152):
```tsx
{/* ❌ Remove this */}
<LanguageSwitch />
```

Remove the import:
```tsx
// ❌ Remove
import { LanguageSwitch } from '@/components/blog/LanguageSwitch';
```

### 4. [`BlogCommentModal.tsx`](apps/admin-blog/src/views/blog/BlogCommentModal.tsx)

Remove the `<LanguageSwitch />` component (line 129):
```tsx
{/* ❌ Remove this */}
<LanguageSwitch />
```

Remove the import:
```tsx
// ❌ Remove
import { LanguageSwitch } from '@/components/blog/LanguageSwitch';
```

### What Stays the Same

- **Header `LocaleDropdown`** — still correctly changes global language ✅
- **`useBlogLocalizedForm`** — no changes needed ✅
- **`useLocalizedForm` / `useLocalizedFormV2`** — already react to locale changes ✅
- **`LanguageSwitch` component** — still available for future use if needed ✅

## Testing Checklist

1. Open article modal (edit) → use header to switch language → form content switches → no data loss
2. Open article modal (create) → type content → switch language via header → content preserved → save
3. Tags modal → switch language via header → form content switches correctly
4. Comments modal → same
5. Create article page → type content → switch language via header → content preserved
