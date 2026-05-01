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

### 🔴 待办优化（按影响排序）

| 优先级 | 优化项 | 预期收益 |
|--------|--------|---------|
| 🔴 P0 | ArticleCard IntersectionObserver 图片预取 | 图片提前 200px 加载，消除等待感 |
| 🔴 P0 | 页面底部自动预取下一页数据 | Load More 无网络等待 |
| 🔴 P0 | 网络感知自适应质量 (useNetworkQuality) | 弱网用户秒开，节省流量 |
| 🟡 P1 | 103 Early Hints | 提前 200-500ms 开始下载资源 |
| 🟡 P1 | LCP 图片 Preload Link 注入 | LCP 提前 300ms+ |
| 🟢 P2 | Cloudflare Edge 图片变换 | 边缘实时 AVIF 转换 |

---

## 二、核心架构：双层缓存系统

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户交互层                                      │
│  ┌──────────┐  ┌────────────┐  ┌────────────────┐                  │
│  │ 滚动页面  │  │ Hover 分类  │  │ 点击 Load More │                  │
│  └────┬─────┘  └─────┬──────┘  └───────┬────────┘                  │
│       │              │                 │                            │
│       ▼              ▼                 ▼                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │                  React Query + Local-First 层              │       │
│  │  ┌──────────────────────────────────────────────────┐    │       │
│  │  │  queryFn:                                        │    │       │
│  │  │    1. 先读 IndexedDB (Dexie.js) → 立即渲染       │    │       │
│  │  │    2. 后台发起网络请求                            │    │       │
│  │  │    3. 网络成功 → 更新 IndexedDB + 刷新 UI        │    │       │
│  │  │    4. 网络失败 → 保持 IndexedDB 数据显示          │    │       │
│  │  └──────────────────────────────────────────────────┘    │       │
│  └─────────────────────┬────────────────────────────────────┘       │
│                        │                                            │
│                        ▼                                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │              智能预取调度层                                  │       │
│  │  ┌──────────────────┐  ┌─────────────────────────────┐   │       │
│  │  │ Intersection     │  │ useNetworkQuality           │   │       │
│  │  │ Observer 200px   │  │ effectiveType, saveData     │   │       │
│  │  │ 提前触发预取      │  │ quality, format, blurOnly   │   │       │
│  │  └────────┬─────────┘  └──────────────┬──────────────┘   │       │
│  │           │                           │                   │       │
│  │           ▼                           ▼                   │       │
│  │  ┌──────────────────────────────────────────────┐        │       │
│  │  │  postMessage → Service Worker                 │        │       │
│  │  │  { type: 'PREFETCH_IMAGES', urls: [...] }    │        │       │
│  │  └──────────────────┬───────────────────────────┘        │       │
│  └─────────────────────┼────────────────────────────────────┘       │
│                        │                                            │
└────────────────────────┼────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Service Worker 层                               │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │  Cache Storage (文件缓存)                                 │       │
│  │  ├─ static-image-assets | StaleWhileRevalidate | 200 张  │       │
│  │  ├─ static-js-css-assets | StaleWhileRevalidate | 32 个  │       │
│  │  ├─ api-cache | StaleWhileRevalidate | 50 条 | 7 天     │       │
│  │  ├─ pages-cache | NetworkFirst | 50 条 | 7 天           │       │
│  │  └─ navigation-pages | NetworkFirst | 50 条 | 7 天      │       │
│  └──────────────────────────────────────────────────────────┘       │
│                         │                                            │
│                         ▼                                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │  IndexedDB (结构化数据) via Dexie.js                      │       │
│  │  ┌────────────────┐  ┌────────────────────────────────┐  │       │
│  │  │ articles 表     │  │ articleContents 表             │  │       │
│  │  │ ├─ id (主键)    │  │ ├─ slug (主键)                 │  │       │
│  │  │ ├─ title       │  │ ├─ content (文章正文 JSON)      │  │       │
│  │  │ ├─ slug        │  │ ├─ contentMd (Markdown)        │  │       │
│  │  │ ├─ coverImage  │  │ └─ updatedAt                   │  │       │
│  │  │ ├─ category    │  │                                │  │       │
│  │  │ ├─ tags[]      │  │  categories 表                  │  │       │
│  │  │ ├─ createdAt   │  │ ├─ id (主键)                   │  │       │
│  │  │ ├─ locale      │  │ ├─ name, slug                  │  │       │
│  │  │ └─ updatedAt   │  │ └─ locale                      │  │       │
│  │  │                │  │                                │  │       │
│  │  │ 搜索索引:       │  │  tags 表                       │  │       │
│  │  │ ├─ title+tags  │  │ ├─ id (主键)                   │  │       │
│  │  │ └─ locale+page │  │ ├─ name, slug                  │  │       │
│  │  │                │  │ └─ locale                      │  │       │
│  │  │                │  │                                │  │       │
│  │  │                │  │  metadata 表                    │  │       │
│  │  │                │  │ ├─ key (主键)                   │  │       │
│  │  │                │  │ └─ value (JSON)                │  │       │
│  │  └────────────────┘  └────────────────────────────────┘  │       │
│  └──────────────────────────────────────────────────────────┘       │
└────────────────────────┼─────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Cloudflare 边缘层                                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Worker.ts                                                   │   │
│  │  ├─ 103 Early Hints → 提前告知浏览器连接 CDN                 │   │
│  │  ├─ KV 缓存层 → ISR + API 缓存                              │   │
│  │  └─ Analytics Engine → 性能指标采集                         │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────┼─────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CDN / 源站层                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐      │
│  │ img.joyminis │  │ API          │  │ OpenNext SSR         │      │
│  │ .com         │  │ joyminis.com │  │ ISR + 服务器端渲染    │      │
│  │ 图片 CDN     │  │ API 网关     │  │                      │      │
│  └──────────────┘  └──────────────┘  └──────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 三、待办优化方案详解

