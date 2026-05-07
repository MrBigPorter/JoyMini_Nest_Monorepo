# admin-blog 权限修复计划

## 现状

### 问题 A：Category/Tag/Comment 三个 Controller 有权限检查但无人有权限

[`CategoryController`](apps/api/src/blog/category/category.controller.ts)、[`TagController`](apps/api/src/blog/tag/tag.controller.ts)、[`CommentController`](apps/api/src/blog/comment/comment.controller.ts) 已经正确使用了 `PermissionsGuard` + `@RequirePermission`，但 [`RolePermissions`](packages/shared/src/config/rbac.config.ts) 中**没有任何角色拥有 `blog:*` 前缀的权限**。这意味着除了 SUPER_ADMIN（跳过权限检查），所有角色都无法访问分类、标签、评论页面。

### 问题 B：BlogController 完全无权限检查

[`BlogController`](apps/api/src/blog/blog.controller.ts) 只使用了 `AdminJwtAuthGuard`，没有 `PermissionsGuard`。VIEWER 账户可以创建/删除文章、更新 AI 配置、停止翻译任务等。

---

## 改动计划

### Step 1：在 RolePermissions 中添加 blog 权限（[`packages/shared/src/config/rbac.config.ts`](packages/shared/src/config/rbac.config.ts)）

#### 1.1 给 VIEWER 添加只读权限

在 `RolePermissions[Role.VIEWER]` 数组末尾添加：

```typescript
`blog:article_view`,
`blog:category_view`,
`blog:tag_view`,
`blog:view`,           // 评论列表只读
`blog:translation_view`,
`blog:ai_view`,
```

#### 1.2 给 ADMIN 添加完整权限

在 `RolePermissions[Role.ADMIN]` 数组末尾添加：

```typescript
// Blog 管理
`blog:article_view`,
`blog:article_manage`,
`blog:category_view`,
`blog:category_manage`,
`blog:tag_view`,
`blog:tag_manage`,
`blog:view`,           // 评论查看
`blog:update`,         // 评论审核/回复
`blog:delete`,         // 评论删除
`blog:translation_view`,
`blog:translation_manage`,
`blog:ai_view`,
`blog:ai_manage`,
```

#### 1.3 给 EDITOR 添加内容管理权限

在 `RolePermissions[Role.EDITOR]` 数组末尾添加：

```typescript
// Blog 内容管理（编辑/运营）
`blog:article_view`,
`blog:article_manage`,
`blog:category_view`,
`blog:category_manage`,
`blog:tag_view`,
`blog:tag_manage`,
`blog:view`,           // 评论查看
`blog:update`,         // 评论审核/回复
`blog:translation_view`,
`blog:translation_manage`,
`blog:ai_view`,
```

---

### Step 2：给 BlogController 添加 PermissionsGuard（[`apps/api/src/blog/blog.controller.ts`](apps/api/src/blog/blog.controller.ts)）

#### 2.1 新增 imports

```typescript
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';
```

#### 2.2 类级别加 PermissionsGuard

将类上的 `@UseGuards(AdminJwtAuthGuard)` 改为：

```typescript
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
```

#### 2.3 给每个路由方法添加 @RequirePermission

