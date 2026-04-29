# NestJS 博客后端架构：模块化设计与 Prisma 实践

> 当技术文档逐渐演变为多语言、多分类、带标签和评论的 CMS 系统时，后端架构如何设计才能既满足当前需求，又不为未来埋坑？

---

Tags: NestJS, Architecture, Prisma, TypeScript

---

## 1. 背景：一个博客后端能有多复杂？

很多人觉得博客后端无非就是 CRUD——创建文章、读取文章、更新、删除。但当"博客"变成"内容管理系统"时，事情就没那么简单了：

- 文章需要**分类**和**标签**来组织
- 需要**多语言**支持（不仅仅是 UI，还有内容本身）
- 需要**评论系统**，带有审核流程
- 需要**权限控制**，区分作者和管理员
- 需要**SEO 支持**（Slug、Sitemap、结构化数据）
- 需要**性能优化**（缓存、索引、分页）

本文从 NestJS 的模块化设计出发，逐步拆解一个生产级博客后端的架构决策。

---

## 2. 模块结构：为什么 NestJS 的模块化是刚需

NestJS 的模块化设计天然适合这种多领域聚合的场景。我们的博客模块目录结构如下：

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

### 2.1 为什么这样分层？

| 层级 | 职责 | 不做什么 |
|------|------|---------|
| **Controller** | 路由映射、参数验证、HTTP 状态码 | 不写业务逻辑 |
| **Service** | 业务编排、事务管理、权限校验 | 不直接操作 HTTP |
| **DTO** | 请求/响应数据结构和验证规则 | 不包含业务逻辑 |
| **Guard** | 身份验证和权限守卫 | 不处理业务数据 |

这种分层遵循了一个核心原则：**每个文件只做一件事，且做好那一件事**。

### 2.2 模块配置示例

```typescript
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [BlogController],
  providers: [BlogService, ArticleOwnerGuard],
  exports: [BlogService],
})
export class BlogModule {}
```

注意这里使用了 `forwardRef` 处理 AuthModule 的循环依赖——这在 NestJS 中是常见模式，Blog 需要用 Auth 的 Guard，Auth 可能需要 Blog 的数据做权限判断。

---

## 3. API 接口设计：统一前缀 + 分层路由

所有博客相关接口统一使用 `/admin/blog/*` 前缀。这带来了几个好处：

1. **路由清晰**：一眼看出哪些接口属于博客模块
2. **权限统一**：可以在 Controller 级别设置 Guard
3. **版本化管理**：未来可以整体迁移路径

### 3.1 文章接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `GET` | `/articles` | 文章列表（分页 + 筛选） | 公开 |
| `GET` | `/articles/:id` | 文章详情 | 公开 |
| `GET` | `/articles/slug/:slug` | 通过 Slug 查找 | 公开 |
| `POST` | `/articles` | 创建文章 | 管理员 |
| `PATCH` | `/articles/:id` | 更新文章 | 作者/管理员 |
| `DELETE` | `/articles/:id` | 删除文章 | 作者/管理员 |
| `POST` | `/articles/:id/publish` | 发布/下架 | 作者/管理员 |

### 3.2 评论接口的特殊设计

评论接口的设计值得单独拿出来说，因为它涉及到**公开访问**和**管理员审核**两个维度：

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `GET` | `/comments` | 全部评论列表 | 管理员 |
| `GET` | `/articles/:articleId/comments` | 某文章的已审核评论 | **公开** |
| `POST` | `/comments` | 提交评论 | **公开**（无需登录） |
| `PATCH` | `/comments/:id/approve` | 审核通过 | 管理员 |
| `PATCH` | `/comments/:id/reject` | 审核拒绝 | 管理员 |

关键设计点：**前台读取和写入都不需要登录**，这是为了降低评论门槛。但所有新评论默认 `PENDING` 状态，需要管理员审核后才能公开显示。

---

## 4. 业务逻辑设计的 4 个关键决策

### 4.1 Slug 生成与冲突处理

Slug 是文章 URL 的唯一标识，它的设计直接影响 SEO 和可读性。

```typescript
// 生成规则
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')  // 保留中文
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// 冲突处理 — 自动追加数字后缀
// "my-title" → "my-title-2" → "my-title-3"
```

**三个原则**：
- **自动生成**：从标题自动生成 URL 友好的 Slug
- **允许自定义**：支持手动修改 Slug（编辑时可以改）
- **唯一性保证**：数据库唯一索引 + 冲突自动追加后缀

### 4.2 文章状态机

```
DRAFT ──→ PUBLISHED ──→ ARCHIVED
  ↑           │
  └───────────┘（可重新发布）
```