### 🔴 P0-A: ArticleCard IntersectionObserver 图片预取

在 [`ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx) 中添加：
- 使用 `IntersectionObserver` 监控卡片进入视口
- 当卡片距离视口 200px 时（rootMargin: '200px'），通过 SW message 通道发送预取指令
- SW 收到消息后，立即在后台通过 Cache API 预加载图片

**数据流：**
```
用户滚动页面
  └→ IntersectionObserver 触发（rootMargin: 200px）
      ├→ postMessage → SW: cache.addAll(图片URLs)
      └→ React Query prefetchQuery → API数据 → IndexedDB同步

离线时访问
  └→ React Query queryFn → 网络失败
      ├→ 读取 IndexedDB → 返回文章列表JSON → 渲染
      ├→ SW Cache命中 → 返回图片 → 渲染
      └→ 显示离线指示器
```

### 🔴 P0-B: 页面底部自动预取下一页数据

在 [`page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.client.tsx) 中：
- 当用户滚动到倒数第 3 篇文章时，自动 prefetch 下一页的 API 数据 + 图片 URL 列表
- 数据同时写入 IndexedDB 和 SW Cache

### 🔴 P0-C: 网络感知自适应质量 (Adaptive Quality)

[`useNetworkQuality`](apps/frontend-blog/src/lib/hooks/useNetworkQuality.ts) Hook 已创建，但未集成到渲染链路。

**质量映射策略：**

| effectiveType | quality | format | blurOnly | 说明 |
|---------------|---------|--------|----------|------|
| 4G / Wi-Fi | 75 | AVIF | false | 高质量 AVIF |
| 3G / LTE | 45 | WebP | false | 中等质量 WebP |
| 2G / slow-2g | 20 | WebP | false | 低质量快速加载 |
| save-data: on | 10 | WebP | false | 省流模式 |
| 极度弱网 | — | — | true | 仅 Blurhash，文字优先 |

**透传链路：**
[`page.client.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.client.tsx) → [`ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx) → [`BlurhashImage.tsx`](apps/frontend-blog/src/components/blog/BlurhashImage.tsx)

### 🟡 P1-A: 103 Early Hints

Cloudflare Dashboard → Speed → Optimization → Early Hints → Enable

或在 [`worker.ts`](apps/frontend-blog/src/worker.ts) 的 `fetch` handler 中添加 103 状态码提前推送 preconnect/preload 提示。

### 🟡 P1-B: LCP 图片 Preload Link 注入

在 [`page.tsx`](apps/frontend-blog/src/app/%5Blocale%5D/page.tsx) 的 SSR 中获取第一篇文章封面 URL，注入到 `<head>`：

```tsx
const firstCoverImage = initialData.items?.[0]?.coverImage;

return (
  <>
    {firstCoverImage && (
      <link rel="preload" as="image" href={firstCoverImage} fetchPriority="high" />
    )}
    <HomePageClient ... />
  </>
);
```

### 🟢 P2-A: Cloudflare Edge 图片变换（可选）

通过 Worker 代理 + `cf.image` 参数实现边缘格式转换。

> **注意**: 需要 Cloudflare Image Resizing 订阅（Pro/Business 计划），可暂缓。

---

