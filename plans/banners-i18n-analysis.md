# Banner Management i18n Analysis

## Overview

The Banner Management page consists of **3 files** that need i18n analysis:

| File                                                                                              | Route      | Type                                      | i18n Status    |
| ------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------- | -------------- |
| [`BannerManagementClient.tsx`](apps/admin-next/src/components/banners/BannerManagementClient.tsx) | `/banners` | Main page (table + search + actions)      | ❌ Not started |
| [`BannerFormModal.tsx`](apps/admin-next/src/views/banner/BannerFormModal.tsx)                     | —          | Create/Edit modal                         | ❌ Not started |
| [`BannerBindProduct.tsx`](apps/admin-next/src/views/banner/BannerBindProduct.tsx)                 | —          | Product selector (sub-component of modal) | ❌ Not started |

**Existing i18n keys:** There are **ZERO** `banner_*` keys in any locale file. Only the sidebar navigation key `"banners"` exists in [`en.json`](apps/admin-next/src/i18n/en.json:40) (line 40).

**Shared components already i18n'd (no work needed):**

- [`BaseTable.tsx`](apps/admin-next/src/components/scaffold/BaseTable.tsx) — Already uses `useTranslation` and `t('common_noData')` ✅
- [`Pagination.tsx`](apps/admin-next/src/components/scaffold/Pagination.tsx) — Already i18n'd ✅
- [`PageHeader.tsx`](apps/admin-next/src/components/scaffold/PageHeader.tsx) — Accepts `title`/`description` as props (strings passed from parent) ✅
- [`SchemaSearchForm.tsx`](apps/admin-next/src/components/scaffold/SchemaSearchForm.tsx) — Accepts `label`/`placeholder` as props from parent ✅

---

## 1. [`BannerManagementClient.tsx`](apps/admin-next/src/components/banners/BannerManagementClient.tsx) — Main Page

**Current state:** No `useTranslation` import. All strings hardcoded.

### 1.1 Page Header (lines 283-288)

```tsx
<PageHeader
  title="Banner Management" // → banners_pageTitle
  description="Manage the banners..." // → banners_pageDescription
  buttonText="Create Banner" // → banners_createBanner
/>
```

### 1.2 Search Form (lines 293-310)

```tsx
// SchemaSearchForm fields — labels and placeholders
{ label: 'Search Title', placeholder: 'Enter keywords...' }     // → banners_searchTitle, banners_searchTitlePlaceholder
{ label: 'Position', options: [                                  // → banners_position
  { label: 'All', value: 'ALL' },                                // → banners_positionAll
  { label: 'Home', value: '1' },                                 // → banners_positionHome
  { label: 'Product', value: '2' },                              // → banners_positionProduct
]}
```

### 1.3 Table Column Headers (lines 163-278)

| Line | Current Hardcoded         | Proposed Key                          |
| :--: | ------------------------- | ------------------------------------- |
| 181  | `'Visual'`                | `banners_visual`                      |
| 200  | `'Info'`                  | `banners_info`                        |
| 207  | `'Permanent (No expiry)'` | `banners_permanent`                   |
| 214  | `'Target'`                | `banners_target`                      |
| 220  | `'Web Link'`              | `banners_webLink`                     |
| 226  | `'Product'`               | `banners_product`                     |
| 229  | `'No Action'`             | `banners_noAction`                    |
| 233  | `'Status'`                | `banners_status`                      |
| 237  | `'Active'` / `'Disabled'` | `banners_active` / `banners_disabled` |
| 242  | `'Actions'`               | `banners_actions`                     |

### 1.4 Modal Open Calls (lines 131-161)

| Line | Current Hardcoded                 | Proposed Key               |
| :--: | --------------------------------- | -------------------------- |
| 134  | `'Edit Banner'`                   | `banners_modalTitleEdit`   |
| 134  | `'Create Banner'`                 | `banners_modalTitleCreate` |
| 154  | `'Delete Banner?'`                | `banners_deleteTitle`      |
| 155  | `'This action cannot be undone.'` | `banners_deleteContent`    |
| 156  | `'Delete'`                        | `banners_delete`           |

### 1.5 Toast Messages (lines 113, 121)

| Line | Current Hardcoded  | Proposed Key                 |
| :--: | ------------------ | ---------------------------- |
| 113  | `'Deleted'`        | `banners_toastDeleted`       |
| 121  | `'Status updated'` | `banners_toastStatusUpdated` |

### 1.6 Table Cell Values (lines 193-195)

| Line | Current Hardcoded | Proposed Key    |
| :--: | ----------------- | --------------- |
| 193  | `'Video'`         | `banners_video` |

