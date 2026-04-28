# Comprehensive Plan: Fix All CI & Lint Errors

## Root Cause Analysis

### Two Separate Apps, Different States of Disrepair

| Aspect | `admin-next` | `admin-blog` |
|--------|-------------|-------------|
| Status | **Original app, many unfixed issues** | **Refactored app, partially fixed, new issues** |
| `t` wrapper pattern | All bare `const t = ...` → new fn every render | Some wrapped in `useCallback`, some not |
| `instrumentation.ts` | Wrong type (`Request` instead of custom type) | Already fixed with proper type |
| Prettier (quotes) | Uses single quotes ✓ (no errors) | Uses DOUBLE quotes ✗ (many Prettier errors) |
| CI result | **FAILS** (exit code 2 — TS error) | Has Prettier errors but TS type-check OK |

### Why So Many Errors in admin-next?

The PRIMARY root cause is the **`t` wrapper pattern** used in 11 different files:

```typescript
// ❌ BAD: Creates new function on EVERY render
const { t: globalT } = useTranslation();
const t = (key, params) => globalT(`namespace_${key}`, params);

// ✅ FIX: Wrap in useCallback
const t = useCallback(
  (key, params) => globalT(`namespace_${key}`, params),
  [globalT],
);
```

The `useTranslation()` hook's `t` is already memoized via `useCallback([tNext])`, but the **local wrapper** `const t = (key, params) => globalT(...)` is NOT. This causes 15+ separate warnings because every hook that references this unstable `t` triggers the `exhaustive-deps` rule.

### Why So Many Prettier Errors in admin-blog?

The `admin-blog` app was likely created/copied from templates that used double quotes (`"`), but the ESLint config enforces `singleQuote: true`. Files like `TranslationProgressCard.tsx`, `ArticleForm.tsx`, and `BlogArticleModal.tsx` all use double quotes, triggering Prettier errors on almost every line.

---

## Part 1: admin-next — 🔴 CRITICAL (blocks CI)

### 1.1 [`instrumentation.ts:110`](apps/admin-next/src/instrumentation.ts:110) — TS Error

**Error:** `Argument of type 'Request' is not assignable to parameter of type 'RequestInfo'`
  Property 'path' is missing in type 'Request' but required in type 'RequestInfo'.

**Why:** Next.js 15's `onRequestError` callback provides the native `Request` type from the Web API, but `@sentry/nextjs`'s `captureRequestError` expects a `RequestInfo` type that requires a `path` property. These are incompatible.

**Fix already exists in [`admin-blog/instrumentation.ts:65-80`](apps/admin-blog/src/instrumentation.ts:65-80):** Change the `request` parameter type from `Request` to a custom shape:

```typescript
// BEFORE (admin-next):
export async function onRequestError(
  error: Error,
  request: Request,                    // ❌ Wrong type
  context: { routerKind: string; routeType: string; routeKey: string },
)

// AFTER (match admin-blog's fix):
export async function onRequestError(
  error: unknown,
  request: {                           // ✅ Custom type with 'path'
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  },
  context: { routerKind: string; routePath: string; routeType: string },
)
```

---

### 1.2 admin-next — 22 exhaustive-deps warnings

#### Pattern: Wrap `t` in useCallback

The same fix applied to **8 files** where the `t` wrapper is bare:

**Fix for each:**
```typescript
// BEFORE:
const t = (key: string, params?: Record<string, string | number>) =>
  globalT(`namespace_${key}`, params);

// AFTER:
const t = useCallback(
  (key: string, params?: Record<string, string | number>) =>
    globalT(`namespace_${key}`, params),
  [globalT],
);
```

**Files requiring this fix:**

| # | File | Lines | Also needs: |
|---|------|-------|-------------|
| 1 | [`create/page.tsx`](apps/admin-next/src/app/(dashboard)/blog/articles/create/page.tsx:32) | 32-33 | Add `t` to useEffect dep `[addToast, t]` (line 154) |
| 2 | [`articles/page.tsx`](apps/admin-next/src/app/(dashboard)/blog/articles/page.tsx:71) | 71-72 | None — just wrap `t` |
| 3 | [`comments/page.tsx`](apps/admin-next/src/app/(dashboard)/blog/comments/page.tsx:42) | 42-43 | Also wrap `fetchComments`/`fetchArticles` in useCallback |
| 4 | [`blog/page.tsx`](apps/admin-next/src/app/(dashboard)/blog/page.tsx) | search | Also wrap `fetchDashboardData` in useCallback |
| 5 | [`AdminUserManagementClient.tsx`](apps/admin-next/src/components/admin-users/AdminUserManagementClient.tsx) | search | Add `t` to useCallback dep (line 174) + useMemo dep (line 347) |
| 6 | [`KycListClient.tsx`](apps/admin-next/src/components/kyc/KycListClient.tsx) | search | Add `t` to 3 useCallback deps (lines 92, 107, 123) |
| 7 | [`OperationLogListClient.tsx`](apps/admin-next/src/components/operation-logs/OperationLogListClient.tsx) | search | Add `t` to 2 useMemo deps (lines 252, 287) |
| 8 | [`BlogArticleModal.tsx`](apps/admin-next/src/views/blog/BlogArticleModal.tsx) | search | Add `t` to useEffect dep (line 88) + useMemo dep (line 506) |

