# 博客系统后端架构设计

**版本**: v1.0
**日期**: 2026-04-04
**状态**: ✅ 数据库层已完成 | ⏳ 后端开发中

---

## 📋 目录

1. [模块结构](#模块结构)
2. [API接口规范](#API接口规范)
3. [业务逻辑设计](#业务逻辑设计)
4. [权限模型](#权限模型)
5. [性能优化](#性能优化)
6. [开发计划](#开发计划)

---

## 🔧 模块结构

```
apps/api/src/blog/
├── blog.module.ts          # NestJS 模块入口
├── blog.service.ts         # 业务逻辑层
├── blog.controller.ts      # HTTP 接口层
├── dto/                    # 数据传输对象 (DTO)
│   ├── create-article.dto.ts
│   ├── update-article.dto.ts
│   ├── create-category.dto.ts
│   ├── update-category.dto.ts
│   ├── create-tag.dto.ts
│   └── create-comment.dto.ts
├── guards/                 # 自定义权限守卫
│   └── article-owner.guard.ts
├── interfaces/             # 内部类型定义
│   └── blog.interface.ts
└── blog.service.spec.ts    # 单元测试
```

---

## 🎯 API 接口规范

### 统一前缀

`/admin/blog/*`

### 文章接口 Article

| 方法     | 路径                    | 说明                   | 权限        | 状态 |
| -------- | ----------------------- | ---------------------- | ----------- | ---- |
| `GET`    | `/articles`             | 文章列表（分页、筛选） | 公开        | ⏳   |
| `GET`    | `/articles/:id`         | 文章详情               | 公开        | ⏳   |
| `GET`    | `/articles/slug/:slug`  | 通过 Slug 查找文章     | 公开        | ⏳   |
| `POST`   | `/articles`             | 创建文章               | 管理员      | ⏳   |
| `PATCH`  | `/articles/:id`         | 更新文章               | 作者/管理员 | ⏳   |
| `DELETE` | `/articles/:id`         | 删除文章               | 作者/管理员 | ⏳   |
| `POST`   | `/articles/:id/publish` | 发布文章               | 作者/管理员 | ⏳   |
| `POST`   | `/articles/:id/view`    | 记录浏览次数           | 公开        | ⏳   |

### 分类接口 Category

| 方法     | 路径              | 说明         | 权限   |
| -------- | ----------------- | ------------ | ------ |
| `GET`    | `/categories`     | 分类树状列表 | 公开   |
| `POST`   | `/categories`     | 创建分类     | 管理员 |
| `PATCH`  | `/categories/:id` | 更新分类     | 管理员 |
| `DELETE` | `/categories/:id` | 删除分类     | 管理员 |

### 标签接口 Tag

| 方法     | 路径        | 说明                  | 权限   |
| -------- | ----------- | --------------------- | ------ |
| `GET`    | `/tags`     | 标签列表 (带文章计数) | 公开   |
| `POST`   | `/tags`     | 创建标签              | 管理员 |
| `DELETE` | `/tags/:id` | 删除标签              | 管理员 |

### 评论接口 Comment

| 方法     | 路径                            | 说明               | 权限            |
| -------- | ------------------------------- | ------------------ | --------------- |
| `GET`    | `/comments`                     | 评论列表           | 管理员          |
| `GET`    | `/articles/:articleId/comments` | 文章下的已审核评论 | 公开            |
| `POST`   | `/comments`                     | 提交评论           | 公开 (无需登录) |
| `PATCH`  | `/comments/:id/approve`         | 审核通过           | 管理员          |
| `PATCH`  | `/comments/:id/reject`          | 审核拒绝           | 管理员          |
| `DELETE` | `/comments/:id`                 | 删除评论           | 管理员          |

---

## 🧠 业务逻辑设计

### 1. Slug 生成规则

✅ **自动生成**: 从文章标题自动生成 URL 友好 Slug
✅ **冲突处理**: 重复时自动追加数字后缀 (`my-title-2`, `my-title-3`)
✅ **允许自定义**: 支持手动修改 Slug
✅ **唯一性保证**: 数据库唯一索引

### 2. 状态机

```
ArticleStatus:
  DRAFT     → 草稿 (默认)
  PUBLISHED → 已发布
  ARCHIVED  → 已归档
```

```
CommentStatus:
  PENDING   → 待审核 (默认)
  APPROVED  → 已通过
  REJECTED  → 已拒绝
```

### 3. 计数器维护

✅ **异步更新**: 浏览次数、评论数异步写入，不阻塞请求
✅ **定时校准**: 每天凌晨 03:00 重新校准计数器准确性
✅ **缓存层**: Redis 热点计数缓存

### 4. 软删除策略

❌ 不使用 `deletedAt` 软删除
✅ 直接物理删除草稿
✅ 已发布文章改为 ARCHIVED 状态保留

---

## 🔐 权限模型

### 现有守卫复用

| 守卫                | 用途           |
| ------------------- | -------------- |
| `AdminJwtAuthGuard` | 验证管理员身份 |
| `RolesGuard`        | 角色权限控制   |

### 新增自定义守卫

| 守卫                | 用途                       |
| ------------------- | -------------------------- |
| `ArticleOwnerGuard` | 验证当前用户是否是文章作者 |

### 权限矩阵

| 操作         | 访客 | 普通管理员 | 超级管理员 | 文章作者 |
| ------------ | ---- | ---------- | ---------- | -------- |
| 查看已发布   | ✅   | ✅         | ✅         | ✅       |
| 查看草稿     | ❌   | ✅         | ✅         | ✅       |
| 创建文章     | ❌   | ✅         | ✅         | ✅       |
| 编辑任意文章 | ❌   | ❌         | ✅         | ❌       |
| 编辑自己文章 | ❌   | ✅         | ✅         | ✅       |
| 删除任意文章 | ❌   | ❌         | ✅         | ❌       |
| 删除自己文章 | ❌   | ✅         | ✅         | ✅       |
| 审核评论     | ❌   | ✅         | ✅         | ✅       |

---

## ⚡ 性能优化

### 1. 查询优化

✅ 列表查询只返回必要字段，不返回 `content` 大字段
✅ 分类和标签预加载
✅ 评论分页限制每页 20 条
✅ 热点文章 Redis 缓存 5 分钟

### 2. 索引优化

```sql
-- 已在 Schema 中配置
idx_blog_article_slug
idx_blog_article_status
idx_blog_article_created_at
idx_blog_article_author_id
idx_blog_comment_article_id
```

### 3. 写入优化

✅ 浏览次数批量异步写入
✅ 计数器不使用 `UPDATE ... INCREMENT` 原子操作
✅ 评论提交后后台异步通知管理员

---

## 📅 开发计划

### ✅ Phase 1: 数据库层 (已完成)

- [x] Schema 模型设计
- [x] 数据库迁移执行
- [x] Prisma Client 生成

### ⏳ Phase 2: 核心业务 (3天)

**Day 1**:

- [ ] BlogModule 模块配置
- [ ] 基础 CRUD 接口实现
- [ ] DTO 验证逻辑
- [ ] 分页和排序

**Day 2**:

- [ ] 权限守卫集成
- [ ] ArticleOwnerGuard 实现
- [ ] Slug 生成算法
- [ ] 状态管理逻辑

**Day 3**:

- [ ] 评论审核流程
- [ ] 计数器维护
- [ ] 单元测试覆盖
- [ ] Swagger 文档

### 🔮 Phase 3: 扩展功能

- [ ] 全文搜索
- [ ] 图片上传
- [ ] 文章版本历史
- [ ] RSS 订阅
- [ ] Sitemap 生成

---

## ✅ 遵循规范

1. ✅ 所有接口路径统一 `/admin/blog/*`
2. ✅ 复用现有认证和权限系统
3. ✅ DTO 使用 `class-validator` 验证
4. ✅ 接口返回统一格式
5. ✅ 错误码遵循项目规范
6. ✅ 每个方法不超过 50 行

---

## 📌 参考文档

- [NestJS 开发规范](../nestjs/AI_COLLABORATION_WORKFLOW.md)
- [Prisma 最佳实践](../read/devops/PRISMA_V6_MIGRATION_CN.md)
- [API 错误码规范]()
