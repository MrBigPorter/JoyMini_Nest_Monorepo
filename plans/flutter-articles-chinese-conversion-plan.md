# Flutter Articles Chinese Conversion Plan

## Objective

Convert all 22 Flutter blog articles from English to Chinese prose, ensuring compliance with the updated [`ARTICLE_AUTHORING_STANDARD.md v2.0.0`](docs/blog/development/ARTICLE_AUTHORING_STANDARD.md) — including both frontmatter format and article style guide.

---

## Phase 0: Standard Document Updated ✅

[`ARTICLE_AUTHORING_STANDARD.md`](docs/blog/development/ARTICLE_AUTHORING_STANDARD.md) has been updated to **v2.0.0** with:

### Frontmatter Standard (Section 1-2)
- Documented all 3 supported tags formats (comma-separated, YAML list, array)
- Added `category` and `date` as optional fields
- Added field ordering convention (`title → slug → tags → description`)
- Added Rule 8: Article prose can be in Chinese
- Added Mistake #9 (English prose) and #10 (missing description) to common mistakes

### Article Style Guide (Section 3 — NEW)
- **3.1 Section Numbering**: Arabic numerals preferred (`## 1.`, `### 2.1`)
- **3.2 First Section Name**: Chinese names recommended (`## 1. 概述`, `## 1. 背景`, `## 1. 引言`)
- **3.3 Post-Title Metadata Block**: 3 patterns:
  - Pattern A: `> **架构关键词**: 关键词1 | 关键词2` (summary blockquote)
  - Pattern B: `> **难度**: ⭐⭐⭐⭐` (key info blockquote)
  - Pattern C: `**日期：** 2024-01-01` + `**标签：** Tag1, Tag2` (date+tags)
- **3.4 Summary/Ending Section**: `## N. 关键要点` or `## N. 总结`, with optional `**相关阅读**`
- **3.5 Title Quoting Style**: No quotes or single quotes for special characters
- **3.6 Inline Code and File References**: Use backticks with optional relative path + line number
- **3.7 Separator Lines**: Use `---` sparingly between major sections
- **3.8 Code Block Language Tags**: Always specify language (e.g., ` ```dart`, ` ```typescript`)
- **3.9 Table of Contents**: Only for 500+ line articles, use `## 目录`

### Updated Template (Section 4)
Template now uses Chinese prose, Chinese section names, and Chinese metadata block.

---

## Phase 1: Fix 22 Flutter Articles — Prose Conversion + Frontmatter Fix

### Scope of Changes Per Article

For each of the 22 Flutter articles, the following changes are needed:

1. **Frontmatter fixes:**
   - Convert `tags: [Tag1, Tag2]` array format → `tags: Tag1, Tag2` comma-separated format
   - Ensure `title` is present and in Chinese
   - Ensure `slug` matches filename
   - Ensure `description` is present and in Chinese
   - Ensure field ordering follows `title → slug → tags → description`

2. **Prose conversion:**
   - Convert all English prose (title, description, body text) to Chinese
   - Keep all code blocks in English (Rule 2, Rule 7)
   - Keep all ASCII/Unicode diagram labels in English (Rule 3)
   - Keep code comments in English (Rule 2)

3. **Style unification (per Style Guide Section 3):**
   - Convert `## Overview` / `## Summary` → `## 1. 概述` / `## N. 关键要点` (Chinese section names)
   - Add `> **架构关键词**: ...` metadata block after title (Pattern A)
   - Ensure section numbering uses Arabic numerals
   - Ensure `# Title` heading matches frontmatter `title`
   - Add `## 目录` for articles 500+ lines (if not already present)
   - Ensure ending section follows `## N. 关键要点` or `## N. 总结` pattern

### Article List (22 total)

#### Batch 1 — Small articles (≤300 lines, 6 articles)
| # | File | Lines | Tags Format |
|---|------|-------|-------------|
| 1 | [`app-bootstrap-data-barrier-parallel-init.md`](docs/blog/articles/flutter/app-bootstrap-data-barrier-parallel-init.md) | 230 | comma-separated |
| 2 | [`kyc-guard-state-machine-route-guard.md`](docs/blog/articles/flutter/kyc-guard-state-machine-route-guard.md) | 241 | comma-separated |
| 3 | [`unified-interceptor-error-strategy-token-refresh.md`](docs/blog/articles/flutter/unified-interceptor-error-strategy-token-refresh.md) | 315 | array |
| 4 | [`share-service-deep-link-platform-integration.md`](docs/blog/articles/flutter/share-service-deep-link-platform-integration.md) | 354 | comma-separated |
| 5 | [`pipeline-runner-sequential-execution.md`](docs/blog/articles/flutter/pipeline-runner-sequential-execution.md) | 432 | array |
| 6 | [`auth-notifier-token-storage-auth-state-machine.md`](docs/blog/articles/flutter/auth-notifier-token-storage-auth-state-machine.md) | 426 | comma-separated |

