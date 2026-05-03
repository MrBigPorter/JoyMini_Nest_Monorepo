# 批量翻译改造计划

## 问题

前端 `BlogTranslationIssues.tsx` 的 `handleBatchTranslateTags` 和 `handleBatchTranslateCategories` 使用 `for` 循环逐个调用后端单条翻译接口。全选 39 个标签时，会逐个发送 39 个 HTTP 请求，效率低、耗时长。

## 方案：后端加批量接口 + 前端改单次调用

### 后端改动

#### 1. `blog.controller.ts` — 新增两个批量端点

```typescript
@Post('tags/batch-translate')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard)
@ApiOperation({ summary: '批量翻译标签' })
async batchTranslateTags(
  @Body() dto: { ids: string[]; targetLang?: string },
) {
  return this.blogService.batchTranslateTags(dto.ids, dto.targetLang);
}

@Post('categories/batch-translate')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard)
@ApiOperation({ summary: '批量翻译分类' })
async batchTranslateCategories(
  @Body() dto: { ids: string[]; targetLang?: string },
) {
  return this.blogService.batchTranslateCategories(dto.ids, dto.targetLang);
}
```

#### 2. `blog.service.ts` — 新增批量方法

```typescript
async batchTranslateTags(tagIds: string[], targetLang?: string) {
  if (this.aiService.getServiceLevel() === AiServiceLevel.DISABLED) {
    throw new BadRequestException('AI translation service is currently disabled...');
  }

  const lang = targetLang || 'en';
  let queued = 0;

  for (const tagId of tagIds) {
    await this.blogAiQueue.add('translate-tag', {
      tagId,
      targetLang: lang,
    });
    queued++;
  }

  return {
    success: true,
    message: `Batch translation queued for ${queued} tags`,
    queued,
    targetLang: lang,
  };
}

// batchTranslateCategories 同理
```

### 前端改动

#### 3. `apps/admin-blog/src/api/index.ts` — 新增批量 API 方法

```typescript
batchTranslateTags: async (ids: string[], targetLang?: string) => {
  return await http.post('/v1/admin/blog/tags/batch-translate', {
    ids,
    targetLang,
  });
},

batchTranslateCategories: async (ids: string[], targetLang?: string) => {
  return await http.post('/v1/admin/blog/categories/batch-translate', {
    ids,
    targetLang,
  });
},
```

#### 4. `BlogTranslationIssues.tsx` — 修改批量处理函数

`handleBatchTranslateTags` 和 `handleBatchTranslateCategories` 从 `for` 循环改为调用新的批量 API：

```typescript
const handleBatchTranslateTags = async () => {
  const ids = selectedTags.length > 0
    ? selectedTags
    : translationIssues?.tags?.map((t: any) => t.tagId) || [];

  if (ids.length === 0) return;

  setBatchTranslatingTags(true);
  try {
    const response = await blogApi.translation.batchTranslateTags(ids, selectedLanguage);
    if (response?.success) {
      addToast('success', t('translationBatchSent', { count: response.queued }));
    } else {
      addToast('error', t('translationFailed'));
    }
  } catch {
    addToast('error', t('translationFailed'));
  } finally {
    setBatchTranslatingTags(false);
    setTranslatingTags({});
    setSelectedTags([]);
    setTimeout(() => runIssues(), 1500);
  }
};
```

### 改动文件清单

| 文件 | 改动 |
|------|------|
| `apps/api/src/blog/blog.controller.ts` | 新增 2 个批量端点 |
| `apps/api/src/blog/blog.service.ts` | 新增 2 个批量方法 |
| `apps/admin-blog/src/api/index.ts` | 新增 2 个批量 API 方法 |
| `apps/admin-blog/src/views/blog/BlogTranslationIssues.tsx` | 修改 2 个批量处理函数 |

### 不变的部分

- 单条翻译接口保留不变（`POST tags/:id/translate`、`POST categories/:id/translate`）
- 后端翻译逻辑不变（都是投递到 Bull 队列）
- 前端 UI 不变
