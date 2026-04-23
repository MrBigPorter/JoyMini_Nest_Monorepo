# Activity Sections (Act Sections) i18n Analysis

## Overview

This document analyzes the i18n needs for the **Activity Sections** management page. The page consists of 3 component files + 1 schema file, with approximately **65+ hardcoded UI strings** and **10+ Zod validation messages** that need to be internationalized across 6 locales (en, zh, ja, ko, fr, de).

**Key constraint**: Both [`ProductSelectorModal`](apps/admin-next/src/views/act-section/ProductSelectorModal.tsx) and [`ActSectionBindProductModal`](apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx) are rendered inside [`ModalManager.open()`](packages/ui/src/components/Modal/modal-manager.tsx:6)'s `renderChildren` callback, which uses `ReactDOM.createRoot()` to render into a separate DOM container — creating a **separate React tree without `NextIntlClientProvider` context**. Therefore, these components **CANNOT use `useTranslation()`** and must receive `t` as a prop (same pattern as the Banner fix).

---

## 1. Files to Modify

| File                                                                                                     | Role                  | Hardcoded Strings | i18n Approach               |
| -------------------------------------------------------------------------------------------------------- | --------------------- | ----------------- | --------------------------- |
| [`ActSectionManagementClient.tsx`](apps/admin-next/src/components/act/ActSectionManagementClient.tsx)    | Main page component   | ~30               | `useTranslation()` directly |
| [`ProductSelectorModal.tsx`](apps/admin-next/src/views/act-section/ProductSelectorModal.tsx)             | Create/Edit modal     | ~20               | Receive `t` as prop         |
| [`ActSectionBindProductModal.tsx`](apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx) | Bind product modal    | ~15               | Receive `t` as prop         |
| [`ActSectionSchema.ts`](apps/admin-next/src/schema/ActSectionSchema.ts)                                  | Zod validation schema | ~10               | Deferred (cross-cutting)    |
| [`en.json`](apps/admin-next/src/i18n/en.json) + 5 other locales                                          | Translation files     | ~55 new keys      | Add `actSection_*` keys     |

---

## 2. Hardcoded Strings Inventory

### 2.1 [`ActSectionManagementClient.tsx`](apps/admin-next/src/components/act/ActSectionManagementClient.tsx) — Main Page (~30 strings)

| Line(s) | Current String                                             | Suggested Key                                     |
| ------- | ---------------------------------------------------------- | ------------------------------------------------- |
| 113     | `'Section status updated'`                                 | `actSection_toastStatusUpdated`                   |
| 121     | `'Section deleted'`                                        | `actSection_toastDeleted`                         |
| 136     | `'Delete Section?'`                                        | `actSection_deleteTitle`                          |
| 137     | `` `Are you sure you want to delete "${record.title}"?` `` | `actSection_deleteContent` (with `{title}` param) |
| 138     | `'Delete'`                                                 | `actSection_delete`                               |
| 148     | `'Edit Product Section'`                                   | `actSection_modalTitleEdit`                       |
| 165     | `'Bind Products'`                                          | `actSection_modalTitleBind`                       |
| 181     | `'Create New Section'`                                     | `actSection_modalTitleCreate`                     |
| 210     | `'Section Title'`                                          | `actSection_columnTitle`                          |
| 223     | `'Style'`                                                  | `actSection_columnStyle`                          |
| 239     | `'Products'`                                               | `actSection_columnProducts`                       |
| 242     | `` `{...length \|\| 0} Products` ``                        | `actSection_productsCount` (with `{count}` param) |
| 247     | `'Schedule'`                                               | `actSection_columnSchedule`                       |
| 251     | `'Now'`                                                    | `actSection_now`                                  |
| 254     | `'Forever'`                                                | `actSection_forever`                              |
| 263     | `'Status'`                                                 | `actSection_columnStatus`                         |
| 266     | `'Active'`                                                 | `actSection_active`                               |
| 266     | `'Disabled'`                                               | `actSection_disabled`                             |
| 272     | `'Actions'`                                                | `actSection_columnActions`                        |
| 329     | `'Activity Sections'`                                      | `actSection_pageTitle`                            |
| 330     | `'Manage homepage sections and product layout'`            | `actSection_pageDescription`                      |
| 331     | `'New Section'`                                            | `actSection_createSection`                        |
| 343     | `'Search Title'`                                           | `actSection_searchTitle`                          |
| 344     | `'Enter keywords...'`                                      | `actSection_searchTitlePlaceholder`               |
| 349     | `'Status'`                                                 | `actSection_searchStatus`                         |
| 352     | `'All Status'`                                             | `actSection_searchStatusAll`                      |
| 353     | `'Active'`                                                 | `actSection_searchStatusActive`                   |
| 354     | `'Disabled'`                                               | `actSection_searchStatusDisabled`                 |

