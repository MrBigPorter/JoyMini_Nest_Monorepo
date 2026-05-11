# Fix: Video Still Lost in Some Articles After Translation

## Root Cause Analysis

The turndown approach (converting HTML with inline `⏸️VIDEO_0` → Markdown) works when the placeholder ends up as a **standalone paragraph** in the Markdown. But it **fails** when the video's position in the original HTML causes turndown to produce the placeholder **inline** within a paragraph or table cell.

### Example Scenarios

**Scenario A — ✅ Works (ErrorStrategy article)**
```
HTML: <p>Text</p><figure class="media"><video src="..."></video></figure><p>Text</p>
After replacement: <p>Text</p>⏸️VIDEO_0<p>Text</p>  ← placeholder BETWEEN block elements
After turndown: Text\n\n⏸️VIDEO_0\n\nText  ← standalone paragraph ✅
```

**Scenario B — ❌ Fails (DeviceFingerprint article)**
```
HTML: <p>Text<figure class="media"><video src="..."></video></figure>Text</p>
After replacement: <p>Text⏸️VIDEO_0Text</p>  ← placeholder INSIDE a <p> tag
After turndown: Text⏸️VIDEO_0Text  ← inline, AI treats as corruption ❌
```

When the placeholder is **inline** (Scenario B), the AI (especially Groq models) treats `⏸️VIDEO_0` as a corrupted/typo character and "cleans" it during translation—removing it entirely.

## Fix: Normalize Placeholders to Standalone Paragraphs

**Where**: [`apps/api/src/blog/processors/blog-ai.processor.ts`](../apps/api/src/blog/processors/blog-ai.processor.ts)

**What**: After turndown conversion, post-process the Markdown to ensure every placeholder is wrapped with blank lines:

```typescript
// Normalize: ensure placeholders are on their own lines (standalone paragraphs)
// Prevents AI from treating inline placeholders as text corruption and removing them
sourceContentForAi = sourceContentForAi
  .replace(/⏸️VIDEO_\d+/g, '\n\n$&\n\n')
  .replace(/🖼️IMG_\d+/g, '\n\n$&\n\n')
  .replace(/\n{3,}/g, '\n\n');
```

This must be applied in **both** code paths:
1. **Path A (line ~1139)**: `sourceContent` already has media tags → placeholders are from `extractMediaAndReplaceWithPlaceholders(sourceContent)`
2. **Path B (line ~1161)**: Fallback to `originalHtml` → placeholders from turndown conversion

### Why this works

- `restoreMediaPlaceholders()` does simple string replacement (`text.replace(placeholder, originalHtml)`) — it doesn't depend on position
- After restoration, `⏸️VIDEO_0` → `<figure><video>...</video></figure>` regardless of whether it was inline or standalone
- The rendered HTML output (via `renderMarkdown`) will correctly display the video as a block element
- AI sees clearly delimited paragraphs, not inline noise

## Files Modified

| File | Change |
|------|--------|
| [`apps/api/src/blog/processors/blog-ai.processor.ts`](../apps/api/src/blog/processors/blog-ai.processor.ts) | Add placeholder normalization after both extraction paths (lines ~1139 and ~1161) |

## Verification

1. `yarn check-types` — type-check passes
2. Server restart → translate DeviceFingerprint article to English
3. Check logs: `finalContent 媒体标签: 1 个<video>` ✅
4. Check frontend: article displays video at original position ✅
