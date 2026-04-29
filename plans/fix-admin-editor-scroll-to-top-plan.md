# Fix: Admin Blog Editor "Can't Save" + "Scroll to Top" Bug

## Root Cause Analysis

After tracing the full form submission flow (`BlogArticleModal` → `useBlogForm` → `useRequest` → API), I identified **two interacting root causes**:

### Root Cause 1: Zod Validation Fails on Submit (Primary)

The `articleSchema` uses `localizedStringSchema(z.string().min(1, 'Content is required'))` for `content` and `title`.

[`localizedStringSchema`](packages/shared/src/types/localized-string.ts:37) produces:
```ts
z.union([
  z.record(z.union([valueSchema, z.undefined()])),  // e.g. { zh: "...", en: "..." }
  valueSchema.transform(...)                           // plain string → { zh: value, en: "" }
])
```

When submitting, the form data contains localized objects like `{ zh: "<p>content</p>", en: "" }`. The inner schema `z.string().min(1)` **rejects empty strings** (`""`). So if any locale has empty content (e.g., English locale not yet translated), **Zod validation fails**.

When RHF validation fails:
1. `handleSubmit` does NOT call the submit handler → **form doesn't save**
2. RHF tries to `focus()` the first field with an error
3. But the parent form's fields (`title`, `content`) are **localized objects stored in RHF, not directly rendered as DOM inputs** — they're managed through the child `ArticleForm` component which has its own separate `useForm` instance
4. RHF can't find the DOM element → **browser scrolls to top** as default behavior
5. No visible error toast because the error is on the parent form's invisible localized-object field

### Root Cause 2: `useRequest` `run` vs `runAsync` (Secondary)

[`updateArticle`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx:104) uses `useRequest` with `manual: true`. The `run` function from ahooks returns `Promise<T>`, but if the API call fails, the error might not propagate correctly through the `onSubmitAction` try/catch because `useRequest` internally handles errors before the Promise rejects.

### Root Cause 3: `setLocale` triggers `router.refresh()` (Scroll Contributor)

[`LanguageProvider.setLocale`](apps/admin-blog/src/hooks/LanguageProvider.tsx:57) calls `router.refresh()` which causes a full page re-render. If any code path inadvertently triggers a locale change during form submission (unlikely but worth checking), this would cause the scroll-to-top.

---

## Fix Plan

### Step 1: Add Console Logging for Debugging

Add strategic `console.log` statements to trace the submission flow:

**File: [`apps/admin-blog/src/views/blog/BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx:132)**
- Add log at the start of `onSubmitAction` showing the raw data
- Add log showing Zod validation result before submission
- Add log showing the API call and response

**File: [`apps/admin-blog/src/hooks/useBlogForm.ts`](apps/admin-blog/src/hooks/useBlogForm.ts:36)**
- Add log showing when `handleSubmit` is called
- Add log showing form errors if validation fails
- Add log showing when the submit handler is actually invoked vs skipped

### Step 2: Fix Zod Validation — Allow Empty Strings for Unused Locales

**File: [`packages/shared/src/types/localized-string.ts`](packages/shared/src/types/localized-string.ts:37)**

The `localizedStringSchema` needs to accept empty strings for locales that haven't been filled in yet. The fix: strip empty strings from the record before validation, or make the inner schema accept empty strings.

**Option A (Recommended):** Change the inner schema to accept empty strings by using `.or(z.literal(''))` or by filtering empty values before submit.

**Option B:** Create a pre-submit transform that strips empty locale values from the localized objects.

### Step 3: Fix `onSubmitAction` to Handle Validation Errors Gracefully

**File: [`apps/admin-blog/src/views/blog/BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx:132)**

In the `onSubmitAction`, add explicit validation of the localized content before calling the API. Strip empty locale values that would cause backend validation to fail.

### Step 4: Prevent Scroll-to-Top on Validation Failure

