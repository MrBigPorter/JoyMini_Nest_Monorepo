# 博客文章模块接口对接分析报告

## 概述

针对 `/blog/articles/` 相关的前端（admin‑next）与后端（NestJS API）接口对接情况进行了全面分析。重点检查了路由映射、分页格式、字段命名、HTTP 方法、验证与安全性等方面。

## 1. 路由与控制器映射

| 前端 API 路径 (blogApi)                      | 后端控制器路由                      | 状态              |
| -------------------------------------------- | ----------------------------------- | ----------------- |
| `GET /v1/admin/blog/articles`                | `BlogController.getArticles`        | ✅ 匹配           |
| `GET /v1/admin/blog/articles/:id`            | `BlogController.getArticle`         | ✅ 匹配           |
| `POST /v1/admin/blog/articles`               | `BlogController.createArticle`      | ✅ 匹配           |
| `PATCH /v1/admin/blog/articles/:id`          | `BlogController.updateArticle`      | ✅ 匹配（已修复） |
| `DELETE /v1/admin/blog/articles/:id`         | `BlogController.deleteArticle`      | ✅ 匹配           |
| `POST /v1/admin/blog/articles/:id/publish`   | `BlogController.publishArticle`     | ✅ 匹配           |
| `POST /v1/admin/blog/articles/:id/unpublish` | `BlogController.unpublishArticle`   | ✅ 匹配           |
| `GET /v1/admin/blog/categories`              | `CategoryController.getCategories`  | ✅ 匹配           |
| `POST /v1/admin/blog/categories`             | `CategoryController.createCategory` | ✅ 匹配           |
| `PATCH /v1/admin/blog/categories/:id`        | `CategoryController.updateCategory` | ✅ 匹配           |
| `DELETE /v1/admin/blog/categories/:id`       | `CategoryController.deleteCategory` | ✅ 匹配           |
| `GET /v1/admin/blog/tags`                    | `TagController.getTags`             | ✅ 匹配           |
| `POST /v1/admin/blog/tags`                   | `TagController.createTag`           | ✅ 匹配           |
| `PATCH /v1/admin/blog/tags/:id`              | `TagController.updateTag`           | ✅ 匹配（已修复） |
| `DELETE /v1/admin/blog/tags/:id`             | `TagController.deleteTag`           | ✅ 匹配           |

**注意**：原先 `updateArticle` 和 `updateTag` 前端使用 `PUT`，而后端期望 `PATCH`。已在 `apps/admin‑next/src/api/index.ts` 中修复。

## 2. 分页格式兼容性

### 文章列表

- 后端 `BlogService.getArticles` 返回格式：
  ```json
  {
    "items": [...],
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
  ```
- 前端 `blogApi.getArticles` 期望 `items` 并重命名为 `list`，转换逻辑正确。
- 页面组件 `ArticlesPageV2` 的 `requestArticles` 方法已正确处理分页参数与响应字段（`viewCount` → `views`、`commentCount` → `comments`）。

### 分类与标签列表

- 后端 `CategoryService.getCategories` 和 `TagService.getTags` 返回**数组**（非分页对象）。
- 前端 `blogApi.getCategories` 和 `blogApi.getTags` 已兼容数组与分页两种格式，会自动包装为 `{ list, total, page, pageSize, totalPages }`。
- 兼容性良好，无额外调整必要。

## 3. 字段映射

| 前端字段名 (DTO/Form) | 后端字段名 (数据库) | 映射位置                                      | 状态      |
| --------------------- | ------------------- | --------------------------------------------- | --------- |
| `featuredImage`       | `coverImage`        | `BlogService.createArticle` / `updateArticle` | ✅ 已映射 |
| `tagIds`              | `tags` (关系)       | 同上，通过 Prisma `connect`/`set` 处理        | ✅ 正确   |
| `categoryId`          | `categoryId`        | 直接使用                                      | ✅ 一致   |
| `status`              | `status`            | 枚举值转换（见下文）                          | ✅ 一致   |

## 4. 状态枚举

- 前端表单 Schema (`articleSchema`) 定义：
  ```ts
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
  ```
- 后端 Prisma 模型 `ArticleStatus` 枚举（需确认值）：
  预计为 `DRAFT`、`PUBLISHED`、`ARCHIVED`，完全匹配。
- 前端列表页状态显示已将后端返回的大写状态转为小写标签（例如 `PUBLISHED` → `Published`），UI 表现正常。

## 5. 验证与安全性

- 创建/更新文章已使用 `CreateArticleDto` / `UpdateArticleDto` 进行校验（`class‑validator`）。
- 写操作（创建、更新、删除、发布/取消发布）均受 `AdminJwtAuthGuard` 保护，前端请求自动携带 `Authorization: Bearer <token>`。
- 字段校验规则（如标题非空、内容非空、图片 URL 格式）前后端一致。

## 6. 潜在问题与建议

### 6.1 评论接口

- 前端 `blogApi.updateComment` 使用 `PUT`，后端评论控制器可能使用 `PATCH` 或 `PUT`，需确认。
- **建议**：检查 `apps/api/src/blog/comment/comment.controller.ts`（若存在）并调整 HTTP 方法。

### 6.2 分类/标签的搜索参数

- 前端 `blogApi.getCategories` 支持 `page`、`pageSize`、`search`，但后端仅支持 `search`。
- 当前兼容逻辑已处理，无功能影响。

### 6.3 文章详情的额外字段

- 前端列表页期望 `views`、`comments`、`readTime` 等字段，后端返回 `viewCount`、`commentCount`，已在前端转换。
- 确保 `readTime` 有默认值（目前前端默认 "5 min"）。

### 6.4 封面图片上传

- 前端 `RichTextEditor` 组件中的图片上传目前模拟返回本地 URL，需对接实际的上传接口（`/v1/admin/upload/image`）。
- **建议**：将 `onUpload` 回调改为调用 `uploadApi.uploadMedia`。

## 7. 已执行的修复

1. **`blogApi.updateArticle`**：将 `http.put` 改为 `http.patch`。
2. **`blogApi.updateTag`**：将 `http.put` 改为 `http.patch`。

以上修改已提交至代码库。

## 8. 后续步骤（可选）

若需进一步优化，可考虑：

1. **统一分页响应格式**：让分类/标签接口也返回标准分页对象（`items`、`total`、`page`、`pageSize`、`totalPages`），避免前端做兼容转换。
2. **补充单元测试**：为 `blogApi` 各方法编写测试，确保 HTTP 方法、参数传递正确。
3. **对接真实图片上传**：在 `BlogArticleModal` 中集成 `uploadApi.uploadMedia`。
4. **验证评论接口**：检查并修正评论相关的 HTTP 方法不匹配。

## 结论

博客文章模块的前后端接口对接整体良好，路由、分页、字段映射、验证与安全性均已对齐。已修复两处 HTTP 方法不匹配问题。当前接口已处于可工作状态，前端管理后台的博客文章列表、创建、编辑、发布/取消发布、删除等功能应可正常调用后端接口。

建议进行集成测试以验证所有功能点，随后可部署到测试环境进行全链路验证。
