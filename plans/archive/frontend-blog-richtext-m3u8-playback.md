# Plan: M3U8/HLS Playback in Rich Text Content

## Problem
Articles written in the admin blog's Quill editor can embed videos via `Html5VideoBlot`. The produced HTML contains `<video>` elements. When rendered in the frontend blog's `ArticleMarkdown`, these `<video>` tags with `.m3u8` HLS streams only work in Safari (native HLS). Chrome/Firefox cannot play them.

## Root Cause
`ArticleMarkdown` renders HTML content via `dangerouslySetInnerHTML` and markdown content via `ReactMarkdown`. Neither path intercepts `<video>` elements with HLS sources to apply `hls.js` for cross-browser playback.

## Solution
Two content paths need modification in `ArticleMarkdown.tsx`:

### Path 1: HTML Content (via `dangerouslySetInnerHTML`) — Primary Path
The Quill editor produces HTML. We add a `useEffect` + `useRef` to:
1. After render, scan the container for `<video>` elements whose `src` or `<source>` child points to `.m3u8`
2. Use `hls.js` directly on those DOM `<video>` elements
3. Implement play coordination: when one video plays, pause others (via `CustomEvent('hls-video-play')`)
4. Cleanup on unmount

### Path 2: Markdown Content (via `ReactMarkdown`) — Secondary Path
Add a custom `video` component renderer:
- Detect if `src` ends with `.m3u8`
- If yes, render `<HlsVideoPlayer hlsUrl={src} />`
- If no, render native `<video>`

## Multi-Video Coordination
- Each hls.js-powered video dispatches `new CustomEvent('hls-video-play', { detail: { src } })` on play
- All videos listen for this event; if the source doesn't match their own, they pause
- This is compatible with `HlsVideoPlayer`'s existing coordination mechanism (already uses same event)

## Files to Modify
1. `apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx` — Core changes

## Implementation Steps
1. Add imports: `useRef`, `Hls` from `hls.js`
2. Add a ref to the article container in the HTML content path
3. Add `useEffect` to scan for m3u8 videos, init hls.js, set up play coordination
4. Add cleanup logic to destroy hls instances
5. Add custom `video` component renderer in the Markdown path

## Risk Assessment
- No new dependencies needed (`hls.js` already in project)
- No hydration mismatch: server renders native `<video>`, client upgrades to hls.js in `useEffect`
- The `useEffect` runs only on client, so SSR is unaffected
