# 首页前端极致优化方案

> 基于当前架构的完整审计结果，对标 Vercel/Netflix/Meta/ByteDance 的 Data-Driven + Edge Computing 实践
> 已实现 IndexedDB 离线持久化层 (Dexie.js) + Local-First 架构 + Service Worker 导航缓存

---

## 一、当前状态总览

### ✅ 已完成优化

| 优化项 | 文件 | 说明 |
|--------|------|------|
| BlurhashImage LRU 缓存 | [`BlurhashImage.tsx`](apps/frontend-blog/src/components/blog/BlurhashImage.tsx) | 全局 LRU 缓存，100 条上限，避免分类切换重复解码 |
| View Transitions API | [`page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.client.tsx) + [`globals.css`](apps/frontend-blog/src/app/globals.css) | 分类切换交叉淡入淡出，prefers-reduced-motion 降级 |
| Hover 预取 | [`CategoryFilter.tsx`](apps/frontend-blog/src/components/blog/CategoryFilter.tsx) | onMouseEnter 触发 queryClient.prefetchQuery |
| Service Worker 运行时缓存 | [`next.config.ts`](apps/frontend-blog/next.config.ts) lines 24-113 | Workbox CacheFirst / NetworkFirst / StaleWhileRevalidate 策略 |
| SW 导航页面缓存 | [`next.config.ts`](apps/frontend-blog/next.config.ts) lines 88-100 | `/(zh\|en\|ko\|ja)/` NetworkFirst 支持离线浏览 |
| CDN Preconnect | [`next.config.ts`](apps/frontend-blog/next.config.ts) line 178-179 | img.joyminis.com preconnect + crossOrigin |
| AVIF/WebP 转换 | [`next.config.ts`](apps/frontend-blog/next.config.ts) line 136 | formats: ['image/avif', 'image/webp'] |
| DeviceSizes 裁剪 | [`next.config.ts`](apps/frontend-blog/next.config.ts) lines 139-143 | 自定义 [480, 640, 768, 1024, 1280] + imageSizes |
| ISR 60s | [`page.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.tsx) line 11 | revalidate: 60 |
| Priority 首屏 | [`page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.client.tsx) line 188 | 前 2 张卡片 priority={true} |
| Quality 65 | [`page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.client.tsx) + [`ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx) | 非首图 quality={65} |
| Cache-Control 策略 | [`next.config.ts`](apps/frontend-blog/next.config.ts) lines 207-209 | public, max-age=3600, stale-while-revalidate=86400 |
| Cloudflare Worker 缓存层 | [`worker.ts`](apps/frontend-blog/src/worker.ts) | KV-based ISR + CACHE + Analytics Engine |
| OpenNext ISR 持久化 | [`open-next.config.ts`](apps/frontend-blog/open-next.config.ts) | KV incremental cache + Durable Objects 队列 |
| IndexedDB Local-First (articles) | [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) | articles 表 + syncArticles + getCachedArticles |
| IndexedDB Local-First (categories) | [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) line 231 | categories 表 + syncCategories + getCachedCategories |
| IndexedDB Local-First (article content) | [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) line 128 | articleContents 表 + syncArticleContent + getCachedArticleContent |
| IndexedDB Local-First (tags) | [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) line 303 | tags 表 + syncTags + getCachedTags + Dexie v2 |
| networkMode: offlineFirst | [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) | 所有 4 个 Local-First hook 均配置 |
| SSR initialCategories | [`page.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.tsx) + [`CategoryFilter.tsx`](apps/frontend-blog/src/components/blog/CategoryFilter.tsx) | 消除分类栏 skeleton 闪烁 |
| 离线指示器 | [`OfflineIndicator.tsx`](apps/frontend-blog/src/components/pwa/OfflineIndicator.tsx) | 底部悬浮提示，支持重试 |
| IntersectionObserver 图片预取 | [`ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx:68) | 200px rootMargin 提前加载图片，预热 SW 缓存 |
| 页面底部自动预取下一页 | [`page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.client.tsx:88) | IntersectionObserver sentinel + queryClient.prefetchQuery + IndexedDB 预热 |
| 网络感知自适应质量 | [`useNetworkQuality.ts`](apps/frontend-blog/src/lib/hooks/useNetworkQuality.ts) + [`ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx:112) | 5 级自适应（slow-2g→4g）+ Save-Data，quality 10–75 |
| LCP 图片 Preload Link | [`page.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.tsx:60) | SSR 注入 `<link rel="preload" fetchPriority="high">` |
| Cloudflare Edge 图片变换 | [`cloudflareImageLoader.ts`](apps/frontend-blog/src/lib/utils/cloudflareImageLoader.ts) | 自定义 loader 生成 `/cdn-cgi/image/` URL，边缘 AVIF 转换 |
| 103 Early Hints | [`worker.ts`](apps/frontend-blog/src/worker.ts:133) | 提前 200-500ms 预热 CDN + API 连接 |

_所有 26 项优化均已实现。_

---

## 二、核心架构：双层缓存系统
