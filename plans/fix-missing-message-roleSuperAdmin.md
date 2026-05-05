# Fix: `MISSING_MESSAGE` for `roleSuperAdmin` in locale `ja`

## Error Summary

```
Error: MISSING_MESSAGE: Could not resolve `roleSuperAdmin` in messages for locale `ja`.

src/hooks/useTranslation.ts (21:19) @ useTranslation.useCallback[t]
Sidebar src/components/layout/Sidebar.tsx
DashboardLayout src/components/layout/DashboardLayout.tsx
AuthenticatedLayout src/app/(dashboard)/layout.tsx
```

The error occurs when the [`Sidebar`](apps/admin-next/src/components/layout/Sidebar.tsx:269) component renders the user's role name:

```tsx
{t(getRoleI18nKey(userInfo.role)) || userInfo.role}
```

## Root Cause Analysis

### Architecture Overview

```
Locale JSON (e.g. ja.json)
  └─ translations: { ... }          ← flat keys at root
  └─ adminUsers: {                  ← nested section
       roleViewer: "閲覧者",
       roleEditor: "編集者",
       roleAdmin: "管理者",
       roleSuperAdmin: "スーパー管理者",  ← key exists here
       ...
     }

request.ts flatten()
  └─ messages = {
       ...raw.translations,          // flat keys at root
       adminUsers: { ... },          // NESTED object preserved as-is
       ...
     }

getRoleI18nKey('SUPER_ADMIN')
  └─ returns 'adminUsers.roleSuperAdmin'  ← dot-path into nested object

useTranslation().t('adminUsers.roleSuperAdmin')
  └─ 1. tNext.raw('adminUsers.roleSuperAdmin')  ← may throw MISSING_MESSAGE
  └─ 2. if raw is not string → return key as fallback
  └─ 3. tNext('adminUsers.roleSuperAdmin')       ← may throw MISSING_MESSAGE
```

### The Problem

[`request.ts`](apps/admin-next/src/i18n/request.ts:42-65) `flatten()` function takes nested locale JSON objects and produces a mixed structure:

```ts
function flatten(raw: RawLocaleJson): Record<string, unknown> {
  return {
    ...raw.translations,                          // flat keys
    ...(raw.adminUsers ? { adminUsers: raw.adminUsers } : {}),  // nested object
    // ... other nested sections (orders, groups, finance, etc.)
  };
}
```

This means in the final `messages` object passed to `NextIntlClientProvider`:
- `messages.roleSuperAdmin` → **does not exist** (it's nested)
- `messages.adminUsers` → **exists** as a nested object `{ roleSuperAdmin: "...", ... }`
- `messages.adminUsers.roleSuperAdmin` → **exists** as a string

The [`useTranslation` hook](apps/admin-next/src/hooks/useTranslation.ts:30-43) calls `tNext.raw(key)` to check if a key resolves to a string before calling `tNext(key)`. The issue is that **`tNext.raw()` (a private next-intl API) may throw `MISSING_MESSAGE` for nested dot-path keys** (like `adminUsers.roleSuperAdmin`) when the parent namespace object exists but the raw check fails to resolve the full dot-path.

**All 6 locale files** (`en`, `zh`, `ja`, `ko`, `fr`, `de`) correctly contain the `roleSuperAdmin` key under the `adminUsers` section, and all are verified to have all 4 role keys (`roleViewer`, `roleEditor`, `roleAdmin`, `roleSuperAdmin`).

### Why It's a Runtime Error, Not a Compile Error

The error is **not** about missing translations in the JSON files. It's about **next-intl's `raw()` method failing to resolve dot-path keys into nested objects** at runtime. The `tNext.raw()` call throws `MISSING_MESSAGE` which is uncaught, crashing the component.

## Fix Strategy

### Fix 1: Defensive `raw()` error handling in `useTranslation` hook

The `useTranslation` hook's `t()` function should catch errors from `tNext.raw()` and fall back gracefully instead of propagating the exception.

**File**: [`apps/admin-next/src/hooks/useTranslation.ts`](apps/admin-next/src/hooks/useTranslation.ts:37)

**Change**: Wrap the `raw()` call in a try-catch:

```ts
let raw: unknown;
try {
  raw = (tNext as any).raw?.(key as any);
} catch {
  raw = undefined;
}
if (typeof raw !== 'string') {
  return key;
}
```

### Fix 2: Flatten `adminUsers.*` role keys in `request.ts` (belt-and-suspenders)

In addition to the defensive fix, also flatten the role keys from the `adminUsers` section to the top level of messages in `request.ts`. This ensures that even if `raw()` or `t()` fails with dot-path resolution for nested objects, the flat key `roleSuperAdmin` at the root level will still resolve.

**File**: [`apps/admin-next/src/i18n/request.ts`](apps/admin-next/src/i18n/request.ts:42-65)

**Change**: Add `adminUsers` keys to the flat spread in the `flatten()` function, or create a separate spread of just the role keys:

```ts
function flatten(raw: RawLocaleJson): Record<string, unknown> {
  return {
    ...raw.translations,
    // Flatten adminUsers role keys to top-level for direct access
    ...(raw.adminUsers
      ? Object.fromEntries(
          Object.entries(raw.adminUsers).filter(
            ([k]) => k.startsWith('role'),
          ),
        )
      : {}),
    ...(raw.adminUsers ? { adminUsers: raw.adminUsers } : {}),
    // ... rest of sections
  };
}
```

This makes keys like `roleSuperAdmin`, `roleAdmin`, etc. available both:
- As flat keys: `t('roleSuperAdmin')` → works
- As nested keys: `t('adminUsers.roleSuperAdmin')` → also works

### Fix 3: Verify all locale files have complete role keys ✅ (already confirmed)

All 6 locale files (`en`, `zh`, `ja`, `ko`, `fr`, `de`) have all 4 role keys under `adminUsers`:
- `roleViewer`, `roleEditor`, `roleAdmin`, `roleSuperAdmin` — all present in all locales.

No changes needed to JSON files.

## Affected Files

| File | Change |
|------|--------|
| [`apps/admin-next/src/hooks/useTranslation.ts`](apps/admin-next/src/hooks/useTranslation.ts) | Wrap `raw()` in try-catch |
| [`apps/admin-next/src/i18n/request.ts`](apps/admin-next/src/i18n/request.ts) | Flatten `role*` keys from nested `adminUsers` to top level |

## Not Affected

- No locale JSON files need changes (keys are already present)
- No other components need changes (the fix is in the i18n infrastructure)
- The `getRoleI18nKey()` function and all call sites remain unchanged

## Verification

1. After applying fixes, the Sidebar should render role names correctly in all locales
2. `t('adminUsers.roleSuperAdmin')` should resolve correctly via dot-path
3. `t('roleSuperAdmin')` should also work as a flat key fallback
4. No `MISSING_MESSAGE` errors should appear in the console for any locale
