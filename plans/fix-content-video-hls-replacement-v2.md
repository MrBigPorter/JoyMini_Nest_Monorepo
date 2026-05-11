# 综合方案：HLS 修复 + "清除翻译" 按钮

## 问题分析

### 问题 1：视频以 MP4 播放而非 HLS
- 之前的修复只修改了 `contentMd`，但 Quill 文章渲染路径使用 `content`（通过 `dangerouslySetInnerHTML`），`contentMd` 从未被使用
- 需要在 `mapArticleForFrontend` 中直接替换 `result.content` 的 MP4 URL 为 HLS URL

### 问题 2：视频需要跨语言存在
- 用户在源语言编辑器插入视频后，其他语言的 content 没有该视频
- `meta.contentVideo[]` 已是全局的。AI 翻译处理器（[`processArticleTranslation`](apps/api/src/blog/processors/blog-ai.processor.ts:1269)）能自动保留视频标签
- 解决方案：提供"清除翻译"按钮，清除其他语言翻译后，用户点击"Update"保存时自动触发翻译

## 方案架构

```mermaid
flowchart TD
    subgraph 用户操作
        A[用户打开编辑弹窗] --> B[在源语言编辑器插入视频\n放到正确位置]
        B --> C[点击'清除翻译'按钮]
        C --> D[清除其他语言翻译\n不自动翻译]
        D --> E[点击'Update'保存]
    end

    subgraph 后端处理
        E --> F[updateArticle保存文章]
        F --> G[/blog/service.ts: 660-679 自动投递翻译任务]
        G --> H[AI翻译processArticleTranslation]
        H --> I[读取源语言HTML\n含video标签]
        I --> J[提取video标签保留]
        J --> K[翻译文本 + 追加video]
        K --> L[保存到contentLocalized]
    end
```

## Phase 1：HLS 修复（`frontend-blog.service.ts` 仅后端）

### 新增方法 `replaceVideoSrcInHtml`

在 [`mapArticleForFrontend()`](apps/api/src/blog/frontend/frontend-blog.service.ts:326) 中，获取 `result.content` 后，直接替换其中的 MP4 src 为 HLS src。

```typescript
private replaceVideoSrcInHtml(
  html: string,
  contentVideo: Array<{ videoKey: string; hlsUrl: string; poster?: string | null }>,
): string {
  if (!html || !contentVideo?.length) return html;
  return html.replace(
    /<video\s+([^>]*?)src="([^"]+)"([^>]*)>/gi,
    (_fullMatch, beforeSrc, srcUrl, afterSrc) => {
      const entry = contentVideo.find(e => srcUrl.includes(e.videoKey));
      if (!entry?.hlsUrl) return _fullMatch;
      let newAttrs = (beforeSrc + ' ' + afterSrc).trim();
      newAttrs = newAttrs.replace(/\s+poster="[^"]*"/gi, '');
      const posterAttr = entry.poster ? ` poster="${entry.poster}"` : '';
      return `<video${posterAttr} src="${entry.hlsUrl}" ${newAttrs}>`;
    },
  );
}
```

在 [`mapArticleForFrontend`](apps/api/src/blog/frontend/frontend-blog.service.ts:326) 中调用：

```typescript
// 替换 content 中的 MP4 URL 为 HLS URL
const contentVideoArr = Array.isArray(result.meta?.contentVideo)
  ? result.meta.contentVideo
  : undefined;
if (result.content && contentVideoArr?.length) {
  result.content = this.replaceVideoSrcInHtml(result.content, contentVideoArr);
}
```

### 前端无需修改 HLS 逻辑

前端 [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:195) 的 `useEffect` 中已有 HLS fallback 逻辑。直接替换 src 为 HLS 更可靠，减少运行时查找开销和竞态条件。

## Phase 2：清除翻译（后端 + 前端）

**注意**：该按钮只清除其他语言的翻译，**不会自动投递翻译任务**。
翻译会在用户点击"Update"保存时由 [`updateArticle()`](apps/api/src/blog/blog.service.ts:589) 自动触发（[第660-679行](apps/api/src/blog/blog.service.ts:660)）。

### 2a. 后端：新增 `clearArticleTranslationsForLocales` 方法

在 [`blog.service.ts`](apps/api/src/blog/blog.service.ts) 中新增：

