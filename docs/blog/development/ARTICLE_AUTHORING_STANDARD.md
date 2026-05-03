# Blog Article Authoring Standard v2.0.0

> Standard for authoring blog articles in the Lucky Nest monorepo.  
> Ensures correct parsing, proper metadata extraction, clean AI translation, and correct frontend rendering.

---

## Table of Contents

1. [Required YAML Frontmatter](#1-required-yaml-frontmatter)
2. [Rules](#2-rules)
3. [Article Style Guide](#3-article-style-guide)
4. [Pre-Submit Checklist](#4-pre-submit-checklist)
5. [Template](#5-template)
6. [Common Mistakes & How to Avoid Them](#6-common-mistakes--how-to-avoid-them)
7. [Troubleshooting](#7-troubleshooting)
8. [Related Documents](#8-related-documents)

---

## 1. Required YAML Frontmatter

Every blog article **MUST** start with a YAML frontmatter block. Without it, the import system cannot extract tags, description, or slug correctly.

### Recommended Format (Comma-Separated Tags)

```markdown
---
title: Your Article Title Here
slug: your-article-slug
tags: Tag1, Tag2, Tag3
description: A concise 1-2 sentence summary of the article (used as excerpt/SEO description)
---
```

### Alternative Tags Formats

The parser ([`parseFrontmatter()`](apps/admin-blog/src/lib/utils/frontmatter.ts:61)) supports **three** tags formats. Choose based on your needs:

**Format A — Comma-separated (preferred for simplicity):**
```yaml
tags: Flutter, Dart, Auth, StateManagement
```

**Format B — YAML list (preferred for many/long tags):**
```yaml
tags:
  - NestJS
  - Google AI Studio
  - Gemini
  - Circuit Breaker
  - Rate Limiting
```

**Format C — Array brackets (supported for backward compatibility):**
```yaml
tags: [Flutter, Caching, SWR, Performance]
```

> **Note:** All three formats produce identical results after parsing. Choose Format A for simple articles (≤6 tags), Format B for articles with many tags or long tag names.

### Field Reference

| Field | Required | Max Length | Description |
|-------|----------|------------|-------------|
| `title` | ✅ Yes | 200 chars | Article title, same as the `# Title` heading below |
| `slug` | ✅ Yes | — | URL-friendly identifier; **must match the filename** (e.g., `slug: my-article` ↔ `my-article.md`) |
| `tags` | ✅ Yes | — | Tags in any supported format (comma-separated, YAML list, or array); use existing tags when possible |
| `description` | ✅ Yes | 1000 chars | Natural-language summary; appears in ArticleCard, SEO `<meta>`, social share previews |
| `category` | ❌ No | — | Optional category label (e.g., `Projects`, `frontend`); used for grouping in some views |
| `date` | ❌ No | — | Optional publication date (e.g., `2026-04-30`); ISO 8601 date format |

> **Note 1:** The `# Title` heading in the body should match the frontmatter `title:` field, though this is not strictly enforced by the parser.
>
> **Note 2:** If `description` is missing from frontmatter, the parser falls back to the first `> quote` block in the body. However, **always prefer** using `description:` in frontmatter for best SEO and card display.

### Field Ordering Convention

While the parser accepts fields in any order, the **recommended** field order is:

```
title → slug → tags → description → [category] → [date]
```

Examples from the codebase:
- [`admin/zustand-auth-store-ssr-hydration.md`](docs/blog/articles/admin/zustand-auth-store-ssr-hydration.md:1) — `title → slug → tags → description`
- [`api/ai-powered-translation-engine.md`](docs/blog/articles/api/ai-powered-translation-engine.md:1) — `title → slug → description → tags` (YAML list)
- [`frontend/admin-blog-form-architecture.md`](docs/blog/articles/frontend/admin-blog-form-architecture.md:1) — `title → description → date → category → tags`

---

## 2. Rules

### Rule 1: YAML Frontmatter Is Required

The import pipeline ([`parseFrontmatter()`](apps/admin-blog/src/lib/utils/frontmatter.ts:61)) reads `title`, `slug`, `tags`, `description` from the YAML block. Without it:
- `tags` will be empty (no `Tags:` fallback line in the body)
- `description`/`excerpt` will fall back to the `> quote` block content
- `slug` will be auto-generated from the filename (may not match expectations)

### Rule 2: Code Comments MUST Be in English

Per [`CODE_STYLE_RULES.md`](docs/blog/development/CODE_STYLE_RULES.md:11):
> ❌ **禁止在代码中出现任何中文字符** — including code comments

```dart
// ✅ CORRECT: English comment
final primaryColor = Color(0xFF1976D2);

// ❌ WRONG: Chinese comment
// 主色阶梯
final primaryColor = Color(0xFF1976D2);
```

**Why:** The AI translation pipeline translates Chinese text. When Chinese comments appear inside code blocks, the AI attempts to translate them, which can break code syntax and produce garbled output.

### Rule 3: ASCII/Unicode Diagram Labels MUST Be in English

Diagrams rendered with box-drawing characters or Unicode art must use English labels:

```
// ✅ CORRECT: English labels
┌──────────┐    ┌──────────┐
│  Initial  │───→│ Checking  │
└──────────┘    └──────────┘

// ❌ WRONG: Chinese labels
┌──────────┐    ┌──────────┐
│  初始状态  │───→│  检查中   │
└──────────┘    └──────────┘
```

**Why:** The AI translation pipeline does not handle mixed Chinese + diagram formatting well. Labels get translated, but the diagram layout is destroyed in the process.

### Rule 4: `description` Must Be a Natural-Language Summary

```markdown
// ✅ CORRECT: Readable summary
description: Implements a robust authentication state machine using AuthNotifier + TokenStorage in Flutter, covering login, token refresh, and secure storage.

// ❌ WRONG: Metadata markers
description: Article F6 | Difficulty: ⭐⭐⭐⭐ | Source: joy_mini_app/lib/gen/
```

The `description` appears in:
- Article cards on the homepage
- SEO `<meta name="description">` tags
- Social share previews (Open Graph, Twitter Cards)

### Rule 5: `slug` Must Match the Filename

The frontend route `/[locale]/articles/[slug]` looks up articles by slug. If the slug doesn't match the filename, the article won't be found at the expected URL.

```
// ✅ CORRECT
Filename: my-awesome-article.md
Frontmatter: slug: my-awesome-article

// ❌ WRONG
Filename: my-awesome-article.md
Frontmatter: slug: different-slug
```

### Rule 6: Tags Should Match Existing Taxonomy

Reuse existing tags from the blog's tag system when possible. Creating inconsistent tag variants (e.g., `Flutter` vs `flutter` vs `Flutter-Framework`) fragments content discovery.

Common tags: `Flutter`, `Dart`, `NestJS`, `Next.js`, `TypeScript`, `React`, `Prisma`, `PostgreSQL`, `Redis`, `Docker`, `DevOps`, `Security`, `Architecture`, `Testing`

> **Note:** Tags are case-insensitive in the parser but should follow PascalCase convention (e.g., `Flutter` not `flutter`, `StateManagement` not `statemanagement`).

### Rule 7: Zero Chinese Characters in Code Blocks

This includes:
- Variable names: `final 颜色 = ...` ❌
- Function names: `void 获取数据()` ❌
- Comments: `// 这是注释` ❌
- String literals shown as code examples: `'这是一个字符串'` ❌
- File paths: `joy_mini_app/lib/gen/` ✅ (English only)

### Rule 8: Article Prose Can Be in Chinese

Only **code blocks** and **diagram labels** must be English. The article's explanatory text can be in Chinese — the AI translation pipeline will handle translating it to other languages.

> **Important:** All article categories should use Chinese for prose (title, description, body content). This ensures consistency across the blog. Currently, Flutter articles are the only category written in English — they should be converted to Chinese to match the rest of the codebase.

---

## 3. Article Style Guide

To maintain a consistent look and feel across all blog articles, follow these style conventions. The reference implementation for this style guide is the `backend/` category — these articles have the most mature and consistent style in the codebase.

### 3.1 Section Numbering

Use **Arabic numerals** for all section headings:

```markdown
## 1. Section Title
### 1.1 Subsection Title
### 1.2 Subsection Title
## 2. Next Section
```

> **Avoid:** Chinese numbering (`## 一、`, `## 二、`) — this is inconsistent with the rest of the blog.

### 3.2 First Section Name

The first section after `# Title` should be a Chinese problem-context section. Choose based on article type:

| Article Type | Recommended First Section |
|--------------|--------------------------|
| Problem-solution | `## 1. 背景` |
| Technical deep-dive | `## 1. 引言` |
| Architecture overview | `## 1. 架构概览` |
| Tutorial/Guide | `## 1. 引言` |

> **Avoid:** `## Overview` (English) — use Chinese `## 1. 概述` instead.

### 3.3 Post-Title Metadata Block

**Do NOT add a metadata block after `# Title`.** Jump directly into `## 1. ...`.

```markdown
# Title

## 1. 背景

Content starts here...
```

> **Exception:** If the article has version tracking or date-specific content, a minimal `**日期：** 2026-01-01` line is acceptable.

### 3.4 Summary / Ending Section

Every article should end with a summary section. Use **`## N. 总结`** with a numbered list of key points:

```markdown
## N. 总结

1. First key point...
2. Second key point...
3. Third key point...
```

Optionally, add a source reference line after the summary:

```markdown
*本文源码基于 [`path/to/file.ts`](path/to/file.ts)（N行），完整包含...等全部实现。*
```

> **Avoid:** `## Key Takeaways`, `## Summary`, `## 关键要点` — use `## 总结`.

### 3.5 Title Quoting Style

Use **no quotes** for simple titles, **single quotes** for titles containing special characters:

```yaml
# Simple title — no quotes
title: Next.js 多语言零闪烁架构

# Title with special characters — single quotes
title: 'Zustand 认证存储 + SSR Hydration — 管理后台三 Store 架构'
```

> **Avoid:** Double quotes `title: "..."` unless the title contains single quotes.

### 3.6 Inline Code and File References

- File paths: Use backtick inline code: `` `apps/api/src/app.module.ts` ``
- Code references: Use backtick inline code: `` `parseFrontmatter()` ``
- Links to files: Use markdown links with relative paths: [`frontmatter.ts`](apps/admin-blog/src/lib/utils/frontmatter.ts)
- Links with line numbers: [`parseFrontmatter()`](apps/admin-blog/src/lib/utils/frontmatter.ts:61)

### 3.7 Separator Lines

Use `---` sparingly:
- Between major sections in long articles (500+ lines)
- Before the final summary section
- Do NOT use `---` between every section

### 3.8 Code Block Language Tags

Always specify the language in code block fences:

```markdown
```dart
// Dart code
```

```typescript
// TypeScript code
```

```bash
# Shell commands
```

```json
{
  "key": "value"
}
```
```

> **Avoid:** Language-less code blocks ` ``` ` — they won't get syntax highlighting.

### 3.9 Table of Contents

Include a Table of Contents only for articles longer than 500 lines:

```markdown
## 目录

1. [Section 1](#1-section-1)
2. [Section 2](#2-section-2)
    - [2.1 Subsection](#21-subsection)
3. [Section 3](#3-section-3)
```

Use `## 目录` (Chinese) not `## Table of Contents` (English).

### 3.10 Writing Voice

Adopt a **technical, direct, problem-solution** voice:

- Start each section by stating the problem, then present the solution
- Use numbered lists for enumerating problems, steps, or key points
- Use tables for comparisons (e.g., pros/cons, before/after, configuration matrix)
- Use ASCII diagrams for simple flow visualization
- Use Mermaid diagrams for complex architecture visualization
- Bold key concepts: `**分布式锁 + 状态机双保险**`
- Reference actual source code with file paths and line numbers
- Keep paragraphs short (3-5 sentences max)

---

## 4. Pre-Submit Checklist

Before committing a new article, verify each item:

### Frontmatter
- [ ] YAML frontmatter `---` block is present at line 1
- [ ] `title:` is filled (≤200 chars)
- [ ] `slug:` matches the filename (without `.md` extension)
- [ ] `tags:` has at least one tag (any supported format: comma-separated, YAML list, or array)
- [ ] `description:` is a natural-language summary (not metadata markers)
- [ ] Field ordering follows the convention: `title → slug → tags → description`

### Style
- [ ] Section numbering uses Arabic numerals (`## 1.`, `## 2.`) not Chinese (`## 一、`)
- [ ] First section name is in Chinese (e.g., `## 1. 概述`, not `## Overview`)
- [ ] Summary section is in Chinese (`## 关键要点` or `## 总结`, not `## Summary`)
- [ ] Title uses no quotes or single quotes (not double quotes)
- [ ] Code blocks have language tags
- [ ] Table of Contents (if present) uses `## 目录` not `## Table of Contents`
- [ ] Post-title metadata follows one consistent pattern

### Code Blocks
- [ ] All code comments are in English
- [ ] No Chinese characters anywhere inside ``` ```` code blocks
- [ ] Variable/function/class names are in English
- [ ] String literals in example code are in English (or use placeholder text)

### Diagrams
- [ ] All ASCII/Unicode diagram labels are in English
- [ ] Diagram layout is preserved (box-drawing characters not broken)

### Content
- [ ] `# Title` heading exists and matches the frontmatter `title:` (recommended)
- [ ] No duplicate `> ` excerpt block in the body if using frontmatter `description`
- [ ] Article renders correctly in preview (check both light/dark themes)
- [ ] Links to other docs/articles use correct relative paths
- [ ] Prose is in Chinese (for consistency with the rest of the blog)

### Build
- [ ] Run `yarn workspace @lucky/api lint` (or relevant workspace lint)
- [ ] Run `yarn workspace @lucky/api type-check`
- [ ] Run `yarn prettier --check docs/blog/articles/your-article.md`

---

## 4. Template

Copy this template when creating a new article:

```markdown
---
title: '文章标题：副标题'
slug: your-article-slug
tags:
  - Tag1
  - Tag2
  - Tag3
description: 用 1-2 句话概括文章核心内容，用于 SEO 和卡片展示。
---

# 文章标题：副标题

## 1. 背景

简要介绍问题背景和本文涵盖的内容。

```dart
// English comments only
final variable = someValue;
```

## 2. 主体内容

```
┌──────────┐    ┌──────────────┐
│  State A  │───→│  State B     │
└──────────┘    └──────────────┘
```

### 2.1 子章节

详细解释...

---

## N. 总结

1. 要点 1
2. 要点 2
3. 要点 3

*本文源码基于 [`path/to/file.ts`](path/to/file.ts)（N行），完整包含...等全部实现。*
```

---

## 5. Common Mistakes & How to Avoid Them

| # | Mistake | Example | Fix |
|---|---------|---------|-----|
| 1 | No YAML frontmatter | Starts directly with `# Title` | Add `---` block at line 1 |
| 2 | Chinese in code comments | `// 主色阶梯` | Replace with English: `// Primary color scale` |
| 3 | Chinese in diagram labels | `│  初始状态  │` | Replace with English: `│  Initial  │` |
| 4 | Metadata in excerpt | `> **Article F6** \| **Difficulty:** ⭐⭐⭐⭐` | Use `description:` with natural language |
| 5 | Slug/filename mismatch | `slug: article-x` for `my-post.md` | Make slug match filename |
| 6 | No `tags:` line | Tags missing from frontmatter | Add `tags: Flutter, Dart` in frontmatter |
| 7 | Duplicate excerpt in body | `> excerpt...` in body + `description:` in frontmatter | Remove the `> ` block from body |
| 8 | Chinese colon in title | `AuthNotifier + TokenStorage：Flutter` (uses `：`) | Use English colon: `AuthNotifier + TokenStorage: Flutter` |
| 9 | English prose in non-English category | Flutter articles written in English | Convert prose to Chinese (see Rule 8) |
| 10 | Missing `description` in frontmatter | Article has no `description:` field | Add a natural-language `description:` summary |

---

## 6. Troubleshooting

### "Article not showing up after import"

1. Check that YAML frontmatter is present with correct syntax (no trailing spaces, valid YAML quoting)
2. Verify `slug:` matches the filename
3. Verify `tags:` has at least one tag
4. Check the admin-blog import page for parsing errors

### "Article content is garbled after translation"

1. Check for Chinese characters inside code blocks
2. Check for Chinese labels in ASCII diagrams
3. Verify the article follows Rule 2 and Rule 3

### "Excerpt shows ugly metadata on the homepage"

1. Remove the `> **Article F6** | ...` quote block from the article body
2. Add a proper `description:` in YAML frontmatter
3. Re-import the article

### "Tags are empty after import"

1. Add `tags: Tag1, Tag2` to YAML frontmatter
2. If using legacy format (no frontmatter), add `Tags: Tag1, Tag2` as the first line after the `---` separator
3. Verify the tags format is one of the three supported formats (comma-separated, YAML list, or array)

---

## 7. Related Documents

- [`CODE_STYLE_RULES.md`](docs/blog/development/CODE_STYLE_RULES.md) — Code style and naming conventions (Chinese-free code mandate)
- [`BLOG_PROSE_STYLE_GUIDE.md`](docs/blog/design/BLOG_PROSE_STYLE_GUIDE.md) — Typography and formatting guide for article prose
- [`I18N_TRANSLATIONS_GUIDE.md`](docs/blog/i18n/I18N_TRANSLATIONS_GUIDE.md) — Multi-language translation documentation
- [`RICH_TEXT_EDITOR_MARKDOWN_MIGRATION_GUIDE.md`](docs/blog/development/RICH_TEXT_EDITOR_MARKDOWN_MIGRATION_GUIDE.md) — Rich text editor markdown migration
- [`fix-flutter-article-import-display.md`](plans/fix-flutter-article-import-display.md) — Root cause analysis for existing article issues
- [`frontmatter.ts`](apps/admin-blog/src/lib/utils/frontmatter.ts) — The frontmatter parser implementation
