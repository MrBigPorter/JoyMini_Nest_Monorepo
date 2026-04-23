# Categories Pages i18n Analysis & Implementation Plan

## Overview

There are **two separate categories pages** in the admin dashboard, and a **shared modal component**:

| Page               | Route              | File                                                                                         | i18n Status     |
| ------------------ | ------------------ | -------------------------------------------------------------------------------------------- | --------------- |
| Product Categories | `/categories`      | [`CategoriesClient.tsx`](apps/admin-next/src/components/categories/CategoriesClient.tsx)     | ✅ Fully i18n'd |
| Blog Categories    | `/blog/categories` | [`blog/categories/page.tsx`](<apps/admin-next/src/app/(dashboard)/blog/categories/page.tsx>) | ✅ Fully i18n'd |
| BlogCategoryModal  | (shared)           | [`BlogCategoryModal.tsx`](apps/admin-next/src/views/blog/BlogCategoryModal.tsx)              | ✅ Fully i18n'd |

**6 locales**: `en`, `zh`, `ja`, `ko`, `fr`, `de`

---

## 1. What's Already Done ✅

### 1.1 [`CategoriesClient.tsx`](apps/admin-next/src/components/categories/CategoriesClient.tsx)

- Line 10: `import { useTranslation } from '@/hooks/useTranslation';` ✅
- Line 21: `const { t } = useTranslation();` ✅
- All 9 hardcoded strings replaced with `t('categories_xxx')` calls ✅
- Line 124: `t('categories_productsLinked', { count: cat.productCount })` correctly uses count param ✅

### 1.2 [`BlogCategoryModal.tsx`](apps/admin-next/src/views/blog/BlogCategoryModal.tsx)

- Line 17: `import { useTranslation } from '@/hooks/useTranslation';` ✅
- Line 38: `const { t } = useTranslation();` ✅
- All 12 hardcoded strings replaced with `t('categories_xxx')` calls ✅
- Conditional keys: `isEditing ? t('categories_modalTitleEdit') : t('categories_modalTitleCreate')` ✅
- Submit button: `isEditing ? t('categories_update') : t('categories_create')` ✅

### 1.3 All 6 locale files — 19 `categories_*` keys each

All present and identical across all locales:
`categories_pageTitle`, `categories_pageDescription`, `categories_addCategory`, `categories_createNew`, `categories_productsLinked`, `categories_deleteTitle`, `categories_deleteContent`, `categories_confirm`, `categories_cancel`, `categories_modalTitleCreate`, `categories_modalTitleEdit`, `categories_name`, `categories_namePlaceholder`, `categories_slug`, `categories_slugPlaceholder`, `categories_description`, `categories_descriptionPlaceholder`, `categories_create`, `categories_update`

### 1.4 Sidebar navigation

[`Sidebar.tsx`](apps/admin-next/src/components/layout/Sidebar.tsx:193) uses `t(route.name)` — the route config at [`routes/index.ts`](apps/admin-next/src/routes/index.ts:59) uses `name: 'categories'` which maps to the existing `"categories"` key in all locale files. ✅

---

## 2. What's Still Missing ❌

### 2.1 Hardcoded Zod Validation Messages in [`categorySchema`](apps/admin-next/src/schema/blog.ts:31-52)

The Zod schema has **6 hardcoded English validation messages** that are NOT i18n'd:

| Line | Field               | Current Hardcoded Message                                         | Proposed Key                           |
| :--: | ------------------- | ----------------------------------------------------------------- | -------------------------------------- |
|  35  | `name` (min)        | `'Category name is required'`                                     | `categories_validation_nameRequired`   |
|  36  | `name` (max)        | `'Category name must be at most 50 characters'`                   | `categories_validation_nameMax`        |
|  40  | `slug` (min)        | `'Slug is required'`                                              | `categories_validation_slugRequired`   |
|  41  | `slug` (max)        | `'Slug must be at most 50 characters'`                            | `categories_validation_slugMax`        |
|  44  | `slug` (regex)      | `'Slug can only contain lowercase letters, numbers, and hyphens'` | `categories_validation_slugFormat`     |
|  49  | `description` (max) | `'Description must be at most 500 characters'`                    | `categories_validation_descriptionMax` |

