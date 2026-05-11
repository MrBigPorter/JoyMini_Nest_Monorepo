# Fix: Content Videos Show as MP4 Instead of HLS + Missing Video

## Bug Summary

After the transcode-overwrite fix (unique paths per video), two regressions appeared:

### Bug A: Videos play as raw MP4, not HLS

**Reported in**: `en/articles/reactive-forms-code-generation/` — both videos show but play as MP4.

**Root cause**: The frontend [`ArticleMarkdown`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:636) matches `<video src>` against `meta.contentVideo[]` using:

```typescript
const matched = meta?.contentVideo?.find((entry) =>
  srcStr.includes(entry.videoKey),
);
```

When this matching fails (e.g., URL format mismatch, query params, case sensitivity), no HLS entry is found. The component falls through to native `<video>` playback with the original mp4 URL.

**Real root cause**: The backend [`injectVideosIntoMarkdown()`](apps/api/src/blog/frontend/frontend-blog.service.ts:540) injects RAW `<video src="mp4_url">` blocks from Quill HTML into `contentMd`. It relies entirely on the frontend's runtime lookup of `meta.contentVideo[]` to replace mp4 with HLS at render time. This is fragile.

**Fix**: In the backend, replace `<video src="mp4_url">` with `<video src="hls_url">` AT INJECTION TIME by looking up `meta.contentVideo[]` entries. This makes the content self-contained — the frontend receives content with HLS URLs directly.

### Bug B: Only 1 of 2 content videos shows

**Reported in**: `zh/articles/platform-adapter-conditional-export/` — two videos uploaded in rich text, but only one displays.

**Likely root cause**: [`injectVideosIntoMarkdown()`](apps/api/src/blog/frontend/frontend-blog.service.ts:540) matches each video to a preceding heading in the HTML, then finds the corresponding markdown heading. If heading matching fails for one video (e.g., heading text mismatch between HTML and markdown), the video is appended at beginning or end based on position. It may still show but be at an unexpected position.

**Fix**: Add debug logging for heading matching to identify which specific video fails. The heading matching logic uses [`textSimilar()`](apps/api/src/blog/frontend/frontend-blog.service.ts:662) which may be too strict.

---

## Plan

### Phase 1: Backend — Replace mp4 → HLS in `injectVideosIntoMarkdown`

#### Step 1.1: Add `contentVideo` parameter to `injectVideosIntoMarkdown`

**File**: [`apps/api/src/blog/frontend/frontend-blog.service.ts`](apps/api/src/blog/frontend/frontend-blog.service.ts:540)

Change signature from:
```typescript
private injectVideosIntoMarkdown(contentMd: string, contentHtml: string): string
```
to:
```typescript
private injectVideosIntoMarkdown(
  contentMd: string,
  contentHtml: string,
  contentVideo?: Array<{ videoKey: string; hlsUrl: string; poster?: string | null }>,
): string
```

#### Step 1.2: Replace mp4 src with HLS src in injected blocks

After extracting video blocks from Quill HTML (line 558-560), add a replacement step:

```typescript
// Replace mp4 URLs with HLS URLs from contentVideo[]
if (contentVideo?.length) {
  for (let i = 0; i < videos.length; i++) {
    const block = videos[i].block;
    const srcMatch = block.match(/src="([^"]+)"/);
    if (srcMatch) {
      const srcUrl = srcMatch[1];
      try {
        const url = new URL(srcUrl);
        const videoKey = url.pathname.replace(/^\//, '');
        const entry = contentVideo.find((e) =>
          srcUrl.includes(e.videoKey) || videoKey.includes(e.videoKey),
        );
        if (entry?.hlsUrl) {
          const newBlock = block.replace(/src="([^"]+)"/, `src="${entry.hlsUrl}"`);
          // Also inject poster from contentVideo entry if available
          const finalBlock = entry.poster
            ? newBlock.replace(/<video\s/, `<video poster="${entry.poster}" `)
            : newBlock;
          videos[i] = { ...videos[i], block: finalBlock };
        }
      } catch {
        // Not a valid URL — skip
      }
    }
  }
}
```

#### Step 1.3: Pass `contentVideo` from caller

In [`mapArticleForFrontend()`](apps/api/src/blog/frontend/frontend-blog.service.ts:369):

```typescript
result.contentMd = this.injectVideosIntoMarkdown(
  baseMd,
  result.content,
  result.meta?.contentVideo,  // NEW: pass contentVideo entries
);
```

**Note on timing**: The transcode job runs asynchronously. On first save after upload, `contentVideo[]` may not have the new entries yet → videos play as MP4. On subsequent saves (after transcode completes), entries exist → HLS replacement works. This is acceptable.

---

### Phase 2: Frontend — Keep matching as fallback (belt-and-suspenders)

#### Step 2.1: The frontend matching in [`ArticleMarkdown`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:636) should remain as-is

