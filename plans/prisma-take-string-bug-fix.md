# Fix: Prisma `take` Receiving String Instead of Integer

## Bug Description

When calling `GET /api/v1/frontend/blog/articles/:id/related?limit=5`, Prisma throws:

```
Argument `take`: Invalid value provided. Expected Int, provided String.
```

## Root Cause

In NestJS, `@Query()` parameters from HTTP query strings are always **strings** by default. The TypeScript type annotation `limit = 5` (default value) does **not** perform runtime type coercion. So when `?limit=5` is sent, the value arrives as the string `"5"`, which propagates through the call chain and reaches Prisma's `take` parameter, which strictly expects `Int`.

### Call Chain

1. **Controller** [`frontend-blog.controller.ts:118`](apps/api/src/blog/frontend/frontend-blog.controller.ts:118) — `@Query('limit') limit = 5` → receives `"5"` (string)
2. **FrontendService** [`frontend-blog.service.ts:257`](apps/api/src/blog/frontend/frontend-blog.service.ts:257) — passes through unchanged
3. **BlogService** [`blog.service.ts:1884`](apps/api/src/blog/frontend/frontend-blog.service.ts:1884) — `limit = 5` receives `"5"`, default doesn't coerce
4. **BlogService** [`blog.service.ts:1901`](apps/api/src/blog/frontend/frontend-blog.service.ts:1901) — `take: limit` → `take: "5"` → **Prisma error**

## Scope

This is a **systemic issue** affecting ALL numeric query parameters (`limit`, `page`, `pageSize`) across all blog controllers. Any endpoint that passes these values to Prisma `take`/`skip` would also fail.

### Affected Controllers

| Controller | Parameters | Lines |
|---|---|---|
| [`frontend-blog.controller.ts`](apps/api/src/blog/frontend/frontend-blog.controller.ts) | `page`, `pageSize`, `limit` (×3) | 48, 49, 103, 118, 150, 151, 191, 192, 216, 217, 249, 262, 263 |
| [`blog.controller.ts`](apps/api/src/blog/blog.controller.ts) | `page`, `pageSize` (×3) | 44, 45, 320, 321, 337, 338 |
| [`comment.controller.ts`](apps/api/src/blog/comment/comment.controller.ts) | `page`, `pageSize` | 36, 37 |
| [`tag.controller.ts`](apps/api/src/blog/tag/tag.controller.ts) | `limit` | 38 |
| [`bookmark.controller.ts`](apps/api/src/blog/frontend/bookmark.controller.ts) | `page`, `pageSize` | 47, 48 |

## Fix Strategy

Add `ParseIntPipe` to each numeric `@Query()` parameter in the affected controllers. This is **consistent with existing patterns** in the codebase:

- [`chat.controller.ts:75`](apps/api/src/common/chat/chat.controller.ts:75): `@Query('page', new ParseIntPipe({ optional: true })) page: number = 1`
- [`payment-channel.controller.ts:64-67`](apps/api/src/client/payment-channel/payment-channel.controller.ts:64): Uses `ParseIntPipe` on query params
- [`category.controller.ts`](apps/api/src/admin/category/category.controller.ts): Uses `ParseIntPipe` on param IDs

### Fix Pattern

```typescript
// Before:
@Query('limit') limit = 5

// After:
@Query('limit', new ParseIntPipe({ optional: true })) limit = 5
```

The `{ optional: true }` option ensures the pipe doesn't throw when the parameter is omitted (default value is used instead).

## Files to Modify

1. [`apps/api/src/blog/frontend/frontend-blog.controller.ts`](apps/api/src/blog/frontend/frontend-blog.controller.ts) — All `page`, `pageSize`, `limit` query params
2. [`apps/api/src/blog/blog.controller.ts`](apps/api/src/blog/blog.controller.ts) — All `page`, `pageSize` query params
3. [`apps/api/src/blog/comment/comment.controller.ts`](apps/api/src/blog/comment/comment.controller.ts) — All `page`, `pageSize` query params
4. [`apps/api/src/blog/tag/tag.controller.ts`](apps/api/src/blog/tag/tag.controller.ts) — `limit` query param
5. [`apps/api/src/blog/frontend/bookmark.controller.ts`](apps/api/src/blog/frontend/bookmark.controller.ts) — All `page`, `pageSize` query params

## Verification

1. Run TypeScript compilation: `yarn workspace @lucky/api tsc --noEmit` (or similar)
2. Test the failing endpoint: `GET /api/v1/frontend/blog/articles/:id/related?limit=5`
3. Test other paginated blog endpoints
