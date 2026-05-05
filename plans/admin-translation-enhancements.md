# Admin 翻译页面增强计划

## 当前状态

所有 DeepSeek 优化修改已完成（代码已修改，等待重启 API 验证），现在需要额外 3 个增强功能：

---

## Feature 1: 实时任务队列显示文章标题

### 问题

在 [`BlogTranslationProgress.tsx`](../apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx:1551) 的 **实时任务队列**（Live Jobs）部分，活跃/等待/失败 Job 只显示原始 ID：

```
job.name: "translate-article"
job.data?.articleId: "clx..."  ← 只显示 UUID，看不出是哪篇文章
```

### 后端修改

[`blog.service.ts:getTranslationJobs()`](../apps/api/src/blog/blog.service.ts:2339) 当前只从 BullMQ 返回 `{ id, name, data, progress, ... }`。需要在返回前，用 `data.articleId` / `data.categoryId` / `data.tagId` 查 DB 获取标题：

```typescript
// 在 formatJob 之后，批量查询文章/分类/标签标题
async getTranslationJobs() {
  const jobs = ...; // 现有逻辑

  // 收集所有 IDs
  const articleIds = new Set<string>();
  const categoryIds = new Set<string>();
  const tagIds = new Set<string>();
  for (const job of [...activeJobs, ...waitingJobs, ...failedJobs]) {
    if (job.data?.articleId) articleIds.add(job.data.articleId);
    if (job.data?.categoryId) categoryIds.add(job.data.categoryId);
    if (job.data?.tagId) tagIds.add(job.data.tagId);
  }

  // 批量查询
  const [articles, categories, tags] = await Promise.all([
    articleIds.size > 0
      ? this.prisma.blogArticle.findMany({ where: { id: { in: [...articleIds] } }, select: { id: true, title: true } })
      : [],
    // ...
  ]);

  // 构建查找 Map
  const titleMap = new Map(articles.map(a => [a.id, a.title]));

  // formatJob 时加入 title
  const formatJob = (job: any) => ({
    ...,
    data: { ...job.data, title: titleMap.get(job.data?.articleId) || '' },
  });
}
```

### 前端修改

[`BlogTranslationProgress.tsx`](../apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx:1576) 显示从 `job.data.title`：

```tsx
<div className="font-medium">{job.data?.title || job.name}</div>
<div className="text-sm text-gray-500">
  {job.data?.title ? `${job.data?.articleId?.substring(0,8)}... → ${job.data?.targetLang?.toUpperCase()}` : job.data?.articleId}
</div>
```

同时活跃/等待/失败三个区域都统一显示标题。

---

## Feature 2: 一键清空翻译有问题的文章

### 问题

当翻译结果损坏/不完整时，现有 `fixTranslationIssuesBatch` 只是重新投递翻译，但不会清除旧数据（导致缓存命中旧数据）。

需要一个新的 **"清空翻译"** 功能：删除已翻译字段，让文章回到未翻译状态（然后自动触发重新翻译）。

### 后端修改

**新增接口**：`POST /admin/blog/translation/clear-translations`

在 [`blog.controller.ts`](../apps/api/src/blog/blog.controller.ts:420) 新增：

```typescript
@Post('translation/clear-translations')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard)
@ApiOperation({ summary: '清空指定文章的翻译字段（重置为未翻译状态）' })
async clearArticleTranslations(
  @Body() body: { articleIds: string[]; targetLang: string },
) {
  return this.blogService.clearArticleTranslations(body.articleIds, body.targetLang);
}
```

在 [`blog.service.ts`](../apps/api/src/blog/blog.service.ts:3210) 新增方法：