**Architecture Decision:** Zod validation messages are resolved at the schema level (outside React components), so `useTranslation()` cannot be called there directly. The recommended approach is to **replace the hardcoded strings with i18n key references** and create a custom `zodErrorMap` that resolves them via `next-intl`'s `useTranslations` at the form level.

However, a simpler approach that works within the current architecture: **Replace the hardcoded English strings in the schema with i18n keys, and create a custom Zod error map** that intercepts error messages and translates them. This can be done by:

1. Replace hardcoded messages with i18n key strings (e.g., `'Category name is required'` → `'categories_validation_nameRequired'`)
2. Create a custom `zodErrorMap` that checks if the error message matches a known i18n key pattern and translates it
3. Apply the error map at the app level or per-form

**Simpler alternative (recommended for this scope):** Since the `FormTextField` component already displays `error.message` from Zod via `react-hook-form`'s `zodResolver`, and the error message is just a string, we can:

1. Keep the hardcoded English messages in the schema as-is (they serve as the English fallback)
2. Add the i18n keys to all 6 locale files with translated validation messages
3. Create a utility function `translateZodError(error: FieldError, t: TFunc): string` that maps known error messages to i18n keys
4. Use this in the form components to translate errors before display

**OR even simpler:** Since the Zod messages are already English and serve as the English locale, we can:

1. Add the 6 validation keys to all locale files with proper translations
2. Modify the `useBlogForm` hook to accept a `t` function and translate Zod errors after resolution
3. Pass `t` from the calling component

### 2.2 [`BlogTagModal.tsx`](apps/admin-next/src/views/blog/BlogTagModal.tsx) — Completely Missing i18n

This file has **no `useTranslation` import** and **all strings are hardcoded**:

| Line | Hardcoded String                        | Proposed Key                                    |
| :--: | --------------------------------------- | ----------------------------------------------- |
| 143  | `'{isEditing ? 'Edit' : 'Create'} Tag'` | `tags_modalTitleCreate` / `tags_modalTitleEdit` |
| 149  | `'Name'`                                | `tags_name`                                     |
| 154  | `'Enter tag name'`                      | `tags_namePlaceholder`                          |
| 159  | `'Slug'`                                | `tags_slug`                                     |
| 160  | `'e.g., technology'`                    | `tags_slugPlaceholder`                          |
| 165  | `'Color'`                               | `tags_color`                                    |
| 166  | `'#3b82f6'`                             | `tags_colorPlaceholder`                         |
| 170  | `'Description'`                         | `tags_description`                              |
| 171  | `'Optional description'`                | `tags_descriptionPlaceholder`                   |
| 181  | `'Cancel'`                              | `tags_cancel`                                   |
| 184  | `'{isEditing ? 'Update' : 'Create'}'`   | `tags_create` / `tags_update`                   |

**Changes needed in `BlogTagModal.tsx`:**

1. Add `import { useTranslation } from '@/hooks/useTranslation';`
2. Add `const { t } = useTranslation();`
3. Replace all hardcoded strings with `t('tags_xxx')` calls

### 2.3 Hardcoded Zod Validation Messages in [`tagSchema`](apps/admin-next/src/schema/blog.ts:57-85)

Same issue as categorySchema — **7 hardcoded English validation messages**:

