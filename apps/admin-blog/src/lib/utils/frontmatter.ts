/**
 * Browser-side YAML frontmatter parser for Markdown files.
 *
 * Supports the following frontmatter formats (observed in docs/blog/articles/):
 *
 * ```yaml
 * # Format A: inline tags
 * ---
 * title: 'Article Title'
 * slug: 'article-slug'
 * tags: Tag1, Tag2, Tag3
 * ---
 *
 * # Format B: list tags with description
 * ---
 * title: 'Article Title'
 * description: 'Article excerpt...'
 * tags:
 *   - Tag1
 *   - Tag2
 * ---
 * ```
 *
 * Falls back to # Title heading + Tags: line parser when no YAML frontmatter found.
 */

export interface ParsedMarkdown {
  /** Article title (from frontmatter `title:` or `# Title` heading) */
  title: string;
  /** URL-safe slug (from frontmatter `slug:` field, undefined if absent) */
  slug?: string;
  /** Article excerpt/description (from frontmatter `description:` or `> blockquote`) */
  excerpt?: string;
  /** Tag names array */
  tags: string[];
  /** Markdown body content (everything after frontmatter block) */
  content: string;
  /**
   * Multi-language title fields (e.g. title_zh, title_en).
   * Parsed but not sent to backend until DTO supports localized fields.
   */
  titleLocalized?: Record<string, string>;
  /**
   * Multi-language content fields (e.g. content_zh, content_en).
   * Parsed but not sent to backend until DTO supports localized fields.
   */
  contentLocalized?: Record<string, string>;
  /**
   * Multi-language excerpt fields (e.g. excerpt_zh, excerpt_en).
   * Parsed but not sent to backend until DTO supports localized fields.
   */
  excerptLocalized?: Record<string, string>;
}

/**
 * Parse a raw markdown string, extracting YAML frontmatter and body content.
 *
 * @param raw - The full text content of a .md file
 * @returns ParsedMarkdown with extracted fields
 */
export function parseFrontmatter(raw: string): ParsedMarkdown {
  if (!raw || raw.trim().length === 0) {
    return { title: '', tags: [], content: '' };
  }

  const trimmed = raw.trimStart();

  // Check if file starts with YAML frontmatter (---)
  if (trimmed.startsWith('---')) {
    try {
      return parseYamlFrontmatter(trimmed);
    } catch {
      // If YAML parsing fails, fall through to non-YAML parser
    }
  }

  // Fallback: parse using # Title heading + Tags: line + > excerpt
  return parseNonYamlMarkdown(trimmed);
}

/**
 * Parse markdown with YAML frontmatter block.
 * Expects format:
 *   ---
 *   title: ...
 *   tags: ...
 *   ---
 *   content...
 */
function parseYamlFrontmatter(raw: string): ParsedMarkdown {
  const endOfFrontmatter = raw.indexOf('\n---', 3); // find closing ---
  if (endOfFrontmatter === -1) {
    throw new Error('Unclosed YAML frontmatter block');
  }

  const yamlBlock = raw.slice(3, endOfFrontmatter).trim();
  const contentStart = endOfFrontmatter + 4; // skip past \n---
  const content = raw.slice(contentStart).trimStart();

  const result: ParsedMarkdown = {
    title: '',
    tags: [],
    content,
  };

  const lines = yamlBlock.split('\n');
  let currentListKey: string | null = null;
  const listValues: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (trimmedLine.length === 0) continue;

    // List item continuation (e.g., "  - tag1")
    if (trimmedLine.startsWith('- ')) {
      if (currentListKey) {
        listValues.push(trimmedLine.slice(2).trim());
      }
      continue;
    }

    // If we were collecting a list and hit a non-list line, flush it
    if (currentListKey) {
      setField(result, currentListKey, listValues.join(', '));
      currentListKey = null;
      listValues.length = 0;
    }

    // Key-value line
    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmedLine.slice(0, colonIndex).trim().toLowerCase();
    let value = trimmedLine.slice(colonIndex + 1).trim();

    // If value is empty, next lines might be a list
    if (value.length === 0) {
      currentListKey = key;
      listValues.length = 0;
      continue;
    }

    // Strip surrounding quotes
    value = stripQuotes(value);

    // Handle inline list format: tags: Tag1, Tag2, Tag3
    if (key === 'tags' || key === 'tag') {
      setField(result, 'tags', value);
    } else {
      setField(result, key, value);
    }
  }

  // Flush remaining list
  if (currentListKey) {
    setField(result, currentListKey, listValues.join(', '));
  }

  // If no title from frontmatter, try # Title heading in content
  if (!result.title) {
    const titleFromHeading = extractTitleFromHeading(content);
    if (titleFromHeading) {
      result.title = titleFromHeading;
    }
  }

  return result;
}

