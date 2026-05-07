# admin-blog VIEWER 权限分析报告

## 角色定义

[`Role.VIEWER`](packages/shared/src/types/enums.ts:60) 是"观察者"角色，权限配置在 [`RolePermissions[Role.VIEWER]`](packages/shared/src/config/rbac.config.ts:61-76) 中，只拥有以下只读权限：

```
user_management:view_user
order_management:view_order
marketing_management:view_marketing
treasure_management:view_treasure
finance_management:view_finance
finance_management:view_payment_channel
system_management:view_system
```

**注意：没有任何 `blog:*` 前缀的权限。**

---

## 后端 Controller 的三种鉴权模式

### 模式一：BlogController — ❌ 无权限检查（异常宽松）

[`BlogController`](apps/api/src/blog/blog.controller.ts:28) 的所有接口仅使用 [`AdminJwtAuthGuard`](apps/api/src/admin/auth/admin-jwt-auth.guard.ts:40)，它**只验证 JWT token 有效性**，不做任何角色/权限检查。

**VIEWER 可成功调用以下所有接口（不应有权限）：**

| HTTP | 路由 | 前端调用函数 |
|------|------|-------------|
| GET | `/v1/admin/blog/articles` | `blogApi.getArticles()` |
| GET | `/v1/admin/blog/articles/:id` | `blogApi.getArticle()` |
| GET | `/v1/admin/blog/articles/slug/:slug` | `blogApi.getArticleBySlug()` |
| POST | `/v1/admin/blog/articles` | `blogApi.createArticle()` |
| PATCH | `/v1/admin/blog/articles/:id` | `blogApi.updateArticle()` |
| DELETE | `/v1/admin/blog/articles/:id` | `blogApi.deleteArticle()` |
| POST | `/v1/admin/blog/articles/:id/publish` | `blogApi.publishArticle()` |
| POST | `/v1/admin/blog/articles/:id/unpublish` | `blogApi.unpublishArticle()` |
| POST | `/v1/admin/blog/articles/:id/translate` | `blogApi.translateArticle()` |
| GET | `/v1/admin/blog/articles/scan-local` | `blogApi.scanLocalArticles()` |
| POST | `/v1/admin/blog/articles/batch-import` | `blogApi.batchImportArticles()` |
| POST | `/v1/admin/blog/articles/:id/transcode-video` | `blogApi.triggerVideoTranscode()` |
| GET | `/v1/admin/blog/statistics` | `blogApi.getBlogStatistics()` |
| GET | `/v1/admin/blog/translation-progress` | `translation.getTranslationProgress()` |
| GET | `/v1/admin/blog/translation-jobs` | `translation.getTranslationJobs()` |
| GET | `/v1/admin/blog/translation-jobs-detail` | `translation.getTranslationJobsDetail()` |
| GET | `/v1/admin/blog/translation-logs` | `translation.getTranslationLogs()` |
| GET | `/v1/admin/blog/translation-issues` | `translation.getTranslationIssues()` |
| POST | `/v1/admin/blog/translation-fix-batch` | `translation.fixTranslationIssuesBatch()` |
| GET | `/v1/admin/blog/enabled-languages` | `translation.getEnabledLanguages()` |
| GET | `/v1/admin/blog/untranslated-articles` | `translation.getUntranslatedArticles()` |
| GET | `/v1/admin/blog/untranslated-categories` | `translation.getUntranslatedCategories()` |
| GET | `/v1/admin/blog/untranslated-tags` | `translation.getUntranslatedTags()` |
| POST | `/v1/admin/blog/translation/repair-categories-tags` | `translation.repairUntranslatedCategoriesTags()` |
| GET | `/v1/admin/blog/translation/detect-incomplete` | `translation.detectIncompleteTranslations()` |
| POST | `/v1/admin/blog/translation/retranslate-incomplete` | `translation.retranslateIncompleteArticles()` |
| POST | `/v1/admin/blog/translation/clear-translations` | `translation.clearArticleTranslations()` |
| POST | `/v1/admin/blog/translation/stop-job/:jobId` | `translation.stopTranslationJob()` |
| POST | `/v1/admin/blog/translation/stop-all-jobs` | `translation.stopAllTranslationJobs()` |
| GET | `/v1/admin/blog/ai/status` | `translation.getAiStatus()` |
| GET | `/v1/admin/blog/ai/providers` | `translation.getAiProviders()` |
| GET | `/v1/admin/blog/ai/provider-config` | `translation.getAiProviderConfig()` |
| PATCH | `/v1/admin/blog/ai/provider-config` | `translation.updateAiProviderConfig()` |
| POST | `/v1/admin/blog/articles/:id/trigger-video-transcode` | `translation.triggerVideoTranscode()` |

