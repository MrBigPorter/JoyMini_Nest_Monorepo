# Client-Side Markdown Import Plan (Comprehensive)

## Goal
Replace server-side `scanLocalMarkdownFiles()` with browser file picker that reads `.md` files and parses frontmatter directly in the browser, then imports via existing `batch-import` API.

## Why
Server only has 2G RAM — no room to store markdown files. Import directly from local dev machine.

## Architecture Data Flow

```mermaid
flowchart TD
    A[User clicks \"选择文件\" or drags .md files] --> B[Browser `<input type=file multiple accept=.md>`]
    B --> C[Validate files: filter .md, check size, deduplicate]
    C --> D[For each file: FileReader.readAsText]
    D --> E[parseFrontmatter: extract YAML frontmatter]
    E --> F{Has slug field?}
    F -->|Yes| G[Use frontmatter slug]
    F -->|No| H[Generate slug from filename]
    G --> I[Assemble ScannedArticle[]]
    H --> I
    I --> J[Display in existing UI: list, preview, stats]
    J --> K[User selects articles -> clicks \"导入选中\"]
    K --> L[POST /articles/batch-import API unchanged]
    L --> M[Backend processes: creates/skips articles]
    M --> N[Show ImportResult: success/skipped/failure]

    style A fill:#4A90D9,color:#fff
    style E fill:#7B68EE,color:#fff
    style L fill:#2ECC71,color:#fff
    style M fill:#F39C12,color:#fff
```

## Files to Touch

| File | Action | Description |
|------|--------|-------------|
| `apps/admin-blog/src/lib/utils/frontmatter.ts` | **NEW** | Browser-side YAML frontmatter parser |
| `apps/admin-blog/src/lib/utils/slug.ts` | **NEW** | Browser-safe slug generator from filename |
| `apps/admin-blog/src/app/(dashboard)/blog/import/page.tsx` | **MODIFY** | Replace server-scan with file picker + client-side parsing |
| `apps/admin-blog/src/api/index.ts` | **MINOR** | Remove unused `scanLocalArticles` import (optional, tree-shaken) |

## No Backend Changes Needed

The `batch-import` endpoint (`POST /articles/batch-import`) already accepts all fields and handles:
- Slug uniqueness check
- Duplicate skip (with `skippedCount` in result)
- Tag find-or-create
- Category mapping (via `categoryId`)
- `buildLocalizedData` wrapping for title/content/excerpt

## Detailed Specifications

---

### 1. `frontmatter.ts` — YAML Frontmatter Parser

**Purpose**: Parse modern YAML frontmatter (as used by all existing blog articles in `docs/blog/articles/`).

**Supported frontmatter formats** (observed in actual files):

```yaml
# Format A: inline tags, with slug
---
title: 'NestJS 后端架构深度解析'
slug: 'nestjs-backend-architecture-deep-dive'
tags: NestJS, Backend, Security, Architecture, WebSocket
---

# Format B: list tags, with description
---
title: 'NestJS 设备指纹风控系统'
description: '深入分析一个生产级 NestJS 设备安全服务'
tags:
  - NestJS
  - Security
  - Anti-Fraud
  - Device Fingerprint
  - Redis
---

# Format C: minimal (no slug, no description)
---
title: 'Some Article Title'
tags: Tag1, Tag2
---
```

**Parser logic**:

```typescript
export interface ParsedMarkdown {
  title: string;
  slug?: string;          // from frontmatter slug: field, or undefined
  excerpt?: string;       // from frontmatter description: field
  tags: string[];
  content: string;        // everything after frontmatter block
  // Multi-language fields (parsed but not used until DTO supports them)
  titleLocalized?: Record<string, string>;   // title_zh, title_en, etc.
  contentLocalized?: Record<string, string>; // content_zh, content_en, etc.
  excerptLocalized?: Record<string, string>;
}

function parseFrontmatter(raw: string): ParsedMarkdown
```

**Parsing steps**:
1. Check if file starts with `---`. If not, use fallback parser (see below).
2. Find closing `---` to extract YAML block.
3. For each line in YAML block:
   - `title:` → extract value (strip quotes), set `title`
   - `description:` or `excerpt:` → set `excerpt`
   - `slug:` → set `slug`
   - `tags:` → handle inline (`tags: A, B, C`) or list (`tags:\n  - A\n  - B`) format
   - `title_xx:` / `content_xx:` / `excerpt_xx:` → store in `titleLocalized` / `contentLocalized` / `excerptLocalized`
4. Everything after closing `---` → `content`
5. If no `title` found in frontmatter, try `# Title` heading in content
6. If still no title, use filename (caller provides it)

**Fallback parser** (for files without YAML frontmatter):
- Match `# Title` heading (line starting with `# `)
- Match `> excerpt` blockquote after title
- Match `Tags: ...` line at start of content body
- This matches the existing `parseMarkdownFile()` format for backward compatibility

