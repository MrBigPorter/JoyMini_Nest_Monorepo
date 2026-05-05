# Admin Blog 内容跟随语言设置 — 实施计划

## 概述

当管理员在后台切换到英语（或其他语言）时，文章列表、详情预览等**只读场景**显示对应语言的翻译内容；**编辑场景**保持完整多语言编辑器不变。

## 现状

- 后端 [`mapArticleToLocalized()`](apps/api/src/blog/blog.service.ts:833) 已支持根据 `locale` 参数解析内容，默认 `locale='zh'`
- Admin 控制器 [`getArticles`](apps/api/src/blog/blog.controller.ts:36) 接受 `locale` 参数，但 [`getArticle`](apps/api/src/blog/blog.controller.ts:72) 和 [`getArticleBySlug`](apps/api/src/blog/blog.controller.ts:76) **不接受**
- 前端 HTTP 客户端 ([`http.ts`](apps/admin-blog/src/api/http.ts:71)) 发送 `Accept-Language` header，但后端 admin 端未使用
- 前端 [`blogApi.getArticles`](apps/admin-blog/src/api/index.ts:52) 和 [`blogApi.getArticleBySlug`](apps/admin-blog/src/api/index.ts:80) **未传递 locale 参数**

## UI 中所有需要改动的地方

通过完整扫描，发现以下 4 个前端文件需要 UI 层面的修改：

| # | 页面/组件 | 当前问题 | 需要改动 |
|---|----------|---------|---------|
| 1 | [**文章列表**](apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx) | 未传 `locale` 到 API，后端默认返回中文 | 请求时加 `locale: lang` |
| 2 | [**文章详情**](apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx) | 未传 `locale` 到 API，后端默认返回中文 | 请求时加 `locale` |
| 3 | [**博客仪表盘**](apps/admin-blog/src/app/(dashboard)/blog/page.tsx) | ✅ 已正确使用 `renderLocalizedText` 和 `LocalizedText` | **无需改动** |
| 4 | [**评论管理**](apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx) | ✅ `fetchArticles()` 已使用 `renderLocalizedText(article.title, lang, ...)` | **无需改动** |
| 5 | [**文章编辑弹窗**](apps/admin-blog/src/views/blog/BlogArticleModal.tsx) | 分类和标签显示硬编码 `'zh'` | 改为使用 `lang` 变量 |
| 6 | [**翻译质量检测**](apps/admin-blog/src/views/blog/BlogTranslationQualityDetection.tsx) | 文章标题显示原始 `article.title`（字符串），未跟随语言 | 使用 `LocalizedText` 组件 |
| 7 | [**翻译进度**](apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx) | 文章标题显示原始 `article.title`（字符串），未跟随语言 | 使用 `LocalizedText` 组件 |

## 实施步骤

### Step 1: 后端 — 给 getArticle 和 getArticleBySlug 添加 locale 参数

**文件**: [`apps/api/src/blog/blog.controller.ts`](apps/api/src/blog/blog.controller.ts)

**改动 1a**: `getArticle()` — 添加 `@Query('locale') locale?: string` 参数，传递给 service

```typescript
// 当前 (line 72)
async getArticle(@Param('id') id: string) {
  return this.blogService.getArticle(id, true);
}

// 改为
async getArticle(
  @Param('id') id: string,
  @Query('locale') locale?: string,
) {
  return this.blogService.getArticle(id, true, locale);
}
```

**改动 1b**: `getArticleBySlug()` — 同理添加 locale 参数

```typescript
// 当前 (line 80)
async getArticleBySlug(@Param('slug') slug: string) {
  return this.blogService.getArticleBySlug(slug, true);
}

// 改为
async getArticleBySlug(
  @Param('slug') slug: string,
  @Query('locale') locale?: string,
) {
  return this.blogService.getArticleBySlug(slug, true, locale);
}
```