---

### 模式二：CategoryController / TagController / CommentController — ✅ 有权限检查（VIEWER 会被拦截）

这三个 Controller 使用 `JwtAuthGuard + PermissionsGuard`，配合 [`@RequirePermission`](apps/api/src/common/decorators/require-permission.decorator.ts:11) 装饰器。

#### [`CategoryController`](apps/api/src/blog/category/category.controller.ts:21)
| HTTP | 路由 | 所需权限 | VIEWER 结果 |
|------|------|---------|------------|
| GET | `/v1/admin/blog/categories` | `blog:category_view` | ❌ 403 Forbidden |
| GET | `/v1/admin/blog/categories/:id` | `blog:category_view` | ❌ 403 Forbidden |
| POST | `/v1/admin/blog/categories` | `blog:category_manage` | ❌ 403 Forbidden |
| PATCH | `/v1/admin/blog/categories/:id` | `blog:category_manage` | ❌ 403 Forbidden |
| DELETE | `/v1/admin/blog/categories/:id` | `blog:category_manage` | ❌ 403 Forbidden |

#### [`TagController`](apps/api/src/blog/tag/tag.controller.ts:21)
| HTTP | 路由 | 所需权限 | VIEWER 结果 |
|------|------|---------|------------|
| GET | `/v1/admin/blog/tags` | `blog:tag_view` | ❌ 403 Forbidden |
| GET | `/v1/admin/blog/tags/popular` | `blog:tag_view` | ❌ 403 Forbidden |
| GET | `/v1/admin/blog/tags/:id` | `blog:tag_view` | ❌ 403 Forbidden |
| POST | `/v1/admin/blog/tags` | `blog:tag_manage` | ❌ 403 Forbidden |
| PATCH | `/v1/admin/blog/tags/:id` | `blog:tag_manage` | ❌ 403 Forbidden |
| DELETE | `/v1/admin/blog/tags/:id` | `blog:tag_manage` | ❌ 403 Forbidden |

#### [`CommentController`](apps/api/src/blog/comment/comment.controller.ts:28)
| HTTP | 路由 | 所需权限 | VIEWER 结果 |
|------|------|---------|------------|
| GET | `/v1/admin/blog/comments` | `blog:view` | ❌ 403 Forbidden |
| PATCH | `/v1/admin/blog/comments/:id/approve` | `blog:update` | ❌ 403 Forbidden |
| PATCH | `/v1/admin/blog/comments/:id/reject` | `blog:update` | ❌ 403 Forbidden |
| PUT | `/v1/admin/blog/comments/:id` | `blog:update` | ❌ 403 Forbidden |
| DELETE | `/v1/admin/blog/comments/:id` | `blog:delete` | ❌ 403 Forbidden |

---

### 模式三：SystemConfigController — ✅ 基于 RolesGuard，VIEWER 可读不可写

[`SystemConfigController`](apps/api/src/admin/system-config/system-config.controller.ts:19) 使用 `AdminJwtAuthGuard + RolesGuard` + `@Roles()` 装饰器。