**Edge cases handled**:
| Case | Behavior |
|------|----------|
| No frontmatter (`---`) | Use fallback `# Title` parser |
| Malformed YAML | Catch error, use fallback parser per-file |
| Empty frontmatter | Treat as no frontmatter |
| No `title:` in frontmatter | Fall back to `# Title` heading |
| No title at all | Use filename (without `.md`) as title |
| No content body | Return empty content, caller handles |
| `title:` with quotes | Strip single/double quotes |
| `tags:` with empty array | Return empty tags array |
| `tags:` line missing | Return empty tags array |
| Very long title (>200 chars) | Truncate at 200 chars |
| Very long excerpt (>500 chars) | Truncate at 500 chars |
| Non-UTF-8 encoding | `FileReader.readAsText` defaults to UTF-8; non-UTF-8 files may have garbled characters |

---

### 2. `slug.ts` — Slug Generator

```typescript
/**
 * Generate URL-safe slug from filename.
 * Priority: frontmatter slug field > filename-derived slug
 * 
 * Examples:
 *   "NestJS Backend Architecture.md" → "nestjs-backend-architecture"
 *   "Hello World!.md"                → "hello-world"
 *   "  My Article (v2).md "          → "my-article-v2"
 */
function generateSlugFromFilename(filename: string): string
```

Logic:
1. Strip `.md` extension
2. Lowercase
3. Replace non-alphanumeric characters with `-`
4. Collapse consecutive `-` into single `-`
5. Trim leading/trailing `-`

This matches the backend `filenameToSlug()` behavior (just strips `.md`) but is more robust (handles spaces, special chars).

---

### 3. `page.tsx` — Complete Page Rewrite

#### State Changes

| Old State | New State | Reason |
|-----------|-----------|--------|
| `scanArticles` (useRequest) | **Removed** | No server scan needed |
| `scanning` (loading) | `loading` | File reading loading |
| `scanError` | **Removed** | Per-file errors instead |
| | `fileErrors: string[]` | **NEW** — Collect per-file parse errors |
| | `dragOver: boolean` | **NEW** — Drag state styling |

#### UI Changes

**a) File Input (hidden)**
```tsx
const fileInputRef = useRef<HTMLInputElement>(null);
// Hidden input
<input
  ref={fileInputRef}
  type="file"
  multiple
  accept=".md"
  onChange={handleFilesSelected}
  className="hidden"
/>
```

**b) Button Text Changes**
- "扫描文件" → "选择文件" (Select Files)
- Icon: `Search` → `FileText` (or keep `Search`)
- Button triggers `fileInputRef.current?.click()`

**c) Empty State Card — Supports Drag & Drop**
- Replace existing empty state with a drop zone
- Text: "拖放 .md 文件到此处，或点击下方按钮选择文件"
- `onDragOver` / `onDragLeave` / `onDrop` handlers
- When dragging: blue border highlight

**d) Per-File Error Display (NEW)**
- If some files failed to parse, show a warning card below stats bar
- List filenames that failed with error message
- User can re-select those files

**e) Stats Bar Changes**
- Remove `existing` count (no DB pre-check)
- Remove `newArticles` count
- Show only: `total` files, `selected` count
- "全选" → selects all selectable files (no filter for "new" since all are "new")

**f) Article List Changes**
- Remove `exists` badge and `canSelect` logic
- All articles are selectable (no "already exists" state)
- The backend will skip duplicates and report in results

#### Handler Changes

**`handleFilesSelected` (NEW)** — replaces `scanArticles`:
```typescript
const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  setLoading(true);
  setFileErrors([]);
  setImportResult(null);

  const parsedArticles: ScannedArticle[] = [];
  const errors: string[] = [];
  const seenFilenames = new Set<string>();

  for (const file of Array.from(files)) {
    // Deduplicate by filename
    if (seenFilenames.has(file.name)) {
      errors.push(`${file.name}: 重复文件，已跳过`);
      continue;
    }
    seenFilenames.add(file.name);

    // Size check (>10MB)
    if (file.size > 10 * 1024 * 1024) {
      errors.push(`${file.name}: 文件过大 (>10MB)，已跳过`);
      continue;
    }

    try {
      const text = await readFileAsText(file);
      const parsed = parseFrontmatter(text);
      const slug = parsed.slug || generateSlugFromFilename(file.name);

      parsedArticles.push({
        filename: file.name,
        slug,
        title: parsed.title || file.name.replace(/\.md$/i, ''),
        excerpt: parsed.excerpt,
        content: parsed.content,
        tags: parsed.tags,
        subDir: null,               // No subdirectory in browser context
        exists: false,               // No DB pre-check
        fileSize: file.size,
        lastModified: new Date(file.lastModified).toISOString(),
      });
    } catch (err) {
      errors.push(`${file.name}: ${(err as Error).message}`);
    }
  }

  setArticles(parsedArticles);
  setFileErrors(errors);
  setSelectedSlugs(new Set(parsedArticles.map((a) => a.slug)));
  setSelectAll(true);
  setLoading(false);

  // Show toast summary
  if (parsedArticles.length === 0) {
    addToast('error', t('blog_import_noFiles'));
  } else {
    addToast('success', `${t('blog_import_found')} ${parsedArticles.length} ${t('blog_import_articles')}`);
  }
};

// Helper
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`读取失败: ${file.name}`));
    reader.readAsText(file);
  });
}
```

