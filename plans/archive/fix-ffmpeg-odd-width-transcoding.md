# Fix ffmpeg HLS Transcoding — Odd Width / Aspect Ratio Bug

## Root Cause

The video source is **2242×1080** (≈2.076:1, wider than 16:9). The dimension computation in [`media-processor.service.ts:270-281`](../apps/api/src/common/media/media-processor.service.ts:270) calculates even dimensions correctly:

```
targetWidth=854  → evenWidth=854
computedHeight=411 → evenHeight=410
resolution = "854:410"
```

But the ffmpeg command at line 288 includes `force_original_aspect_ratio=decrease`:
```
-vf "scale=854:410:force_original_aspect_ratio=decrease"
```

This flag is **redundant** — the code already computes aspect-ratio-preserving dimensions. Moreover, `force_original_aspect_ratio=decrease` **overrides** the computed dimensions to perfectly match the source aspect ratio, producing non-even values:

```
Source: 2242×1080 → aspect ratio ≈ 2.076
Scale to fit within 854×410:
  - width=854 → height=411 (>410, doesn't fit)
  - height=410 → width=851 (ODD! H.264 requires even)
→ ERROR: "width not divisible by 2 (851x410)"
```

This also explains why the **1080p quality target** might have succeeded previously for some videos — the odd-width bug only manifests when `force_original_aspect_ratio=decrease` produces a non-even dimension, which depends on the source aspect ratio and target resolution.

## Fix

**File**: [`apps/api/src/common/media/media-processor.service.ts`](../apps/api/src/common/media/media-processor.service.ts)
**Line**: 288
**Change**: Remove `:force_original_aspect_ratio=decrease` from the scale filter.

```diff
- -vf "scale=${resolution}:force_original_aspect_ratio=decrease"
+ -vf "scale=${resolution}"
```

**Rationale**:
- The code at lines 270-281 already computes `evenWidth:evenHeight` that preserves the source aspect ratio
- The rounding error from `Math.round()` is at most ±1px in one dimension — visually negligible
- Even dimensions are guaranteed by the code's `% 2 === 0` check
- No need for extra `pad` filter or complex dimension calculations

## Verification

After the fix:
1. Upload a 2242×1080 (or any non-standard aspect ratio) video
2. Run the `transcodeVideoToHls` flow
3. All quality targets (480p, 720p, 1080p) should complete without `width not divisible by 2` errors
4. Verify the output HLS playable and aspect ratio is correct