#### Other dep fixes:

| # | File | Line | Fix |
|---|------|------|-----|
| 9 | [`articles/page.tsx`](apps/admin-next/src/app/(dashboard)/blog/articles/page.tsx) | 518 | Add `lang` to useCallback deps |
| 10 | [`tags/page.tsx`](apps/admin-next/src/app/(dashboard)/blog/tags/page.tsx) | 53 | Wrap `fetchTags` in useCallback, add to deps |
| 11 | [`OperationLogListClient.tsx`](apps/admin-next/src/components/operation-logs/OperationLogListClient.tsx) | 59 | Fix `hydrationInput` useMemo dep |

#### Intentional eslint-disable comments (3 places):

| # | File | Line | Reason |
|---|------|------|--------|
| 12 | [`RichTextEditor.tsx`](apps/admin-next/src/components/blog/RichTextEditor.tsx) | 115 | `value` dep intentionally excluded, ref prevents re-runs |
| 13 | [`RichTextEditor.tsx`](apps/admin-next/src/components/blog/RichTextEditor.tsx) | 230 | `onChange` intentionally excluded, adding it causes infinite loops |
| 14 | [`RichTextEditor.tsx`](apps/admin-next/src/components/blog/RichTextEditor.tsx) | 388 | Same as above |
| 15 | [`BlogCommentModal.tsx`](apps/admin-next/src/views/blog/BlogCommentModal.tsx) | 58 | `getDefaultValues` already in useCallback, false positive |

---

### 1.3 admin-next — `<img>` warnings (2)

| # | File | Line | Fix |
|---|------|------|-----|
| 16 | [`BlogArticleContent.tsx:270`](apps/admin-next/src/app/blog/articles/[slug]/BlogArticleContent.tsx:270) | 270 | Add `// eslint-disable-next-line @next/next/no-img-element` |
| 17 | [`SmartImage.tsx:91`](apps/admin-next/src/components/ui/SmartImage.tsx:91) | 91 | Add `// eslint-disable-next-line @next/next/no-img-element` |

---

## Part 2: admin-blog — 🟡 Prettier Formatting Errors

**Root cause:** Files use double quotes (`"use client"`, `"react"`, `"ahooks"`) but ESLint config enforces `singleQuote: true`.

**Affected files detected:**
- [`TranslationProgressCard.tsx`](apps/admin-blog/src/views/blog/components/TranslationProgressCard.tsx) — ALL strings use double quotes
- [`ArticleForm.tsx`](apps/admin-blog/src/views/blog/ArticleForm.tsx:62) — `t` wrapper not in useCallback
- [`BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx) — Uses double quotes throughout

**Fix:** Run Prettier on the entire admin-blog workspace:
```bash
yarn prettier --write "apps/admin-blog/src/**/*.{ts,tsx}"
```

This will auto-convert all `"` to `'` and fix any other formatting issues.

---

## Part 3: admin-blog — Remaining exhaustive-deps issues

**File [`ArticleForm.tsx`](apps/admin-blog/src/views/blog/ArticleForm.tsx:62):**
- Same pattern — `t` wrapper not wrapped in useCallback
- Fix: Wrap in `useCallback([globalT])`

---

## Execution Order

| Priority | Step | App | Change | Risk |
|----------|------|-----|--------|------|
| 🔴 P0 | Fix `instrumentation.ts` TS error | admin-next | Change type signature | LOW |
| 🟡 P1 | Wrap all `t` wrappers in `useCallback` (8 files) | admin-next | Standard pattern | LOW |
| 🟡 P1 | Add missing deps (comments, tags, etc.) | admin-next | Standard fix | LOW |
| 🟡 P1 | Add eslint-disable comments (5 places) | admin-next | Comments only | LOW |
| 🟢 P2 | Run `prettier --write` on admin-blog | admin-blog | Auto-format | LOW |
| 🟢 P2 | Fix ArticleForm.tsx t wrapper | admin-blog | useCallback | LOW |

## Verification

```bash
# admin-next
cd /Volumes/MySSD/work/JoyMini_Nest_Monorepo
yarn workspace @lucky/admin-next lint
yarn workspace @lucky/admin-next check-types

# admin-blog
yarn workspace @lucky/admin-blog lint
yarn workspace @lucky/admin-blog check-types
```