**`handleDrop` (NEW)** — Drag & drop handler:
```typescript
const handleDrop = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  setDragOver(false);
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    // Reuse the same handler by setting input.files
    // Or extract logic to a shared function
    processFiles(files);
  }
}, []);
```

**`handleSelectAll` — Simplified**:
Since there's no `exists` check, select all simply selects all articles:
```typescript
const handleSelectAll = useCallback(() => {
  if (selectAll) {
    setSelectedSlugs(new Set());
    setSelectAll(false);
  } else {
    setSelectedSlugs(new Set(articles.map((a) => a.slug)));
    setSelectAll(true);
  }
}, [selectAll, articles]);
```

**`handleImport` — Unchanged**:
Same as before, just without `subdir: a.subDir` (it's always null for client-side).

**Conditional rendering changes:**
- Remove `{scanError && <Card>}` block
- Replace `{!scanning && articles.length === 0 && !scanError}` with `{!loading && articles.length === 0 && fileErrors.length === 0}`

---

## Edge Cases & Their Handling

| Edge Case | Handling |
|-----------|----------|
| **Same `.md` file selected twice** | Deduplicate by `file.name` in `handleFilesSelected`, warn in errors |
| **Non-`.md` files selected** | `<input accept=".md">` prevents this; drag-drop filters `.md` |
| **File without frontmatter** | Fall back to `# Title` heading parser |
| **File with no frontmatter AND no `# Title`** | Use filename (without `.md`) as title |
| **Malformed YAML** | Catch error silently, fall back to non-YAML parser for that file |
| **Very large file (>10MB)** | Skip with warning in `fileErrors` |
| **Empty file** | Content is empty string; skip with warning |
| **Non-UTF-8 encoding** | `FileReader.readAsText` defaults to UTF-8; garbled chars possible |
| **>100 files selected** | Process sequentially, show `loading` state with progress feedback |
| **Browser doesn't support FileReader** | Unlikely (all modern browsers), but page gracefully shows empty state |
| **Internet Explorer / old browsers** | Not supported by Next.js anyway |
| **User cancels file picker** | No change; `e.target.files` is empty/null, returns early |
| **Drag-drop non-`.md` files** | Filter by `.md` extension in `handleDrop`, show error for non-`.md` files |
| **Slug already exists in DB** | Backend handles: returns `skippedCount` in `ImportResult`; UI shows skipped count |
| **Frontmatter `title:` vs `# Title` conflict** | `title:` in frontmatter takes priority (it's more explicit) |
| **Multi-language frontmatter fields** | Parsed but not sent to backend (DTO doesn't accept them); logged for future use |

---

## What Stays Unchanged

- `ScannedArticle` interface (same shape, `exists` always `false`, `subDir` always `null`)
- Selection toggle logic
- Preview panel
- Import button and `batchImportArticles` call
- Import result display (success/skipped/failure)
- All `blog_import_*` translation keys (25 already in all 6 locale files)
- Backend API (no changes needed)

## What Is Removed

- `useRequest(blogApi.scanLocalArticles, ...)` — no more server scan call
- `scanError` state and error card
- `Search` icon from `lucide-react` (if no longer used elsewhere in the page)
- `exists` badge in article rows
- "已存在的文章不可选" hint text
- `canSelect` checkbox disable logic
- Server-scan related states: `scanning`

## Implementation Order (Todo List)

1. Create `apps/admin-blog/src/lib/utils/frontmatter.ts` — YAML frontmatter parser + fallback parser
2. Create `apps/admin-blog/src/lib/utils/slug.ts` — slug generator from filename
3. Modify `apps/admin-blog/src/app/(dashboard)/blog/import/page.tsx`:
   a. Add file input ref + hidden `<input>` element
   b. Add drag-drop support on empty state card
   c. Implement `handleFilesSelected` with `FileReader` + `parseFrontmatter`
   d. Update empty state with drag-drop zone
   e. Remove scan button → replace with file picker button
   f. Remove `scanError` card
   g. Simplify stats bar (remove `exists`/`newArticles`)
   h. Remove `exists` badge from article rows
   i. Simplify `handleSelectAll` (no filter)
4. Verify TypeScript compiles cleanly
5. Run `npx prettier --write` on modified files