**Subtotal: ~28 strings**

### 2.2 [`ProductSelectorModal.tsx`](apps/admin-next/src/views/act-section/ProductSelectorModal.tsx) — Create/Edit Modal (~20 strings)

| Line(s) | Current String                       | Suggested Key                     |
| ------- | ------------------------------------ | --------------------------------- |
| 39      | `'Section created successfully'`     | `actSection_toastCreated`         |
| 49      | `'Section updated successfully'`     | `actSection_toastUpdated`         |
| 76      | `'Failed to save product'`           | `actSection_toastSaveFailed`      |
| 112     | `'Title'`                            | `actSection_formTitle`            |
| 113     | `'e.g. New Arrival'`                 | `actSection_formTitlePlaceholder` |
| 118     | `'Key (Unique)'`                     | `actSection_formKey`              |
| 120     | `'e.g. Weekly Best'`                 | `actSection_formKeyPlaceholder`   |
| 127     | `'Style Type'`                       | `actSection_formStyleType`        |
| 130     | `'Ending (Horizontal Scroll)'`       | `actSection_styleType1`           |
| 132     | `'Special Area (List w/ Progress)'`  | `actSection_styleType2`           |
| 136     | `'Home Future (Vertical Big Cards)'` | `actSection_styleType3`           |
| 140     | `'Recommendation (Grid 2 Columns)'`  | `actSection_styleType4`           |
| 145     | `'Limit'`                            | `actSection_formLimit`            |
| 149     | `'Start Time'`                       | `actSection_formStartTime`        |
| 150     | `'End Time'`                         | `actSection_formEndTime`          |
| 154     | `'Enable this section'`              | `actSection_formEnable`           |
| 159     | `'Cancel'`                           | `actSection_cancel`               |
| 162     | `'Update Section'`                   | `actSection_updateSection`        |
| 162     | `'Create Section'`                   | `actSection_createSection`        |

**Subtotal: ~19 strings**

### 2.3 [`ActSectionBindProductModal.tsx`](apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx) — Bind Product Modal (~15 strings)

| Line(s) | Current String                                                       | Suggested Key                                    |
| ------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| 65      | `'Products added to activity section successfully'`                  | `actSection_toastProductsBound`                  |
| 74      | `'Products added to activity section successfully'`                  | (same key, duplicate)                            |
| 84      | `'Product unbound successfully'`                                     | `actSection_toastProductUnbound`                 |
| 100     | `'Please select at least one product'`                               | `actSection_toastSelectProduct`                  |
| 109     | `'Confirm Unbind'`                                                   | `actSection_unbindTitle`                         |
| 110     | `` `Are you sure you want to unbind "${product.treasureName}"...` `` | `actSection_unbindContent` (with `{name}` param) |
| 111     | `'Unbind'`                                                           | `actSection_unbind`                              |
| 112     | `'Cancel'`                                                           | `actSection_cancel`                              |
| 136     | `'Product Info'`                                                     | `actSection_columnProductInfo`                   |
| 156     | `'Price'`                                                            | `actSection_columnPrice`                         |
| 163     | `'Actions'`                                                          | `actSection_columnActions`                       |
| 207     | `'Search product name...'`                                           | `actSection_searchProductPlaceholder`            |
| 247     | `items`                                                              | `actSection_items` (with `{count}` param)        |
| 250     | `'Cancel'`                                                           | `actSection_cancel`                              |
| 253     | `'Confirm Add'`                                                      | `actSection_confirmAdd`                          |

**Subtotal: ~15 strings (some shared with above)**

### 2.4 [`ActSectionSchema.ts`](apps/admin-next/src/schema/ActSectionSchema.ts) — Zod Validation (~10 strings)

| Line(s) | Current Message                                      | Suggested Key                             |
| ------- | ---------------------------------------------------- | ----------------------------------------- |
| 4       | `'Title is required'`                                | `actSection_validation_titleRequired`     |
| 5       | `'Key is required'`                                  | `actSection_validation_keyRequired`       |
| 8       | `'Image Style Type is required'`                     | `actSection_validation_styleTypeRequired` |
| 9       | `'Image Style Type must be a number'`                | `actSection_validation_styleTypeNumber`   |
| 11      | `'Image Style Type must be an integer'`              | `actSection_validation_styleTypeInteger`  |
| 13      | `'Image Style Type must be one of 1, 2, 3,or 4'`     | `actSection_validation_styleTypeInvalid`  |
| 17      | `'Status is required'`                               | `actSection_validation_statusRequired`    |
| 18      | `'Status must be a number'`                          | `actSection_validation_statusNumber`      |
| 20      | `'Status must be an integer'`                        | `actSection_validation_statusInteger`     |
| 22      | `'Status must be either 0 (INACTIVE) or 1 (ACTIVE)'` | `actSection_validation_statusInvalid`     |
| 27      | `'Limit is required'`                                | `actSection_validation_limitRequired`     |
| 28      | `'Limit must be a number'`                           | `actSection_validation_limitNumber`       |
| 29      | `'Limit must be an integer'`                         | `actSection_validation_limitInteger`      |
| 30      | `'Limit must be at least 10'`                        | `actSection_validation_limitMin`          |

