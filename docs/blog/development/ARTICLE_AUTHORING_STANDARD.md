# Blog Article Authoring Standard v1.0.0

> Standard for authoring blog articles in the Lucky Nest monorepo.  
> Ensures correct parsing, proper metadata extraction, clean AI translation, and correct frontend rendering.

---

## Table of Contents

1. [Required YAML Frontmatter](#1-required-yaml-frontmatter)
2. [Rules](#2-rules)
3. [Pre-Submit Checklist](#3-pre-submit-checklist)
4. [Template](#4-template)
5. [Common Mistakes & How to Avoid Them](#5-common-mistakes--how-to-avoid-them)
6. [Troubleshooting](#6-troubleshooting)
7. [Related Documents](#7-related-documents)

---

## 1. Required YAML Frontmatter

Every blog article **MUST** start with a YAML frontmatter block. Without it, the import system cannot extract tags, description, or slug correctly.

```markdown
---
title: Your Article Title Here
slug: your-article-slug
tags: Tag1, Tag2, Tag3
description: A concise 1-2 sentence summary of the article (used as excerpt/SEO description)
---

# Your Article Title

Article content starts here...
```

### Field Reference

| Field | Required | Max Length | Description |
|-------|----------|------------|-------------|
| `title` | ✅ Yes | 200 chars | Article title, same as the `# Title` heading below |
| `slug` | ✅ Yes | — | URL-friendly identifier; **must match the filename** (e.g., `slug: my-article` ↔ `my-article.md`) |
| `tags` | ✅ Yes | — | Comma-separated tag names (e.g., `Flutter, Dart, Auth`); use existing tags when possible |
| `description` | ✅ Yes | 1000 chars | Natural-language summary; appears in ArticleCard, SEO `<meta>`, social share previews |

> **Note:** The `# Title` heading in the body should match the frontmatter `title:` field, though this is not strictly enforced by the parser.

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

### Rule 7: Zero Chinese Characters in Code Blocks

This includes:
- Variable names: `final 颜色 = ...` ❌
- Function names: `void 获取数据()` ❌
- Comments: `// 这是注释` ❌
- String literals shown as code examples: `'这是一个字符串'` ❌
- File paths: `joy_mini_app/lib/gen/` ✅ (English only)

### Rule 8: Article Prose Can Be in Chinese

Only **code blocks** and **diagram labels** must be English. The article's explanatory text can be in Chinese — the AI translation pipeline will handle translating it to other languages.

---

## 3. Pre-Submit Checklist

Before committing a new article, verify each item:

### Frontmatter
- [ ] YAML frontmatter `---` block is present at line 1
- [ ] `title:` is filled (≤200 chars)
- [ ] `slug:` matches the filename (without `.md` extension)
- [ ] `tags:` has at least one tag, comma-separated
- [ ] `description:` is a natural-language summary (not metadata markers)

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

### Build
- [ ] Run `yarn workspace @lucky/api lint` (or relevant workspace lint)
- [ ] Run `yarn workspace @lucky/api type-check`
- [ ] Run `yarn prettier --check docs/blog/articles/your-article.md`

---

## 4. Template

Copy this template when creating a new article:

```markdown
---
title: Your Article Title
slug: your-article-slug
tags: Tag1, Tag2, Tag3
description: A concise 1-2 sentence summary of the article for SEO and card display.
---

# Your Article Title

## 1. Introduction

Brief overview of the problem and what this article covers.

```dart
// English comments only
final variable = someValue;
```

## 2. Main Content

```
┌──────────┐    ┌──────────────┐
│  State A  │───→│  State B     │
└──────────┘    └──────────────┘
```

### 2.1 Subsection

Detailed explanation here...

## 3. Summary

Key takeaways and conclusion.
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

---

## 7. Related Documents

- [`CODE_STYLE_RULES.md`](docs/blog/development/CODE_STYLE_RULES.md) — Code style and naming conventions (Chinese-free code mandate)
- [`BLOG_PROSE_STYLE_GUIDE.md`](docs/blog/design/BLOG_PROSE_STYLE_GUIDE.md) — Typography and formatting guide for article prose
- [`I18N_TRANSLATIONS_GUIDE.md`](docs/blog/i18n/I18N_TRANSLATIONS_GUIDE.md) — Multi-language translation documentation
- [`RICH_TEXT_EDITOR_MARKDOWN_MIGRATION_GUIDE.md`](docs/blog/development/RICH_TEXT_EDITOR_MARKDOWN_MIGRATION_GUIDE.md) — Rich text editor markdown migration
- [`fix-flutter-article-import-display.md`](plans/fix-flutter-article-import-display.md) — Root cause analysis for existing article issues
- [`frontmatter.ts`](apps/admin-blog/src/lib/utils/frontmatter.ts) — The frontmatter parser implementation