## 四、预期效果

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| LCP (首屏加载) | ~1.5-2.5s | ~0.8-1.2s | -47% |
| 离线首页访问 | ❌ 白页/Chrome恐龙 | ✅ 文章列表 + 分类 + 图片缓存 | 从无到有 |
| 离线文章详情 | ❌ 不可用 | ✅ 文章正文可读 | 从无到有 |
| 分类切换视觉反馈 | ~200ms (View Transitions) | ~50ms (IndexedDB 本地读取) | -75% |
| 弱网 3G 图片加载 | ~3-5s 白块 | ~200ms (SW 缓存) 或 blurhash | -90%+ |
| Load More 图片闪现 | 每次请求新图 | 预缓存无感知 | 消除闪现 |
| SW + IndexedDB 容量 | 64 张图片 | 200 张图片 + 不限文章数 | 3x+ |

---

## 五、风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| IndexedDB 存储版本升级迁移 | 旧数据不兼容 | Dexie 内置 version() 迁移机制 |
| SW 预取过多图片消耗用户流量 | 用户不满 | 只在 Wi-Fi 下预取，4G 仅预取视口下 3 张 |
| save-data 用户被过度降级 | 体验差 | 仅降级质量，不低于 quality=20 |
| 103 Early Hints 在 HTTP/2 上无效 | 降级无影响 | 纯增益特性，不支持也无损失 |
| Cloudflare Image Resizing 额外费用 | 成本增加 | 先仅在 Worker 层做 format=auto |
| useNetworkQuality 在 iOS Safari 不支持 | 降级 | 返回 'unknown'，使用默认 quality=65 |
| IndexedDB 写入时机不当导致闪烁 | 性能/体验 | 写入在 requestIdleCallback 或网络回调中异步进行 |

---

## 附录：离线验证指南

### 方法 1：DevTools 观察 IndexedDB 写入

1. 打开浏览器 DevTools（F12）
2. 切换到 **Application** 标签
3. 左侧展开 **IndexedDB** → **JoyMiniBlog**

| 表名 | 触发页面 | 验证操作 | 预期 |
|------|----------|----------|------|
| `categories` | 首页 `/zh` | 刷新首页 | `categories` 表出现数据 |
| `tags` | 标签页 `/zh/tags` | 访问标签页 | `tags` 表出现数据 |
| `articleContents` | 任意文章详情页 | 点开文章 | `articleContents` 表出现数据 |

### 方法 2：Console 快速检查

```js
// 首页验证 categories
(await (await indexedDB.open('JoyMiniBlog')).transaction('categories').objectStore('categories').getAll()).map(c => c.name)

// 标签页验证 tags
(await (await indexedDB.open('JoyMiniBlog')).transaction('tags').objectStore('tags').getAll()).map(t => t.name)

// 文章页验证 articleContents
(await (await indexedDB.open('JoyMiniBlog')).transaction('articleContents').objectStore('articleContents').getAll()).map(a => a.slug)
```

### 方法 3：离线模式测试

**第 1 步：写入缓存（在线状态）**
1. 访问首页 `/zh` — 触发 categories 缓存
2. 访问标签页 `/zh/tags` — 触发 tags 缓存
3. 点开 2-3 篇文章 — 触发 articleContents 缓存

**第 2 步：切换到离线模式**
DevTools → **Network** 标签 → 勾选 **Offline**

**第 3 步：验证离线渲染**

| 验证项 | 操作 | 成功标准 |
|--------|------|----------|
| 分类筛选器 | 刷新首页 | 分类列表仍显示 ✅ |
| 文章详情 | 刷新已打开过的文章页 | 正文内容仍显示 ✅ |
| 标签列表 | 刷新标签页 | 标签列表仍显示 ✅ |

**第 4 步：恢复在线** — 取消勾选 Offline。

### 方法 4：Network 请求确认 Local-First 行为

1. DevTools → **Network** 标签
2. 刷新首页，注意过滤 `api` 请求
3. 观察流程：
   - 页面立即渲染（IndexedDB 缓存数据）
   - 稍后 API 请求完成（后台网络更新）
   - 没有等待 API 的空白期

### 异常排查

| 现象 | 可能原因 | 解决方案 |
|------|----------|----------|
| IndexedDB 表为空 | 缓存写入未触发 | 确认页面已完整加载，网络请求成功返回 |
| 离线时页面空白 | `networkMode` 未生效 | 检查 `useFrontendArticles.ts` 中对应 hook 是否有 `networkMode: 'offlineFirst'` |
| 旧数据还在 | Dexie v2 迁移未执行 | 在 Console 执行 `indexedDB.deleteDatabase('JoyMiniBlog')` 后刷新 |
