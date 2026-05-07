# Fix Video Upload: `application/octet-stream` MIME Type Validation

## Problem

When uploading a video through the blog's Featured Image uploader, the browser sends the file with MIME type `application/octet-stream` instead of a proper video MIME type like `video/mp4`. The backend rejects it with:

```
Validation failed (current file type is application/octet-stream, expected type is /(jpg|jpeg|png|gif|webp|mp4|avi|mov|mkv|webm)$/i)
```

## Root Causes

1. **`FileTypeValidator` in `ParseFilePipe`** checks `file.mimetype` against a regex. `application/octet-stream` doesn't match any of the allowed patterns.

2. **Folder routing logic** (`file.mimetype.startsWith('video/')`) would also fail for `application/octet-stream`, routing video files to the `images` folder (20MB limit) instead of `videos` (200MB limit).

## Fix

**Single file change**: `apps/api/src/common/upload/upload.controller.ts`

### Step 1: Remove `FileTypeValidator` from `ParseFilePipe`

Relax the `ParseFilePipe` by removing its validators array. The validation will move to the method body alongside the existing size validation.

### Step 2: Add file extension validation in method body

Check `file.originalname` for allowed extensions instead of checking `file.mimetype`. This is more reliable because:
- File extensions are part of the filename and can't be faked by the browser's MIME type detection
- Works regardless of what MIME type the browser sends
- Still prevents uploading arbitrary file types

### Step 3: Fix folder routing for `application/octet-stream`

Update the `isVideo` determination to also check file extension as a fallback when the MIME type is `application/octet-stream` or doesn't start with `video/`.

## No Frontend Changes Needed

The previous fixes (prop passthrough in `FormMediaUploaderField.tsx` and `maxFileSizeMB={200}` in `ArticleForm.tsx`) are already in place.

## Verification

1. Upload a video through the Featured Image uploader - should succeed
2. Upload an image through the Featured Image uploader - should still work
3. Upload a video through the RichTextEditor video handler - should still work
4. Upload an unsupported file type (e.g., `.exe`, `.pdf`) - should be rejected