**Total for BannerManagementClient.tsx: ~25 hardcoded strings**

---

## 2. [`BannerFormModal.tsx`](apps/admin-next/src/views/banner/BannerFormModal.tsx) — Create/Edit Modal

**Current state:** No `useTranslation` import. All strings hardcoded.

### 2.1 Form Fields (lines 114-157)

| Line | Current Hardcoded                      | Proposed Key                   |
| :--: | -------------------------------------- | ------------------------------ |
| 116  | `label="Internal Title"`               | `banners_formTitle`            |
| 117  | `placeholder="e.g. 11.11 Main Banner"` | `banners_formTitlePlaceholder` |
| 124  | `label="Creative Asset (16:9)"`        | `banners_formCreativeAsset`    |
| 143  | `label="Display Position"`             | `banners_formPosition`         |
| 146  | `{ label: 'Home', value: '1' }`        | `banners_positionHome`         |
| 147  | `{ label: 'Activity', value: '2' }`    | `banners_positionActivity`     |
| 148  | `{ label: 'Product', value: '3' }`     | `banners_positionProduct`      |
| 151  | `label="Sort Order"`                   | `banners_formSortOrder`        |
| 155  | `label="Start Time"`                   | `banners_formStartTime`        |
| 156  | `label="End Time"`                     | `banners_formEndTime`          |

### 2.2 Click Action Section (lines 160-217)

| Line | Current Hardcoded            | Proposed Key                       |
| :--: | ---------------------------- | ---------------------------------- |
| 162  | `'Click Action'`             | `banners_clickAction`              |
| 167  | `label="Navigation Type"`    | `banners_navType`                  |
| 171  | `'No Action (Just Display)'` | `banners_navNone`                  |
| 175  | `'Open Product Detail'`      | `banners_navProduct`               |
| 179  | `'Open External Web'`        | `banners_navExternal`              |
| 190  | `label="Target URL"`         | `banners_formTargetUrl`            |
| 191  | `placeholder="https://..."`  | `banners_formTargetUrlPlaceholder` |

### 2.3 Footer Buttons (lines 222-227)

| Line | Current Hardcoded | Proposed Key     |
| :--: | ----------------- | ---------------- |
| 223  | `'Cancel'`        | `banners_cancel` |
| 226  | `'Save Banner'`   | `banners_save`   |

### 2.4 Toast Message (line 82)

| Line | Current Hardcoded                                                  | Proposed Key                                    |
| :--: | ------------------------------------------------------------------ | ----------------------------------------------- |
|  82  | `` `Banner ${editingData ? 'updated' : 'created'} successfully` `` | `banners_toastUpdated` / `banners_toastCreated` |

### 2.5 Zod Validation (schema level — [`bannerShema.ts`](apps/admin-next/src/schema/bannerShema.ts))

| Line | Current Hardcoded                                                    | Proposed Key                              |
| :--: | -------------------------------------------------------------------- | ----------------------------------------- |
|  7   | `'Title is required'`                                                | `banners_validation_titleRequired`        |
|  7   | `.max(200)` (no message)                                             | —                                         |
|  27  | `'Related title ID must be provided when jump category is TREASURE'` | `banners_validation_relatedTitleRequired` |

**Total for BannerFormModal.tsx: ~20 hardcoded strings** (including 2 Zod messages)

---

## 3. [`BannerBindProduct.tsx`](apps/admin-next/src/views/banner/BannerBindProduct.tsx) — Product Selector

**Current state:** No `useTranslation` import. All strings hardcoded.

| Line | Current Hardcoded                      | Proposed Key                       |
| :--: | -------------------------------------- | ---------------------------------- |
|  70  | `'Select'` (table header)              | `banners_select`                   |
|  96  | `'Product Info'` (table header)        | `banners_productInfo`              |
| 117  | `'Price'` (table header)               | `banners_price`                    |
| 142  | `placeholder="Search product name..."` | `banners_searchProductPlaceholder` |
| 197  | `'Total: '` (pagination)               | `banners_total`                    |
| 210  | `'Prev'`                               | `banners_prev`                     |
| 225  | `'Next'`                               | `banners_next`                     |

**Total for BannerBindProduct.tsx: ~7 hardcoded strings**

---

## 4. Summary of New i18n Keys Needed

### 4.1 UI Keys (~45 keys)

