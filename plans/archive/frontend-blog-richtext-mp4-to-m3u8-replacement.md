# Plan: Replace mp4→m3u8 in Rich Text Content After Video Transcoding

## Problem

When a video is uploaded to a blog article's rich text content (via Quill editor), the backend's `MediaProcessor.handleTranscodeVideo()` transcodes it to HLS (m3u8) using ffmpeg. However:

1. The transcoded m3u8 URL is **only** stored in `article.meta.video.hlsUrl` — it's never written back into the article's HTML content.
2. The article's `content` (HTML string) still contains the original mp4 URL, so the frontend plays the raw mp4 instead of the transcoded HLS stream.
3. The `Html5VideoBlot` (Quill custom blot) doesn't recognize `.m3u8` extension for MIME type detection.

## Solution

### Change 1: Backend — Replace URL in article content after transcoding

**File**: `apps/api/src/common/media/media.processor.ts`

In `handleTranscodeVideo()`, after successfully updating article meta (line ~223), add logic to:

1. Reconstruct the original CDN URL from `videoKey`:  
   `const publicDomain = this.mediaProcessorService['getPublicDomain']();`  
   `const originalUrl = \`${publicDomain}/${videoKey}\`;`

2. Get the transcoded HLS URL from `videoVariants.hlsUrl`

3. Fetch the article's `content` and `contentLocalized`:
   ```ts
   const article = await this.prisma.blogArticle.findUnique({
     where: { id: articleId },
     select: { content: true, contentLocalized: true },
   });
   ```

4. Replace the original URL with HLS URL in both fields:
   - In `content` (string HTML): replace all occurrences of `originalUrl` with `hlsUrl`
   - In `contentLocalized` (JSON object): iterate values, replace all occurrences

5. Update the article record with the modified content

### Change 2: Frontend — Add m3u8 MIME type to Html5VideoBlot

**File**: `apps/admin-blog/src/components/blog/Html5VideoBlot.ts`

In the MIME type detection block (lines 55-60), add:
```ts
else if (ext === 'm3u8') mime = 'application/vnd.apple.mpegurl';
```

This ensures that when admin users re-open an article whose content has been updated with m3u8 URLs, Quill properly recognizes and renders the video element.

## Execution Order

1. Modify `apps/api/src/common/media/media.processor.ts` — After meta update, replace URLs in content
2. Modify `apps/admin-blog/src/components/blog/Html5VideoBlot.ts` — Add m3u8 MIME type

## Testing

- Upload a video to rich text content → verify transcoding completes
- Open article detail page → verify the video now loads as HLS (m3u8 segments)
- Check article content in database → verify original mp4 URL replaced with m3u8 URL
- Open article in admin editor → verify video element displays correctly
