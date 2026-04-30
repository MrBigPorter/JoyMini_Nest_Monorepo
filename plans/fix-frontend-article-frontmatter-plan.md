# Plan: Add YAML Frontmatter to 16 Frontend Blog Articles

## Background

The blog's [`parseMarkdownFile()`](apps/api/src/blog/blog.service.ts:436) function extracts article metadata (title, description, tags) from YAML frontmatter. Articles without frontmatter have their content incorrectly extracted from the raw Markdown — the function previously used `---` as a content boundary delimiter, which truncated content at the first Markdown horizontal rule.

**Parser fix** (already deployed): The `---` scanning loop was removed, so content now starts correctly from after the title/excerpt. However, articles still **need YAML frontmatter** for proper metadata extraction (tags, descriptions stored in DB).

## Status Check

Per user confirmation:
- ✅ `architecture/` — 7 files, all have frontmatter
- ✅ `backend/` — 5 files, all have frontmatter (3 just added)
- ✅ `devops/` — 5 files, all have frontmatter
- ✅ `performance/` — 4 files, all have frontmatter
- ❌ `frontend/` — 16 of 17 files **lack** YAML frontmatter
- ❓ `security/` — user hasn't checked yet

## Frontend Article Inventory (16 files needing frontmatter)

| # | Filename | Title | Tags Source |
|---|----------|-------|-------------|
| 1 | `blog-ai-multilingual-translation.md` | Next.js 博客双语系统：基于 Gemini AI 的零侵入自动翻译实践 | `Tags: Next.js, AI, Gemini, Translation, i18n` |
| 2 | `blog-nextjs-seo-technical-implementation.md` | Next.js 博客 SEO 技术实现：从 Sitemap 到 JSON-LD 结构化数据的完整指南 | `Tags: Next.js, SEO, Sitemap, JSON-LD, i18n` |
| 3 | `blog-three-in-one-login-system.md` | Next.js 博客三合一登录系统：邮件验证码 + Google OAuth + Facebook OAuth 完整实现 | `Tags: Next.js, OAuth, Authentication, Zustand, Security` |
| 4 | `blog-video-hls-transcoding-practice.md` | Next.js 博客视频系统架构：从上传到 HLS 自适应播放的完整实现 | `Tags: Next.js, Video, HLS, Cloudflare, Architecture` (line 7) |
| 5 | `blog-xss-content-sanitization-practice.md` | NestJS XSS 内容过滤实战：用 DOMPurify + Pipe 为博客评论构建安全防线 | `Tags: NestJS, XSS, Security` |
| 6 | `nextjs-auth-zero-flicker.md` | Next.js 认证零闪烁实战：双模式架构根治水合闪动 | No explicit tags → derive from keywords |
| 7 | `nextjs-blog-bookmark-system.md` | Next.js 博客收藏功能：Auth 集成与状态同步的完整实现 | `> **Tags:** Next.js, Bookmark, Authentication, Zustand, React Query` |
| 8 | `nextjs-blog-comment-system.md` | Next.js 博客评论系统：从 AI 审核到乐观更新的完整架构 | `> **Tags:** Next.js, Comment, WebSocket, Prisma, React Query` |
| 9 | `nextjs-blog-loading-optimization.md` | Next.js 博客极致加载优化：从骨架屏到边缘缓存的系统性实践 | No explicit tags → derive from keywords |
| 10 | `nextjs-language-zero-flicker.md` | Next.js 多语言零闪烁架构：Cookie 优先的唯一真理策略 | No explicit tags → derive from keywords |
| 11 | `nextjs-page-transition-animation.md` | Next.js 页面过渡动画实战：Framer Motion + 水合安全 + 无障碍 | No explicit tags → derive from keywords |
| 12 | `nextjs-pwa-installable-offline-blog.md` | Next.js PWA 实战：一步步实现可安装离线博客 | `Tags: Next.js, PWA, Mobile, Performance` (line 7) |
| 13 | `nextjs-rendering-modes-guide.md` | Next.js 渲染模式终极指南：SSR/SSG/ISR 选型与常见陷阱 | No explicit tags → derive from keywords |
| 14 | `nextjs-zero-skeleton-optimization.md` | Next.js 零骨架屏优化实战：ISR + 四层架构 + 平台感知缓存 | No explicit tags → derive from keywords |
| 15 | `react-hls-cross-component-coordination.md` | React 跨组件 HLS 视频协调：点击播放 + 单视频互斥 | `Tags: React, Video, HLS, Hooks, Architecture` (line 7) |
| 16 | `react-query-platform-adapter.md` | React Query 平台适配器：三端统一数据请求与自动降级策略 | No explicit tags → derive from keywords |

