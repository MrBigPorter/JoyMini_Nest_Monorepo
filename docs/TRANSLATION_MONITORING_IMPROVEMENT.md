# 翻译监控系统改进方案

## 当前问题

1. **队列统计不准**：`removeOnComplete: true` 导致完成即删除，队列 completed 永远是 0
2. **进度计算有缺陷**：`pending = total - completed`，不是真实队列活跃数
3. **无进度追踪**：`processArticleTranslation` 不调用 `job.updateProgress()`，所有任务 progress = 0%
4. **多语言只统计第一个**：`targetLangs[0]` 忽略其他目标语言
5. **无翻译预览**：界面只有数字，看不到实际翻译内容

## 解决方案

### 1. 新增 TranslationJob 表

在 Prisma schema 添加：

```prisma
model TranslationJob {
  id          String   @id @default(cuid())
  type        String   // translate-article | translate-category | translate-tag
  targetId    String   // articleId / categoryId / tagId
  targetLang  String
  status      String   // QUEUED | PROCESSING | COMPLETED | FAILED
  progress    Int      @default(0)  // 0-100
  errorMsg    String?
  createdAt   DateTime @default(now())
  startedAt   DateTime?
  completedAt DateTime?
  @@index([status])
  @@index([type, targetId])
}
```

### 2. Processor 中添加进度更新

`processArticleTranslation` 各阶段：

```
5%   → 读取文章数据
20%  → 调用 AI 翻译中
50%  → AI 返回结果
70%  → 保存翻译到 DB
90%  → 渲染 HTML
100% → 完成
```

每阶段同时更新 TranslationJob 记录 + `job.updateProgress()`。

### 3. 新增 TranslationJobService

- `createJob(type, targetId, targetLang)` → 创建 QUEUED 记录
- `updateProgress(jobId, progress, status)` → 更新进度
- `getJobsByStatus(status)` → 按状态查询
- `getStatsByLanguage(lang)` → 按语言统计

### 4. 重构 getTranslationProgress()

基于 TranslationJob 表统计，而不是 DB 字段扫描。支持按语言分组统计。

### 5. 新增 API

| 端点 | 说明 |
|------|------|
| `GET /admin/blog/translation/detail?lang=en` | 每项任务详情（进度、状态、原文/译文预览） |
| `GET /admin/blog/translation/stats` | 多语言进度统计 |

### 6. 前端改进

- 按语言分 tab 显示进度
- 每个任务显示实时进度条 + 当前阶段文本
- 队列流水线可视化（QUEUED → PROCESSING → COMPLETED/FAILED）
- 点击展开原文/译文对照预览

## 涉及文件

| 文件 | 改动 |
|------|------|
| `apps/api/prisma/schema.prisma` | 新增 TranslationJob 模型 |
| `apps/api/src/blog/blog.module.ts` | 注册 TranslationJobService |
| 新建 `apps/api/src/blog/translation-job.service.ts` | 任务日志服务 |
| `apps/api/src/blog/blog.service.ts` | 重构进度统计 |
| `apps/api/src/blog/blog.controller.ts` | 新增 detail/stats 端点 |
| `apps/api/src/blog/processors/blog-ai.processor.ts` | 添加 updateProgress |
| `apps/admin-next/src/api/index.ts` | 新增 API 调用 |
| `apps/admin-next/src/views/blog/BlogTranslationProgress.tsx` | 重写监控页面 |