```json
// Page-level
"banners_pageTitle": "Banner Management",
"banners_pageDescription": "Manage the banners displayed in the mini shop.",
"banners_createBanner": "Create Banner",

// Search form
"banners_searchTitle": "Search Title",
"banners_searchTitlePlaceholder": "Enter keywords...",
"banners_position": "Position",
"banners_positionAll": "All",
"banners_positionHome": "Home",
"banners_positionActivity": "Activity",
"banners_positionProduct": "Product",

// Table columns
"banners_visual": "Visual",
"banners_info": "Info",
"banners_permanent": "Permanent (No expiry)",
"banners_target": "Target",
"banners_webLink": "Web Link",
"banners_product": "Product",
"banners_noAction": "No Action",
"banners_status": "Status",
"banners_active": "Active",
"banners_disabled": "Disabled",
"banners_actions": "Actions",
"banners_video": "Video",

// Modal titles
"banners_modalTitleCreate": "Create Banner",
"banners_modalTitleEdit": "Edit Banner",

// Delete confirm
"banners_deleteTitle": "Delete Banner?",
"banners_deleteContent": "This action cannot be undone.",
"banners_delete": "Delete",

// Toast
"banners_toastDeleted": "Deleted",
"banners_toastStatusUpdated": "Status updated",
"banners_toastCreated": "Banner created successfully",
"banners_toastUpdated": "Banner updated successfully",

// Form fields
"banners_formTitle": "Internal Title",
"banners_formTitlePlaceholder": "e.g. 11.11 Main Banner",
"banners_formCreativeAsset": "Creative Asset (16:9)",
"banners_formPosition": "Display Position",
"banners_formSortOrder": "Sort Order",
"banners_formStartTime": "Start Time",
"banners_formEndTime": "End Time",

// Click action
"banners_clickAction": "Click Action",
"banners_navType": "Navigation Type",
"banners_navNone": "No Action (Just Display)",
"banners_navProduct": "Open Product Detail",
"banners_navExternal": "Open External Web",
"banners_formTargetUrl": "Target URL",
"banners_formTargetUrlPlaceholder": "https://...",

// Buttons
"banners_cancel": "Cancel",
"banners_save": "Save Banner",

// Product selector
"banners_select": "Select",
"banners_productInfo": "Product Info",
"banners_price": "Price",
"banners_searchProductPlaceholder": "Search product name...",
"banners_total": "Total: ",
"banners_prev": "Prev",
"banners_next": "Next",
```

### 4.2 Validation Keys (~2 keys)

```json
"banners_validation_titleRequired": "Title is required",
"banners_validation_relatedTitleRequired": "Related title ID must be provided when jump category is TREASURE",
```

### 4.3 Total

| Category                    | Count             |
| --------------------------- | ----------------- |
| UI keys                     | ~45               |
| Validation keys             | ~2                |
| **Total new keys**          | **~47**           |
| Files to modify (6 locales) | 6                 |
| **Total key insertions**    | **~282** (47 × 6) |

---

## 5. Implementation Steps

### Phase A: Add i18n keys to all 6 locale files

| #   | Step                                                | Files                                         |
| --- | --------------------------------------------------- | --------------------------------------------- |
| A1  | Add all `banners_*` UI keys to `en.json` (baseline) | [`en.json`](apps/admin-next/src/i18n/en.json) |
| A2  | Add all `banners_*` UI keys to `zh.json`            | [`zh.json`](apps/admin-next/src/i18n/zh.json) |
| A3  | Add all `banners_*` UI keys to `ja.json`            | [`ja.json`](apps/admin-next/src/i18n/ja.json) |
| A4  | Add all `banners_*` UI keys to `ko.json`            | [`ko.json`](apps/admin-next/src/i18n/ko.json) |
| A5  | Add all `banners_*` UI keys to `fr.json`            | [`fr.json`](apps/admin-next/src/i18n/fr.json) |
| A6  | Add all `banners_*` UI keys to `de.json`            | [`de.json`](apps/admin-next/src/i18n/de.json) |

### Phase B: BannerManagementClient.tsx i18n

| #   | Step                                                                             | Files                                                                                             |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| B1  | Add `useTranslation` import + `const { t } = useTranslation()`                   | [`BannerManagementClient.tsx`](apps/admin-next/src/components/banners/BannerManagementClient.tsx) |
| B2  | Replace PageHeader hardcoded strings with `t('banners_xxx')`                     | Same file                                                                                         |
| B3  | Replace SchemaSearchForm label/placeholder strings with `t('banners_xxx')`       | Same file                                                                                         |
| B4  | Replace table column header strings with `t('banners_xxx')`                      | Same file                                                                                         |
| B5  | Replace modal open title/confirm strings with `t('banners_xxx')`                 | Same file                                                                                         |
| B6  | Replace toast messages with `t('banners_xxx')`                                   | Same file                                                                                         |
| B7  | Replace table cell values (Video, Active/Disabled, etc.) with `t('banners_xxx')` | Same file                                                                                         |

### Phase C: BannerFormModal.tsx i18n

