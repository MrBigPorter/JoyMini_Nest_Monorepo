# Plan: Make Cover Image Clickable in ArticleCard

## Problem

In the [`ArticleCard`](apps/frontend-blog/src/components/blog/ArticleCard.tsx) component, the cover image area (static images via `BlurhashImage`) is **not clickable** — clicking it does nothing. Only the title + excerpt + meta section (wrapped in a `<Link>`) navigates to the article detail page.

For **video** cover images, this is intentional (play button to play video inline). But for **static image** cover images, users expect clicking the image to navigate to the article detail.

## Current Structure

```
<div class="card">                           ← card wrapper
  <BookmarkIconButton />                     ← absolute, z-10

  <div class="cover-image-wrapper">          ← lines 184-279
    <BlurhashImage /> | <video> | placeholder
    ⚠ NOT wrapped in Link — clicking does nothing for static images
  </div>

  <Link href="/articles/[slug]">             ← lines 282-404
    <h3>title</h3>
    <p>excerpt</p>
    <div>meta info</div>
  </Link>
</div>
```

## Proposed Solution

**Recommendation: Wrap non-video cover images in the same `<Link href="/articles/[slug]">` component.**

This is the cleanest, most accessible approach with minimal risk.

### What changes

In [`ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx:244-258), wrap the `BlurhashImage` branch (line 245-258) in a `<Link>` component with the same props as the content link:

- `href={`/articles/${article.slug}`}` 
- `prefetch={false}`
- `onPointerDown` to save `previousPageUrl` in sessionStorage (scroll restoration)
- `onMouseEnter` / `onTouchStart` for prefetch

### What stays the same

| Area | Behavior | Why |
|------|----------|-----|
| **Video cover images** (HLS + native `<video>`) | Unchanged — click play button to play inline | Videos need their own interaction; wrapping in a Link would interfere |
| **Gradient placeholder** (no cover image) | Unchanged — not clickable | No visual element to click; content Link already covers this |
| **Content section** (title/excerpt/meta Link) | Unchanged | Second `<Link>` to same href is valid and improves accessibility |
| **Bookmark button** | Unchanged — absolute positioned with `z-10` | Remains clickable since it's outside the Link |
| **Card hover effects** | Unchanged | `group-hover` continues to work |

### Change Detail

In `ArticleCard.tsx`, lines 244-258 (the `BlurhashImage` branch), replace:

```tsx
) : (
  <BlurhashImage
    src={coverImageUrl}
    alt={article.title}
    fill
    priority={priority}
    quality={imageQuality}
    blurhash={...}
    className="transition-transform duration-300 group-hover:scale-105"
    sizes="..."
  />
)
```

With:

```tsx
) : (
  <Link
    href={`/articles/${article.slug}`}
    className="block w-full h-full"
    prefetch={false}
    onPointerDown={() => {
      setNavDirection('forward');
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        const search = window.location.search;
        const localePrefix = `/${locale}`;
        const pathWithoutLocale = path.startsWith(localePrefix)
          ? path.slice(localePrefix.length) || '/'
          : path;
        const savedUrl = pathWithoutLocale + search;
        sessionStorage.setItem('previousPageUrl', savedUrl);
      }
    }}
    onMouseEnter={() => router.prefetch(`/articles/${article.slug}`)}
    onTouchStart={() => router.prefetch(`/articles/${article.slug}`)}
  >
    <BlurhashImage
      src={coverImageUrl}
      alt={article.title}
      fill
      priority={priority}
      quality={imageQuality}
      blurhash={...}
      className="transition-transform duration-300 group-hover:scale-105 cursor-pointer"
      sizes="..."
    />
  </Link>
)
```

**Key considerations:**
- `cursor-pointer` is added to `BlurhashImage`'s className to indicate it's clickable
- The existing `group-hover:scale-105` still works for the visual effect
- The `Link` uses `className="block w-full h-full"` to fill the parent container
- Since the Link is inside the `relative` cover-image wrapper div, it will properly fill the aspect-ratio container

### Accessibility

- Adding a second `<Link>` to the same destination is valid per WCAG and HTML spec
- Keyboard users can Tab to either the image or the content link, both navigate to the same article
- Screen readers will announce both as links to the same article, which is acceptable

### No hydration risk

- `BlurhashImage` is already a `'use client'` component
- `Link` from `@/navigation` works on both server and client
- No new browser API usage — all patterns (prefetch, sessionStorage) are already used in the existing content Link