| Line | Field               | Current Hardcoded Message                                         | Proposed Key                     |
| :--: | ------------------- | ----------------------------------------------------------------- | -------------------------------- |
|  61  | `name` (min)        | `'Tag name is required'`                                          | `tags_validation_nameRequired`   |
|  62  | `name` (max)        | `'Tag name must be at most 30 characters'`                        | `tags_validation_nameMax`        |
|  65  | `slug` (min)        | `'Slug is required'`                                              | `tags_validation_slugRequired`   |
|  66  | `slug` (max)        | `'Slug must be at most 50 characters'`                            | `tags_validation_slugMax`        |
|  69  | `slug` (regex)      | `'Slug can only contain lowercase letters, numbers, and hyphens'` | `tags_validation_slugFormat`     |
|  76  | `color` (regex)     | `'Color must be a valid hex code, e.g., #3b82f6'`                 | `tags_validation_colorFormat`    |
|  83  | `description` (max) | `'Description must be at most 300 characters'`                    | `tags_validation_descriptionMax` |

---

## 3. New i18n Keys to Add

### 3.1 Categories Validation Keys (all 6 locale files)

```
categories_validation_nameRequired: "Category name is required"
categories_validation_nameMax: "Category name must be at most 50 characters"
categories_validation_slugRequired: "Slug is required"
categories_validation_slugMax: "Slug must be at most 50 characters"
categories_validation_slugFormat: "Slug can only contain lowercase letters, numbers, and hyphens"
categories_validation_descriptionMax: "Description must be at most 500 characters"
```

### 3.2 Tags UI Keys (all 6 locale files)

```
tags_modalTitleCreate: "Create Tag"
tags_modalTitleEdit: "Edit Tag"
tags_name: "Name"
tags_namePlaceholder: "Enter tag name"
tags_slug: "Slug"
tags_slugPlaceholder: "e.g., technology"
tags_color: "Color"
tags_colorPlaceholder: "#3b82f6"
tags_description: "Description"
tags_descriptionPlaceholder: "Optional description"
tags_cancel: "Cancel"
tags_create: "Create"
tags_update: "Update"
```

### 3.3 Tags Validation Keys (all 6 locale files)

```
tags_validation_nameRequired: "Tag name is required"
tags_validation_nameMax: "Tag name must be at most 30 characters"
tags_validation_slugRequired: "Slug is required"
tags_validation_slugMax: "Slug must be at most 50 characters"
tags_validation_slugFormat: "Slug can only contain lowercase letters, numbers, and hyphens"
tags_validation_colorFormat: "Color must be a valid hex code, e.g., #3b82f6"
tags_validation_descriptionMax: "Description must be at most 300 characters"
```

---

## 4. Implementation Steps

### Phase A: Zod Validation i18n (Cross-cutting)

| #   | Step                                                                                         | Files                                                        |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| A1  | Add `categories_validation_*` keys to `en.json` (baseline)                                   | [`en.json`](apps/admin-next/src/i18n/en.json)                |
| A2  | Add `categories_validation_*` keys to `zh.json`                                              | [`zh.json`](apps/admin-next/src/i18n/zh.json)                |
| A3  | Add `categories_validation_*` keys to `ja.json`                                              | [`ja.json`](apps/admin-next/src/i18n/ja.json)                |
| A4  | Add `categories_validation_*` keys to `ko.json`                                              | [`ko.json`](apps/admin-next/src/i18n/ko.json)                |
| A5  | Add `categories_validation_*` keys to `fr.json`                                              | [`fr.json`](apps/admin-next/src/i18n/fr.json)                |
| A6  | Add `categories_validation_*` keys to `de.json`                                              | [`de.json`](apps/admin-next/src/i18n/de.json)                |
| A7  | Add `tags_validation_*` keys to all 6 locale files                                           | All 6 locale files                                           |
| A8  | Create a custom `zodErrorMap` utility that translates Zod error messages via `next-intl`     | New file: `apps/admin-next/src/lib/utils/zodErrorMap.ts`     |
| A9  | Integrate the `zodErrorMap` into the app's form setup (e.g., in `useBlogForm` or a provider) | [`useBlogForm.ts`](apps/admin-next/src/hooks/useBlogForm.ts) |

### Phase B: BlogTagModal i18n

