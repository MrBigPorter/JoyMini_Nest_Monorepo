# Frontend-Blog 专用API接口设计

## 🎯 设计目标

为前端博客应用创建专用API接口，解决以下问题：
1. **接口职责清晰**：与admin后台完全解耦
2. **数据格式优化**：只返回前端博客必需字段
3. **多语言处理简化**：专门为前端优化的多语言逻辑
4. **性能优化**：针对前端使用场景进行缓存和查询优化

## 📊 当前问题分析

### 现有 `/v1/public/blog/` 接口的问题：
1. **与admin后台共享逻辑**：`mapArticleToLocalized` 方法需要同时满足admin和frontend需求
2. **数据格式复杂**：返回包含完整Localized对象，前端需要额外处理
3. **多语言处理混乱**：当请求语言为'en'但翻译缺失时，逻辑复杂
4. **字段冗余**：返回admin需要的字段，前端不需要

## 🏗️ 架构设计

### 新接口路径：`/v1/frontend/blog/`

### 控制器结构：
```
apps/api/src/blog/frontend/
├── frontend-blog.controller.ts    # 主控制器
├── frontend-blog.service.ts       # 专用服务
└── frontend-blog.module.ts        # 模块定义
```

### 数据流优化：
```
数据库 → BlogService → FrontendBlogService → 前端
                    ↓
                数据转换
                    ↓
             只返回必需字段
```

## 🔧 接口设计

### 1. 文章接口

#### GET `/v1/frontend/blog/articles`
**参数**：
- `page` (可选): 页码，默认1
- `pageSize` (可选): 每页数量，默认10
- `categoryId` (可选): 分类ID过滤
- `tagId` (可选): 标签ID过滤
- `locale` (自动): 从Accept-Language头解析

