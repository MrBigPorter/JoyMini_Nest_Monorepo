# 403 Error Handling Fix Plan

## Problem Analysis

The error flow for a 403 (Forbidden) response from the server:

```mermaid
sequenceDiagram
    participant User as User Click
    participant Page as CategoriesPage
    participant HTTP as http.ts
    participant API as Backend API

    User->>Page: Delete category
    Page->>HTTP: deleteCategory(id)
    HTTP->>API: DELETE /v1/admin/blog/categories/:id
    API-->>HTTP: 403 Forbidden
    Note over HTTP: Interceptor error handler fires
    HTTP->>HTTP: handleHttpError() → returns early for 403 (no toast, no console.error)
    HTTP-->>HTTP: Returns Promise.reject(error)
    HTTP-->>Page: Rejection propagates
    Page->>Page: onError fires → console.error(AxiosError) → Next.js dev overlay
    Page->>Page: addToast(error, 'deleteFailed')
```

## Current Issues

1. `handleHttpError` at line 257 in `http.ts` returns early for 403 — **no toast shown**
2. The error still propagates as a rejection — triggers page's `onError` → `console.error` → dev overlay
3. Previous fix attempt (returning `error.response`) caused `onSuccess` to fire with "Category deleted successfully"

## Fix Strategy

Two changes needed in `apps/admin-blog/src/api/http.ts`:

### Change 1: `handleHttpError` — show toast for 403

Current (line 254-257):
```typescript
if (status === 403) return;
```

Changed to:
```typescript
if (status === 403) {
    const msg = data?.message || 'Forbidden';
    this.toastError(msg);
    return;
}
```

This ensures a toast is shown for 403 errors.

### Change 2: Revert the interceptor change

Remove the 403 early-return logic from the interceptor error handler (lines 172-176) that was added in the previous attempt. The interceptor should continue to reject for 403, so `onError` fires in the calling code.

### Result Flow

```mermaid
sequenceDiagram
    participant User as User Click
    participant Page as CategoriesPage
    participant HTTP as http.ts
    participant API as Backend API

    User->>Page: Delete category
    Page->>HTTP: deleteCategory(id)
    HTTP->>API: DELETE /v1/admin/blog/categories/:id
    API-->>HTTP: 403 Forbidden
    Note over HTTP: Interceptor error handler fires
    HTTP->>HTTP: handleHttpError() → shows toast "Forbidden", no console.error
    HTTP-->>HTTP: Returns Promise.reject(error)
    HTTP-->>Page: Rejection propagates
    Note over Page: onError fires (console.error still logs, but toast already shown)
    Page->>Page: addToast(error, 'deleteFailed')
```

The user sees:
- ✅ Toast: "Forbidden" (from http.ts)
- ✅ Toast: "Delete failed" (from page's onError — acceptable)
- ❌ Console error still present (but this is the page's code, not http.ts)

## Next Steps

Switch to Code mode to apply the changes.