| #   | Step                                                                           | Files                                                                 |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| B1  | Add `tags_*` UI keys to `en.json` (baseline)                                   | [`en.json`](apps/admin-next/src/i18n/en.json)                         |
| B2  | Add `tags_*` UI keys to `zh.json`                                              | [`zh.json`](apps/admin-next/src/i18n/zh.json)                         |
| B3  | Add `tags_*` UI keys to `ja.json`                                              | [`ja.json`](apps/admin-next/src/i18n/ja.json)                         |
| B4  | Add `tags_*` UI keys to `ko.json`                                              | [`ko.json`](apps/admin-next/src/i18n/ko.json)                         |
| B5  | Add `tags_*` UI keys to `fr.json`                                              | [`fr.json`](apps/admin-next/src/i18n/fr.json)                         |
| B6  | Add `tags_*` UI keys to `de.json`                                              | [`de.json`](apps/admin-next/src/i18n/de.json)                         |
| B7  | Add `useTranslation` import and `t()` hook to `BlogTagModal.tsx`               | [`BlogTagModal.tsx`](apps/admin-next/src/views/blog/BlogTagModal.tsx) |
| B8  | Replace all hardcoded strings in `BlogTagModal.tsx` with `t('tags_xxx')` calls | [`BlogTagModal.tsx`](apps/admin-next/src/views/blog/BlogTagModal.tsx) |

### Phase C: Verification

| #   | Step                                                           | Files                                                                 |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| C1  | Verify no hardcoded strings remain in `BlogTagModal.tsx`       | [`BlogTagModal.tsx`](apps/admin-next/src/views/blog/BlogTagModal.tsx) |
| C2  | Verify all new keys exist in all 6 locale files                | All 6 locale files                                                    |
| C3  | Run type-check + lint + prettier                               | —                                                                     |
| C4  | Test form validation messages display correctly in all locales | —                                                                     |

---

## 5. Architecture: Zod Error i18n Approach

### Problem

Zod validation messages are defined in the schema file (`schema/blog.ts`) which is outside React's component tree. `useTranslation()` cannot be called there.

### Solution: Custom `zodErrorMap`

Create a utility that maps Zod error codes + path to i18n keys:

```typescript
// apps/admin-next/src/lib/utils/zodErrorMap.ts
import { z } from "zod";
import type { TFunc } from "@/hooks/useTranslation";

/**
 * Translates Zod validation errors using the app's i18n system.
 * Falls back to the original message if no translation key is found.
 */
export function createZodErrorMap(t: TFunc): z.ZodErrorMap {
  return (issue, ctx) => {
    // Map specific error paths + codes to i18n keys
    const path = issue.path.join(".");

    // Category schema
    if (path === "name" && issue.code === "too_small")
      return { message: t("categories_validation_nameRequired") };
    if (path === "name" && issue.code === "too_big")
      return { message: t("categories_validation_nameMax") };
    if (path === "slug" && issue.code === "too_small")
      return { message: t("categories_validation_slugRequired") };
    if (path === "slug" && issue.code === "too_big")
      return { message: t("categories_validation_slugMax") };
    if (path === "slug" && issue.code === "invalid_string")
      return { message: t("categories_validation_slugFormat") };
    if (path === "description" && issue.code === "too_big")
      return { message: t("categories_validation_descriptionMax") };

    // Tag schema
    if (path === "name" && issue.code === "too_small")
      return { message: t("tags_validation_nameRequired") };
    if (path === "name" && issue.code === "too_big")
      return { message: t("tags_validation_nameMax") };
    if (path === "slug" && issue.code === "too_small")
      return { message: t("tags_validation_slugRequired") };
    if (path === "slug" && issue.code === "too_big")
      return { message: t("tags_validation_slugMax") };
    if (path === "slug" && issue.code === "invalid_string")
      return { message: t("tags_validation_slugFormat") };
    if (path === "color" && issue.code === "invalid_string")
      return { message: t("tags_validation_colorFormat") };
    if (path === "description" && issue.code === "too_big")
      return { message: t("tags_validation_descriptionMax") };

    return { message: ctx.defaultError };
  };
}
```