## Frontmatter Format to Use

Following the existing frontend pattern (see [`nextjs-ssr-seo-crawler-master-guide.md`](docs/blog/articles/frontend/nextjs-ssr-seo-crawler-master-guide.md:1)):

```yaml
---
title: <title from # heading>
slug: <filename without .md>
tags: <Tag1>, <Tag2>, <Tag3>
---
```

## Implementation Steps

### Step 1: Add frontmatter to 16 frontend articles

For each file, insert YAML frontmatter at the top. The content after the `---` closing delimiter remains unchanged.

**Files with explicit `Tags:` line** (pattern A, B, D, E): Extract tags directly, remove the original tags line from content.

**Files with `> **架构关键词：**` only** (pattern C): Derive tags from the architecture keywords and article context.

Detailed frontmatter for each file:

#### 1. `blog-ai-multilingual-translation.md`
```yaml
---
title: Next.js 博客双语系统：基于 Gemini AI 的零侵入自动翻译实践
slug: blog-ai-multilingual-translation
tags: Next.js, AI, Gemini, Translation, i18n
---
```

#### 2. `blog-nextjs-seo-technical-implementation.md`
```yaml
---
title: Next.js 博客 SEO 技术实现：从 Sitemap 到 JSON-LD 结构化数据的完整指南
slug: blog-nextjs-seo-technical-implementation
tags: Next.js, SEO, Sitemap, JSON-LD, i18n
---
```

#### 3. `blog-three-in-one-login-system.md`
```yaml
---
title: Next.js 博客三合一登录系统：邮件验证码 + Google OAuth + Facebook OAuth 完整实现
slug: blog-three-in-one-login-system
tags: Next.js, OAuth, Authentication, Zustand, Security
---
```

#### 4. `blog-video-hls-transcoding-practice.md`
```yaml
---
title: Next.js 博客视频系统架构：从上传到 HLS 自适应播放的完整实现
slug: blog-video-hls-transcoding-practice
tags: Next.js, Video, HLS, Cloudflare, Architecture
---
```

#### 5. `blog-xss-content-sanitization-practice.md`
```yaml
---
title: NestJS XSS 内容过滤实战：用 DOMPurify + Pipe 为博客评论构建安全防线
slug: blog-xss-content-sanitization-practice
tags: NestJS, XSS, Security
---
```

#### 6. `nextjs-auth-zero-flicker.md`
Keywords: Zustand, ProtectedRoute, SSR, CSR, Authentication
```yaml
---
title: Next.js 认证零闪烁实战：双模式架构根治水合闪动
slug: nextjs-auth-zero-flicker
tags: Next.js, Authentication, Zustand, SSR, CSR
---
```

#### 7. `nextjs-blog-bookmark-system.md`
```yaml
---
title: Next.js 博客收藏功能：Auth 集成与状态同步的完整实现
slug: nextjs-blog-bookmark-system
tags: Next.js, Bookmark, Authentication, Zustand, React Query
---
```

#### 8. `nextjs-blog-comment-system.md`
```yaml
---
title: Next.js 博客评论系统：从 AI 审核到乐观更新的完整架构
slug: nextjs-blog-comment-system
tags: Next.js, Comment, WebSocket, Prisma, React Query
---
```

