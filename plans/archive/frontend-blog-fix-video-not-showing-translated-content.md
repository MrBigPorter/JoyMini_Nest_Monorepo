# Fix: Video Not Showing in Translated Article ContentMd

## Root Cause

When an article is created via Quill Editor (admin-blog), the HTML content with `<video>` elements is stored in `article.content`. The `article.contentMd` field is `null` (Quill doesn't generate markdown).

When the auto-translation AI processes the article:

1. It translates the HTML content to markdown text for the target language
2. `<video>` tags are **lost** during AI translation (text-only processing)
3. `contentMdLocalized[locale]` = translated markdown text (no video)
4. `contentLocalized[locale]` = rendered HTML + video tags **appended at end**

At the frontend, [`page.client.tsx:292`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx:292):

```tsx
<ArticleMarkdown content={article.contentMd || article.content || ''} />
```

- For **Chinese** users: `contentMd` returns original HTML (from `contentMdLocalized.zh`) → video shows ✓
- For **other locales** (en, ja, ko, fr, de): `contentMd` returns AI-translated markdown (text only, no video) → video hidden ✗

## Solution

**Single-line change** in [`page.client.tsx:292`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx:292).

```diff
- content={article.contentMd || article.content || ''}
+ {/* When HTML content has video elements absent from markdown, prefer HTML path to preserve video visibility */}
+ content={article.content?.includes('<video') && !article.contentMd?.includes('<video')
+   ? article.content
+   : (article.contentMd || article.content || '')}
```

### Logic

- If `content` (HTML) has `<video>` AND `contentMd` (markdown) does NOT have `<video>` → prefer `content`
- Otherwise → existing behavior (`contentMd || content || ''`)

### Why This Works

| Scenario | contentMd | content | Result |
|----------|-----------|---------|--------|
| Source language (zh), has video | HTML with video (from `contentMdLocalized.zh`) | HTML with video at correct position | Either works |
| Other locale, translated, has video | Markdown (no video) | HTML + video at end | Prefers `content` → video shows |
| No video in article | Markdown or HTML (no video) | HTML (no video) | Existing behavior |
| Batch-imported article (markdown source) | Raw markdown (from import) | Rendered HTML | Existing behavior |

### Trade-off

- **Prism syntax highlighting** is only available in the markdown rendering path
- For articles with videos, switching to the HTML path loses Prism highlighting for code blocks
- However, Quill HTML already has code block CSS classes applied (`ql-syntax`), so visual appearance is preserved
- `ArticleMarkdown`'s HTML path already has hls.js DOM scanning for m3u8 videos (`useEffect` lines 127-190)

## Files Changed

1. [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx:292`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx:292) — Content selection logic

## Test Cases

1. **Article with video, Chinese locale**: Video shows at correct position ✓ (existing behavior)
2. **Article with video, English locale**: Video shows (appended at end of translated content)
3. **Article without video, any locale**: No change in behavior
4. **Article with multiple videos, any locale**: All videos show
5. **HLS video (m3u8)**: Still handled by ArticleMarkdown's HTML path DOM scanner