| 方法 | 路由 | 装饰器 |
|------|------|--------|
| `getArticles()` | GET /articles | `@RequirePermission('blog', 'article_view')` |
| `getArticle()` | GET /articles/:id | `@RequirePermission('blog', 'article_view')` |
| `getArticleBySlug()` | GET /articles/slug/:slug | `@RequirePermission('blog', 'article_view')` |
| `createArticle()` | POST /articles | `@RequirePermission('blog', 'article_manage')` |
| `scanLocalArticles()` | GET /articles/scan-local | `@RequirePermission('blog', 'article_manage')` |
| `batchImportArticles()` | POST /articles/batch-import | `@RequirePermission('blog', 'article_manage')` |
| `updateArticle()` | PATCH /articles/:id | `@RequirePermission('blog', 'article_manage')` |
| `deleteArticle()` | DELETE /articles/:id | `@RequirePermission('blog', 'article_manage')` |
| `publishArticle()` | POST /articles/:id/publish | `@RequirePermission('blog', 'article_manage')` |
| `unpublishArticle()` | POST /articles/:id/unpublish | `@RequirePermission('blog', 'article_manage')` |
| `translateArticle()` | POST /articles/:id/translate | `@RequirePermission('blog', 'article_manage')` |
| `translateCategory()` | POST /categories/:id/translate | `@RequirePermission('blog', 'category_manage')` |
| `translateTag()` | POST /tags/:id/translate | `@RequirePermission('blog', 'tag_manage')` |
| `batchTranslateTags()` | POST /tags/batch-translate | `@RequirePermission('blog', 'tag_manage')` |
| `batchTranslateCategories()` | POST /categories/batch-translate | `@RequirePermission('blog', 'category_manage')` |
| `triggerVideoTranscode()` | POST /articles/:id/trigger-video-transcode | `@RequirePermission('blog', 'article_manage')` |
| `getAiStatus()` | GET /ai/status | `@RequirePermission('blog', 'ai_view')` |
| `getAiProviders()` | GET /ai/providers | `@RequirePermission('blog', 'ai_view')` |
| `getProviderConfig()` | GET /ai/provider-config | `@RequirePermission('blog', 'ai_view')` |
| `updateProviderConfig()` | PATCH /ai/provider-config | `@RequirePermission('blog', 'ai_manage')` |
| `getTranslationProgress()` | GET /translation-progress | `@RequirePermission('blog', 'translation_view')` |
| `getTranslationJobs()` | GET /translation-jobs | `@RequirePermission('blog', 'translation_view')` |
| `getTranslationJobsDetail()` | GET /translation-jobs-detail | `@RequirePermission('blog', 'translation_view')` |
| `getTranslationLogs()` | GET /translation-logs | `@RequirePermission('blog', 'translation_view')` |
| `getTranslationIssues()` | GET /translation-issues | `@RequirePermission('blog', 'translation_view')` |
| `fixTranslationIssuesBatch()` | POST /translation-fix-batch | `@RequirePermission('blog', 'translation_manage')` |
| `getEnabledLanguages()` | GET /enabled-languages | `@RequirePermission('blog', 'translation_view')` |
| `getUntranslatedArticles()` | GET /untranslated-articles | `@RequirePermission('blog', 'translation_view')` |
| `getUntranslatedCategories()` | GET /untranslated-categories | `@RequirePermission('blog', 'translation_view')` |
| `getUntranslatedTags()` | GET /untranslated-tags | `@RequirePermission('blog', 'translation_view')` |
| `repairUntranslatedCategoriesTags()` | POST /translation/repair-categories-tags | `@RequirePermission('blog', 'translation_manage')` |
| `detectIncompleteTranslations()` | GET /translation/detect-incomplete | `@RequirePermission('blog', 'translation_view')` |
| `detectIncompleteTranslationsStream()` | GET /translation/detect-incomplete/stream | `@RequirePermission('blog', 'translation_view')` |
| `retranslateIncompleteArticles()` | POST /translation/retranslate-incomplete | `@RequirePermission('blog', 'translation_manage')` |
| `clearArticleTranslations()` | POST /translation/clear-translations | `@RequirePermission('blog', 'translation_manage')` |
| `stopTranslationJob()` | POST /translation/stop-job/:jobId | `@RequirePermission('blog', 'translation_manage')` |
| `stopAllTranslationJobs()` | POST /translation/stop-all-jobs | `@RequirePermission('blog', 'translation_manage')` |

---

## 总结

| 步骤 | 改动的文件 | 改动内容 | 行数预估 |
|------|-----------|---------|---------|
| Step 1.1 | `packages/shared/src/config/rbac.config.ts` | VIEWER 加 6 行只读权限 | +6 行 |
| Step 1.2 | 同上 | ADMIN 加 14 行完整权限 | +14 行 |
| Step 1.3 | 同上 | EDITOR 加 12 行内容管理权限 | +12 行 |
| Step 2.1 | `apps/api/src/blog/blog.controller.ts` | 新增 2 个 import | +2 行 |
| Step 2.2 | 同上 | 修改类级别 @UseGuards | 改 1 行 |
| Step 2.3 | 同上 | 37 个路由加 @RequirePermission | +37 行 |

**总计：约 72 行新增，无逻辑变更，全是机械性装饰器添加和配置数组追加。**
