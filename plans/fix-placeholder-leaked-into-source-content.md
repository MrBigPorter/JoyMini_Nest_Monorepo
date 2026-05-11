# Fix: Placeholder `⏸️VIDEO_0` Leaked into Source Content

## Problem

The article content shows `⏸️VIDEO_0` as literal text in the rendered page. This is a Unicode placeholder that was supposed to be restored to the original `<video>` HTML tag after translation, but it was saved into the database as-is.

## Root Cause

The placeholder leaked into `contentMdLocalized[zh]` (source language field) through this self-perpetuating corruption cycle:

1. A previous translation run saved `⏸️VIDEO_0` into `contentMdLocalized[zh]` because `restoreMediaPlaceholders` failed (likely `mediaMap` was empty at save time)
2. On subsequent runs, `sourceContent` (from `contentMdLocalized[zh]`) has `⏸️VIDEO_0` but no `<video>` tags
3. `extractMediaAndReplaceWithPlaceholders(sourceContent)` → count=0 (no media tags to extract)
4. Falls to `else` branch, tries `originalHtml` → may also have no media tags
5. `mediaMap` stays empty → `sourceMediaRestored = sourceContent` (still has placeholders)
6. Placeholders get saved back → corruption persists forever

## Fix: Two-Pronged Approach

### Fix 1: Backend — Restore placeholders in `mapArticleForFrontend` (safety net)

In [`frontend-blog.service.ts`](apps/api/src/blog/frontend/frontend-blog.service.ts:326), after getting `contentMd`, check if it has placeholders. If so, extract media from `content` (HTML) and restore them.

This is a safety net that fixes existing corrupted data at read time without requiring a database migration.

### Fix 2: Backend — Prevent future corruption in translation processor

In [`blog-ai.processor.ts`](apps/api/src/blog/processors/blog-ai.processor.ts:1158), when `sourceContent` has placeholders but no media tags, detect this and extract media from `originalHtml` to build the `mediaMap`. This ensures the source content can be properly restored.

## Detailed Changes

### Fix 1: [`frontend-blog.service.ts`](apps/api/src/blog/frontend/frontend-blog.service.ts:326)

In `mapArticleForFrontend`, after the existing video injection logic (line 401), add:

```typescript
// Safety net: if contentMd still has literal placeholders (⏸️VIDEO_N, 🖼️IMG_N),
// try to restore them from the HTML content. This handles data corruption where
// placeholders were saved into the database instead of being restored.
import { hasMediaPlaceholders, extractMediaAndReplaceWithPlaceholders, restoreMediaPlaceholders } from '../../utils/media-placeholder';

// After line 401 (end of video injection block):
if (result.contentMd && hasMediaPlaceholders(result.contentMd)) {
  // Try to extract media from HTML content to build a restoration map
  const htmlContent = result.content || '';
  const mediaResult = extractMediaAndReplaceWithPlaceholders(htmlContent);
  if (mediaResult.count > 0) {
    const restored = restoreMediaPlaceholders(result.contentMd, mediaResult.mediaMap);
    if (!hasMediaPlaceholders(restored)) {
      // All placeholders were successfully restored
      result.contentMd = restored;
    }
  }
}
```

### Fix 2: [`blog-ai.processor.ts`](apps/api/src/blog/processors/blog-ai.processor.ts:1158)

In the placeholder extraction section, after the first `extractMediaAndReplaceWithPlaceholders(sourceContent)` returns count=0, add a check for existing placeholders:

```typescript
let mediaResult = extractMediaAndReplaceWithPlaceholders(sourceContent);
if (mediaResult.count > 0) {
  // sourceContent had media tags → extract and replace with placeholders
  mediaMap = mediaResult.mediaMap;
  sourceContentForAi = mediaResult.text;
  // ... normalization ...
} else if (hasMediaPlaceholders(sourceContent)) {
  // sourceContent has LITERAL placeholders (from previous corruption).
  // Extract media from original HTML to build the restoration map,
  // then restore placeholders in sourceContent.
  this.logger.warn(
    `[DIAG] ⚠️ sourceContent 含有未还原的占位符！尝试从 originalHtml 提取媒体元素进行修复。`,
  );
  const originalHtml = ...; // (existing code)
  const htmlMediaResult = extractMediaAndReplaceWithPlaceholders(originalHtml);
  if (htmlMediaResult.count > 0) {
    mediaMap = htmlMediaResult.mediaMap;
    // Restore placeholders in sourceContent using the HTML media map
    sourceContentForAi = restoreMediaPlaceholders(sourceContent, mediaMap);
    this.logger.log(
      `[DIAG] 已从 originalHtml 提取 ${htmlMediaResult.count} 个媒体元素并修复 sourceContent 中的占位符`,
    );
  } else {
    // Can't restore — log warning and proceed with sourceContent as-is
    this.logger.warn(
      `[DIAG] ⚠️ originalHtml 中也未找到媒体元素，无法修复占位符`,
    );
    sourceContentForAi = sourceContent;
  }
} else {
  // First-time translation: extract from original HTML
  // ... existing code ...
}
```

## Files Modified

| File | Change |
|------|--------|
| [`apps/api/src/blog/frontend/frontend-blog.service.ts`](apps/api/src/blog/frontend/frontend-blog.service.ts) | Add placeholder safety net in `mapArticleForFrontend` |
| [`apps/api/src/blog/processors/blog-ai.processor.ts`](apps/api/src/blog/processors/blog-ai.processor.ts) | Add existing-placeholder detection in extraction logic |

## Verification

1. Type-check: `yarn workspace @lucky/api check-types`
2. Deploy and test with the Flutter MotionX article that shows `⏸️VIDEO_0`
3. The video should appear at its correct position in the article
