/**
 * Media Placeholder Utility
 *
 * Solves the problem of media elements (video, img) being lost or corrupted
 * during AI translation. Instead of sending HTML media tags to the AI (which
 * may strip or modify them), we:
 *
 * 1. BEFORE translation: Extract media elements, replace with unique placeholders
 * 2. AI translates only text + placeholders (never touches media tags)
 * 3. AFTER translation: Restore placeholders → original media HTML
 *
 * This is the industry-standard approach used by Crowdin, Lokalise, and Phrase.
 * Media elements appear at their ORIGINAL positions in the translated content.
 */

// Unique placeholder prefixes — using Unicode symbols that AI won't translate or modify
const MEDIA_PLACEHOLDER_PREFIX = {
  video: '⏸️VIDEO_',
  img: '🖼️IMG_',
};

/**
 * Regex patterns to match media elements in HTML/Markdown content.
 * Order matters: <figure> wrappers must come first (they contain <video>/<img> inside).
 */
const MEDIA_PATTERNS = [
  // <figure>...<video>...</video>...</figure> (Quill editor wraps videos in figures)
  /<figure[^>]*>[\s\S]*?<video[\s\S]*?<\/video>[\s\S]*?<\/figure>/gi,
  // Standalone <video>...</video>
  /<video[\s\S]*?<\/video>/gi,
  // Standalone <img> tags (not already inside a figure — those are caught above)
  /<img\s[^>]*\/?>/gi,
] as const;

export interface MediaPlaceholderResult {
  /** Content with media elements replaced by placeholders */
  text: string;
  /** Map of placeholder → original media HTML */
  mediaMap: Map<string, string>;
  /** Number of media elements extracted */
  count: number;
}

/**
 * Extract media elements from content and replace with unique placeholders.
 *
 * The AI will translate text around these placeholders without modifying them.
 * Placeholders use Unicode symbols (⏸️, 🖼️) that AI models recognize as
 * non-translatable icons/symbols.
 *
 * @param content - Source content (Markdown or HTML) containing media elements
 * @returns Content with placeholders + a map to restore them later
 */
export function extractMediaAndReplaceWithPlaceholders(
  content: string,
): MediaPlaceholderResult {
  if (!content) {
    return { text: content || '', mediaMap: new Map(), count: 0 };
  }

  const mediaMap = new Map<string, string>();
  let counter = 0;
  let result = content;

  // Track positions already consumed by <figure> wrappers to avoid double-matching
  const consumedRanges: Array<[number, number]> = [];

  for (const pattern of MEDIA_PATTERNS) {
    result = result.replace(pattern, (match, offset: number) => {
      // Check if this match falls within a previously consumed range (e.g., <figure> already caught the <video> inside)
      const isAlreadyConsumed = consumedRanges.some(
        ([start, end]) => offset >= start && offset < end,
      );
      if (isAlreadyConsumed) {
        return match;
      }

      // Determine placeholder prefix based on what type of element this is
      const isVideo = /<video/i.test(match);
      const prefix = isVideo
        ? MEDIA_PLACEHOLDER_PREFIX.video
        : MEDIA_PLACEHOLDER_PREFIX.img;

      const placeholder = `${prefix}${counter}`;
      mediaMap.set(placeholder, match);
      counter++;

      // Track consumed range to prevent double-matching
      consumedRanges.push([offset, offset + match.length]);

      return placeholder;
    });
  }

  return { text: result, mediaMap, count: counter };
}

/**
 * Restore media placeholders in translated content with original media HTML.
 *
 * @param text - Translated content containing placeholders
 * @param mediaMap - Map of placeholder → original media HTML (from extractMediaAndReplaceWithPlaceholders)
 * @returns Content with placeholders restored to original media HTML
 */
export function restoreMediaPlaceholders(
  text: string,
  mediaMap: Map<string, string>,
): string {
  if (!text || !mediaMap || mediaMap.size === 0) {
    return text || '';
  }

  let result = text;

  for (const [placeholder, originalHtml] of mediaMap) {
    // Replace all occurrences (safeguard: if same placeholder somehow appears twice)
    result = result.split(placeholder).join(originalHtml);
  }

  return result;
}

/**
 * Check if content contains any media placeholders.
 * Useful for validation/debugging.
 */
export function hasMediaPlaceholders(content: string): boolean {
  if (!content) return false;
  const allPrefixes = Object.values(MEDIA_PLACEHOLDER_PREFIX);
  return allPrefixes.some((prefix) => content.includes(prefix));
}
