# Blog Preview 404 Fix Plan

## Problem

The "Preview" button on the blog articles page (`/dashboard/blog/articles`) links to `/blog/articles/{slug}` but returns a 404 because no such route exists in the admin-next app.

## Goal

Create a public-facing blog article page that displays the article content, accessible via `/blog/articles/{slug}`.

## Scope

- Create a single dynamic route `blog/articles/[slug]/page.tsx` within the existing admin-next app (outside the dashboard).
- Use the existing API endpoint `GET /v1/admin/blog/articles/slug/{slug}` (public, no auth required) to fetch article data.
- Render article title, meta info (author, date, category, tags), featured image, and HTML content.
- Apply basic styling consistent with the admin design system (using existing UI components).
- Ensure HTML content is safely sanitized before rendering.
- Keep the existing preview link unchanged (already points to correct path).

## Implementation Steps

### 1. Create route directory and page component

- Create folder structure: `apps/admin-next/src/app/blog/articles/[slug]/`
- Create `page.tsx` with the following structure:
  - Server component that reads the `slug` param.
  - Fetch article data using `blogApi.getArticleBySlug(slug)` (or direct fetch).
  - Handle loading, error, and not‑found states.
  - Render article.

### 2. Data fetching

- Use `blogApi` from `@/api` (already configured with base URL).
- Since the page is public and the API endpoint is under `/admin/blog`, we need to ensure CORS is already configured (should be fine).
- Consider adding caching and revalidation with Next.js `fetch` options.

### 3. Styling

- Use existing UI components (`Card`, `Badge`, etc.) from `@/components/UIComponents` and `@repo/ui`.
- Follow the same visual style as the admin dashboard but without dashboard layout (no sidebar).
- Include a simple header with site branding and a back link.

### 4. HTML sanitization

- Install `dompurify` or `sanitize-html` as a dependency.
- Create a utility function `sanitizeHtml` that strips dangerous scripts while preserving basic formatting.
- Apply it to the `article.content` before rendering with `dangerouslySetInnerHTML`.

### 5. Update preview link (if needed)

- Verify that the existing preview link (`/blog/articles/${article.slug}`) is correct (relative to the app root).
- If the admin app is deployed under a subpath (e.g., `/dashboard`), adjust the link accordingly.
- Currently the link appears correct; no changes anticipated.

### 6. Testing

- Test with a published article and a draft article (preview should show both).
- Verify that the page renders correctly on different screen sizes.
- Ensure that the "Preview" button opens the page in a new tab (already uses `target="_blank"`).

## Optional Enhancements (future)

- Add a blog index page (`/blog`) listing published articles.
- Implement social sharing meta tags (Open Graph, Twitter Cards).
- Add related articles section.
- Support RSS feed.

## Dependencies

- No new external dependencies required for basic functionality (sanitization library optional but recommended).

## Risks

- The API endpoint may require authentication for draft articles; currently it does not. If authentication is later added, preview may break.
- HTML content may contain unsafe scripts; sanitization is critical.

## Success Criteria

- Clicking "Preview" on an article in the admin dashboard opens the public article page without a 404.
- The page displays the article content correctly, including images and formatting.
- The page is publicly accessible (no login required).
- No security vulnerabilities from unsanitized HTML.

## Next Steps

1. Switch to Code mode to implement the steps.
2. Follow the todo list in sequential order.
3. After implementation, test thoroughly and deploy.