**文件**: [`apps/api/src/blog/blog.service.ts`](apps/api/src/blog/blog.service.ts)

**改动 1c**: `getArticle()` 方法签名 — 添加 `locale` 参数

```typescript
// 当前 (line 1045)
async getArticle(id: string, incrementView = false) {

// 改为
async getArticle(id: string, incrementView = false, locale?: string) {
```

并将内部调用 `mapArticleToLocalized(article)` 改为 `mapArticleToLocalized(article, locale || 'zh')`

**改动 1d**: `getArticleBySlug()` 方法签名 — 已有 `locale` 参数，无需改动 service
```
// 当前 (line 1085) — 已有 locale 参数
async getArticleBySlug(slug: string, incrementView = false, locale: string = 'zh', options = {})
```
只需确认 controller 正确传递即可。

### Step 2: 前端 — blogApi 添加 locale 参数

**文件**: [`apps/admin-blog/src/api/index.ts`](apps/admin-blog/src/api/index.ts)

**改动 2a**: `getArticles` — 在 params 类型中添加 locale

```typescript
// 当前 (line 52)
getArticles: async (params?: { page?: number; pageSize?: number; status?: string; categoryId?: string; tagId?: string; search?: string }) => {

// 改为
getArticles: async (params?: { page?: number; pageSize?: number; status?: string; categoryId?: string; tagId?: string; search?: string; locale?: string }) => {
```

**改动 2b**: `getArticleBySlug` — 添加 locale 参数

```typescript
// 当前 (line 80)
getArticleBySlug: async (slug: string, ssrToken?: string) => {

// 改为
getArticleBySlug: async (slug: string, locale?: string, ssrToken?: string) => {
```

### Step 3: 前端 — 文章列表页传递 locale

**文件**: [`apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx)

**改动 3a**: `requestArticles` 函数 — 在请求参数中加入 `locale: lang`

```typescript
// 在 requestArticles 中，line 495-501 附近
const response = await blogApi.getArticles({
  search: params.search,
  status: status,
  categoryId: params.category || undefined,
  page: params.current,
  pageSize: params.pageSize,
  locale: lang,  // ← 新增
});
```

`lang` 已在 line 71 从 `useTranslation()` 中解构：`const { t: globalT, lang } = useTranslation();`

### Step 4: 前端 — 文章详情页传递 locale

**文件**: [`apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx)

**改动 4a**: 获取文章时传递 locale

```typescript
// 当前 (line 134)
} = useRequest<ArticlePreview, any[]>(() => blogApi.getArticleBySlug(slug), {

// 改为
} = useRequest<ArticlePreview, any[]>(() => blogApi.getArticleBySlug(slug, locale), {
```

`locale` 已在 line 123 从 `useLanguage()` 中获取：`const { locale } = useLanguage();`

### Step 5: 前端 — 文章编辑弹窗修复硬编码 'zh'