```typescript
/**
 * 清除文章所有其他语言的翻译，保留源语言
 * 不自动投递翻译任务——翻译在用户点击 Update 保存时触发
 * 用于用户在源语言编辑器中插入视频后清除其他语言翻译
 */
async clearArticleTranslationsForLocales(
  articleId: string,
): Promise<{ success: boolean; cleared: string[]; message: string }> {
  const article = await this.prisma.blogArticle.findUnique({
    where: { id: articleId },
    select: {
      id: true,
      titleLocalized: true,
      contentLocalized: true,
      contentMdLocalized: true,
      excerptLocalized: true,
    },
  });
  if (!article) throw new NotFoundException('Article not found');

  const { list: locales } = await this.systemConfigService.getBlogLocales();
  const enabledCodes = locales.filter((l) => l.enabled).map((l) => l.code);
  const sourceLang = await this.systemConfigService.get<string>(
    'blog.translation.defaultSourceLang',
    'zh',
  );

  const titleLoc = (article.titleLocalized as any) ?? {};
  const contentLoc = (article.contentLocalized as any) ?? {};
  const contentMdLoc = (article.contentMdLocalized as any) ?? {};
  const excerptLoc = (article.excerptLocalized as any) ?? {};

  const clearedLangs: string[] = [];

  for (const targetLang of enabledCodes) {
    if (targetLang === sourceLang) continue;
    const hasContent = contentLoc[targetLang] || contentMdLoc[targetLang];
    if (!hasContent) continue;
    delete titleLoc[targetLang];
    delete contentLoc[targetLang];
    delete contentMdLoc[targetLang];
    delete excerptLoc[targetLang];
    clearedLangs.push(targetLang);
  }

  if (clearedLangs.length === 0) {
    return { success: true, cleared: [], message: 'No translations to clear' };
  }

  // 更新数据库，仅清除翻译，不投递翻译任务
  await this.prisma.blogArticle.update({
    where: { id: articleId },
    data: {
      titleLocalized: titleLoc,
      contentLocalized: contentLoc,
      contentMdLocalized: contentMdLoc,
      excerptLocalized: excerptLoc,
      translationStatus: 'PENDING',
    },
  });

  this.logger.log(
    `clearArticleTranslationsForLocales: cleared [${clearedLangs.join(', ')}] for article ${articleId}. Translation will happen on next save.`,
  );

  return {
    success: true,
    cleared: clearedLangs,
    message: `已清除 ${clearedLangs.length} 个语言的翻译，保存文章时将自动重新翻译`,
  };
}
```

### 2b. 后端：新增 API 路由

在 [`blog.controller.ts`](apps/api/src/blog/blog.controller.ts) 中新增：

```typescript
@Post('articles/:id/clear-translations')
@ApiBearerAuth()
@RequirePermission('blog', 'article_manage')
@ApiOperation({ summary: '清除文章所有其他语言的翻译（不自动翻译，保存时触发翻译）' })
async clearArticleLocaleTranslations(@Param('id') id: string) {
  return this.blogService.clearArticleTranslationsForLocales(id);
}
```

### 2c. 前端：新增 API 方法

在 [`apps/admin-blog/src/api/index.ts`](apps/admin-blog/src/api/index.ts) 中新增：

```typescript
clearArticleTranslations: async (id: string) => {
  return await http.post<any>(
    `/v1/admin/blog/articles/${id}/clear-translations`,
  );
},
```

### 2d. 前端：编辑弹窗新增按钮

