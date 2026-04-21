# Blog SEO 规范文档 v1.0.0

> 搜索引擎优化标准规范

---

## 1. Meta 标签规范

### 1.1 通用标签

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="index, follow" />
<meta name="author" content="Lucky Nest" />
<meta name="generator" content="Next.js 15" />
```

### 1.2 Open Graph 标签

```html
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Lucky Nest Blog" />
<meta property="og:locale" content="en_US" />
<meta property="og:url" content="https://blog.joyminis.com" />
<meta property="og:title" content="页面标题" />
<meta property="og:description" content="页面描述" />
<meta property="og:image" content="封面图片URL" />
```

### 1.3 Twitter Card 标签

```html
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@joyminis" />
<meta name="twitter:title" content="页面标题" />
<meta name="twitter:description" content="页面描述" />
<meta name="twitter:image" content="封面图片URL" />
```

---

## 2. 结构化数据

### 2.1 BlogPosting Schema

```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "文章标题",
  "datePublished": "2026-04-06T12:00:00Z",
  "dateModified": "2026-04-06T12:00:00Z",
  "author": {
    "@type": "Person",
    "name": "作者名称"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Lucky Nest"
  }
}
```

---

**文档版本**: 1.0.0  
**最后更新**: 2026-04-06
