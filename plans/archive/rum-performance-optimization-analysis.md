# RUM 性能优化分析 — JoyMini Blog

> 基于 Sentry RUM + Web Vitals 数据驱动的前端性能优化记录。
> 先保存分析笔记，待部署验证效果后再决定是否撰写博客。

---

## 目录

1. [问题 1: "Connection closed" TypeError](#问题-1-connection-closed-typeerror)
2. [问题 2: LCP 15,024ms — video poster](#问题-2-lcp-15024ms--video-poster)
3. [问题 3: LCP 2,648ms — img.object-cover (Cloudflare URL mismatch)](#问题-3-lcp-2648ms--imgobject-cover-cloudflare-url-mismatch)
4. [修改文件清单](#修改文件清单)
5. [博客素材备忘](#博客素材备忘)

---

## 问题 1: "Connection closed" TypeError

### 表现
- Sentry RUM 捕获 `TypeError: Connection closed`
- 页面: `blog.joyminis.com/ja/`
- 触发场景: 快速切换分类导航 tab

### 根因分析

```
快速点击分类 tab
    ↓
handleCategoryChange() 连续调用
    ↓
View Transitions API 重叠 (startViewTransition)
    ↓
router.replace() 基于可能已过期的 searchParams
    ↓
Next.js abort 前一个 RSC stream (abort signal)
    ↓
fetch rejection 未被 catch → unhandled promise rejection
    ↓
Sentry 的 console.error instrumentation 捕获为 exception
    ↓
ErrorBoundary 捕获 → 显示错误 UI 给用户
```

**关键问题点**:
1. `router.replace()` 依赖 `searchParams` — 当 `searchParams` 是 React.use() 的 Suspense 边界时，连续调用可能导致使用过期的 params
2. View Transitions API 的回调中执行 `router.replace()`，如果前一个 transition 还没完成就启动新的，会产生重叠
3. Next.js RSC streaming 使用 abort signal — 前一个 fetch 被 abort 后抛出 "Connection closed"

### 修复

| 文件 | 修改 | 目的 |
|------|------|------|
| `instrumentation-client.ts` | 将 `'Connection closed'` 加入 `ignoreErrors` | 防止 Sentry 误报（网络波动导致的正常中断） |
| `page.client.tsx` | `handleCategoryChange` 增加 300ms debounce | 只有最后一次点击触发导航，避免快速点击的竞态 |

### 关键代码

```typescript
// page.client.tsx — debounce
const categoryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const handleCategoryChange = useCallback(
  (categoryId?: string) => {
    if (categoryDebounceRef.current) {
      clearTimeout(categoryDebounceRef.current);
    }
    categoryDebounceRef.current = setTimeout(() => {
      // ... existing View Transitions + router.replace logic
    }, 300);
  },
  [searchParams, router, prefetchCategory, currentLocale],
);
```

---

## 问题 2: LCP 15,024ms — video poster

### 表现
- LCP 元素: `<video class="w-full h-full object-contain">` (HlsVideoPlayer)
- LCP 时间: **15,024ms** (P50/P75/P90/P99 全部 15,024ms)
- Poster URL: `img.joyminis.com/uploads/blog/videos/.../poster.jpg`
- 页面: `blog-dev.joyminis.com/en/`

### 根因分析

```
首页第一篇是视频文章
    ↓
LCP 候选元素是 <video poster="...">
    ↓
poster.jpg 是 ffmpeg 提取的 JPEG (1280px, -q:v 3 = 高画质 = 300-600KB)
    ↓
无 SSR preload：page.tsx 只 preload 了 firstCoverImage
    ↓
无 fetchpriority hint：浏览器不知道这个 poster 是 LCP 元素
    ↓
无 WebP 变体：JPEG 比同等视觉质量的 WebP 大 30-50%
    ↓
15 秒才加载完成
```

### 修复

| 文件 | 修改 | 目的 |
|------|------|------|
| `page.tsx` | 增加 `firstVideoPoster` + `firstVideoPosterWebp` 检测，注入 SSR preload | 让浏览器尽早发现 poster 资源 |
| `HlsVideoPlayer.tsx` | 增加 `posterWebp` prop + `effectivePoster` + `fetchpriority="high"` | 优先使用 WebP + 给浏览器 LCP hint |
| `HeroSection.tsx` | 传递 `posterWebp` prop | 打通数据链 |
| `ArticleCard.tsx` | 传递 `posterWebp` prop | 打通数据链 |
| `frontend-blog.ts` | `ArticleMeta.video` 增加 `posterWebp?: string` | 类型定义 |
| `media-processor.service.ts` | `extractVideoThumbnail()` 返回 `{ jpg, webp }` + sharp WebP 生成 + JPEG 质量从 `-q:v 3` 降为 `-q:v 8` | 后端生成 WebP 变体并减小 JPEG 体积 |
| `media.processor.ts` | 解构新 return type，存储 `poster` 和 `posterWebp` | 适配新接口 |

### 关键代码

```typescript
// media-processor.service.ts — WebP 生成
async extractVideoThumbnail(
  buffer: Buffer,
  articleId: string,
): Promise<{ jpg: string; webp: string }> {
  // 1. ffmpeg 提取第一帧 at 1s
  // 2. 缩放至 1280px width
  // 3. JPEG quality 8 (之前是 3, 文件体积减半)
  // 4. sharp 转换 WebP quality 80
  // 5. 分别上传 poster.jpg 和 poster.webp
  // 6. 返回 { jpg: string, webp: string }
}
```

```typescript
// HlsVideoPlayer.tsx — WebP 优先 + fetchpriority
const effectivePoster = posterWebp || poster;

useEffect(() => {
  const video = videoRef.current;
  if (effectivePoster && video) {
    video.setAttribute('fetchpriority', 'high');
  }
}, [effectivePoster]);
```

```typescript
// page.tsx — SSR preload
const firstVideoPoster = initialData.items?.[0]?.meta?.video?.poster;
const firstVideoPosterWebp = initialData.items?.[0]?.meta?.video?.posterWebp;

const preloadImages = new Set<string>();
if (firstCoverImage) preloadImages.add(firstCoverImage);
if (firstVideoPosterWebp) {
  preloadImages.add(firstVideoPosterWebp);
} else if (firstVideoPoster) {
  preloadImages.add(firstVideoPoster);
}
```

### 注意点
- `fetchpriority` 不能直接在 JSX 中使用，因为 React 19.2.14 的 `VideoHTMLAttributes` 不包含此属性。需要通过 `video.setAttribute('fetchpriority', 'high')` 在 DOM 上设置。
- 后续新增文章的 poster 需要重新处理才能获得 WebP 版本。已有文章的 poster 不会自动获得 WebP。

---

## 问题 3: LCP 2,648ms — img.object-cover (Cloudflare URL mismatch)

### 表现
- LCP 元素: `<img class="object-cover">`
- LCP 时间: **2,648ms** (P50/P75/P90/P99 全部 2,648ms)
- URL: `img.joyminis.com/cdn-cgi/image/width=768,quality=75,f=auto,fit=scale-down/uploads/blog/.../image.png`
- 页面: `blog.joyminis.com/en/`

### 根因分析

```
SSR preload (<link rel="preload">):
  https://img.joyminis.com/uploads/blog/.../image.png          ← 原始 R2 URL

浏览器实际加载 (<img> via Next.js Image + cloudflareImageLoader):
  https://img.joyminis.com/cdn-cgi/image/width=768,quality=75,f=auto,fit=scale-down/uploads/blog/.../image.png
                                                               ← Cloudflare 转换 URL

=> URL 不同 → preload miss → 2.6s 冷加载
```

**数据流**: `coverImage` (DB存储原始R2 URL) → `BlurhashImage` → Next.js `<Image>` → `cloudflareImageLoader` → `/cdn-cgi/image/width=...,quality=...,f=auto,fit=scale-down/...`

### 修复

| 文件 | 修改 | 目的 |
|------|------|------|
| `page.tsx` | 导入 `cloudflareImageLoader`，转换 `firstCoverImage` URL 后注入 preload | preload URL 匹配实际渲染 URL |

### 关键代码

```typescript
// page.tsx — 转换 cover image URL
const preloadedCoverImage = firstCoverImage
  ? cloudflareImageLoader({
      src: firstCoverImage,
      width: 1200,  // hero image, sizes="(max-width: 1024px) 100vw, 66vw"
      quality: 75,  // Next.js 默认 quality
    })
  : undefined;

const preloadImages = new Set<string>();
if (preloadedCoverImage) preloadImages.add(preloadedCoverImage);
// ... video poster preloads
```

**补充说明**: `page.client.tsx` 中的无限滚动 prefetch（第 330-350 行）已经正确处理了 URL 转换，但 SSR preload 遗漏了这个逻辑。

---

## 修改文件清单

### Frontend (6 files)

| 文件 | 修改类型 |
|------|----------|
| [`apps/frontend-blog/src/instrumentation-client.ts`](/Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/frontend-blog/src/instrumentation-client.ts) | 新增 ignoreErrors 条目 |
| [`apps/frontend-blog/src/app/[locale]/page.client.tsx`](/Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/frontend-blog/src/app/[locale]/page.client.tsx) | 新增 debounce ref + 包装 handleCategoryChange |
| [`apps/frontend-blog/src/app/[locale]/page.tsx`](/Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/frontend-blog/src/app/[locale]/page.tsx) | SSR preload: 新增 video poster + WebP poster + 转换 cover image URL |
| [`apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx`](/Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx) | 新增 posterWebp prop + effectivePoster + fetchpriority |
| [`apps/frontend-blog/src/components/blog/HeroSection.tsx`](/Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/frontend-blog/src/components/blog/HeroSection.tsx) | 传递 posterWebp (main + side) |
| [`apps/frontend-blog/src/components/blog/ArticleCard.tsx`](/Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/frontend-blog/src/components/blog/ArticleCard.tsx) | 传递 posterWebp |
| [`apps/frontend-blog/src/lib/types/frontend-blog.ts`](/Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/frontend-blog/src/lib/types/frontend-blog.ts) | 新增 posterWebp 类型 |

### Backend (2 files)

| 文件 | 修改类型 |
|------|----------|
| [`apps/api/src/common/media/media-processor.service.ts`](/Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/api/src/common/media/media-processor.service.ts) | 返回 { jpg, webp }; 降低 JPEG 质量; 新增 sharp WebP 生成 |
| [`apps/api/src/common/media/media.processor.ts`](/Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/api/src/common/media/media.processor.ts) | 适配新 return type |

### 验证

- `tsc --noEmit`: **0 errors**
- `lint`: **0 errors** (仅存已有 warnings, 与本次修改无关)

---

## 博客素材备忘

> 待部署验证效果后，再决定是否撰写博客。

### 潜在选题

#### 选题 A: 《RUM 驱动的前端性能优化实战》
- 合并所有 3 个问题，形成一个完整故事
- 结构: 发现问题（Sentry RUM）→ 分析根因 → 修复 → 验证效果
- 适合: 中级前端开发者、关注 Web Vitals 的团队
- 技术栈: Next.js App Router, RSC, hls.js, Cloudflare Image Resizing

#### 选题 B: 《Next.js + Cloudflare Image Resizing: 一个 preload 暗坑》
- 聚焦问题 3（URL mismatch），深入分析
- 适合: 使用 Next.js + Cloudflare 的团队
- 技术栈: Next.js Image, cloudflareImageLoader, SSR preload

#### 选题 C: 《视频 Poster 的 LCP 优化指南》
- 聚焦问题 2，扩展为通用指南
- 适合: 视频内容网站、媒体平台
- 技术栈: ffmpeg, sharp, WebP, hls.js

### 需要收集的数据（部署后）

- [ ] LCP P50/P75/P90/P99 对比 (before vs after)
- [ ] "Connection closed" 错误频率变化
- [ ] Cloudflare Image Resizing 缓存命中率变化
- [ ] 视频 poster 加载时间变化
- [ ] WebP vs JPEG 的 poster 文件大小对比
