# Remove Video Poster WebP Generation

## Background

The video poster thumbnail generation currently produces both JPEG and WebP variants. Since all media is served through Cloudflare CDN with `f=auto` format selection in [`getOptimizedImageUrl()`](apps/frontend-blog/src/lib/utils/cloudflareImageLoader.ts:28), Cloudflare automatically converts JPEG to WebP (or AVIF) based on browser support — making the backend WebP generation redundant.

## Scope

**Only video poster WebP** — image variants (`thumbnail.webp`, `medium.webp`, `large.webp`) remain unchanged.

## Files to Modify

### 1. Backend: Remove WebP generation from video thumbnail extraction

**File**: [`apps/api/src/common/media/media-processor.service.ts`](apps/api/src/common/media/media-processor.service.ts)

- **Method**: `extractVideoThumbnail()` (line 166)
- **Changes**:
  - Remove `webpKey` variable (line 200)
  - Remove the `sharp(posterBuffer).webp({ quality: 80 }).toBuffer()` block (lines 209-225)
  - Change return type from `Promise<{ jpg: string; webp: string }>` to `Promise<{ jpg: string }>` or simply `Promise<string>` (the JPEG URL)
  - Update return value to only return `{ jpg: baseUrl + '/poster.jpg' }` (line 228-231)

### 2. Backend: Remove posterWebp from meta storage

**File**: [`apps/api/src/common/media/media.processor.ts`](apps/api/src/common/media/media.processor.ts)

- **Location**: Lines 314-315 where `posterWebp: posterUrl?.webp` is stored in meta
- **Changes**:
  - In the cover image video update (line 315): remove `posterWebp: posterUrl?.webp`
  - Update the destructuring of `posterUrl` — currently expects `{ jpg, webp }`, update to just `{ jpg }`

### 3. Frontend: Remove posterWebp from type definition

**File**: [`apps/frontend-blog/src/lib/types/frontend-blog.ts`](apps/frontend-blog/src/lib/types/frontend-blog.ts)

- **Location**: Line 28
- **Changes**: Remove `posterWebp?: string;` property from `ArticleMeta.video`

### 4. Frontend: Simplify HlsVideoPlayer poster logic

**File**: [`apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx`](apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx)

- **Changes**:
  - Remove `posterWebp` prop from the interface
  - Change line 52 from `const rawPoster = posterWebp || poster;` to just `const rawPoster = poster;`
  - Remove `posterWebp` from component props destructuring or simply stop passing it

### 5. Frontend: Update HeroSection

**File**: [`apps/frontend-blog/src/components/blog/HeroSection.tsx`](apps/frontend-blog/src/components/blog/HeroSection.tsx)

- **Changes**:
  - Line 83: Remove `posterWebp={mainArticle.meta?.video?.posterWebp}`
  - Line 210: Remove `posterWebp={article.meta?.video?.posterWebp}`

### 6. Frontend: Update ArticleCard

**File**: [`apps/frontend-blog/src/components/blog/ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx)

- **Changes**:
  - Lines 199-203: Remove `posterWebp` prop passing to `HlsVideoPlayer`

### 7. Frontend: Clean up page.tsx

**File**: [`apps/frontend-blog/src/app/[locale]/page.tsx`](apps/frontend-blog/src/app/[locale]/page.tsx)

- **Changes**:
  - Line 73-74: Remove `firstVideoPosterWebp` variable
  - Remove any references to it in preload logic (check lines 89+)

## Verification

After changes, verify:
1. `yarn workspace @lucky/api lint` passes
2. `yarn workspace @lucky/frontend-blog lint` passes
3. `yarn workspace @lucky/frontend-blog typecheck` passes
4. No remaining references to `posterWebp` in the codebase

## Migration Note

Existing articles that already have `posterWebp` stored in their `meta.video` will retain the stale field in the JSON blob — this is harmless as the frontend will no longer reference it. No database migration needed.
