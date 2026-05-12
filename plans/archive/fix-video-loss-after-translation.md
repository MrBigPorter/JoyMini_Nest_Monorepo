# Fix: Videos Disappear After AI Translation

## Bug Report
User says: "感觉被翻译后的文章视频消失了" — Videos disappear from translated articles after AI translation.

## Root Cause

### Primary Issue: Stale `article.content` for Video Extraction

In [`blog-ai.processor.ts:1272`](../apps/api/src/blog/processors/blog-ai.processor.ts:1272), the translation processor extracts `<video>` tags from `article.content`:

```typescript
const originalHtml = article.content || '';
```

However, if a user:
1. Creates an article (sets `article.content` = initial HTML, possibly without videos)
2. Later edits the article via Quill editor and adds videos (updates `contentLocalized['zh']`)
3. The `updateArticle` → `buildLocalizedData` updates BOTH `content` and `contentLocalized`
4. BUT — if the edit didn't include `dto.content` (e.g., only title changed), only `titleLocalized` is updated, not `content`

**More importantly**: The `article.content` field and `contentLocalized[sourceLang]` can diverge over time through different code paths (e.g., `clearArticleTranslationsForLocales` only touches localized fields, not `article.content`).

The translation processor already correctly reads `sourceContent` from `contentLocalized[sourceLang]` (lines 1104-1108), but the video tag extraction at line 1272 only reads from `article.content`. If the latest edits (including video additions) are in `contentLocalized[sourceLang]` but not reflected in `article.content`, the video tags are lost.

### Secondary Issue: Hardcoded 'zh' in Frontend Fallback

In [`frontend-blog.service.ts:502-505`](../apps/api/src/blog/frontend/frontend-blog.service.ts:502), the `getLocalizedString` fallback video injection uses hardcoded `'zh'`:

```typescript
const htmlSource =
  (entity['contentLocalized'] as any)?.['zh'] ||
  entity['content'] ||
  '';
```

This should use the configured `sourceLang` instead. But since sourceLang is always `'zh'` in this project, this is a robustness concern, not the immediate bug.

## Data Flow (Current)

```
Article Creation / Edit
  → dto.content = { zh: "Quill HTML with <video>..." }
  → buildLocalizedData → contentLocalized = { zh: "...", en: "..." }
                        → content = "Quill HTML with <video>..." (zh value)
  → updateArticle → translation queued

Translation Processor (processArticleTranslation)
  → prisma.blogArticle.findUnique({ id })
  → article.content = current DB value (may or may not have video tags)
  → sourceContent = contentLocalized[sourceLang] || article.content (HAS video tags)
  → preservedVideoTags extracted from article.content (MAY BE STALE)
  → Saves:
    contentMdLocalized[targetLang] = translatedText + '\n\n' + preservedVideoTags
    contentLocalized[targetLang] = renderedHtml + '\n' + preservedVideoTags
```

## Fix

### Fix 1: [`blog-ai.processor.ts:1272`](../apps/api/src/blog/processors/blog-ai.processor.ts:1272)

Change video tag extraction to also check `contentLocalized[sourceLang]`:

**Before:**
```typescript
const originalHtml = article.content || '';
```

**After:**
```typescript
const originalHtml =
  ((article as any).contentLocalized as any)?.[sourceLang] ||
  article.content ||
  '';
```

This ensures the latest edited content (including videos added via Quill after creation) is used for video tag extraction.

### Fix 2: [`frontend-blog.service.ts:502-505`](../apps/api/src/blog/frontend/frontend-blog.service.ts:502) (Optional, Robustness)

Change hardcoded `'zh'` to use `sourceLang` from config. However, this requires injecting the config service, which adds complexity. Since sourceLang is always `'zh'` currently, this is low priority.

## Verification

1. **TypeScript compile check**: `yarn workspace @lucky/api type-check`
2. **Scenario test**: 
   - Create article with videos in Quill editor
   - Translate to another language
   - Verify translated article frontend page shows videos
   - Clear translations, re-save, verify re-translated article still has videos

## Files Modified

| File | Change |
|------|--------|
| [`apps/api/src/blog/processors/blog-ai.processor.ts:1272`](../apps/api/src/blog/processors/blog-ai.processor.ts:1272) | Use `contentLocalized[sourceLang]` as primary source for video extraction, fall back to `article.content` |