#### 9. `nextjs-blog-loading-optimization.md`
Keywords: ISR, Skeleton, Streaming, Edge Cache, Performance
```yaml
---
title: Next.js 博客极致加载优化：从骨架屏到边缘缓存的系统性实践
slug: nextjs-blog-loading-optimization
tags: Next.js, Performance, ISR, Cache, SSR
---
```

#### 10. `nextjs-language-zero-flicker.md`
Keywords: Cookie, I18n, SSR
```yaml
---
title: Next.js 多语言零闪烁架构：Cookie 优先的唯一真理策略
slug: nextjs-language-zero-flicker
tags: Next.js, i18n, Cookie, SSR
---
```

#### 11. `nextjs-page-transition-animation.md`
Keywords: AnimatePresence, Hydration, Accessibility
```yaml
---
title: Next.js 页面过渡动画实战：Framer Motion + 水合安全 + 无障碍
slug: nextjs-page-transition-animation
tags: Next.js, Animation, Framer Motion, Accessibility
---
```

#### 12. `nextjs-pwa-installable-offline-blog.md`
```yaml
---
title: Next.js PWA 实战：一步步实现可安装离线博客
slug: nextjs-pwa-installable-offline-blog
tags: Next.js, PWA, Mobile, Performance
---
```

#### 13. `nextjs-rendering-modes-guide.md`
Keywords: SSR, SSG, ISR, Rendering
```yaml
---
title: Next.js 渲染模式终极指南：SSR/SSG/ISR 选型与常见陷阱
slug: nextjs-rendering-modes-guide
tags: Next.js, SSR, SSG, ISR, Rendering
---
```

#### 14. `nextjs-zero-skeleton-optimization.md`
Keywords: ISR, Cache, Platform Adapter
```yaml
---
title: Next.js 零骨架屏优化实战：ISR + 四层架构 + 平台感知缓存
slug: nextjs-zero-skeleton-optimization
tags: Next.js, Performance, ISR, Cache, SSR
---
```

#### 15. `react-hls-cross-component-coordination.md`
```yaml
---
title: React 跨组件 HLS 视频协调：点击播放 + 单视频互斥
slug: react-hls-cross-component-coordination
tags: React, Video, HLS, Hooks, Architecture
---
```

#### 16. `react-query-platform-adapter.md`
Keywords: React Query, Next.js, SSR, Adapter
```yaml
---
title: React Query 平台适配器：三端统一数据请求与自动降级策略
slug: react-query-platform-adapter
tags: React Query, Next.js, SSR, Adapter, Performance
---
```

### Step 2: Re-import articles

After frontmatter is added, call the batch import API with overwrite=true:

```bash
curl -X POST https://<api-url>/admin/blog/articles/batch-import \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"overwrite": true}'
```

### Step 3: Verify

- Check each frontend article page loads full content
- Verify tags are correctly extracted in DB
- Confirm no content truncation

## Merge/Apply Strategy

Each file edit is a simple prepend of 5-6 lines (frontmatter block) before the existing line 1 content. For files with existing `Tags:` lines on line 3 (or line 7 for some), those lines should be removed since the tags are now in frontmatter. For files with `> **Tags:**` lines, those should be removed too. For files with `> **架构关键词：**` lines, keep them as they contain descriptive text not tags.

Files needing tag line removal:
- Line 3 `Tags:` → remove: blog-ai-multilingual-translation, blog-nextjs-seo-technical-implementation, blog-three-in-one-login-system, blog-xss-content-sanitization-practice
- Line 3 `> **Tags:**` → remove: nextjs-blog-bookmark-system, nextjs-blog-comment-system
- Line 7 `Tags:` → remove: blog-video-hls-transcoding-practice, nextjs-pwa-installable-offline-blog, react-hls-cross-component-coordination
- Files with `> **架构关键词：**` only: keep as-is (these are descriptive, not tag declarations)
