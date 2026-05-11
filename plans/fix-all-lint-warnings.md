# Plan: Fix All Lint Warnings Across Monorepo

## Overview

Fix all ESLint warnings across `@lucky/frontend-blog` and `@lucky/api` packages. The warnings fall into distinct categories that can be addressed systematically.

---

## Package 1: `@lucky/frontend-blog` (~90 warnings)

### ESLint Config (`.eslintrc.cjs`)

The current config enables these rules as `warn`:
- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/no-unused-vars`
- `@next/next/no-img-element`
- `react-hooks/exhaustive-deps` (inherited from `next/core-web-vitals`)
- `import/no-anonymous-default-export` (inherited from `next/core-web-vitals`)

### Category A: `@typescript-eslint/no-unused-vars` (~25 occurrences)

**Strategy**: Remove unused imports/variables, or prefix with `_` if intentionally unused.

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | [`page.client.tsx:4`](apps/frontend-blog/src/app/%5Blocale%5D/articles/%5Bslug%5D/page.client.tsx:4) | `getNavDirection` imported but unused | Remove unused import |
| 2 | [`page.client.tsx:159`](apps/frontend-blog/src/app/%5Blocale%5D/articles/%5Bslug%5D/page.client.tsx:159) | `formatDate` assigned but never used | Remove unused variable |
| 3 | [`Header.tsx:59`](apps/frontend-blog/src/components/Header.tsx:59) | `theme` assigned but never used | Remove or prefix with `_theme` |
| 4 | [`Header.tsx:118`](apps/frontend-blog/src/components/Header.tsx:118) | `handleSearchSubmit` assigned but never used | Remove or prefix with `_handleSearchSubmit` |
| 5 | [`ThemeProvider.tsx:30`](apps/frontend-blog/src/components/ThemeProvider.tsx:30) | `systemDark` assigned but never used | Remove unused variable |
| 6 | [`ProtectedRouteV2.tsx:31`](apps/frontend-blog/src/components/auth/ProtectedRouteV2.tsx:31) | `fallback` assigned but never used | Remove unused variable |
| 7 | [`ProtectedRouteV2.tsx:145`](apps/frontend-blog/src/components/auth/ProtectedRouteV2.tsx:145) | `platform` assigned but never used | Remove unused variable |
| 8 | [`ArticleCard.tsx:130`](apps/frontend-blog/src/components/blog/ArticleCard.tsx:130) | `isClient` assigned but never used | Remove unused variable |
| 9 | [`ArticleCard.tsx:136`](apps/frontend-blog/src/components/blog/ArticleCard.tsx:136) | `publishedDate` assigned but never used | Remove unused variable |
| 10 | [`ArticleMarkdown.tsx:590`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:590) | `props` defined but never used | Remove unused parameter |
| 11 | [`BookmarkButton.tsx:10`](apps/frontend-blog/src/components/blog/BookmarkButton.tsx:10) | `withLocale` imported but never used | Remove unused import |
| 12 | [`CommentList.tsx:7`](apps/frontend-blog/src/components/blog/CommentList.tsx:7) | `Heart` imported but never used | Remove unused import |
| 13 | [`CommentList.tsx:18`](apps/frontend-blog/src/components/blog/CommentList.tsx:18) | `Link` imported but never used | Remove unused import |
| 14 | [`CommentList.tsx:47`](apps/frontend-blog/src/components/blog/CommentList.tsx:47) | `user` assigned but never used | Remove unused variable |
| 15 | [`CommentList.tsx:329`](apps/frontend-blog/src/components/blog/CommentList.tsx:329) | `pageSize` assigned but never used | Remove unused variable |
| 16 | [`CommentList.tsx:336`](apps/frontend-blog/src/components/blog/CommentList.tsx:336) | `reload` assigned but never used | Remove unused variable |
| 17 | [`CommentList.tsx:344`](apps/frontend-blog/src/components/blog/CommentList.tsx:344) | `user`, `authLoading` assigned but never used | Remove unused variables |
| 18 | [`HeroSection.tsx:63`](apps/frontend-blog/src/components/blog/HeroSection.tsx:63) | `mainMediaIsVideo` assigned but never used | Remove unused variable |
| 19 | [`MobileSettingsContent.tsx:17`](apps/frontend-blog/src/components/mobile/MobileSettingsContent.tsx:17) | `Settings` imported but never used | Remove unused import |
| 20 | [`SearchModal.tsx:11`](apps/frontend-blog/src/components/search/SearchModal.tsx:11) | `SearchBar` imported but never used | Remove unused import |
| 21 | [`PageSkeleton.tsx:12`](apps/frontend-blog/src/components/ui/PageSkeleton.tsx:12) | `className` assigned but never used | Remove unused variable |
| 22 | [`useAvailableLocales.ts:5`](apps/frontend-blog/src/hooks/useAvailableLocales.ts:5) | `Locale` imported but never used | Remove unused import |
| 23 | [`BookmarkButton.tsx:45,55`](apps/frontend-blog/src/lib/components/BookmarkButton.tsx:45) | `showLoading`, `show` assigned but never used | Remove unused variables |
| 24 | [`SkeletonLoader.tsx:56`](apps/frontend-blog/src/lib/components/SkeletonLoader.tsx:56) | `spacing` assigned but never used | Remove unused variable |
| 25 | [`sync.ts:11`](apps/frontend-blog/src/lib/db/sync.ts:11) | `FrontendPaginatedResponse` imported but never used | Remove unused import |
| 26 | [`fetcher.ts:15,17,18`](apps/frontend-blog/src/lib/fetcher.ts:15) | `isClient`, `isBuildTime`, `isRuntimeServer` imported but never used | Remove unused imports |
| 27 | [`useAuth.ts:3`](apps/frontend-blog/src/lib/hooks/useAuth.ts:3) | `LoginResponse` imported but never used | Remove unused import |
| 28 | [`useAuth.ts:300,304`](apps/frontend-blog/src/lib/hooks/useAuth.ts:300) | `role`, `permission` assigned but never used | Remove unused variables |
| 29 | [`useBookmarksInfiniteQuery.ts:6`](apps/frontend-blog/src/lib/hooks/useBookmarksInfiniteQuery.ts:6) | `BookmarkedArticle` imported but never used | Remove unused import |
| 30 | [`useBookmarksInfiniteQuery.ts:55`](apps/frontend-blog/src/lib/hooks/useBookmarksInfiniteQuery.ts:55) | `allPages` assigned but never used | Remove unused variable |
| 31 | [`useComments.ts:23`](apps/frontend-blog/src/lib/hooks/useComments.ts:23) | `isAuthenticated` assigned but never used | Remove unused variable |
| 32 | [`useFrontendArticles.ts:20`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts:20) | `FrontendTag` imported but never used | Remove unused import |
| 33 | [`commentStatus.ts:86`](apps/frontend-blog/src/lib/utils/commentStatus.ts:86) | `oldStatus` assigned but never used | Remove unused variable |
| 34 | [`navigation.ts:61`](apps/frontend-blog/src/lib/utils/navigation.ts:61) | `t` assigned but never used | Remove unused variable |
| 35 | [`oauth.ts:7`](apps/frontend-blog/src/lib/utils/oauth.ts:7) | `useAuthStore` imported but never used | Remove unused import |

### Category B: `@typescript-eslint/no-explicit-any` (~50 occurrences)

**Strategy**: Replace `any` with proper types. Where types are complex or from external libraries, use `unknown` + type narrowing, or define proper interfaces.

| # | File | Occurrences | Fix Strategy |
|---|------|-------------|--------------|
| 1 | [`page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/articles/%5Bslug%5D/page.client.tsx:49) | 2 `any` | Replace with proper types or `unknown` |
| 2 | [`layout.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/layout.tsx:183) | 1 `any` | Replace with proper type |
| 3 | [`login/page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/login/page.client.tsx:75) | 5 `any` | Replace with proper types |
| 4 | [`page.tsx`](apps/frontend-blog/src/app/page.tsx:45) | 1 `any` | Replace with proper type |
| 5 | [`ProtectedLink.tsx`](apps/frontend-blog/src/components/auth/ProtectedLink.tsx:61) | 1 `any` | Replace with proper type |
| 6 | [`ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx:137) | 1 `any` | Replace with proper type |
| 7 | [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:594) | 4 `any` | Replace with proper types |
| 8 | [`PwaComponents.tsx`](apps/frontend-blog/src/components/pwa/PwaComponents.tsx:64) | 1 `any` | Replace with proper type |
| 9 | [`badge.tsx`](apps/frontend-blog/src/components/ui/badge.tsx:7) | 1 `any` | Replace with proper type |
| 10 | [`frontendBlogApi.ts`](apps/frontend-blog/src/lib/api/frontendBlogApi.ts:229) | 2 `any` | Replace with proper types |
| 11 | [`GoogleOAuthProvider.tsx`](apps/frontend-blog/src/lib/components/GoogleOAuthProvider.tsx:31) | 2 `any` | Replace with proper types |
| 12 | [`fetcher.ts`](apps/frontend-blog/src/lib/fetcher.ts:27) | 7 `any` | Replace with generics or proper types |
| 13 | [`useAuth.ts`](apps/frontend-blog/src/lib/hooks/useAuth.ts:266) | 1 `any` | Replace with proper type |
| 14 | [`useBookmarks.ts`](apps/frontend-blog/src/lib/hooks/useBookmarks.ts:95) | 1 `any` | Replace with proper type |
| 15 | [`useBookmarksInfiniteQuery.ts`](apps/frontend-blog/src/lib/hooks/useBookmarksInfiniteQuery.ts:26) | 2 `any` | Replace with proper types |
| 16 | [`useCommentSSE.ts`](apps/frontend-blog/src/lib/hooks/useCommentSSE.ts:264) | 2 `any` | Replace with proper types |
| 17 | [`useComments.ts`](apps/frontend-blog/src/lib/hooks/useComments.ts:57) | 6 `any` | Replace with proper types |
| 18 | [`useCommentsAdapter.ts`](apps/frontend-blog/src/lib/hooks/useCommentsAdapter.ts:42) | 1 `any` | Replace with proper type |
| 19 | [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts:128) | 2 `any` | Replace with proper types |
| 20 | [`useIsClient.ts`](apps/frontend-blog/src/lib/hooks/useIsClient.ts:79) | 5 `any` | Replace with generics or `unknown` |
| 21 | [`useNetworkQuality.ts`](apps/frontend-blog/src/lib/hooks/useNetworkQuality.ts:124) | 2 `any` | Replace with proper types |
| 22 | [`I18nProvider.tsx`](apps/frontend-blog/src/lib/providers/I18nProvider.tsx:67) | 1 `any` | Replace with proper type |
| 23 | [`auth.store.ts`](apps/frontend-blog/src/lib/stores/auth.store.ts:65) | 1 `any` | Replace with proper type |
| 24 | [`autoReplyStatus.ts`](apps/frontend-blog/src/lib/utils/autoReplyStatus.ts:40) | 9 `any` | Replace with proper types |
| 25 | [`commentStatus.ts`](apps/frontend-blog/src/lib/utils/commentStatus.ts:301) | 2 `any` | Replace with proper types |
| 26 | [`cookie-manager.ts`](apps/frontend-blog/src/lib/utils/cookie-manager.ts:147) | 3 `any` | Replace with proper types |
| 27 | [`oauth.ts`](apps/frontend-blog/src/lib/utils/oauth.ts:22) | 6 `any` | Replace with proper types |
| 28 | [`worker.ts`](apps/frontend-blog/src/worker.ts:7) | 10 `any` | Replace with Cloudflare Workers types or `unknown` |

### Category C: `react-hooks/exhaustive-deps` (~6 occurrences)

**Strategy**: Add missing dependencies to useEffect/useCallback dependency arrays.

| # | File | Line | Issue | Fix |
|---|------|------|-------|-----|
| 1 | [`page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.client.tsx:247) | 247 | `useEffect` missing `setAllArticles` | Add `setAllArticles` to deps |
| 2 | [`page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.client.tsx:432) | 432 | `useCallback` missing `setPage` | Add `setPage` to deps |
| 3 | [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:531) | 531 | `useEffect` missing `meta.contentVideo` | Add `meta.contentVideo` to deps |
| 4 | [`InstallPrompt.tsx`](apps/frontend-blog/src/components/pwa/InstallPrompt.tsx:71) | 71 | `useEffect` missing `handleClose` | Add `handleClose` to deps |
| 5 | [`useIsClient.ts`](apps/frontend-blog/src/lib/hooks/useIsClient.ts:265) | 265 | `useEffect` non-array dependency list + missing `asyncFunction` | Fix dependency array syntax, add `asyncFunction` |

### Category D: `@next/next/no-img-element` (~6 occurrences)

**Strategy**: Replace `<img>` with `next/image` (`<Image />`) or add eslint-disable comment if `<img>` is intentional (e.g., dynamic external images).

| # | File | Line | Fix |
|---|------|------|-----|
| 1 | [`Header.tsx`](apps/frontend-blog/src/components/Header.tsx:206) | 206, 253, 369 | Replace with `<Image />` or add eslint-disable |
| 2 | [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:731) | 731 | Replace with `<Image />` or add eslint-disable |
| 3 | [`FeaturedProjects.tsx`](apps/frontend-blog/src/components/blog/FeaturedProjects.tsx:515) | 515 | Replace with `<Image />` or add eslint-disable |
| 4 | [`MobileSettingsContent.tsx`](apps/frontend-blog/src/components/mobile/MobileSettingsContent.tsx:115) | 115 | Replace with `<Image />` or add eslint-disable |

### Category E: `import/no-anonymous-default-export` (1 occurrence)

| # | File | Line | Fix |
|---|------|------|-----|
| 1 | [`worker.ts`](apps/frontend-blog/src/worker.ts:114) | 114 | Assign the default export to a named variable first |

---

## Package 2: `@lucky/api` (~15 warnings)

### ESLint Config (`eslint.config.mjs`)

The API config already disables most TypeScript strict rules. Remaining warnings are:
- `prettier/prettier` (formatting)
- `prefer-const`

### Category F: `prettier/prettier` (~13 formatting issues)

**Strategy**: Run `prettier --write` on affected files, or manually fix formatting.

| # | File | Issue |
|---|------|-------|
| 1 | [`blog.controller.ts:229`](apps/api/src/blog/blog.controller.ts:229) | Object property formatting |
| 2 | [`frontend-blog.service.ts:564,593,597`](apps/api/src/blog/frontend/frontend-blog.service.ts:564) | `prefer-const` + prettier formatting |
| 3 | [`blog-ai.processor.ts:132,1305,1488,1618,1624-1627,1644`](apps/api/src/blog/processors/blog-ai.processor.ts:132) | Multiple prettier + `prefer-const` issues |
| 4 | [`ai.service.ts:850,857`](apps/api/src/common/ai/ai.service.ts:850) | Prettier formatting |
| 5 | [`media-processor.service.ts:191,369`](apps/api/src/common/media/media-processor.service.ts:191) | Prettier formatting |
| 6 | [`media.processor.ts:246`](apps/api/src/common/media/media.processor.ts:246) | Prettier formatting |

### Category G: `prefer-const` (2 occurrences)

| # | File | Line | Fix |
|---|------|------|-----|
| 1 | [`frontend-blog.service.ts:564`](apps/api/src/blog/frontend/frontend-blog.service.ts:564) | `cleanedMd` never reassigned → use `const` |
| 2 | [`blog-ai.processor.ts:1305`](apps/api/src/blog/processors/blog-ai.processor.ts:1305) | `mediaResult` never reassigned → use `const` |

---

## Execution Order

The work should be done in this order to minimize context switching and maximize efficiency:

### Phase 1: `@lucky/api` (simpler, fewer files)

1. **Fix `prefer-const`** - 2 quick changes in 2 files
2. **Fix `prettier/prettier` formatting** - Run `prettier --write` on the 5 affected files, or manually fix

### Phase 2: `@lucky/frontend-blog` - Unused Variables

3. **Fix `no-unused-vars`** - Remove unused imports/variables across ~25 locations. This is mechanical and safe.

### Phase 3: `@lucky/frontend-blog` - React Hooks Dependencies

4. **Fix `react-hooks/exhaustive-deps`** - Add missing dependencies to 5 useEffect/useCallback calls. Requires careful review to avoid infinite loops.

### Phase 4: `@lucky/frontend-blog` - `no-explicit-any`

5. **Fix `no-explicit-any` in utility files** - `fetcher.ts`, `autoReplyStatus.ts`, `commentStatus.ts`, `cookie-manager.ts`, `oauth.ts`, `navigation.ts`
6. **Fix `no-explicit-any` in hooks** - `useAuth.ts`, `useBookmarks.ts`, `useBookmarksInfiniteQuery.ts`, `useCommentSSE.ts`, `useComments.ts`, `useCommentsAdapter.ts`, `useFrontendArticles.ts`, `useIsClient.ts`, `useNetworkQuality.ts`
7. **Fix `no-explicit-any` in components** - `ArticleMarkdown.tsx`, `ArticleCard.tsx`, `ProtectedLink.tsx`, `PwaComponents.tsx`, `badge.tsx`, `GoogleOAuthProvider.tsx`, `I18nProvider.tsx`, `auth.store.ts`
8. **Fix `no-explicit-any` in pages** - `page.client.tsx`, `layout.tsx`, `login/page.client.tsx`, `page.tsx`
9. **Fix `no-explicit-any` in worker.ts** - Replace with Cloudflare Workers types or `unknown`

### Phase 5: `@lucky/frontend-blog` - Remaining

10. **Fix `no-img-element`** - Replace `<img>` with `<Image />` or add eslint-disable comments
11. **Fix `import/no-anonymous-default-export`** in `worker.ts`

### Phase 6: Verification

12. **Run `yarn lint`** to verify all warnings are resolved
13. **Run type-check** to ensure no type errors introduced

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Removing a variable that's actually used | Runtime error | Check each removal carefully; look for usage in template/JSX |
| Adding missing deps causes infinite loop | Performance/broken UI | Test after each dep addition; use `useCallback` where needed |
| Replacing `any` with wrong type | Type errors | Use `unknown` when unsure; check API response shapes |
| Replacing `<img>` with `<Image />` | Layout shift | Ensure width/height props are correct |
| Prettier formatting changes | No functional impact | Low risk; auto-fixable |