| HTTP | 路由 | 允许的角色 | VIEWER 结果 |
|------|------|-----------|------------|
| GET | `/v1/admin/system-config` | SUPER_ADMIN, ADMIN, VIEWER | ✅ 200 OK |
| POST | `/v1/admin/system-config` | SUPER_ADMIN, ADMIN | ❌ 403 |
| PATCH | `/v1/admin/system-config/:key` | SUPER_ADMIN, ADMIN | ❌ 403 |
| DELETE | `/v1/admin/system-config/:key` | SUPER_ADMIN, ADMIN | ❌ 403 |
| GET | `/v1/admin/system-config/locales` | SUPER_ADMIN, ADMIN, VIEWER | ✅ 200 OK |
| PATCH | `/v1/admin/system-config/locales/:code` | SUPER_ADMIN, ADMIN | ❌ 403 |
| GET | `/v1/admin/system-config/translation/default-source-lang` | SUPER_ADMIN, ADMIN, VIEWER | ✅ 200 OK |
| PATCH | `/v1/admin/system-config/translation/default-source-lang` | SUPER_ADMIN, ADMIN | ❌ 403 |
| GET | `/v1/admin/system-config/blog/locales` | SUPER_ADMIN, ADMIN, VIEWER | ✅ 200 OK |
| PATCH | `/v1/admin/system-config/blog/locales/:code` | SUPER_ADMIN, ADMIN | ❌ 403 |

---

## admin-blog 前端各页面受影响情况

| 页面 | 路由 | 调用的 API | VIEWER 结果 |
|------|------|-----------|------------|
| 仪表盘 | `/` → `/blog` | `getBlogStatistics()` (BlogController) | ✅ 成功（但无意义） |
| 文章列表 | `/blog/articles` | `getArticles()` | ✅ 成功 |
| 创建文章 | `/blog/articles/create` | `createArticle()` | ✅ **成功（不应允许）** |
| 编辑文章 | `/blog/articles/edit/[id]` | `getArticle()`, `updateArticle()` | ✅ **成功（不应允许）** |
| 分类管理 | `/blog/categories` | `getCategories()` | ❌ **403 页面加载失败** |
| 标签管理 | `/blog/tags` | `getTags()` | ❌ **403 页面加载失败** |
| 评论管理 | `/blog/comments` | `getComments()` | ❌ **403 页面加载失败** |
| 导入文章 | `/blog/import` | `scanLocalArticles()`, `batchImportArticles()` | ✅ **成功（不应允许）** |
| 翻译进度 | `/blog/translation-progress` | `getTranslationProgress()` | ✅ 成功 |
| 翻译问题 | `/blog/translation-issues` | `getTranslationIssues()` | ✅ 成功 |
| 翻译质量检测 | `/blog/translation-quality-stream` | `detectIncompleteTranslations()` | ✅ 成功 |
| 系统设置 | `/settings` | `getAll()` (system-config) | ✅ 成功 |
| 语言设置 | `/settings/locales` | `getBlogLocales()`, `toggleBlogLocale()` | GET ✅ / PATCH ❌ |

---

## 问题总结

### 严重安全缺陷：BlogController 缺少权限检查
[`BlogController`](apps/api/src/blog/blog.controller.ts) 的所有接口仅使用 `AdminJwtAuthGuard`，没有任何角色或权限验证。VIEWER 账户理论上可以：
- 创建、编辑、删除文章
- 发布/下架文章
- 触发翻译、批量导入
- 更新 AI 提供商配置
- 停止翻译任务
- 触发视频转码

**建议：** 给 `BlogController` 加上 `PermissionsGuard`，并在写操作（POST/PATCH/DELETE）上加 `@RequirePermission('blog', 'article_manage')`，读操作（GET）上加 `@RequirePermission('blog', 'article_view')`。

### 次要问题：Category/Tag/Comment 无 VIEWER 权限
`CategoryController`、`TagController`、`CommentController` 的权限检查正常工作，但 `RolePermissions` 中缺少 `blog:*` 权限定义。如果希望 VIEWER 能查看分类/标签/评论，需要在 [`RolePermissions[Role.VIEWER]`](packages/shared/src/config/rbac.config.ts:61-76) 中添加对应的 `blog:category_view`、`blog:tag_view`、`blog:view` 权限。
