# Plan: Simplify Blog Settings Page

## Problem

The blog Settings page currently has 3 tabs (copied from admin-next):
- **General Config** — Shows ALL system KV pairs (exchange rates, withdrawal limits, KYC, platform info, etc.)
- **Locale Settings** — Enable/disable languages
- **Translation Settings** — Source language & strategy

The "General Config" tab is inappropriate for blog because:
1. It exposes platform-level configs (exchange rates, KYC, finance) that blog admins shouldn't see/edit
2. It's confusing noise — blog admins only care about language & translation
3. The data is shared (same backend API), but the UI should be scoped

## Solution

**Remove the "General Config" tab entirely** from the blog Settings page. Keep only:

1. **Locale Settings** tab — Enable/disable blog languages
2. **Translation Settings** tab — Configure source language & strategy

## Files to Modify

### 1. `apps/admin-blog/src/components/settings/SettingsClient.tsx`

Remove:
- `CreateConfigForm` component (lines 73-188)
- `ConfigRow` component (lines 190-326)
- `CONFIG_META` constant (lines 25-68)
- `SystemConfigListResult` interface
- `general` tab from tab navigation
- `systemConfigApi.getAll`, `.create`, `.update`, `.delete` usage
- `Settings`, `RefreshCw`, `Edit2`, `X`, `Check`, `Plus`, `Trash2` icons (no longer needed)
- `useToastStore` import (no longer needed)
- `ModalManager` import (no longer needed)
- `SystemConfigItem` type import (no longer needed)

Keep:
- `LocaleSettingsContent` component
- `TranslationSettingsContent` component
- `Globe`, `Languages`, `AlertTriangle` icons
- `useAvailableLocales`, `useTranslation` hooks
- `systemConfigApi.getDefaultSourceLang`, `.updateDefaultSourceLang`, `.getLocales` usage
- `PageHeader` import

Simplify `SystemConfig` component to only have `locales` and `translation` tabs.

### 2. `apps/admin-blog/src/app/(dashboard)/settings/page.tsx`

No changes needed — it just renders `<SystemConfig />`.

### 3. `apps/admin-blog/src/app/(dashboard)/settings/locales/page.tsx`

No changes needed — it's already a standalone locale settings page.

## Result

The blog Settings page becomes a clean **Language & Translation Settings** page with:
- Tab 1: **Language Settings** — Enable/disable languages
- Tab 2: **Translation Settings** — Source language, strategy

No more irrelevant platform configs visible to blog admins.