**Subtotal: ~14 strings (deferred — cross-cutting concern)**

---

## 3. Locale Keys Summary

### 3.1 UI Keys (~55 total)

```
actSection_pageTitle
actSection_pageDescription
actSection_createSection
actSection_searchTitle
actSection_searchTitlePlaceholder
actSection_searchStatus
actSection_searchStatusAll
actSection_searchStatusActive
actSection_searchStatusDisabled
actSection_columnTitle
actSection_columnStyle
actSection_columnProducts
actSection_columnSchedule
actSection_columnStatus
actSection_columnActions
actSection_columnProductInfo
actSection_columnPrice
actSection_now
actSection_forever
actSection_active
actSection_disabled
actSection_productsCount          // param: {count}
actSection_toastStatusUpdated
actSection_toastDeleted
actSection_toastCreated
actSection_toastUpdated
actSection_toastSaveFailed
actSection_toastProductsBound
actSection_toastProductUnbound
actSection_toastSelectProduct
actSection_deleteTitle
actSection_deleteContent          // param: {title}
actSection_delete
actSection_modalTitleEdit
actSection_modalTitleBind
actSection_modalTitleCreate
actSection_formTitle
actSection_formTitlePlaceholder
actSection_formKey
actSection_formKeyPlaceholder
actSection_formStyleType
actSection_formLimit
actSection_formStartTime
actSection_formEndTime
actSection_formEnable
actSection_styleType1
actSection_styleType2
actSection_styleType3
actSection_styleType4
actSection_cancel
actSection_updateSection
actSection_unbindTitle
actSection_unbindContent          // param: {name}
actSection_unbind
actSection_searchProductPlaceholder
actSection_items                  // param: {count}
actSection_confirmAdd
```

### 3.2 Validation Keys (~14 total, deferred)

```
actSection_validation_titleRequired
actSection_validation_keyRequired
actSection_validation_styleTypeRequired
actSection_validation_styleTypeNumber
actSection_validation_styleTypeInteger
actSection_validation_styleTypeInvalid
actSection_validation_statusRequired
actSection_validation_statusNumber
actSection_validation_statusInteger
actSection_validation_statusInvalid
actSection_validation_limitRequired
actSection_validation_limitNumber
actSection_validation_limitInteger
actSection_validation_limitMin
```

---

## 4. Implementation Phases

### Phase A: Add `actSection_*` Keys to All 6 Locale Files

Add ~55 UI keys to each of:

- [`en.json`](apps/admin-next/src/i18n/en.json) (baseline — English)
- [`zh.json`](apps/admin-next/src/i18n/zh.json)
- [`ja.json`](apps/admin-next/src/i18n/ja.json)
- [`ko.json`](apps/admin-next/src/i18n/ko.json)
- [`fr.json`](apps/admin-next/src/i18n/fr.json)
- [`de.json`](apps/admin-next/src/i18n/de.json)

Insert before the `blogCard` section (same position as `banners_*` keys).

### Phase B: i18n [`ActSectionManagementClient.tsx`](apps/admin-next/src/components/act/ActSectionManagementClient.tsx)

1. Add `import { useTranslation } from '@/hooks/useTranslation';`
2. Add `const { t } = useTranslation();` inside component
3. Replace all ~28 hardcoded strings with `t('actSection_xxx')` calls
4. Pass `t={t}` to `<ProductSelectorModal>` (line 150-154) and `<ActSectionBindProductModal>` (line 167-171)
5. For `handleDelete` (line 134-143): pre-translate `title`, `content`, `confirmText` before passing to `ModalManager.open()`
6. For `handleEdit` (line 145-160): pre-translate `title` before passing to `ModalManager.open()`
7. For `handleBindProduct` (line 162-177): pre-translate `title` before passing to `ModalManager.open()`
8. For `handleCreate` (line 179-187): pre-translate `title` before passing to `ModalManager.open()`
9. For `columns` (line 189-322): use `t('actSection_xxx')` for all `header` values and cell text
10. Add `t` to `columns` dependency array (line 315-322)

