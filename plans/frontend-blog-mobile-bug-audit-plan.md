# frontend-blog-mobile Bug Audit & Fix Plan

## Summary

Comprehensive audit of all ~60 source files in `../frontend-blog-mobile` found **15 bugs/issues**:
- **5 Critical** (will crash at runtime)
- **4 High** (broken navigation)
- **4 Medium** (features not working or inaccurate)
- **2 Low** (architecture/style)

---

## 🔴 Critical Bugs (will crash at runtime)

### Fix 1: TabBar component prop mismatch
**File**: [`RootNavigator.tsx:166`](../frontend-blog-mobile/src/navigation/RootNavigator.tsx:166)
**Problem**: `tabBar={props => <TabBar {...props} />}` passes `BottomTabBarProps` from React Navigation to `TabBar`, but `TabBar` expects `{tabs, activeTab, onTabPress}`. These are completely incompatible types, will cause render crash.
**Fix**: Re-integrate the custom `TabBar` to properly map React Navigation's bottom tab bar props to the `TabBar` component's expected props.

### Fix 2: Missing bookmarks API endpoint
**File**: [`src/api/endpoints/bookmarks.ts`](../frontend-blog-mobile/src/api/endpoints) (MISSING)
**Problem**: File doesn't exist. `bookmarksSlice.ts` uses raw `fetch` + `createAsyncThunk` instead of RTK Query pattern used by all other endpoints.
**Fix**: Create `bookmarks.ts` following the `injectEndpoints()` pattern from other endpoint files (articles.ts, categories.ts, tags.ts, comments.ts).

### Fix 3: i18n type error
**File**: [`lib/i18n/index.ts:31`](../frontend-blog-mobile/src/lib/i18n/index.ts:31)
**Problem**: `getEnabledLocales()` returns `Locale[]` (array of strings like `'en'`, `'zh'`), but code does `.map(l => l.code)` treating elements as objects with a `.code` property.
**Fix**: Either change `config.ts` to return object array with `code` property, or change `index.ts` to use `.map(l => l)`.

### Fix 4: `theme.dark` doesn't exist on ThemeContext
**File**: [`SettingsScreen.tsx:245,248,255`](../frontend-blog-mobile/src/screens/SettingsScreen.tsx:245)
**Problem**: `ThemeContext` exposes `mode` and `isDark`, not `dark`. References to `theme.dark` will return `undefined`, causing dark mode toggle to break.
**Fix**: Replace `theme.dark` with `theme.isDark`.

### Fix 5: Platform import at bottom of file
**File**: [`StatsScreen.tsx:286`](../frontend-blog-mobile/src/screens/StatsScreen.tsx:286)
**Problem**: `import { Platform } from 'react-native'` is placed after `export default`. Imports must be at file top.
**Fix**: Move the import to the top of the file alongside other imports.

---

## 🟠 Navigation Bugs (wrong screen destinations)

### Fix 6-9: Category/Tag presses navigate to wrong screen
**Files**:
- [`HomeScreen.tsx:120-126`](../frontend-blog-mobile/src/screens/HomeScreen.tsx:120) — `handleCategoryPress` navigates to `ArticleDetail` instead of `CategoryArticles`
- [`HomeScreen.tsx:309-313`](../frontend-blog-mobile/src/screens/HomeScreen.tsx:309) — Categories grid cards navigate to `ArticleDetail` instead of `CategoryArticles`
- [`CategoryListScreen.tsx:49-52`](../frontend-blog-mobile/src/screens/CategoryListScreen.tsx:49) — Category card press navigates to `ArticleDetail` instead of `CategoryArticles`
- [`TagListScreen.tsx:53-56`](../frontend-blog-mobile/src/screens/TagListScreen.tsx:53) — Tag press navigates to `ArticleDetail` instead of `TagArticles`

**Fix**: Update all navigation calls to use correct screen names and params:
- Category → `CategoryArticles` with `{ categorySlug, categoryName }`
- Tag → `TagArticles` with `{ tagSlug, tagName }`

---

## 🟡 Functional Bugs (features not working)

### Fix 10: Language switch is TODO
**File**: [`SettingsScreen.tsx:215-216`](../frontend-blog-mobile/src/screens/SettingsScreen.tsx:215)
**Problem**: `// TODO: Implement i18n language switch` — the language selection UI works but doesn't propagate to i18n.
**Fix**: Import and call `changeLanguage` from the i18n module when a language is selected.

### Fix 11: Hardcoded Accept-Language header
**File**: [`baseApi.ts:14`](../frontend-blog-mobile/src/api/baseApi.ts:14)
**Problem**: `'Accept-Language': 'en'` is hardcoded, ignoring the user's selected language.
**Fix**: Dynamically read the current language from i18n using `i18n.language`.

### Fix 12: Eye icon doesn't change on password visibility toggle
**File**: [`AuthScreen.tsx:354`](../frontend-blog-mobile/src/screens/AuthScreen.tsx:354)
**Problem**: `name={showPassword ? 'eye' : 'eye'}` — both states show the same `eye` icon.
**Fix**: Change to `name={showPassword ? 'eye' : 'eye-off'}`.

### Fix 13: Inaccurate stats aggregation
**File**: [`StatsScreen.tsx:65-66`](../frontend-blog-mobile/src/screens/StatsScreen.tsx:65)
**Problem**: Comments/Views/Likes stats derived from `useGetArticlesQuery({ page: 1, pageSize: 1 })` — only fetches 1 article, making aggregated stats worthless.
**Fix**: Increase pageSize to a large number (e.g., 1000) or use a dedicated stats endpoint.

---

## ⚪ Architecture/Low Priority

### Fix 14: Mixed API patterns
**Problem**: `authSlice.ts` and `bookmarksSlice.ts` use raw `fetch` + `createAsyncThunk` while all other endpoints use RTK Query's `injectEndpoints()`. Inconsistent patterns increase maintenance burden.
**Fix** (optional): Convert auth and bookmarks to use RTK Query mutations/queries.

### Fix 15: Inconsistent i18n defaults
**Problem**: `uiSlice.ts` default language is `'en'`, but i18n config default locale is `'zh'`.
**Fix**: Align defaults to a single source of truth.

---

## Execution Order

1. Fix 1 — TabBar prop mismatch (CRITICAL, blocks all navigation)
2. Fix 2 — Create bookmarks.ts endpoint (CRITICAL, missing file)
3. Fix 3 — Fix i18n type error (CRITICAL, blocks type-check)
4. Fix 4 — Fix SettingsScreen `theme.dark` (CRITICAL, runtime crash on theme toggle)
5. Fix 5 — Fix StatsScreen Platform import (CRITICAL, runtime crash)
6. Fix 6-9 — Fix all navigation targets (HIGH, broken UX)
7. Fix 10 — Implement language switch (MEDIUM, feature not working)
8. Fix 11 — Dynamic Accept-Language header (MEDIUM, i18n broken)
9. Fix 12 — Fix eye icon (MEDIUM, UI bug)
10. Fix 13 — Fix stats aggregation (MEDIUM, inaccurate data)
