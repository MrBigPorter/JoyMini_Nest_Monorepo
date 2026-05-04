# Translation Detection Fix: Category & Tag Semantic Content Validation

## Problem

The blog categories and tags API response shows that many entries have Chinese text (the source language `zh`) stored in ALL language fields (`en`, `ja`, `fr`, `de`, `ko`) instead of proper translations. The translation detection system fails to flag these as "untranslated" because it only checks for NULL or empty field values.

### Example: Categories with Chinese text in English/Japanese fields

| slug | zh (source) | en (should be) | en (actual) | ja (should be) | ja (actual) |
|------|-------------|----------------|-------------|----------------|-------------|
| frontend | 前端开发 | Frontend Development | 前端开发 | フロントエンド開発 | 前端开发 |
| backend | 后端开发 | Backend Development | 后端开发 | バックエンド開発 | 后端开发 |
| api | 接口管理 | API Management | 接口管理 | API管理 | 接口管理 |
| multi-platform | 多平台 | Multi-platform | 多平台 | マルチプラットフォーム | 多平台 |
| project | 项目案例 | Project Cases | 项目案例 | プロジェクト事例 | 项目案例 |
| admin | 管理后台 | Admin Panel | 管理后台 | 管理画面 | 管理后台 |

## Root Cause

The SQL queries used for detecting untranslated categories and tags only check for NULL or empty values. Since fields like `name->>'en'` contain "前端开发" (non-null, non-empty), the SQL considers them "translated".

### Affected Code Locations

All in [`apps/api/src/blog/blog.service.ts`](apps/api/src/blog/blog.service.ts):

1. **`getCategoryTranslationStats()`** (line 2258) — SQL query counts categories as "completed" if `name->>'en'` is non-null and non-empty, even if it contains Chinese text.

2. **`getTranslationIssues()`** (line 2436) — SQL query for categories only flags entries where `name->'en' IS NULL OR name->>'en' = ''`. Same for tags at line 2449.

3. **`getUntranslatedCategories()`** (line 2690) — Same simplified SQL pattern, only checks NULL/empty.

4. **`getUntranslatedTags()`** (line 2725) — Same simplified SQL pattern.

### Contrast: Article Detection

The [`detectArticleTranslationIssues()`](apps/api/src/blog/blog.service.ts:2524) method DOES perform semantic checks for articles:
- Compares `titleLocalized[lang]` against `titleLocalized.zh` (line 2535)
- Checks content length ratio (line 2547)
- Checks if content matches source language content exactly (line 2561)

But this logic is **NOT applied to categories and tags**.

### Existing Tool: `LanguageDetectionService.isFieldTranslated()`

The [`LanguageDetectionService.isFieldTranslated()`](apps/api/src/common/services/language-detection.service.ts:303) method already has logic to detect this:
- Checks if source value equals target value (line 323)
- Returns `{ translated: false, confidence: 0.9, reason: '与源文本完全相同' }` when they match
- BUT this method is never called for categories/tags during the SQL-based detection

## Fix Plan

### Task 1: Add post-SQL semantic filter to translation stats methods

**Files:**
- [`apps/api/src/blog/blog.service.ts`](apps/api/src/blog/blog.service.ts)

**Changes in [`getCategoryTranslationStats()`](apps/api/src/blog/blog.service.ts:2254):**
After the SQL query, add a post-filter that queries ALL categories and checks if the `name` field for `targetLang` actually contains Chinese characters (indicating untranslated content). Subtract those from the `completed` count.

Alternatively, enhance the SQL query to also check for Chinese character presence in the target language field when the target language is not `zh`:

```sql
-- For targetLang = 'en': also check that name->>'en' doesn't contain Chinese chars
SELECT COUNT(*) as count FROM blog_categories 
WHERE name IS NOT NULL 
  AND name != 'null'::jsonb 
  AND name->>${targetLang} IS NOT NULL 
  AND name->>${targetLang} != ''
  -- New: ensure the field doesn't contain Chinese characters (untranslated)
  AND (name->>${targetLang} !~ '[\u4e00-\u9fff\u3400-\u4dbf]' 
       OR ${targetLang} = 'zh')  -- skip check for zh (source language)
```

