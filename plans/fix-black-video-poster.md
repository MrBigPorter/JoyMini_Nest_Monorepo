# Fix Black Video / Missing Poster — Refined Plan

## Status

| Item | Status |
|------|--------|
| P0: HlsVideoPlayer opacity-0 when overlay showing | ✅ Done |
| P1: ArticleMarkdown black flash fix | ✅ Done |
| Cloudflare 415 guard in getOptimizedImageUrl | ✅ Done |
| P2: page.client.tsx hero banner for video covers | ❌ REJECTED — needs revert |
| Content video missing poster in ArticleMarkdown | ❌ Needs fix |

---

## Fix A — REVERT page.client.tsx (current P2 fix is wrong)

**Files:** [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx:279)

**Current (WRONG) code** — lines 276-301:
```tsx
{article.coverImage && !isVideoUrl(article.coverImage) ? (
  // Show Image for static covers
) : article.coverImage && isVideoUrl(article.coverImage) && article.meta?.video?.poster ? (
  // WRONG: Shows meta.video.poster as hero banner — user says "不该出在这里"
  <Image src={article.meta.video.poster} ... />
) : null}
```

**User feedback:** "这个是item的封面，不该出在这里" — This is the item's cover, it shouldn't appear here.

**Root cause:** The detail page should NOT show a hero banner for video covers. Videos are only for list cards (ArticleCard on homepage). The detail page should show only non-video cover images.

**Fix:** Revert to original logic — only render banner when coverImage is NOT a video URL:
```tsx
{article.coverImage && !isVideoUrl(article.coverImage) ? (
  <Image ... />  // Static cover image only
) : null}
```

---

## Fix B — Content Video Missing Poster in ArticleMarkdown

**Files:** [`apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx)

**Symptom:** Content videos embedded in rich text show a dark gradient (`linear-gradient(135deg, #1e293b 0%, #0f172a 100%)`) instead of a poster/thumbnail.

**Root cause chain:**

1. Backend [`media.processor.ts`](apps/api/src/common/media/media.processor.ts:258-261) calls `extractVideoThumbnail()` — if it fails (non-fatal catch), `posterUrl` is `undefined`
2. Backend stores `poster: posterUrl?.jpg ?? null` ([line 330](apps/api/src/common/media/media.processor.ts:330)) — so `null` is persisted in DB
3. Frontend receives `meta.contentVideo[].poster: null` in ArticleMeta
4. **Path A** (ReactMarkdown [`video` component](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:631-633)):
   ```typescript
   const posterStr = matched?.poster || (typeof props.poster === 'string' ? props.poster : undefined);
   ```
   `matched?.poster` is `null` (falsy) → falls through → `props.poster` is undefined → `posterStr` is `undefined` → [`NativeVideoPlayer`](apps/frontend-blog/src/components/blog/NativeVideoPlayer.tsx:51-58) shows gradient

5. **Path B** (useEffect DOM overlay, [line 227](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:227)):
   ```typescript
   if (matched?.poster) {  // null is falsy!
       video.setAttribute('poster', matched.poster);  // never reached
   }
   ```
   Poster never set → `video.getAttribute('poster')` returns null → `poster` becomes `''` → fallback to gradient ([line 263-265](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:263-265))

**Fix B1 — Path A (ReactMarkdown video component):**
Change [`line 631-633`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:631-633):
```typescript
// Before:
const posterStr =
    matched?.poster ||
    (typeof props.poster === 'string' ? props.poster : undefined);

// After:
const posterStr =
    (matched?.poster != null ? matched.poster : undefined) ??
    (typeof props.poster === 'string' ? props.poster : undefined);
```

This properly distinguishes `null` (explicitly no poster) from `undefined` (no lookup result). When poster is null, we still pass `undefined` to NativeVideoPlayer which will show the gradient — correct behavior since there's genuinely no poster available.

**Fix B2 — Path B (useEffect DOM overlay):**
Change [`line 227`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:227):
```typescript
// Before:
if (matched?.poster) {
    video.setAttribute('poster', matched.poster);
}

// After:
if (matched?.poster != null) {
    video.setAttribute('poster', matched.poster);
}
```

This allows setting an empty string poster (though meaningless) but more importantly makes the intent clear: we only skip when there's genuinely no poster data. The actual fallback at line 234 `video.getAttribute('poster') || ''` handles the null case correctly already.

---

## Execution Order

1. **Revert page.client.tsx** (Fix A) — quick, safe change
2. **Fix ArticleMarkdown poster handling** (Fix B1 + B2) — also quick, safe change
3. **Type check** — run `yarn workspace @lucky/frontend-blog tsc --noEmit`
4. **Test scenarios**:
   - Homepage HlsVideoPlayer clickToPlay: should show poster + play overlay, video hidden until click
   - Detail page ArticleMarkdown content video with poster: should show poster
   - Detail page ArticleMarkdown content video without poster (null): should show gradient (acceptable)
   - Detail page ArticleMarkdown HLS video: should work with HlsVideoPlayer
   - Detail page hero: should NOT show banner for video covers
   - Detail page hero: should still show banner for static image covers
