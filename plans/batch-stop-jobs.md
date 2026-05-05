# Feature 4: 批量取消 Active/Waiting Jobs

## 需求

在翻译进度页面的"实时任务队列"卡片中，添加一个"取消所有任务"按钮，一键取消所有 active（进行中）和 waiting（等待中）的 BullMQ 翻译任务，并同步更新 Prisma TranslationJob 记录为 CANCELLED。

## 修改清单

### 1. 后端 — [`blog.service.ts`](apps/api/src/blog/blog.service.ts) 新增 `stopAllTranslationJobs()` 方法

在 `stopTranslationJob()` 方法之后（line ~3394）添加新方法：

```
async stopAllTranslationJobs() {
  1. 并行获取 active + waiting jobs:
     const [activeJobs, waitingJobs] = await Promise.all([
       this.blogAiQueue.getActive(),
       this.blogAiQueue.getWaiting(),
     ]);
  
  2. 合并所有 jobs，提取 articleIds/categoryIds/tagIds:
     const allJobs = [...activeJobs, ...waitingJobs];
     收集 id 集合用于后续更新 DB。
  
  3. 并行移除所有 jobs:
     await Promise.all(allJobs.map(job => job.remove().catch(() => {})));
  
  4. 批量更新 Prisma TranslationJob 为 CANCELLED:
     await this.prisma.translationJob.updateMany({
       where: { 
         targetId: { in: [...articleIds] },
         status: { in: ['QUEUED', 'PROCESSING'] }
       },
       data: { status: 'CANCELLED' },
     });
  
  5. 返回: { success: true, stoppedCount, message }
}
```

### 2. 后端 — [`blog.controller.ts`](apps/api/src/blog/blog.controller.ts) 新增 endpoint

在 `stopTranslationJob` 之后（line ~443）添加：

```
@Post('translation/stop-all-jobs')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard)
@ApiOperation({ summary: '批量取消所有进行中和等待中的翻译任务' })
async stopAllTranslationJobs() {
  return this.blogService.stopAllTranslationJobs();
}
```

### 3. 前端 API — [`apps/admin-blog/src/api/index.ts`](apps/admin-blog/src/api/index.ts) 新增方法

在 `stopTranslationJob` 之后（line ~498）添加：

```
stopAllTranslationJobs: async () => {
  return await http.post('/v1/admin/blog/translation/stop-all-jobs');
},
```

### 4. 前端 UI — [`BlogTranslationProgress.tsx`](apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx)

#### 4a. 新增 `handleStopAllJobs` 函数（line ~780 之后）

```
const handleStopAllJobs = async () => {
  try {
    await blogApi.translation.stopAllTranslationJobs();
    addToast('success', t('stopAllJobsSuccess'));
    runJobs();
    runDbJobs();
  } catch (err: any) {
    addToast(err?.message || t('stopAllJobsFailed'), 'error');
  }
};
```

#### 4b. 在实时任务队列卡片标题区添加"取消所有"按钮

在 line 1565 的 `<Card title={t('liveJobsTitle')}>` — 需要改为自定义标题区域，在标题右侧添加一个红色按钮：

```
<Card
  title={
    <div className="flex items-center justify-between w-full">
      <span>{t('liveJobsTitle')}</span>
      {(jobs?.active?.length > 0 || jobs?.waiting?.length > 0) && (
        <Button
          variant="outline"
          size="sm"
          className="text-red-500 border-red-300 hover:bg-red-50"
          onClick={handleStopAllJobs}
        >
          <XCircle className="w-4 h-4 mr-1" />
          {t('stopAllJobs')}
        </Button>
      )}
    </div>
  }
>
```

注意：如果 `Card title` 不支持 ReactNode，则改用在卡片内部顶部添加一个操作栏。

### 5. i18n — 所有 6 个 locale 文件

在 `blog_translation_stopJobFailed`（line ~171）之后添加 3 个新 key：

| Key | zh | en | fr | ja | ko | de |
|-----|----|----|----|----|----|----|
| `blog_translation_stopAllJobs` | 取消所有任务 | Cancel All Jobs | Annuler toutes les tâches | すべてのジョブを停止 | 모든 작업 취소 | Alle Jobs abbrechen |
| `blog_translation_stopAllJobsSuccess` | 所有任务已取消 | All jobs cancelled | Toutes les tâches annulées | すべてのジョブを停止しました | 모든 작업이 취소되었습니다 | Alle Jobs abgebrochen |
| `blog_translation_stopAllJobsFailed` | 取消任务失败 | Failed to cancel jobs | Échec de l'annulation | ジョブの停止に失敗 | 작업 취소 실패 | Fehler beim Abbrechen |

文件列表:
- [`apps/admin-blog/src/i18n/zh.json`](apps/admin-blog/src/i18n/zh.json)
- [`apps/admin-blog/src/i18n/en.json`](apps/admin-blog/src/i18n/en.json)
- [`apps/admin-blog/src/i18n/fr.json`](apps/admin-blog/src/i18n/fr.json)
- [`apps/admin-blog/src/i18n/ja.json`](apps/admin-blog/src/i18n/ja.json)
- [`apps/admin-blog/src/i18n/ko.json`](apps/admin-blog/src/i18n/ko.json)
- [`apps/admin-blog/src/i18n/de.json`](apps/admin-blog/src/i18n/de.json)

## 数据流

```
用户点击"取消所有任务"按钮
  → BlogTranslationProgress.handleStopAllJobs()
    → blogApi.translation.stopAllJobs() [POST /v1/admin/blog/translation/stop-all-jobs]
      → blogController.stopAllTranslationJobs()
        → blogService.stopAllTranslationJobs()
          → blogAiQueue.getActive()
          → blogAiQueue.getWaiting()
          → Promise.all(jobs.map(job.remove()))
          → prisma.translationJob.updateMany({ status: 'CANCELLED' })
          → return { success, stoppedCount }
    → addToast success
    → runJobs() + runDbJobs() (刷新队列和 DB 记录)
```

## 验证

1. `yarn workspace @lucky/api build` 通过
2. `yarn workspace @lucky/admin-blog build` 通过
3. 在页面上确认：
   - 当 active/waiting > 0 时，显示"取消所有任务"按钮
   - 点击后所有 active/waiting 任务消失
   - DB 记录状态变为 CANCELLED
   - 成功/失败 toast 正常显示