**Same pattern for [`getTagTranslationStats()`](apps/api/src/blog/blog.service.ts) (look up similar method).**

### Task 2: Fix `getTranslationIssues()` for categories and tags

**Changes at lines 2436-2459:**
Add an additional check that after identifying categories/tags with NULL/empty fields, also detects categories/tags where the target language field contains Chinese characters (the source language).

**Approach:** Add a second SQL query (or UNION) that finds categories/tags where:
- `name->>targetLang` contains Chinese characters (regex `[\u4e00-\u9fff\u3400-\u4dbf]`)
- AND `targetLang != 'zh'`

Example:
```sql
-- Categories with Chinese text in English/Japanese/etc fields
SELECT id, name, slug FROM blog_categories
WHERE "name" IS NOT NULL 
  AND "name" != 'null'::jsonb
  AND "name"->>${targetLang} IS NOT NULL 
  AND "name"->>${targetLang} != ''
  AND ${targetLang} != 'zh'
  AND "name"->>${targetLang} ~ '[\u4e00-\u9fff\u3400-\u4dbf]'
```

Union both result sets:
```sql
SELECT id, name, slug FROM blog_categories
WHERE
  "name" IS NULL
  OR "name" = 'null'::jsonb
  OR "name"->${targetLang} IS NULL
  OR jsonb_typeof("name"->${targetLang}) = 'null'
  OR "name"->>${targetLang} = ''
UNION
SELECT id, name, slug FROM blog_categories
WHERE "name" IS NOT NULL 
  AND "name" != 'null'::jsonb
  AND "name"->>${targetLang} IS NOT NULL 
  AND "name"->>${targetLang} != ''
  AND ${targetLang} != 'zh'
  AND "name"->>${targetLang} ~ '[\u4e00-\u9fff\u3400-\u4dbf]'
```

**Same fix for tags (lines 2449-2459).**

### Task 3: Fix `getUntranslatedCategories()` and `getUntranslatedTags()`

Same approach as Task 2 — add Chinese character detection to the SQL queries in these methods (lines 2690 and 2725).

### Task 4: Add batch re-translate endpoint for affected categories/tags

Add an API endpoint that:
1. Queries all categories/tags with Chinese text in non-zh language fields
2. Queues them for re-translation via the existing `queueFullLocaleTranslation` or individual translation jobs

**Location:**
- [`apps/api/src/blog/blog.controller.ts`](apps/api/src/blog/blog.controller.ts) — new endpoint `POST /v1/admin/blog/translation/repair-categories-tags`
- [`apps/api/src/blog/blog.service.ts`](apps/api/src/blog/blog.service.ts) — new method `repairUntranslatedCategories()`

### Task 5: Fix seed/import scripts to prevent recurrence

**Files:**
- [`apps/api/scripts/seed/seed-blog-categories-tags.ts`](apps/api/scripts/seed/seed-blog-categories-tags.ts)
- [`scripts/batch-import-blog-articles.ts`](scripts/batch-import-blog-articles.ts) (line 432: `name: { zh: tagName, en: tagName }`)

Ensure seed scripts only set `name.zh` and let the AI translation system populate other languages.

## Risk Assessment

- **SQL regex performance**: The `~` operator with regex on JSONB fields may be slower on large datasets. Consider indexing or limiting to targeted queries.
- **False positives**: Proper nouns like "NestJS", "Prisma" in Chinese context are English already — they won't contain Chinese characters, so they won't trigger false positives. However, some technical terms like "WebSocket" (same in both languages) are safe.
- **Backward compatibility**: Existing API responses will now correctly report these as issues, which is the desired behavior. No breaking changes to API contracts.

## Verification

After implementation:
1. Call `GET /v1/admin/blog/translation-issues?languageCode=en` — should show categories like "前端开发", "后端开发", "接口管理" as having missing `en` translations
2. Call `GET /v1/admin/blog/untranslated-categories?languageCode=en` — should include same entries
3. Translation progress stats should no longer count these as "completed"
