/**
 * Browser-safe slug generator.
 *
 * Generates URL-safe slugs from filenames or titles.
 * Matches the backend convention (filename without .md extension, lowercased).
 *
 * Examples:
 *   generateSlugFromFilename("NestJS Backend Architecture.md")
 *   // → "nestjs-backend-architecture"
 *
 *   generateSlugFromFilename("Hello World!.md")
 *   // → "hello-world"
 *
 *   generateSlugFromFilename("  My Article (v2).md ")
 *   // → "my-article-v2"
 */

/**
 * Generate a URL-safe slug from a markdown filename.
 * Priority: frontmatter `slug:` field > filename-derived slug
 *
 * @param filename - The .md filename (e.g., "my-article.md")
 * @returns URL-safe slug string
 */
export function generateSlugFromFilename(filename: string): string {
  let slug = filename;

  // Strip .md extension (case-insensitive)
  slug = slug.replace(/\.md$/i, '');

  // Lowercase
  slug = slug.toLowerCase();

  // Replace any non-alphanumeric characters with hyphens
  slug = slug.replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-');

  // Collapse consecutive hyphens
  slug = slug.replace(/-+/g, '-');

  // Trim leading/trailing hyphens
  slug = slug.replace(/^-+|-+$/g, '');

  return slug;
}

/**
 * Generate a URL-safe slug from a title string (not filename).
 * Used when no filename is available (e.g., from frontmatter title).
 *
 * @param title - The article title
 * @returns URL-safe slug string
 */
export function generateSlugFromTitle(title: string): string {
  let slug = title.toLowerCase();

  // Replace non-alphanumeric with hyphens (keep Chinese characters)
  slug = slug.replace(/[^a-z0-9\u4e00-\u9fff\s-]+/g, '');
  slug = slug.replace(/[\s]+/g, '-');
  slug = slug.replace(/-+/g, '-');
  slug = slug.replace(/^-+|-+$/g, '');

  return slug || 'untitled';
}