**File: [`apps/admin-blog/src/hooks/useBlogForm.ts`](apps/admin-blog/src/hooks/useBlogForm.ts:36)**

Override RHF's default `shouldFocusError` behavior by passing `shouldFocusError: false` to `useForm` options. This prevents RHF from trying to focus invisible fields and causing the scroll.

### Step 5: Add Error Toast for Validation Failures

**File: [`apps/admin-blog/src/hooks/useBlogForm.ts`](apps/admin-blog/src/hooks/useBlogForm.ts:36)**

When form validation fails (the `handleSubmit` callback is NOT called), show a toast with the validation error message so the user knows what went wrong.

---

## Detailed Implementation Steps

### 1. [`apps/admin-blog/src/hooks/useBlogForm.ts`](apps/admin-blog/src/hooks/useBlogForm.ts)

```typescript
// Change useForm options to add shouldFocusError: false
const form = useForm<z.infer<T>>({
  resolver: zodResolver(schema as any),
  defaultValues,
  shouldFocusError: false,  // ADD THIS - prevents scroll-to-top on validation failure
});

// Add logging for validation errors
const handleSubmit = useCallback(
  async (data: z.infer<T>) => {
    console.log('[BLOG_FORM] handleSubmit called with data:', data);
    // ... existing code
  },
  [onSubmitAction, addToast],
);

// Add a wrapper to catch validation errors and show toast
const submitHandler = form.handleSubmit(
  handleSubmit,
  (errors) => {
    // This callback is called when validation fails
    console.error('[BLOG_FORM] Validation errors:', errors);
    const firstError = Object.values(errors)[0];
    const message = firstError?.message || 'Form validation failed';
    addToast('error', String(message));
  },
);
```

### 2. [`apps/admin-blog/src/views/blog/BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx)

In `onSubmitAction`, add pre-processing to strip empty locale values:

```typescript
onSubmitAction: async (data: any) => {
  console.log('[BlogArticleModal] onSubmitAction called', {
    isEditing,
    editingArticleId: editingArticle?.id,
    dataKeys: Object.keys(data),
  });
  
  try {
    const processedData = { ...data };
    
    // Strip empty locale values from localized fields before submit
    const localizedFields = ['title', 'content', 'excerpt', 'featuredImage'];
    localizedFields.forEach((field) => {
      if (processedData[field] && typeof processedData[field] === 'object') {
        // Remove empty string values, keep undefined ones
        Object.keys(processedData[field]).forEach((locale) => {
          if (processedData[field][locale] === '') {
            delete processedData[field][locale];
          }
        });
      }
    });
    
    // ... rest of existing code
  } catch (error) {
    console.error('[BlogArticleModal] onSubmitAction error:', error);
    throw error;
  }
},
```

### 3. [`apps/admin-blog/src/views/blog/BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx)

Add `onError` handler to the `updateArticle` useRequest:

```typescript
const { run: updateArticle, loading: isUpdating } = useRequest(
  blogApi.updateArticle,
  {
    manual: true,
    onSuccess: () => {
      onSuccessAction();
      onCloseAction();
    },
    onError: (error) => {
      console.error('[BlogArticleModal] updateArticle failed:', error);
      addToast('error', t('updateFailed') || 'Failed to update article');
    },
  },
);
```

---

## Verification Steps

1. Open the admin blog editor for an existing article
2. Make changes to the content
3. Click "Update" button
4. Verify: form submits successfully, modal closes, article list refreshes
5. Verify: no scroll-to-top behavior
6. Test with only one locale filled (e.g., only Chinese, English empty)
7. Test creating a new article
8. Check browser console for any errors

---

## Files to Modify

| File | Changes |
|------|---------|
| [`apps/admin-blog/src/hooks/useBlogForm.ts`](apps/admin-blog/src/hooks/useBlogForm.ts) | Add `shouldFocusError: false`, add validation error toast, add logging |
| [`apps/admin-blog/src/views/blog/BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx) | Strip empty locale values before submit, add `onError` handler, add logging |