- **DRAFT**（草稿）：默认状态，仅作者和管理员可见
- **PUBLISHED**（已发布）：公开可见
- **ARCHIVED**（已归档）：已发布但主动下架，保留数据

### 4.3 评论状态机

```
PENDING ──→ APPROVED
    │
    └──→ REJECTED
```

所有新评论默认 `PENDING`，公开接口只返回 `APPROVED` 状态的评论。

### 4.4 软删除 vs 物理删除

这是一个常见但经常被忽视的设计决策：

```
草稿文章    → 物理删除（delete）
已发布文章  → 改为 ARCHIVED 状态（保留数据）
评论        → 物理删除（但关联数据保留）
```

**为什么已发布文章不做软删除？**

因为"已发布"意味着它可能已经被搜索引擎索引、被其他网站引用、被用户收藏。直接删除会返回 404，影响用户体验和 SEO。改为 ARCHIVED 状态则可以在前端显示"该文章已下架"，而不是冰冷的 404 页面。

---

## 5. 权限模型：三层守卫体系

### 5.1 现有守卫复用

我们复用了项目中已有的两个核心守卫：

| 守卫 | 职责 |
|------|------|
| `AdminJwtAuthGuard` | 验证管理员身份（JWT Token） |
| `RolesGuard` | 角色权限控制（普通管理员 vs 超级管理员） |

### 5.2 新增自定义守卫：ArticleOwnerGuard

```typescript
@Injectable()
export class ArticleOwnerGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // 来自 AdminJwtAuthGuard
    const articleId = request.params.id;

    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
      select: { authorId: true },
    });

    if (!article) return false;
    if (user.role === 'SUPER_ADMIN') return true; // 超级管理员可以编辑任何文章
    return article.authorId === user.id; // 普通管理员只能编辑自己的
  }
}
```

### 5.3 权限矩阵

| 操作 | 访客 | 普通管理员 | 超级管理员 | 文章作者 |
|------|------|-----------|-----------|---------|
| 查看已发布文章 | ✅ | ✅ | ✅ | ✅ |
| 查看草稿 | ❌ | ✅ | ✅ | ✅（仅自己） |
| 创建文章 | ❌ | ✅ | ✅ | ✅ |
| 编辑任意文章 | ❌ | ❌ | ✅ | ❌ |
| 编辑自己文章 | ❌ | ✅ | ✅ | ✅ |
| 审核评论 | ❌ | ✅ | ✅ | ❌ |

**核心原则**：超级管理员拥有一切权限，普通管理员只能管理自己的文章，但可以审核评论。

---

## 6. 性能优化：从查询到缓存的系统化思考

### 6.1 查询优化

列表查询只返回必要字段，不返回 `content` 大字段：

```typescript
// 列表查询 — 只选必要字段
async getArticles(page: number, size: number) {
  return this.prisma.article.findMany({
    select: {
      id: true,
      title: true,
      slug: true,
      excerpt: true,
      status: true,
      createdAt: true,
      // ⚠️ 不选 content — 大字段只在详情页加载
    },
    skip: (page - 1) * size,
    take: size,
  });
}
```

### 6.2 索引策略

```sql
-- 已在 Schema 中配置
idx_blog_article_slug       -- 唯一索引，用于 Slug 查找
idx_blog_article_status     -- 按状态筛选（DRAFT/PUBLISHED/ARCHIVED）
idx_blog_article_created_at -- 按创建时间排序
idx_blog_article_author_id  -- 按作者筛选
idx_blog_comment_article_id -- 按文章查评论
```

### 6.3 计数器设计

浏览次数和评论数采用**异步更新 + 定时校准**策略：

```
请求到达 → 写入 Redis（毫秒级）
          ↓
定时任务（每天 03:00）→ 从 Redis 同步到数据库
```

这样既保证了热点数据的实时性，又避免了对数据库的频繁写入。

---

## 7. 开发计划与当前进度

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 1 | 数据库层 — Schema 设计、Migration、Prisma Client | ✅ 已完成 |
| Phase 2 | 核心业务 — CRUD、DTO 验证、权限守卫、Slug 生成 | ⏳ 开发中 |
| Phase 3 | 扩展功能 — 全文搜索、图片上传、RSS、Sitemap | 🔮 规划中 |

---

## 8. 总结

这个博客后端架构的核心设计理念可以概括为三句话：

1. **模块化是最好的可扩展性** — NestJS 的 Module/Controller/Service/Guard 分层让每个关注点都有落脚处
2. **状态机是最好的数据安全** — 用状态转换代替物理删除，数据可追溯、可恢复
3. **索引是最好的性能投资** — 在 Schema 设计阶段就规划好索引，比上线后加索引成本低 10 倍

如果你的 Next.js 博客也需要一个后端，希望这篇架构解析能帮你少走一些弯路。
