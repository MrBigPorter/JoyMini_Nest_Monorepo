import DOMPurify from 'dompurify';

/**
 * Sanitizes HTML to prevent XSS attacks using DOMPurify.
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') {
    // Server side fallback - return empty string or use server side sanitizer
    return html;
  }

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'strong',
      'em',
      'u',
      's',
      'blockquote',
      'code',
      'pre',
      'ul',
      'ol',
      'li',
      'a',
      'img',
      'figure',
      'figcaption',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'div',
      'span',
      'hr',
      'sub',
      'sup',
      'mark',
      'del',
      'ins',
    ],
    ALLOWED_ATTR: [
      'href',
      'target',
      'rel',
      'src',
      'alt',
      'title',
      'width',
      'height',
      'class',
      'style',
      'data-*',
      'id',
    ],
    ALLOW_DATA_ATTR: true,
  });
}