### Phase C: i18n [`ProductSelectorModal.tsx`](apps/admin-next/src/views/act-section/ProductSelectorModal.tsx)

1. **Remove** `import { useTranslation }` — replace with `import type { TFunc } from '@/hooks/useTranslation';`
2. Add `t: TFunc` to `Props` interface
3. Replace all ~19 hardcoded strings with `t('actSection_xxx')` calls
4. Toast messages: pre-translate before passing to `addToast()`

### Phase D: i18n [`ActSectionBindProductModal.tsx`](apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx)

1. **Remove** `import { useTranslation }` — replace with `import type { TFunc } from '@/hooks/useTranslation';`
2. Add `t: TFunc` to `Props` interface
3. Replace all ~15 hardcoded strings with `t('actSection_xxx')` calls
4. Toast messages: pre-translate before passing to `addToast()`
5. For `unbind` callback (line 106-120): pre-translate `title`, `content`, `confirmText`, `cancelText` before passing to `ModalManager.open()`
6. For `columns` (line 132-200): use `t('actSection_xxx')` for all `header` values
7. Add `t` to `columns` dependency array (line 193-200)

### Phase E: i18n [`ActSectionSchema.ts`](apps/admin-next/src/schema/ActSectionSchema.ts) Zod Validation (Deferred)

This is a **cross-cutting concern** — same pattern as [`categorySchema`](apps/admin-next/src/schema/blog.ts:31-52) and [`tagSchema`](apps/admin-next/src/schema/blog.ts:57-85). Requires a custom `zodErrorMap` utility to be implemented first. Defer until the zodErrorMap approach is finalized.

### Phase F: Verification

1. Run `yarn workspace @lucky/admin-next type-check` — verify no type errors
2. Run `yarn workspace @lucky/admin-next lint --fix` — verify no lint errors
3. Run `yarn workspace @lucky/admin-next prettier` — verify formatting

---

## 5. Key Architectural Notes

### 5.1 ModalManager Context Issue

Both [`ProductSelectorModal`](apps/admin-next/src/views/act-section/ProductSelectorModal.tsx) and [`ActSectionBindProductModal`](apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx) are rendered via [`ModalManager.open()`](packages/ui/src/components/Modal/modal-manager.tsx:6)'s `renderChildren` prop. The `ModalManager` uses `ReactDOM.createRoot()` to render into a new DOM container, creating a **separate React tree** that has **no access to `NextIntlClientProvider` context**.

**Solution**: Both components must receive `t: TFunc` as a prop from the parent ([`ActSectionManagementClient`](apps/admin-next/src/components/act/ActSectionManagementClient.tsx)), which has access to `useTranslation()`.

### 5.2 Nested ModalManager Calls

[`ActSectionBindProductModal`](apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx) itself calls `ModalManager.open()` internally (line 108) for the unbind confirmation dialog. Since this inner modal is also rendered via `ReactDOM.createRoot()`, the `title`, `content`, `confirmText`, and `cancelText` must be **pre-translated** before being passed to `ModalManager.open()`.

### 5.3 `getActSectionTypeLabel` Function

The [`getActSectionTypeLabel`](packages/shared/src/types/actSection.ts:17) function from `@lucky/shared` returns hardcoded English labels for style types. This is used in the table's "Style" column (line 227). Since this function lives in `packages/shared` (not in the admin app), it cannot use `next-intl` directly. Options:

- **Option A**: Replace the `getActSectionTypeLabel` call with a `t('actSection_styleType' + val)` lookup in the component
- **Option B**: Keep the function but make it accept a translation function parameter

**Recommendation**: Option A — use `t()` directly in the component, since the style type labels already have dedicated keys (`actSection_styleType1` through `actSection_styleType4`).

### 5.4 Shared Components Already i18n'd

- [`BaseTable`](apps/admin-next/src/components/scaffold/BaseTable.tsx) — already i18n'd
- [`PageHeader`](apps/admin-next/src/components/scaffold/PageHeader.tsx) — accepts string props, no i18n needed internally
- [`SchemaSearchForm`](apps/admin-next/src/components/scaffold/SchemaSearchForm.tsx) — accepts string props (`label`, `placeholder`, option `label`), no i18n needed internally

---

## 6. Summary

| Item                               | Count   |
| ---------------------------------- | ------- |
| UI keys needed                     | ~55     |
| Validation keys needed             | ~14     |
| Total new locale keys              | ~69     |
| Files to modify (components)       | 3       |
| Files to modify (locale)           | 6       |
| Files to modify (schema, deferred) | 1       |
| Implementation phases              | 6 (A-F) |