**文件**: [`apps/admin-blog/src/views/blog/BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx)

**改动 5a**: 分类下拉选项 — 将硬编码 `'zh'` 改为 `lang`

```typescript
// 当前 (line 537)
label: renderLocalizedText(c.name, 'zh', c.id),

// 改为
label: renderLocalizedText(c.name, lang, c.id),
```

**改动 5b**: 标签按钮 — 将硬编码 `'zh'` 改为 `lang`

```typescript
// 当前 (line 772)
{renderLocalizedText(tag.name, 'zh', tag.id)}

// 改为
{renderLocalizedText(tag.name, lang, tag.id)}
```

`lang` 已在 line 53 从 `useTranslation()` 中解构：`const { t: globalT, lang } = useTranslation();`

### Step 6: 前端 — 翻译质量检测页面使用 LocalizedText

**文件**: [`apps/admin-blog/src/views/blog/BlogTranslationQualityDetection.tsx`](apps/admin-blog/src/views/blog/BlogTranslationQualityDetection.tsx)

**改动 6a**: 添加 `lang` 变量和 `LocalizedText` 导入

```typescript
// 当前 (line 8)
import { useTranslation } from '@/hooks/useTranslation';

// 当前 (line 113)
const { t: globalT } = useTranslation();

// 改为
import { useTranslation } from '@/hooks/useTranslation';
import LocalizedText from '@/components/blog/LocalizedText';  // ← 新增导入

// line 113
const { t: globalT, lang } = useTranslation();  // ← 添加 lang
```

**改动 6b**: 文章标题显示使用 LocalizedText

```typescript
// 当前 (line 412)
<div className="font-medium text-gray-900 dark:text-white text-sm">
  {article.title}
</div>

// 改为
<div className="font-medium text-gray-900 dark:text-white text-sm">
  <LocalizedText value={article.title} />
</div>
```

### Step 7: 前端 — 翻译进度页面使用 LocalizedText

**文件**: [`apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx`](apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx)

**改动 7a**: 文章标题显示使用 LocalizedText

```typescript
// 当前 (line 1054)
<div className="font-medium">{article.title}</div>

// 改为
<div className="font-medium"><LocalizedText value={article.title} /></div>
```

`LocalizedText` 已在 line 30 中导入：`import LocalizedText from '@/components/blog/LocalizedText.tsx';`
`lang` 已在 line 622 从 `useTranslation()` 中解构：`const { t: globalT, lang } = useTranslation();`

### Step 8: 测试验证

1. **切换语言为中文** → 所有页面的文章标题/内容显示中文
2. **切换语言为英文** → 显示英文内容（如果有翻译），否则回退中文
3. **切换语言为日文/法文/韩文等** → 显示对应翻译（如果有），否则回退中文
4. **文章编辑弹窗** → 分类和标签名称跟随语言切换
5. **翻译管理页面**（质量检测、进度）→ 文章标题跟随语言

## 涉及文件清单

| # | 文件 | 改动类型 | 改动内容 |
|---|------|---------|---------|
| 1 | `apps/api/src/blog/blog.controller.ts` | 后端 | getArticle / getArticleBySlug 添加 `locale` query 参数 |
| 2 | `apps/api/src/blog/blog.service.ts` | 后端 | getArticle 添加 `locale` 参数，透传给 mapArticleToLocalized |
| 3 | `apps/admin-blog/src/api/index.ts` | 前端 API | getArticles 和 getArticleBySlug 添加 `locale` 参数 |
| 4 | `apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx` | 前端 UI | 列表请求传 `locale: lang` |
| 5 | `apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx` | 前端 UI | 详情请求传 `locale` |
| 6 | `apps/admin-blog/src/views/blog/BlogArticleModal.tsx` | 前端 UI | 分类/标签硬编码 `'zh'` → 改为 `lang` |
| 7 | `apps/admin-blog/src/views/blog/BlogTranslationQualityDetection.tsx` | 前端 UI | 文章标题使用 `<LocalizedText>`，添加 `lang` |
| 8 | `apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx` | 前端 UI | 文章标题使用 `<LocalizedText>` |
| 9 | `apps/admin-blog/src/app/(dashboard)/blog/categories/page.tsx` | 前端 UI | 分类名称 `renderLocalizedText(category.name)` 缺 `lang` 参数 |

## 不涉及的文件

- `ArticleForm.tsx` — 编辑表单已是多语言编辑器，无需改动
- `LocalizedText.tsx` — 组件逻辑兼容字符串和对象，无需改动
- `schema/blog.ts` — Zod schema 已支持 localizedStringSchema，无需改动
- Dashboard 页面 — 已正确使用 `renderLocalizedText` 和 `LocalizedText`
- 评论页面 — `fetchArticles()` 已使用 `renderLocalizedText(article.title, lang, ...)`
- HTTP 客户端 `http.ts` — 已发送 `Accept-Language` header，无需改动
