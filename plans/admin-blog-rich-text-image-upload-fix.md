# Plan: Fix Admin Blog Rich Text Image Upload

## Root Cause

Both image and video uploads use the **identical upload pipeline**:
1. [`uploadApi.uploadMedia()`](apps/admin-blog/src/api/index.ts:600) → POST `/v1/admin/upload/image`
2. [`UploadController.uploadMedia()`](apps/api/src/common/upload/upload.controller.ts:63) → validates file, uploads to R2
3. [`uploadService.uploadFile()`](apps/api/src/common/upload/upload.service.ts:373) → returns `{ url, key, originalName }`

Since video uploads work, the upload pipeline is **not the problem**.

### The Critical Difference — in [`RichTextEditor.tsx`](apps/admin-blog/src/components/blog/RichTextEditor.tsx)

| Aspect | Image Handler (line 148) | Video Handler (line 236) |
|--------|--------------------------|--------------------------|
| Upload | `onUploadAction(file, onProgress)` | `onUploadAction(file, onProgress)` |
| Insert | `quill.insertEmbed(index, 'image', url, 'user')` | `quill.insertEmbed(index, 'html5-video', url, 'user')` |
| **DOM check** | ❌ **Missing** | ✅ `afterHtml === beforeHtml` check (line 336) |
| **Fallback** | ❌ **Missing** | ✅ `dangerouslyPasteHTML` fallback (line 357) |
| onChange | `onChangeAction(content)` in setTimeout | `onChangeAction(content)` after DOM check |

The video handler specifically handles the case where `insertEmbed` silently fails (which can happen due to Quill blot registration issues, CDN URL restrictions, or configuration edge cases). The image handler needs the **same protection**.

## Implementation Plan

### Step 1: Add DOM-change fallback to `imageHandler`
**File**: [`apps/admin-blog/src/components/blog/RichTextEditor.tsx`](apps/admin-blog/src/components/blog/RichTextEditor.tsx)

- Before `insertEmbed`, capture `const beforeHtml = quill.root.innerHTML`
- After `insertEmbed` + `setSelection`, in the `setTimeout`:
  - Check `if (afterHtml === beforeHtml)` (DOM didn't change)
  - If so, fall back to: `quill.clipboard.dangerouslyPasteHTML(insertIndex, '<img src="url" class="max-w-full" />')`
  - Call `onChangeAction` with the actual content
  - Add debug logging for both cases

### Step 2: Fix `setIsUploading` race condition
**File**: [`apps/admin-blog/src/components/blog/RichTextEditor.tsx`](apps/admin-blog/src/components/blog/RichTextEditor.tsx)

- Move `setIsUploading(false)` **inside** the `setTimeout` callback, after `onChangeAction`
- This ensures the upload state persists until the content is fully synced

### Step 3: Add debug logging
- Add `console.debug` before and after the insertEmbed fallback check
- Log the URL being inserted and whether DOM changed

## Files to Modify

1. [`apps/admin-blog/src/components/blog/RichTextEditor.tsx`](apps/admin-blog/src/components/blog/RichTextEditor.tsx) — image handler logic fix

## Files NOT Modified (no changes needed)

- [`apps/admin-blog/src/api/index.ts`](apps/admin-blog/src/api/index.ts) — upload API is fine
- [`apps/admin-blog/src/api/http.ts`](apps/admin-blog/src/api/http.ts) — HTTP client is fine
- [`apps/api/src/common/upload/upload.controller.ts`](apps/api/src/common/upload/upload.controller.ts) — backend is fine
- [`apps/api/src/common/upload/upload.service.ts`](apps/api/src/common/upload/upload.service.ts) — upload service is fine
- [`apps/admin-blog/src/views/blog/ArticleForm.tsx`](apps/admin-blog/src/views/blog/ArticleForm.tsx) — form component is fine
- [`apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx) — create page is fine
- [`apps/admin-blog/src/views/blog/BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx) — modal is fine

## Verification

1. Build the admin-blog app: `yarn workspace @lucky/admin-blog build` (check for TS/type errors)
2. Run lint: `yarn workspace @lucky/admin-blog lint`
3. Start dev server and test:
   - Upload an image via the rich text editor
   - Verify the image appears in the editor
   - Save the article and verify the image persists on reload
   - Verify video upload still works