Even with backend replacement, the ReactMarkdown `video` component's matching and the HTML path's `useEffect` matching provide a fallback in case the backend couldn't replace (e.g., transcode not yet complete).

#### Step 2.2: Fix the matching to be case-insensitive

Current matching:
```typescript
srcStr.includes(entry.videoKey)
```

Issue: extension case mismatch — `videoKey` might be `.MP4` (uppercase from original filename) while src URL has `.mp4` (lowercase). 

Fix: normalize both to lowercase:
```typescript
const matched = meta?.contentVideo?.find((entry) =>
  srcStr.toLowerCase().includes(entry.videoKey.toLowerCase()),
);
```

**Applies to both**:
- [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:639) — ReactMarkdown `video` component
- [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:216) — HTML path `useEffect`

---

### Phase 3: Debug "Only 1 of 2 videos shows" (zh article)

#### Step 3.1: Add logging to `injectVideosIntoMarkdown`

In the heading matching loop (line 598-610), log when a heading match succeeds or fails:

```typescript
logger.debug(`[video-inject] Video ${i}: heading="${lastHeading.text}" (H${lastHeading.level})`);
if (insertLineIndex >= 0) {
  logger.debug(`[video-inject] Matched to markdown line ${insertLineIndex}: "${mdLines[insertLineIndex]}"`);
} else {
  logger.warn(`[video-inject] NO heading match for video ${i}: "${lastHeading.text}" → position ${positionPercent.toFixed(1)}%`);
}
```

#### Step 3.2: Check if both videos are in the `zh` locale's contentLocalized

The [`scanRichTextVideos()`](apps/api/src/blog/blog.service.ts:736) scans ALL locale content. But [`injectVideosIntoMarkdown()`](apps/api/src/blog/frontend/frontend-blog.service.ts:540) only gets videos from the CURRENT locale's content (as returned by `getLocalizedString`). If one video was saved in `en` locale content, it won't appear in `zh`.

**Fix**: If this is the cause, the fix depends on desired behavior. Current behavior (videos per locale) is expected per user feedback.

---

### Phase 4: Update plan document

**File**: [`plans/fix-video-transcode-overwrite.md`](plans/fix-video-transcode-overwrite.md)

Update the plan to reflect the completed and remaining work.

---

## Execution Order

| # | Task | File(s) | Description |
|---|------|---------|-------------|
| 1 | Add `contentVideo` param to `injectVideosIntoMarkdown` | [`frontend-blog.service.ts`](apps/api/src/blog/frontend/frontend-blog.service.ts:540) | Pass `contentVideo[]` entries to the injection function |
| 2 | Replace mp4→HLS in injected blocks | [`frontend-blog.service.ts`](apps/api/src/blog/frontend/frontend-blog.service.ts:558) | For each video block, replace src URL with HLS URL if entry exists |
| 3 | Pass `contentVideo` from caller | [`frontend-blog.service.ts`](apps/api/src/blog/frontend/frontend-blog.service.ts:369) | Extract `meta.contentVideo` and pass to injection |
| 4 | Fix case-insensitive matching in frontend | [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:639) | `.toLowerCase()` on both sides of `includes()` |
| 5 | Fix case-insensitive matching in useEffect | [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:216) | Same fix for HTML rendering path |
| 6 | Add heading-match debug logging | [`frontend-blog.service.ts`](apps/api/src/blog/frontend/frontend-blog.service.ts:598) | Log success/failure for each video's heading match |
| 7 | TypeScript compile check | — | Run `yarn workspace @lucky/api typecheck` |
| 8 | Test zh article | — | Verify both videos show with HLS |
| 9 | Test en article | — | Verify both videos show with HLS |

---

## Mermaid Diagram: Data Flow After Fix

```mermaid
flowchart TD
    A[Article Saved] --> B[scanRichTextVideos]
    B --> C[Meta has contentVideo[]?]
    C -->|Yes| D[Transcode already complete]
    C -->|No| E[Enqueue transcode job]
    E --> F[Next save: contentVideo populated]
    
    D --> G[Frontend API request]
    F --> G
    
    G --> H[mapArticleForFrontend]
    H --> I[get localized content]
    I --> J[content has video tags?]
    J -->|Yes| K[injectVideosIntoMarkdown]
    J -->|No| L[No injection needed]
    
    K --> M[Extract video blocks from HTML]
    M --> N[Look up each mp4 URL in contentVideo[]]
    N --> O{Entry found with hlsUrl?}
    O -->|Yes| P[Replace src=mp4_url with src=hls_url]
    O -->|No| Q[Keep original mp4 URL]
    
    P --> R[Inject HLS-ready blocks into markdown]
    Q --> R
    
    R --> S[Frontend receives contentMd with HLS URLs]
    S --> T[ArticleMarkdown renders HlsVideoPlayer]
    
    style P fill:#c6efce,stroke:#2d7d46
    style Q fill:#ffeb9c,stroke:#bf8f00
```
