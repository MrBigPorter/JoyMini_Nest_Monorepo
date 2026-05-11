# Fix: Newly Uploaded MP4 (No Poster, No HLS) Should Play Directly

## Background

When a video is first uploaded to the blog:
- It's stored as `uploads/blog/{articleId}/{filename}.MP4` (raw MP4)
- **No poster exists yet** — thumbnail extraction happens during HLS transcoding
- **No HLS (.m3u8) exists yet** — only produced after transcoding completes

So there are **3 states** for a content video in rich text:

| State | Has HLS? | Has Poster? | Current Behavior | Desired Behavior |
|-------|----------|-------------|-----------------|-----------------|
| **1. Newly uploaded** (MP4 only) | ❌ | ❌ | NativeVideoPlayer → dark gradient + play button → **black** | Render native `<video>` directly, browser shows first frame, user can play with native controls |
| **2. Transcoded** (HLS + poster) | ✅ | ✅ | HlsVideoPlayer → poster overlay + click-to-play → ✅ **works** | Same as current |
| **3. HLS ready, poster null** (thumb extraction failed) | ✅ | ❌ (`null`) | HlsVideoPlayer → dark gradient overlay + click-to-play → playable but no cover | Keep as-is (playable, acceptable fallback) |

## Changes Required

### File: `apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx`

#### Change A: ReactMarkdown `video` component (~line 665)

Currently, the non-HLS branch always renders `NativeVideoPlayer`:

```tsx
// For regular mp4 / non-HLS: click-to-play with poster overlay
const player = (
  <NativeVideoPlayer
    src={srcStr}
    poster={posterStr}
    className="w-full"
  />
);
```

**Change to** — use poster presence to decide:
- Has poster → `NativeVideoPlayer` (click-to-play with poster overlay) — unchanged
- No poster (state 1) → native `<video>` directly with `controls`, browser renders first frame

```tsx
if (posterStr) {
  // Has poster → click-to-play with poster overlay
  const player = (
    <NativeVideoPlayer
      src={srcStr}
      poster={posterStr}
      className="w-full"
    />
  );
  return isRawHtml ? player : <div className="article-media-wrapper">{player}</div>;
}

// No poster (newly uploaded MP4, not yet transcoded) → show native video directly
// Browser will render first frame as default poster, user can use native controls
const player = (
  <video
    src={srcStr}
    controls
    playsInline
    preload="metadata"
    className="w-full rounded-lg bg-black aspect-video"
  />
);
return isRawHtml ? player : <div className="article-media-wrapper">{player}</div>;
```

#### Change B: `useEffect` overlay path (~lines 203-206, and overlay creation)

Currently, the `forEach` callback ALWAYS:
1. Sets `video.style.opacity = '0'`
2. Creates overlay with poster or dark gradient

**Change to** — check if this video has HLS or poster before creating overlay:

```typescript
container.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
  // ... existing hlsUrl lookup (lines 208-233) ...
  
  // Get poster
  const poster = video.getAttribute('poster') || '';
  
  // --- NEW: Skip overlay for MP4-only videos with no poster ---
  // If no HLS and no poster, let the video play natively (state 1: newly uploaded)
  if (!hlsUrl.includes('.m3u8') && !poster) {
    video.style.opacity = '1';
    video.setAttribute('controls', '');
    video.setAttribute('preload', 'metadata');
    return; // skip overlay creation for this video
  }
  // --- END NEW ---
  
  // ... rest of existing overlay creation code ...
  video.style.opacity = '0';
  // ...
});
```

## Summary

| Change | File | Location | What |
|--------|------|----------|------|
| A | `ArticleMarkdown.tsx` | ReactMarkdown `video` component (`~line 665`) | If no HLS AND no poster → native `<video>` directly instead of `NativeVideoPlayer` |
| B | `ArticleMarkdown.tsx` | `useEffect` overlay path (`~line 234`) | If no HLS AND no poster → skip overlay, set `controls`, keep video visible |

## User Action After Fix

After this code change is deployed:
1. Go to admin panel, open the article with the content video
2. Save it (triggers `scanRichTextVideos` which now correctly detects the MP4 at `uploads/blog/{articleId}/{filename}.MP4`)
3. Wait for HLS transcoding to complete (poster + m3u8 will be generated)
4. Refresh the frontend — the page will now show:
   - **Before transcoding**: Native `<video>` with MP4, browser shows first frame
   - **After transcoding**: `contentVideo[]` has entry with HLS+poster → HlsVideoPlayer with poster overlay