/**
 * Set a field on the ParsedMarkdown result from a YAML key-value pair.
 */
function setField(result: ParsedMarkdown, key: string, value: string): void {
  switch (key) {
    case 'title':
      result.title = truncate(value, 200);
      break;

    case 'slug':
      result.slug = value;
      break;

    case 'excerpt':
    case 'description':
      result.excerpt = truncate(value, 1000);
      break;

    case 'tags':
    case 'tag':
      // Strip YAML inline list brackets: [Tag1, Tag2] → "Tag1, Tag2"
      // Also handle the legacy inline-list syntax [A, B, C] where [ and ] are preserved
      const cleaned = value.replace(/^\[|\]$/g, '').trim();
      result.tags = cleaned
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      break;

    default: {
      // Handle multi-language fields: title_zh, title_en, content_zh, excerpt_ja, etc.
      const multiLangMatch = key.match(/^(title|content|excerpt)_([a-z]{2})$/);
      if (multiLangMatch) {
        const fieldType = multiLangMatch[1] as 'title' | 'content' | 'excerpt';
        const langCode = multiLangMatch[2];
        const targetKey = `${fieldType}Localized` as keyof Pick<
          ParsedMarkdown,
          'titleLocalized' | 'contentLocalized' | 'excerptLocalized'
        >;
        if (!result[targetKey]) {
          (result as any)[targetKey] = {};
        }
        (result[targetKey] as Record<string, string>)[langCode] = value;
      }
      break;
    }
  }
}

/**
 * Fallback parser for markdown files without YAML frontmatter.
 *
 * Matches the backend's `parseMarkdownFile()` format:
 *   # Title
 *   > excerpt
 *   ---
 *   Tags: Tag1, Tag2
 *   content...
 */
function parseNonYamlMarkdown(raw: string): ParsedMarkdown {
  const lines = raw.split('\n');
  const result: ParsedMarkdown = {
    title: '',
    tags: [],
    content: '',
  };

  // 1. Extract # Title heading
  let titleLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('# ')) {
      result.title = truncate(trimmed.replace(/^#\s+/, '').trim(), 200);
      titleLineIndex = i;
      break;
    }
  }

  // 2. Extract > excerpt after title
  let excerptLineIndex = -1;
  if (titleLineIndex !== -1) {
    for (let i = titleLineIndex + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('> ')) {
        result.excerpt = truncate(trimmed.replace(/^>\s+/, '').trim(), 1000);
        excerptLineIndex = i;
        break;
      }
      if (trimmed === '---' || (trimmed !== '' && !trimmed.startsWith('>'))) {
        break;
      }
    }
  }

  // 3. Find content start (after --- separator)
  let contentStartIndex = titleLineIndex !== -1 ? titleLineIndex + 1 : 0;
  for (let i = contentStartIndex; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      contentStartIndex = i + 1;
      break;
    }
  }
  if (
    contentStartIndex === (titleLineIndex !== -1 ? titleLineIndex + 1 : 0) &&
    excerptLineIndex !== -1
  ) {
    contentStartIndex = excerptLineIndex + 1;
  }

  const bodyLines = lines.slice(contentStartIndex);

  // 4. Extract Tags line from start of body
  const firstBodyLine = bodyLines[0]?.trim() || '';
  const tagsMatch = firstBodyLine.match(/^Tags:\s*(.+)$/i);
  if (tagsMatch) {
    result.tags = tagsMatch[1]
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    bodyLines.shift();
  }

  result.content = bodyLines.join('\n').trim();

  // If no title found, use empty string (caller should fallback to filename)
  return result;
}

/**
 * Extract the first # Title heading from content string.
 */
function extractTitleFromHeading(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) {
    return truncate(match[1].trim(), 200);
  }
  return null;
}

/**
 * Strip surrounding single or double quotes from a string.
 */
function stripQuotes(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

/**
 * Truncate a string to maxLength, preserving whole words.
 */
function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).trimEnd() + '…';
}