| #   | Step                                                           | Files                                                                         |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| C1  | Add `useTranslation` import + `const { t } = useTranslation()` | [`BannerFormModal.tsx`](apps/admin-next/src/views/banner/BannerFormModal.tsx) |
| C2  | Replace form field labels/placeholders with `t('banners_xxx')` | Same file                                                                     |
| C3  | Replace select option labels with `t('banners_xxx')`           | Same file                                                                     |
| C4  | Replace click action section strings with `t('banners_xxx')`   | Same file                                                                     |
| C5  | Replace button text with `t('banners_xxx')`                    | Same file                                                                     |
| C6  | Replace toast message with `t('banners_xxx')`                  | Same file                                                                     |

### Phase D: BannerBindProduct.tsx i18n

| #   | Step                                                           | Files                                                                             |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| D1  | Add `useTranslation` import + `const { t } = useTranslation()` | [`BannerBindProduct.tsx`](apps/admin-next/src/views/banner/BannerBindProduct.tsx) |
| D2  | Replace table column headers with `t('banners_xxx')`           | Same file                                                                         |
| D3  | Replace search placeholder with `t('banners_xxx')`             | Same file                                                                         |
| D4  | Replace pagination text with `t('banners_xxx')`                | Same file                                                                         |

### Phase E: Zod Validation i18n

| #   | Step                                                                                             | Files                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Replace hardcoded Zod messages in `BannerShema` with i18n key references                         | [`bannerShema.ts`](apps/admin-next/src/schema/bannerShema.ts)                                                                                     |
| E2  | Add `banners_validation_*` keys to all 6 locale files                                            | All 6 locale files                                                                                                                                |
| E3  | Integrate with `zodErrorMap` (if already created from categories work) or create inline solution | [`zodErrorMap.ts`](apps/admin-next/src/lib/utils/zodErrorMap.ts) or [`BannerFormModal.tsx`](apps/admin-next/src/views/banner/BannerFormModal.tsx) |

### Phase F: Verification

| #   | Step                                                           | Files              |
| --- | -------------------------------------------------------------- | ------------------ |
| F1  | Verify no hardcoded strings remain in all 3 files              | All 3 banner files |
| F2  | Verify all new keys exist in all 6 locale files                | All 6 locale files |
| F3  | Run type-check + lint + prettier                               | —                  |
| F4  | Test form validation messages display correctly in all locales | —                  |

---

## 6. Architecture Notes

### 6.1 Shared Components Already i18n'd

- [`BaseTable.tsx`](apps/admin-next/src/components/scaffold/BaseTable.tsx) — Already uses `t('common_noData')` ✅
- [`Pagination.tsx`](apps/admin-next/src/components/scaffold/Pagination.tsx) — Already i18n'd ✅
- [`PageHeader.tsx`](apps/admin-next/src/components/scaffold/PageHeader.tsx) — Accepts strings as props, no changes needed ✅
- [`SchemaSearchForm.tsx`](apps/admin-next/src/components/scaffold/SchemaSearchForm.tsx) — Accepts `label`/`placeholder` as props, no changes needed ✅

### 6.2 Zod Validation Approach

The [`BannerShema`](apps/admin-next/src/schema/bannerShema.ts) has 2 hardcoded messages. If the `zodErrorMap.ts` utility is already created from the categories i18n work, extend it to include `banners_validation_*` keys. Otherwise, use the same approach: replace messages with i18n keys and translate via `z.setErrorMap()`.

### 6.3 Sidebar Navigation

The route config at [`routes/index.ts`](apps/admin-next/src/routes/index.ts:60) uses `name: 'banners'` which maps to the existing `"banners"` key in all locale files. ✅ Already done.

---

## 7. Summary

| Item                                                           | Status             | Priority   |
| -------------------------------------------------------------- | ------------------ | ---------- |
| Sidebar "Banners" label                                        | ✅ Already done    | —          |
| `BaseTable` / `Pagination` / `PageHeader` / `SchemaSearchForm` | ✅ Already i18n'd  | —          |
| **`BannerManagementClient.tsx` UI i18n**                       | **❌ ~25 strings** | **High**   |
| **`BannerFormModal.tsx` UI i18n**                              | **❌ ~20 strings** | **High**   |
| **`BannerBindProduct.tsx` UI i18n**                            | **❌ ~7 strings**  | **Medium** |
| **`BannerShema` Zod validation messages**                      | **❌ 2 messages**  | **Medium** |
| **`banners_*` keys in all 6 locale files**                     | **❌ ~47 keys**    | **High**   |
| **`banners_validation_*` keys in all 6 locale files**          | **❌ 2 keys**      | **Medium** |
