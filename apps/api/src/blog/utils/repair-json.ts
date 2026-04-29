/**
 * Repair common JSON issues from AI responses.
 *
 * Layer 1: Direct JSON.parse (fast path for valid JSON)
 * Layer 2: Extract JSON from markdown code blocks (```json ... ```)
 * Layer 3: Balanced-brace extraction of the outermost { ... } object
 * Layer 4: Fix unterminated strings by escaping problematic characters
 *
 * If all repair strategies fail, throws the original parse error
 * so the caller can fall back to its existing retry/fallback logic.
 */
export function repairJsonResponse(raw: string): string {
  if (!raw) throw new Error('Empty response');

  // ── Layer 1: Direct parse ──────────────────────────────────
  try {
    JSON.parse(raw);
    return raw; // Already valid → return unchanged
  } catch {
    // Continue to repair
  }

  // ── Layer 2: Extract JSON from markdown code blocks ────────
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const extracted = codeBlockMatch[1].trim();
    try {
      JSON.parse(extracted);
      return extracted;
    } catch {
      // Continue repair on extracted content
      raw = extracted;
    }
  }

  // ── Layer 3: Find outermost { ... } with balanced braces ───
  const firstBrace = raw.indexOf('{');
  if (firstBrace !== -1) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let lastContentEnd = -1;

    for (let i = firstBrace; i < raw.length; i++) {
      const char = raw[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            lastContentEnd = i + 1;
            break;
          }
        }
      }
    }

    if (lastContentEnd !== -1) {
      const candidate = raw.substring(firstBrace, lastContentEnd);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        // Will be handled by Layer 4
        raw = candidate;
      }
    }
  }

  // ── Layer 4: Fix unterminated strings ──────────────────────
  // Walk through the string character by character.
  // When we detect an unescaped " inside a string value (i.e. a quote
  // that should have been escaped as \"), we add a backslash before it.
  let repaired = '';
  let inStr = false;
  let escNext = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (escNext) {
      repaired += char;
      escNext = false;
      continue;
    }

    if (char === '\\') {
      repaired += char;
      escNext = true;
      continue;
    }

    // Toggle string state on unescaped double quotes
    if (char === '"') {
      inStr = !inStr;
      repaired += char;
      continue;
    }

    // If we're inside a string and hit a newline, escape it as \n
    if (inStr && (char === '\n' || char === '\r')) {
      if (char === '\r') {
        // Skip \r, handle \n below
        continue;
      }
      repaired += '\\n';
      continue;
    }

    repaired += char;
  }

  // Try the repaired version
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    // If still failing, attempt to close any unclosed strings/objects.
    // Count unclosed quotes – if odd, add a closing quote.
    let quoteCount = 0;
    let qEscNext = false;
    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];
      if (qEscNext) {
        qEscNext = false;
        continue;
      }
      if (char === '\\') {
        qEscNext = true;
        continue;
      }
      if (char === '"') {
        quoteCount++;
      }
    }

    if (quoteCount % 2 !== 0) {
      repaired += '"';
    }

    // Also try adding closing braces if depth is unbalanced
    let openBraces = 0;
    let openBrackets = 0;
    let braceInStr = false;
    let braceEscNext = false;
    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];
      if (braceEscNext) {
        braceEscNext = false;
        continue;
      }
      if (char === '\\') {
        braceEscNext = true;
        continue;
      }
      if (char === '"') {
        braceInStr = !braceInStr;
        continue;
      }
      if (braceInStr) continue;
      if (char === '{') openBraces++;
      else if (char === '}') openBraces--;
      else if (char === '[') openBrackets++;
      else if (char === ']') openBrackets--;
    }

    while (openBraces > 0) {
      repaired += '}';
      openBraces--;
    }
    while (openBrackets > 0) {
      repaired += ']';
      openBrackets--;
    }

    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      throw new Error('Unable to repair JSON response after all strategies');
    }
  }
}