#### Batch 2 — Medium articles (300-600 lines, 9 articles)
| # | File | Lines | Tags Format |
|---|------|-------|-------------|
| 7 | [`platform-adapter-conditional-export.md`](docs/blog/articles/flutter/platform-adapter-conditional-export.md) | 457 | array |
| 8 | [`http-static-class-dual-dio-native-adapter.md`](docs/blog/articles/flutter/http-static-class-dual-dio-native-adapter.md) | 481 | array |
| 9 | [`server-time-helper-calibration-countdown.md`](docs/blog/articles/flutter/server-time-helper-calibration-countdown.md) | 525 | array |
| 10 | [`app-startup-data-pre-warming.md`](docs/blog/articles/flutter/app-startup-data-pre-warming.md) | 521 | array |
| 11 | [`design-tokens-generated-system.md`](docs/blog/articles/flutter/design-tokens-generated-system.md) | 542 | comma-separated |
| 12 | [`gorouter-route-system-shell-route-auth.md`](docs/blog/articles/flutter/gorouter-route-system-shell-route-auth.md) | 554 | array |
| 13 | [`device-fingerprint-risk-control.md`](docs/blog/articles/flutter/device-fingerprint-risk-control.md) | 570 | array |
| 14 | [`deep-link-oauth-global-handler.md`](docs/blog/articles/flutter/deep-link-oauth-global-handler.md) | 595 | array |
| 15 | [`modal-system-base-config-radix-sheet-modal.md`](docs/blog/articles/flutter/modal-system-base-config-radix-sheet-modal.md) | 620 | array |

#### Batch 3 — Large articles (600-900 lines, 4 articles)
| # | File | Lines | Tags Format |
|---|------|-------|-------------|
| 16 | [`error-strategy-decision-table.md`](docs/blog/articles/flutter/error-strategy-decision-table.md) | 644 | comma-separated |
| 17 | [`global-handler-callkit-webrtc.md`](docs/blog/articles/flutter/global-handler-callkit-webrtc.md) | 702 | array |
| 18 | [`hydrated-state-notifier-abstract-persistence.md`](docs/blog/articles/flutter/hydrated-state-notifier-abstract-persistence.md) | 413 | array |
| 19 | [`api-cache-manager-dual-storage-swr.md`](docs/blog/articles/flutter/api-cache-manager-dual-storage-swr.md) | 447 | array |

#### Batch 4 — Extra large articles (900+ lines, 3 articles)
| # | File | Lines | Tags Format |
|---|------|-------|-------------|
| 20 | [`image-cache-manager-l1-l2-responsive-image-service.md`](docs/blog/articles/flutter/image-cache-manager-l1-l2-responsive-image-service.md) | 1270 | array |
| 21 | [`global-upload-service-s3-compression-mime.md`](docs/blog/articles/flutter/global-upload-service-s3-compression-mime.md) | 1382 | array |
| 22 | [`lucky-form-theme-validator-system.md`](docs/blog/articles/flutter/lucky-form-theme-validator-system.md) | 1623 | array |

### Conversion Rules

1. **Title**: Convert to Chinese, keep technical terms in English (e.g., "ApiCacheManager: Dual Storage + SWR Cache Strategy" → "ApiCacheManager：双重存储 + SWR 缓存策略")
2. **Description**: Convert to Chinese summary
3. **Body prose**: Convert all explanatory text to Chinese
4. **Code blocks**: Keep entirely in English (no changes)
5. **Diagram labels**: Keep in English (no changes)
6. **Code comments**: Keep in English (no changes)
7. **Tags**: Convert from array format `[Tag1, Tag2]` to comma-separated `Tag1, Tag2`
8. **Field ordering**: Ensure `title → slug → tags → description` order
9. **`# Title` heading**: Ensure it matches frontmatter `title`
10. **Section names**: Convert English section names to Chinese (e.g., `## Overview` → `## 1. 概述`, `## Summary` → `## N. 关键要点`)
11. **Metadata block**: Add `> **架构关键词**: ...` after title
12. **Section numbering**: Ensure Arabic numerals throughout

### Verification Checklist

After conversion, verify each article:
- [ ] Frontmatter has all required fields (title, slug, tags, description)
- [ ] Tags use comma-separated format
- [ ] Field order: title → slug → tags → description
- [ ] Title is in Chinese
- [ ] Description is in Chinese
- [ ] Body prose is in Chinese
- [ ] Code blocks are still in English
- [ ] Diagram labels are still in English
- [ ] Code comments are still in English
- [ ] `# Title` heading matches frontmatter `title`
- [ ] `slug` matches filename
- [ ] Section names use Chinese (e.g., `## 1. 概述`, `## N. 关键要点`)
- [ ] Metadata block present after title (`> **架构关键词**: ...`)
- [ ] Section numbering uses Arabic numerals
- [ ] No broken markdown syntax
- [ ] No Chinese characters in code blocks