**返回字段**：
```typescript
{
  items: Array<{
    id: string;
    slug: string;
    title: string;           // 当前语言的字符串
    excerpt: string;         // 当前语言的字符串
    coverImage: string;      // 当前语言的字符串
    views: number;
    likes: number;
    commentsCount: number;
    publishedAt: string;
    category: {              // 简化的分类对象
      id: string;
      name: string;          // 当前语言的字符串
      slug: string;
    };
    tags: Array<{            // 简化的标签数组
      id: string;
      name: string;          // 当前语言的字符串
      slug: string;
    }>;
  }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

#### GET `/v1/frontend/blog/articles/:slug`
**返回字段**：
```typescript
{
  id: string;
  slug: string;
  title: string;           // 当前语言的字符串
  excerpt: string;         // 当前语言的字符串
  content: string;         // 当前语言的字符串（HTML格式）
  contentMd: string;       // 当前语言的字符串（Markdown格式）
  coverImage: string;      // 当前语言的字符串
  views: number;
  likes: number;
  commentsCount: number;
  publishedAt: string;
  updatedAt: string;
  category: {
    id: string;
    name: string;          // 当前语言的字符串
    slug: string;
    description: string;   // 当前语言的字符串
  };
  tags: Array<{
    id: string;
    name: string;          // 当前语言的字符串
    slug: string;
  }>;
  author: {
    id: string;
    name: string;
    avatar: string;
  };
  relatedArticles: Array<{  // 相关文章（简化版）
    id: string;
    slug: string;
    title: string;
    excerpt: string;
    publishedAt: string;
  }>;
}
```

### 2. 分类接口

#### GET `/v1/frontend/blog/categories`
**返回字段**：
```typescript
Array<{
  id: string;
  name: string;           // 当前语言的字符串
  slug: string;
  description: string;    // 当前语言的字符串
  articleCount: number;
  coverImage: string;     // 当前语言的字符串
}>
```

#### GET `/v1/frontend/blog/categories/:slug`
**返回字段**：
```typescript
{
  id: string;
  name: string;           // 当前语言的字符串
  slug: string;
  description: string;    // 当前语言的字符串
  coverImage: string;     // 当前语言的字符串
  articleCount: number;
  articles: {             // 分页的文章列表
    items: Array<{
      id: string;
      slug: string;
      title: string;
      excerpt: string;
      publishedAt: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  };
}
```

### 3. 标签接口

#### GET `/v1/frontend/blog/tags`
**返回字段**：
```typescript
Array<{
  id: string;
  name: string;           // 当前语言的字符串
  slug: string;
  articleCount: number;
}>
```

#### GET `/v1/frontend/blog/tags/:slug`
**返回字段**：
```typescript
{
  id: string;
  name: string;           // 当前语言的字符串
  slug: string;
  articleCount: number;
  articles: {             // 分页的文章列表
    items: Array<{
      id: string;
      slug: string;
      title: string;
      excerpt: string;
      publishedAt: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  };
}
```

### 4. 其他接口

#### GET `/v1/frontend/blog/articles/popular`
#### GET `/v1/frontend/blog/articles/:id/related`
#### GET `/v1/frontend/blog/search`
#### GET `/v1/frontend/blog/stats`
#### GET `/v1/frontend/blog/archive`
#### GET `/v1/frontend/blog/tags/popular`

## 🛠️ 实现细节

### 1. 多语言处理优化

**专用映射方法**：
```typescript
private mapArticleForFrontend(article: any, locale: string) {
  // 简化的映射逻辑，只处理前端需要的字段
  const result = {
    id: article.id,
    slug: article.slug,
    title: this.getLocalizedString(article, 'title', locale),
    excerpt: this.getLocalizedString(article, 'excerpt', locale),
    content: this.getLocalizedString(article, 'content', locale),
    contentMd: this.getLocalizedString(article, 'contentMd', locale),
    coverImage: this.getLocalizedString(article, 'coverImage', locale),
    // ... 其他字段
  };
  
  return result;
}

private getLocalizedString(entity: any, field: string, locale: string): string {
  // 简化的逻辑：优先返回指定语言，否则返回中文，否则返回空字符串
  const localizedField = entity[`${field}Localized`];
  
  if (localizedField && localizedField[locale]) {
    return localizedField[locale];
  }
  
  // 检查独立字段
  const suffix = locale === 'zh' ? '' : locale.charAt(0).toUpperCase() + locale.slice(1);
  const dbValue = entity[`${field}${suffix}`];
  
  if (dbValue) {
    return dbValue;
  }
  
  // 回退到中文
  if (localizedField && localizedField['zh']) {
    return localizedField['zh'];
  }
  
  // 最后回退到原始字段
  return entity[field] || '';
}
```

### 2. 缓存策略

- **文章列表**：缓存5分钟
- **文章详情**：缓存10分钟
- **分类/标签列表**：缓存1小时
- **热门文章/标签**：缓存30分钟

### 3. 错误处理

- **翻译缺失**：返回中文内容或空字符串，不抛出错误
- **文章不存在**：返回404
- **参数错误**：返回400

## 📈 迁移计划

### 第一阶段：创建专用接口
1. 创建 `FrontendBlogController` 和 `FrontendBlogService`
2. 实现核心接口（文章、分类、标签）
3. 注册到 `BlogModule`

### 第二阶段：前端迁移
1. 创建新的API客户端 `frontendBlogApi`
2. 更新hooks使用新接口
3. 逐步替换现有调用

### 第三阶段：测试和优化
1. 全面测试新接口
2. 性能对比测试
3. 监控错误率

## 🎯 预期收益

1. **接口清晰**：frontend-blog专用接口，职责单一
2. **性能提升**：减少数据传输量，优化查询
3. **维护简单**：与admin后台解耦，修改不影响对方
4. **用户体验**：更稳定的多语言支持
5. **开发效率**：前端开发者无需理解复杂的admin逻辑

## 🔍 风险评估

- **低风险**：创建新接口不影响现有功能
- **中风险**：前端迁移需要全面测试
- **低风险**：可以并行运行，逐步迁移