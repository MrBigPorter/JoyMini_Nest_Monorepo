# Plan: Make Admin Blog Preview Match Frontend Blog Detail

## Problem

The admin blog's article preview page at [`apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx`] does not visually match the frontend blog's article detail page at [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx`]. When admins preview an article before publishing, the layout, styling, and displayed information differ significantly from how the article will appear on the public frontend.

## Root Cause

The admin preview was built independently with admin-specific UI patterns (Card wrapper, PageHeader, status badge, preview indicator, excerpt section) without referencing the frontend article detail layout as the visual target.

## Required Changes

### 1. Add Tags Display
The admin preview currently does NOT show article tags. The frontend displays tags as `Badge` components below the category and above the title.

**Current (admin):** No tags rendered
**Target (frontend):**
```tsx
{article.tags?.map((tag: any) => (
  <Badge key={tag.id} variant="outline">
    <Tag className="h-3 w-3 mr-1" />
    {tag.name}
  </Badge>
))}
```

The admin API response includes `tags` field (array of tag objects with `id`, `name`), so this data is available. Update the `ArticlePreview` interface to include `tags` and add the tags rendering section.

### 2. Add Views, Likes, Comments to Metadata
The admin metadata section currently shows: author, date, reading time, category, status badge.

The frontend shows: author (with avatar), date, reading time, **views**, **likes**, **comments count**.

**Changes needed:**
- Add `viewCount`, `likeCount` (or `likes`), `commentCount` (or `commentsCount`) to the `ArticlePreview` interface
- Add the corresponding icon + count elements to the metadata section
- Remove the `·` separator before the status badge (or move status outside the metadata area)

### 3. Update Title Typography
**Current:** `text-3xl md:text-4xl`
**Target:** `text-3xl md:text-4xl lg:text-5xl`

### 4. Update Content Renderer Prose Classes
The admin's `ArticleRenderer` component uses prose classes that are similar but less comprehensive than the frontend's `ArticleMarkdown` component.

**Key differences in `ArticleMarkdown` (frontend) that are missing in admin:**
- `break-words` class on the wrapper
- `prose-a:no-underline hover:prose-a:underline` for link styling
- `prose-pre:overflow-x-auto` for code block overflow
- `prose-hr` classes (`border-t`, `border-gray-200 dark:border-gray-700`, `my-8`)
- `prose-table:w-full`
- `prose-th:text-left`
- `prose-td:align-top`
- `prose-li:my-0 prose-li:border-0` for list styling
- `prose-code` missing `prose-code:rounded` in admin (it has it, but check carefully)

Also the `isHtmlContent` detection function differs slightly:
- Frontend: `/^\s*<\w+[^>]*>/.test(content.trim())` - more precise
- Admin: `/<[a-z][\s\S]*>/i.test(content)` - too broad, may match code examples with angle brackets

### 5. Move/Layout Adjustments
- **Featured image**: Currently shown at the top of the article content. The frontend doesn't show a separate featured image in the detail page (it's embedded in markdown). Consider keeping it for admin preview purposes since admins need to verify the featured image.
- **Excerpt section**: The frontend doesn't show excerpt separately. Consider keeping it for admin review but styling it less prominently.
- **Status badge**: Admin-only info, can keep it but move it outside the "article display" area (e.g., next to the preview indicator).
- **Back link**: Keep pointing to `/blog/articles` (admin navigation).

### 6. General Layout Refinements
- Update the main content wrapper to use `max-w-5xl` and similar padding/spacing as frontend
- Remove the `Card` wrapper around article content for a more authentic preview, OR keep the Card but match internal spacing
- Remove the `Preview` indicator text (admin-only)

### 7. (Optional) Update Loading/Error States
- Loading state: Admin uses spinner, frontend uses skeleton. Could update to match, but low priority.
- Error state: Both have similar structure with back links. Could align styling.

## Files to Modify

### Primary: [`apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx`]
This is the main file that needs all the changes.

## Implementation Steps

1. **Update `ArticlePreview` interface** - Add `tags`, `viewCount`, `likeCount`, `commentCount` fields
2. **Add tags display** - Render tags with Badge components below category
3. **Update metadata section** - Add views, likes, comments icons/counts
4. **Update title typography** - Add `lg:text-5xl`
5. **Update prose classes** in `ArticleRenderer` to match `ArticleMarkdown`
6. **Update `isHtmlContent` detection** to use the same regex as frontend
7. **Adjust layout** - Max width, spacing, Card usage
8. **Update `ArticleRenderer`** to use `<article>` tag like frontend

## Files NOT to Modify
- [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx`] - Already the reference design
- [`apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx`] - Reference for prose classes
- Any other admin or frontend files

## Verification
After implementation:
1. Navigate to admin blog → Articles → Click "Preview" on an article
2. Verify the article display layout matches the frontend blog detail page
3. Verify tags are shown
4. Verify views/likes/comments counts are shown (if data is available)
5. Verify content rendering has the same prose styling
