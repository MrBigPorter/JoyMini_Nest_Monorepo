# Blog Form Excerpt Validation Fix - Implementation Plan

## Selected Approach: **方案 B**

1. Add `maxLength` prop to `FormTextareaField` with character counter
2. Increase excerpt limit in Zod schema from 500 → 1000
3. Pass `maxLength={1000}` to all excerpt fields

## Files to Modify

### 1. [`packages/ui/src/form/types/baseFieldType.ts`](../packages/ui/src/form/types/baseFieldType.ts)
- Add `maxLength?: number` to `BaseFieldProps` interface

### 2. [`packages/ui/src/form/FormTextareaField.tsx`](../packages/ui/src/form/FormTextareaField.tsx)
- Accept `maxLength` prop from BaseFieldProps
- After `FormMessage`, add a character counter showing `{current}/{max}`
- Counter color: normal (gray) → amber (>80%) → red (>100%)

### 3. [`apps/admin-blog/src/schema/blog.ts`](../apps/admin-blog/src/schema/blog.ts)
- Change line 14: `z.string().max(500, ...)` → `z.string().max(1000, ...)`

### 4. [`apps/admin-blog/src/views/blog/ArticleForm.tsx`](../apps/admin-blog/src/views/blog/ArticleForm.tsx)
- Add `maxLength={1000}` to the excerpt `FormTextareaField` (line 167-171)

### 5. [`apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx`](../apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx)
- Add `maxLength={1000}` to the excerpt field using `localize('excerpt')` (around line 221-225)

### 6. [`apps/admin-blog/src/views/blog/BlogArticleModal.tsx`](../apps/admin-blog/src/views/blog/BlogArticleModal.tsx)
- Check if excerpt field in modal also needs `maxLength={1000}`

## Implementation Order

1. `baseFieldType.ts` — add type
2. `FormTextareaField.tsx` — add char counter UI
3. `blog.ts` schema — increase limit to 1000
4. `ArticleForm.tsx` — pass maxLength to excerpt
5. `create/page.tsx` — pass maxLength to excerpt
6. `BlogArticleModal.tsx` — pass maxLength to excerpt (if applicable)