Then integrate it into `useBlogForm`:

```typescript
// In useBlogForm.ts
import { useTranslation } from '@/hooks/useTranslation';
import { createZodErrorMap } from '@/lib/utils/zodErrorMap';

export function useBlogForm<T extends z.ZodSchema>({ ... }) {
  const { t } = useTranslation();

  // Set the custom error map
  z.setErrorMap(createZodErrorMap(t));

  // ... rest of the hook
}
```

**Note:** `z.setErrorMap()` is global — it sets the error map for all Zod validations. If this is undesirable, an alternative is to use `superRefine` or a custom wrapper that translates errors after validation.

---

## 6. Translation Values per Locale

### `en.json` (baseline) — Categories Validation

```json
"categories_validation_nameRequired": "Category name is required",
"categories_validation_nameMax": "Category name must be at most 50 characters",
"categories_validation_slugRequired": "Slug is required",
"categories_validation_slugMax": "Slug must be at most 50 characters",
"categories_validation_slugFormat": "Slug can only contain lowercase letters, numbers, and hyphens",
"categories_validation_descriptionMax": "Description must be at most 500 characters"
```

### `en.json` (baseline) — Tags UI

```json
"tags_modalTitleCreate": "Create Tag",
"tags_modalTitleEdit": "Edit Tag",
"tags_name": "Name",
"tags_namePlaceholder": "Enter tag name",
"tags_slug": "Slug",
"tags_slugPlaceholder": "e.g., technology",
"tags_color": "Color",
"tags_colorPlaceholder": "#3b82f6",
"tags_description": "Description",
"tags_descriptionPlaceholder": "Optional description",
"tags_cancel": "Cancel",
"tags_create": "Create",
"tags_update": "Update"
```

### `en.json` (baseline) — Tags Validation

```json
"tags_validation_nameRequired": "Tag name is required",
"tags_validation_nameMax": "Tag name must be at most 30 characters",
"tags_validation_slugRequired": "Slug is required",
"tags_validation_slugMax": "Slug must be at most 50 characters",
"tags_validation_slugFormat": "Slug can only contain lowercase letters, numbers, and hyphens",
"tags_validation_colorFormat": "Color must be a valid hex code, e.g., #3b82f6",
"tags_validation_descriptionMax": "Description must be at most 300 characters"
```

> **Note:** For `zh.json`, `ja.json`, `ko.json`, `fr.json`, `de.json`, use the same translation patterns as the existing `categories_*` keys in each locale. The `tags_*` UI keys should follow the same pattern as `categories_*` UI keys.

---

## 7. Summary

| Item                                                 | Status          | Priority   |
| ---------------------------------------------------- | --------------- | ---------- |
| `CategoriesClient.tsx` UI i18n                       | ✅ Done         | —          |
| `BlogCategoryModal.tsx` UI i18n                      | ✅ Done         | —          |
| `blog/categories/page.tsx` UI i18n                   | ✅ Done         | —          |
| All 6 locale files `categories_*` keys               | ✅ Done         | —          |
| Sidebar "Categories" label                           | ✅ Done         | —          |
| **`categorySchema` Zod validation messages**         | **❌ Not done** | **High**   |
| **`BlogTagModal.tsx` UI i18n**                       | **❌ Not done** | **High**   |
| **`tagSchema` Zod validation messages**              | **❌ Not done** | **Medium** |
| Custom `zodErrorMap` utility                         | ❌ Not done     | High       |
| `tags_*` keys in all 6 locale files                  | ❌ Not done     | High       |
| `categories_validation_*` keys in all 6 locale files | ❌ Not done     | High       |
| `tags_validation_*` keys in all 6 locale files       | ❌ Not done     | Medium     |