在 [`BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx:560) 中，现有的"重新翻译"按钮旁边新增"清除翻译"按钮：

```tsx
{isEditing && (
  <>
    {/* 现有重新翻译按钮 */}
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="flex items-center gap-2"
      isLoading={isTranslating}
      onClick={async () => { /* ... */ }}
    >
      <Globe size={16} />
      {t('retranslate')}
    </Button>

    {/* 新增清除翻译按钮（不清除源语言，不自动翻译） */}
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="flex items-center gap-2"
      isLoading={isClearingTranslations}
      onClick={async () => {
        if (!editingArticle?.id) return;
        try {
          setIsClearingTranslations(true);
          const result = await blogApi.clearArticleTranslations(editingArticle.id);
          addToast('success', `${t('translationsCleared')}: ${result.cleared?.join(', ') || ''}`);
          // 重新获取数据并刷新表单
          const fresh = await blogApi.getArticle(editingArticle.id);
          if (fresh) { /* 刷新表单逻辑 */ }
        } catch (error) {
          console.error('Clear translations failed:', error);
          addToast('error', t('clearTranslationsFailed'));
        } finally {
          setIsClearingTranslations(false);
        }
      }}
    >
      <Globe size={16} />
      {t('clearTranslations')}
    </Button>
  </>
)}
```

需要新增状态：
```typescript
const [isClearingTranslations, setIsClearingTranslations] = useState(false);
```

需要新增翻译键（在6个语言文件中）：
- `blog_article_clearTranslations` → 清除翻译 / Clear Translations
- `blog_article_translationsCleared` → 已清除翻译 (保持原键名)
- `blog_article_clearTranslationsFailed` → 清除翻译失败

## 用户问题的完整答案

### 关于"编辑未翻译的语言只能手动拖到相应的位置吗？未翻译的语言呢？"

**新方案的回答：不需要手动拖！**

1. **用户工作流：**
   - 在源语言（zh）编辑器插入视频 → 放到正确位置 → 保存文章
   - 点击 **"清除翻译"** 按钮（不清除源语言，不清除已保存的文章数据）
   - 点击 **"Update"** 保存文章 → `updateArticle()` 自动触发 AI 翻译
   - AI 自动从源语言翻译到所有其他语言
   - 视频标签在翻译过程中自动保留

2. **为什么视频能保留？**
   翻译处理器（[`processArticleTranslation`](apps/api/src/blog/processors/blog-ai.processor.ts:1269)）的流程：
   - 第1272-1277行：从原始 HTML 中提取所有 `<video>` 标签
   - AI 只翻译文本内容
   - 第1290-1293行：将提取的视频标签追加到翻译后的内容末尾

3. **未翻译语言呢？**
   - 清除翻译时，所有已启用语言（除源语言外）的翻译都会被清除
   - 保存时 `updateArticle()`（[blog.service.ts:660-679](apps/api/src/blog/blog.service.ts:660)）自动投递翻译任务
   - AI 翻译会生成全新的内容，包含视频标签

### 执行步骤

```
用户在 ZH 编辑器插入视频到正确位置并保存文章
  → 点击"清除翻译"按钮
    → API 清除 EN/JA 等语言的翻译字段
    → translationStatus 设置为 PENDING
    → 前端刷新表单（显示空白的翻译字段）
  → 用户点击"Update"保存
    → updateArticle() 检测到待翻译语言
    → 为每个语言投递 AI 翻译任务
    → AI 翻译从 ZH 读取内容（含视频）
    → 保留视频标签，翻译文本
    → 保存到各语言的 contentLocalized
```

## 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| [`apps/api/src/blog/frontend/frontend-blog.service.ts`](apps/api/src/blog/frontend/frontend-blog.service.ts) | 新增 `replaceVideoSrcInHtml` 方法 + 在 `mapArticleForFrontend` 中调用 |
| [`apps/api/src/blog/blog.service.ts`](apps/api/src/blog/blog.service.ts) | 新增 `clearArticleTranslationsForLocales` 方法（仅清除，不投递翻译） |
| [`apps/api/src/blog/blog.controller.ts`](apps/api/src/blog/blog.controller.ts) | 新增 `POST articles/:id/clear-translations` 路由 |
| [`apps/admin-blog/src/api/index.ts`](apps/admin-blog/src/api/index.ts) | 新增 `clearArticleTranslations` API 方法 |
| [`apps/admin-blog/src/views/blog/BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx) | 新增"清除翻译"按钮 + 刷新表单逻辑 |
| [`apps/admin-blog/src/i18n/*.json`](apps/admin-blog/src/i18n/) | 新增 3 个翻译键（6个语言文件） |

## 验证步骤

1. `yarn workspace @lucky/api check-types` ✅
2. `yarn workspace @lucky/admin-next check-types` ✅
3. 在 ZH 编辑器上传视频到正确位置，保存文章
4. 点击"清除翻译"按钮
5. 验证表单中 EN/JA 等语言的 content 变为空白
6. 点击"Update"保存
7. 等待 AI 翻译完成
8. 切换到 EN/JA 语言查看文章详情页，验证：
   - 视频自动出现
   - 视频以 HLS 播放（检查 Network 标签页有 .m3u8 请求）
9. 验证内容已被翻译（不是中文原文）