```typescript
async clearArticleTranslations(articleIds: string[], targetLang: string) {
  const articles = await this.prisma.blogArticle.findMany({
    where: { id: { in: articleIds } },
    select: { id: true, titleLocalized: true, contentLocalized: true, contentMdLocalized: true, excerptLocalized: true },
  });

  for (const article of articles) {
    const titleLocalized = article.titleLocalized as any || {};
    const contentLocalized = article.contentLocalized as any || {};
    const contentMdLocalized = article.contentMdLocalized as any || {};
    const excerptLocalized = article.excerptLocalized as any || {};

    // 删除目标语言字段
    delete titleLocalized[targetLang];
    delete contentLocalized[targetLang];
    delete contentMdLocalized[targetLang];
    delete excerptLocalized[targetLang];

    await this.prisma.blogArticle.update({
      where: { id: article.id },
      data: {
        titleLocalized,
        contentLocalized,
        contentMdLocalized,
        excerptLocalized,
        translationStatus: 'PENDING',
      },
    });
  }

  // 可选：投递翻译任务
  for (const id of articleIds) {
    await this.blogAiQueue.add('translate-article', {
      articleId: id,
      targetLang,
      sourceLang: 'zh',
      force: true,
    });
  }

  return { cleared: articleIds.length, queued: articleIds.length };
}
```

### 前端修改

在 [`BlogTranslationQualityDetection.tsx`](../apps/admin-blog/src/views/blog/BlogTranslationQualityDetection.tsx:168) 的检测结果区域增加 **"清空并重新翻译"** 按钮：

- 列表每行增加一个 "清空" 按钮（在现有 "重新翻译" 旁边）
- 顶部增加 "批量清空所有不完整文章" 按钮（在现有 "批量重新翻译" 旁边）
- 清空操作前弹出确认对话框

同时在 [`api/index.ts`](../apps/admin-blog/src/api/index.ts:462) 增加：

```typescript
clearArticleTranslations: async (articleIds: string[], targetLang: string) => {
  return await http.post('/v1/admin/blog/translation/clear-translations', {
    articleIds,
    targetLang,
  });
},
```

---

## Feature 3: 停止 Job 任务

### 问题

当前如果投递了错误的翻译任务（比如参数不对、语言不对），或者某个 Job 卡住了，无法从 Admin UI 取消。

### 后端修改

**新增接口**：`POST /admin/blog/translation/stop-job/:jobId`

在 [`blog.controller.ts`](../apps/api/src/blog/blog.controller.ts:420) 新增：

```typescript
@Post('translation/stop-job/:jobId')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard)
@ApiOperation({ summary: '停止/移除指定的翻译任务' })
async stopTranslationJob(@Param('jobId') jobId: string) {
  return this.blogService.stopTranslationJob(jobId);
}
```

在 [`blog.service.ts`](../apps/api/src/blog/blog.service.ts) 新增方法：

```typescript
async stopTranslationJob(jobId: string) {
  const job = await this.blogAiQueue.getJob(jobId);
  if (!job) {
    throw new NotFoundException(`Job ${jobId} not found`);
  }

  // 尝试移除
  await job.remove();

  // 同时更新持久化记录
  await this.prisma.translationJob.updateMany({
    where: { jobId },
    data: { status: 'CANCELLED' },
  });

  return { success: true, jobId };
}
```

### 前端修改

在 [`BlogTranslationProgress.tsx`](../apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx:1571) 的实时任务队列中，每个 Job 项右侧增加一个 **"停止" 按钮**：

```tsx
{job.data?.title || job.name}
...
<Button
  variant="ghost"
  size="sm"
  className="text-red-500 hover:text-red-700"
  onClick={() => handleStopJob(job.id)}
>
  <XCircle className="w-4 h-4" />
  停止
</Button>
```

同样在等待队列和持久化记录中也增加停止按钮。

---

## 执行顺序

1. **Feature 1**（后端 + 前端）：实时任务队列显示标题 — 纯展示优化，无风险
2. **Feature 2**（后端 + 前端）：一键清空翻译 — 新接口 + 按钮，不影响现有逻辑
3. **Feature 3**（后端 + 前端）：停止 Job — 新接口 + 按钮，不影响现有逻辑

每个 Feature 做完后，重启 API → 验证 → 继续下一个。

---

## 验证方法

1. 导航到 **翻译进度** 页面（`/blog/translation-progress`），查看实时任务队列是否显示标题
2. 导航到 **翻译质量检测** 页面（`/blog/translation-quality`），测试一键清空按钮
3. 投递一个翻译任务，在实时任务队列中点击停止，验证 Job 被移除
