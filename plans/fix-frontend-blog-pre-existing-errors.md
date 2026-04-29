# Fix Pre-existing TypeScript Errors in frontend-blog page.client.tsx

## Problem

[`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx) has 12 pre-existing TypeScript/ESLint errors, all unrelated to our CSDN-style rendering changes.

## Error Analysis

### 1. Missing UI components (TS2307) — 3 errors
- `@/components/ui/skeleton` — does not exist locally
- `@/components/ui/badge` — does not exist locally
- `@/components/ui/button` — does not exist locally

**Root cause**: These components exist in `packages/ui/src/components/ui/` but are NOT directly exported via the `@repo/ui` package index for the skeleton. Badge is exported via `packages/ui/src/components/index.ts`. Button is exported from `packages/ui/src/button.tsx`.

**Fix**: Create skeleton component locally, create badge component locally, and use Button from `@repo/ui`.

### 2. Wrong CommentList export (TS2614) — 1 error
- `Module '"@/components/blog/CommentList"' has no exported member 'CommentList'`

**Root cause**: [`CommentList.tsx`](apps/frontend-blog/src/components/blog/CommentList.tsx) uses `export default` not named export.

**Fix**: Change import from `{ CommentList }` to `CommentList` (default import).

### 3. Missing blog components (TS2307) — 3 errors
- `@/components/blog/LikeButton` — does not exist
- `@/components/blog/ShareButton` — does not exist
- `@/components/blog/ReadingProgress` — does not exist

**Root cause**: These components were never created or were removed. They're referenced in JSX but have no implementation.

**Fix**: Remove the imports and their JSX usage from the component.

### 4. BookmarkButton prop mismatch (TS2322) — 1 error
- `onBookmarkChange` does not exist on `BookmarkButtonProps`

**Root cause**: [`BookmarkButton`](apps/frontend-blog/src/components/blog/BookmarkButton.tsx:11-26) defines props as `{ articleId, size, variant, className, showText }` — no `onBookmarkChange` prop.

**Fix**: Remove the `onBookmarkChange` prop usage from the JSX.

### 5. Unused Button import (TS6133) — 1 error
- Button imported but never used (was used before the migration to local UI components)

**Fix**: Remove unused import.

### 6. Props mismatch (TS2322) — 2 errors
- `initialData`, `locale`, `slug` passed from [`page.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.tsx:135) but `ArticlePageClientProps` only defines `initialArticle`

**Root cause**: page.client.tsx accepts `initialArticle` but page.tsx passes `initialData`, `locale`, `slug`.

**Fix**: Sync the props — either update the interface or update the caller.

### 7. Implicit any (TS7006) — 1 error
- Parameter `bookmarked` implicitly has `any` type (in the `onBookmarkChange` callback that will be removed)

**Fix**: Resolved by removing the callback (error #4).

## Execution Plan

### Step 1: Create missing UI components
Create `apps/frontend-blog/src/components/ui/skeleton.tsx` — simple skeleton component using existing patterns.

### Step 2: Create missing badge component
Create `apps/frontend-blog/src/components/ui/badge.tsx` — simple badge component.

### Step 3: Use @repo/ui for Button instead of local
Change import from `@/components/ui/button` to `@repo/ui`.

### Step 4: Fix page.client.tsx
- Remove `{ CommentList }` → `CommentList` (default import)
- Remove LikeButton, ShareButton, ReadingProgress imports + JSX
- Remove onBookmarkChange prop from BookmarkButton
- Remove unused Button import
- Fix ArticlePageClientProps to match page.tsx call

### Step 5: Run type-check to verify
