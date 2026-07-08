export interface ParsedSection {
  section: string;
  sentences: string[];
}

/**
 * Parse coupon.ts format into structured sections.
 *
 * Input (coupon.ts format):
 * ```
 * // ── Listing coupons ──
 * 'Show my available coupons',
 * 'What coupons do I have?',
 * // ── Applying codes ──
 * 'Apply coupon code SAVE10',
 * ```
 *
 * Output:
 * ```
 * [
 *   { section: "Listing coupons", sentences: ["Show my available coupons", "What coupons do I have?"] },
 *   { section: "Applying codes", sentences: ["Apply coupon code SAVE10"] }
 * ]
 * ```
 *
 * Also supports plain list format (no section headers):
 * ```
 * 'Show my available coupons',
 * 'What coupons do I have?',
 * ```
 * → wraps in a single "General" section.
 */
export function parseSections(text: string): ParsedSection[] {
  const lines = text.split('\n');
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines, export statements, import statements, comments that aren't section headers
    if (!trimmed) continue;
    if (trimmed.startsWith('export ')) continue;
    if (trimmed.startsWith('import ')) continue;

    // Match // ── Section Name ──  (section header comment)
    const sectionMatch = trimmed.match(/\/\/\s*─+\s*(.+?)\s*─+/);
    if (sectionMatch) {
      current = { section: sectionMatch[1].trim(), sentences: [] };
      sections.push(current);
      continue;
    }

    // Skip other comments (not section headers)
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*')
    ) {
      continue;
    }

    // Match quoted strings: 'sentence', or "sentence",
    const sentenceMatch = trimmed.match(/^['"](.+?)['"],?$/);
    if (sentenceMatch) {
      const sentence = sentenceMatch[1].trim();
      if (current) {
        current.sentences.push(sentence);
      } else {
        // No section header yet — create implicit "General" section
        current = { section: 'General', sentences: [sentence] };
        sections.push(current);
      }
    }
  }

  // If no sections found at all, try treating entire text as one section
  if (sections.length === 0) {
    const sentences = lines
      .map((l) => l.trim().match(/^['"](.+?)['"],?$/)?.[1])
      .filter((s): s is string => !!s);
    if (sentences.length > 0) {
      sections.push({ section: 'General', sentences });
    }
  }

  return sections;
}

/**
 * Serialize sections back to coupon.ts format.
 */
export function serializeToTsFormat(sections: ParsedSection[]): string {
  const parts: string[] = [];
  for (const sec of sections) {
    parts.push(`  // ── ${sec.section} ──`);
    for (const sentence of sec.sentences) {
      parts.push(`  '${sentence}',`);
    }
    parts.push(''); // blank line between sections
  }
  return parts.join('\n');
}

/**
 * Flatten sections into a single string array (for API submission).
 */
export function flattenSections(sections: ParsedSection[]): string[] {
  return sections.flatMap((s) => s.sentences);
}
