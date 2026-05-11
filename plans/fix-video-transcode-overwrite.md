# Fix: Video Transcode Output Path Overwrite

## Root Cause

Two functions use `articleId` alone in the R2 output path:

1. `transcodeVideoToHls(buffer, articleId)` → `uploads/blog/videos/${articleId}/hls/`
2. `extractVideoThumbnail(buffer, articleId)` → `uploads/blog/videos/${articleId}/poster.jpg`

When two content videos for the same article are transcoded, the second job **overwrites** the first job's HLS files and poster in R2. Both `contentVideo[]` entries then point to the same URL.

## Fix

Add `videoKey` parameter to both functions. Extract the unique filename (UUID) from the video key and include it in the output path.

### Example

- Video key: `uploads/blog/cmogfg5hu00008ogahj6ru3qd/3eef1dea-ee8e-4b4c-be67-f20a8e60d354.mp4`
- Extracted unique ID: `3eef1dea-ee8e-4b4c-be67-f20a8e60d354`
- New HLS path: `uploads/blog/videos/${articleId}/3eef1dea-ee8e-4b4c-be67-f20a8e60d354/hls/master.m3u8`
- New poster path: `uploads/blog/videos/${articleId}/3eef1dea-ee8e-4b4c-be67-f20a8e60d354/poster.jpg`

This ensures each video gets its own directory. The cover video (`meta.video`) also benefits since it uses the same `transcodeVideoToHls` function.

## Changes Required

### File 1: `apps/api/src/common/media/media-processor.service.ts`

**`transcodeVideoToHls`** — add `videoKey` param, use unique ID in path
```typescript
// Before:
async transcodeVideoToHls(buffer: Buffer, articleId: string): Promise<VideoVariants>
// ...
const hlsFolder = `uploads/blog/videos/${articleId}/hls`;

// After:
async transcodeVideoToHls(buffer: Buffer, articleId: string, videoKey: string): Promise<VideoVariants>
// ...
const videoId = videoKey.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'unknown';
const hlsFolder = `uploads/blog/videos/${articleId}/${videoId}/hls`;
```

**`extractVideoThumbnail`** — add `videoKey` param, use unique ID in path
```typescript
// Before:
async extractVideoThumbnail(buffer: Buffer, articleId: string): Promise<...>
// ...
const jpgKey = `uploads/blog/videos/${articleId}/poster.jpg`;
const webpKey = `uploads/blog/videos/${articleId}/poster.webp`;

// After:
async extractVideoThumbnail(buffer: Buffer, articleId: string, videoKey: string): Promise<...>
// ...
const videoId = videoKey.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'unknown';
const jpgKey = `uploads/blog/videos/${articleId}/${videoId}/poster.jpg`;
const webpKey = `uploads/blog/videos/${articleId}/${videoId}/poster.webp`;
```

### File 2: `apps/api/src/common/media/media.processor.ts`

**`handleTranscodeVideo`** — pass `videoKey` to both functions
```typescript
// Before:
const videoVariants = await this.mediaProcessorService.transcodeVideoToHls(buffer, articleId);
posterUrl = await this.mediaProcessorService.extractVideoThumbnail(buffer, articleId);

// After:
const videoVariants = await this.mediaProcessorService.transcodeVideoToHls(buffer, articleId, videoKey);
posterUrl = await this.mediaProcessorService.extractVideoThumbnail(buffer, articleId, videoKey);
```

## Backward Compatibility

Existing cover videos already have HLS at `uploads/blog/videos/{articleId}/hls/`. Old `meta.video` entries still point there — they continue to work. New transcodes will use the new path with the unique ID.
