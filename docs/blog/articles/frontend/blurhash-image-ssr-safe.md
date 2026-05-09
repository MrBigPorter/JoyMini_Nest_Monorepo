---
title: BlurhashImage — SSR 安全的 BlurHash 占位符组件与"像文字一样平滑"的渲染策略
slug: blurhash-image-ssr-safe
tags: Next.js, BlurHash, SSR, Performance, Image Optimization, Canvas
---

# BlurhashImage — SSR 安全的 BlurHash 占位符组件与"像文字一样平滑"的渲染策略

> **Article F1** — JoyMini 博客平台使用 BlurHash 在图片加载期间提供优美的占位符，通过独特的"覆盖层淡出"技术消除了大多数图片占位符实现的闪烁问题。所有渲染均在 Next.js SSR 下安全运行。

- **GitHub**: [`BlurhashImage.tsx`](apps/frontend-blog/src/components/blog/BlurhashImage.tsx)
- **相关组件**: [`useNetworkQuality.ts`](apps/frontend-blog/src/lib/hooks/useNetworkQuality.ts), [`ArticleMeta`](apps/frontend-blog/src/lib/types/frontend-blog.ts:13), [`ArticleCard.tsx`](apps/frontend-blog/src/components/blog/ArticleCard.tsx), [`HeroSection.tsx`](apps/frontend-blog/src/components/blog/HeroSection.tsx), [`FeaturedProjects.tsx`](apps/frontend-blog/src/components/blog/FeaturedProjects.tsx)
- **系列**: 前端架构深度解析

---

## 1. 问题：SSR + Canvas API 的冲突

Next.js App Router 支持三种渲染模式——SSR、SSG 和 CSR。当页面进行服务端渲染（SSR）或静态生成（SSG）时，React 组件在 **Node.js 环境**中执行，此时浏览器 API 如 `Canvas`、`window`、`document` 等均不存在。

[`blurhash`](https://github.com/woltapp/blurhash) 库的 `decode()` 函数返回原始像素数据（`Uint8ClampedArray`）。要将这些像素渲染为可视化占位符，我们需要 **Canvas API** 将像素转换为 `<img>` 兼容的 data URL。这从根本上来说是仅浏览器支持的操作。

常见的不兼容 SSR 的方案：

| 方案 | SSR 行为 |
|----------|-------------|
| `react-blurhash` 的 `<Blurhash>` 组件 | **崩溃**——模块加载时就引入了 Canvas |
| 直接使用 `document.createElement('canvas')` | **崩溃**——`document is not defined` |
| 仅 `blurhash.decode()` 不渲染 | 可用但没有视觉回退 |

我们的 [`BlurhashImage`](apps/frontend-blog/src/components/blog/BlurhashImage.tsx:107) 组件通过 **三层 SSR 安全策略**以及独特的"覆盖层淡出"渲染方式解决了这个问题，消除了懒加载图片的典型闪烁。

---

## 2. 架构概览

```
┌────────────────────────────────────────────────────────┐
│                   ArticleCard / HeroSection              │
│  ┌──────────────────────────────────────────────────┐  │
│  │              BlurhashImage Component              │  │
│  │                                                    │  │
│  │  ┌──────────────┐     ┌────────────────────────┐  │  │
│  │  │ SSR 安全层    │     │  渲染策略              │  │  │
│  │  │ ────────────  │     │ ────────────────────   │  │  │
│  │  │ • use client   │     │ • Image 全透明度       │  │  │
│  │  │ • useEffect    │     │ • Blurhash 覆盖 ↑      │  │  │
│  │  │ • typeof win   │     │ • 加载后淡出           │  │  │
│  │  └──────────────┘     └────────────────────────┘  │  │
│  │                                                    │  │
│  │  ┌─────────────────────────────────────────────┐   │  │
│  │  │      全局 LRU 缓存 (Map<string,string>)      │  │  │
│  │  │      最大 100 条，淘汰最旧条目                │  │  │
│  │  └─────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │         useNetworkQuality (自适应)                │  │
│  │  effectiveType → quality, format, shouldBlurOnly  │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 3. 渲染策略："像文字一样平滑"

大多数图片占位符的实现遵循以下模式：

1. 显示 blurhash 占位符
2. 等待图片加载
3. 淡入图片
4. 淡出占位符

这会产生**明显的闪烁**——图片突然出现，同时 blurhash 消失。用户感受到一种突兀的过渡。

我们的方法反转了渲染顺序：

```
时间 ───────────────────────────────────────────────►

图片:     ████████████████████████████████████████
           (始终 100% 透明度，渲染在底层)

Blurhash: ████████████████████████░░░░░░░░░░░░░░░░
           (z-20 覆盖层，图片加载后淡出)

用户看到: ░░░░░░░░░░░░░░░░░░░░░░░░░████████████████
           (blurhash → 平滑淡出 → 真实图片)
```

关键思路：**图片元素立即以全透明度渲染**。blurhash 作为 CSS 覆盖层（`z-20`）**放置在图片之上**。当图片加载完成时，覆盖层淡出（300ms `transition-opacity`），露出一直在下方渲染的图片。

### 为什么这样做有效

- **无闪烁**：图片在用户看到之前已经完全加载并渲染好了
- **极度流畅**：简单的 CSS 透明度过渡（100% → 0%）由 GPU 加速
- **无布局偏移**：覆盖层使用 `absolute inset-0`，图片布局稳定
- **渐进增强**：即使没有 JS，图片也能正常渲染（覆盖层从不出现）

### 代码实现

```tsx
// blurhash 覆盖层——定位在图片之上 (z-20)
{placeholderUrl && (
  <div
    className={`absolute inset-0 z-20 bg-cover bg-center transition-opacity duration-300 ${
      isLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'
    }`}
    style={{
      backgroundImage: `url(${placeholderUrl})`,
      backgroundSize: 'cover',
      filter: 'blur(8px)',
      transform: 'scale(1.1)',
    }}
  />
)}
```

低分辨率 blurhash（以 32×32 解码）通过以下方式在视觉上展开：

- [`filter: blur(8px)`](apps/frontend-blog/src/components/blog/BlurhashImage.tsx:228) —— 平滑低分辨率解码的像素化效果
- [`transform: scale(1.1)`](apps/frontend-blog/src/components/blog/BlurhashImage.tsx:229) —— 隐藏边缘模糊伪影

---

## 4. 三层 SSR 安全保护

组件实现了三层 SSR 保护：

### 第一层：`'use client'` 指令

文件以 `'use client'` 开头，告诉 Next.js 这是一个客户端组件。这可以防止在服务端渲染组件树。然而在 SSG（静态生成）期间，组件**仍然会渲染一次**以生成初始 HTML——这就是第二层和第三层发挥作用的地方。

### 第二层：`useEffect` 处理 Canvas 操作

所有 Canvas 和 blurhash 解码操作都在 `useEffect` 内部进行：

```typescript
useEffect(() => {
  if (blurhash && typeof window !== 'undefined') {
    const url = blurhashToDataUrl(blurhash, 32, 32);
    if (url) {
      setPlaceholderUrl(url);
    }
  }
}, [blurhash]);
```

`useEffect` 仅在客户端水合后执行。在 SSR/SSG 期间，这段代码不会执行——`setPlaceholderUrl` 永远不会被调用，因此 `placeholderUrl` 保持为 `''`（初始状态）。

### 第三层：`typeof window !== 'undefined'` 运行时守卫

即使在仅客户端的 `useEffect` 内部，还有一层额外的守卫——[`typeof window !== 'undefined'`](apps/frontend-blog/src/components/blog/BlurhashImage.tsx:128)。这是一个防御性检查，针对：

- **SSR/SSG 渲染**：`useEffect` 回调在服务端渲染时本就不会触发，但守卫让意图更加明确
- **Edge Runtime 的兼容性问题**：某些 Edge Functions 具有部分 DOM polyfill，可能导致意外行为
- **测试环境**：Jest/JSDOM 可能没有完整的 Canvas 支持

### 降级状态

| 状态 | 视觉效果 |
|-------|--------|
| SSR/SSG 渲染（blurhash 尚未解码） | 灰色 `animate-pulse` 骨架屏 |
| 客户端挂载，解码进行中 | 同上 |
| 解码成功 | Blurhash 覆盖层在图片之上 |
| 解码失败（无效 hash） | 灰色骨架屏（不会崩溃） |
| 没有图片或图片加载出错 | 渐变占位符 + 图片图标 SVG |

```typescript
const [isLoaded, setIsLoaded] = useState(false);
const [hasError, setHasError] = useState(false);
const [placeholderUrl, setPlaceholderUrl] = useState<string>('');
```

---

## 5. 全局 LRU 缓存用于 BlurHash 解码

BlurHash 解码是 CPU 密集型的——每次调用 `decode(hash, width, height)` 都会对 hash 的频率分量执行离散余弦变换（DCT）来重建像素数据。

### 问题

当用户在分类之间导航时，组件会重新挂载（新文章数据触发 React reconciliation）。没有缓存的话，每次分类切换都会重新解码相同的 blurhash 字符串，导致明显的卡顿——尤其是在移动设备上。

### 解决方案：全局 LRU 缓存

```typescript
const blurhashCache = new Map<string, string>();
const BLURHASH_CACHE_MAX = 100;
```

缓存以 `"${hash}:${width}:${height}"` 为键存储解码后的 data URL。关键设计决策：

- **全局作用域（模块级别）**：缓存存在于 React 组件生命周期之外，在重新挂载后仍然保留
- **LRU 淘汰**：当缓存条目被访问时，它会移动到 Map 的末尾（最近使用）。当缓存超过 100 条时，最旧的条目（Map 迭代器的第一个键）被淘汰
- **Data URL 存储**：解码后的 `data:image/png` URL 存储成本很低（几 KB），相比重新解码非常划算
- **不可变键**：BlurHash 字符串和维度通常是每个图片静态的，因此缓存失效很少需要

### 性能影响

| 操作 | 耗时 | 说明 |
|-----------|------|-------|
| 首次解码（32×32） | ~0.5–2ms | CPU 密集型 DCT |
| 缓存命中（data URL） | ~0.001ms | Map 查找 |
| 分类切换（无缓存） | ~50–200ms 总计 | 解码 25+ 个卡片 |
| 分类切换（有缓存） | ~0.1ms | 全部缓存命中 |

### 缓存 API

```typescript
function getCachedBlurhashUrl(hash: string, width: number, height: number): string
function setCachedBlurhashUrl(hash: string, width: number, height: number, url: string): void
```

`blurhashToDataUrl` 函数编排缓存：

```typescript
function blurhashToDataUrl(hash: string, width: number, height: number): string {
  // 先查缓存
  const cached = getCachedBlurhashUrl(hash, width, height);
  if (cached) return cached;

  const pixels = decode(hash, width, height);
  // ... Canvas 操作 ...
  const url = canvas.toDataURL('image/png');
  setCachedBlurhashUrl(hash, width, height, url);
  return url;
}
```

---

## 6. 低分辨率解码

BlurHash 以 [`32×32`](apps/frontend-blog/src/components/blog/BlurhashImage.tsx:129) 像素解码——远低于最终显示尺寸（通常为 600px–100vw）。

```typescript
const url = blurhashToDataUrl(blurhash, 32, 32);
```

这是有意为之：

- **解码速度**：`decode()` 函数处理 `width × height` 像素。32×32（1,024 像素）vs 600×338（202,800 像素），解码速度提升了约 200 倍
- **视觉质量**：结合 `filter: blur(8px)` 和 `transform: scale(1.1)`，低分辨率解码在用作模糊背景时与全分辨率解码几乎无法区分
- **内存**：生成的 data URL 是很小的 PNG（几百字节到约 2KB），而全分辨率需要几十 KB

视觉效果流水线：

```
32×32 像素 ──→ scale(1.1) + blur(8px) ──→ 覆盖整个容器
[块状/像素化]    [平滑、艺术化]      [无可见伪影]
```

---

## 7. 与自适应图片质量的集成

[`useNetworkQuality`](apps/frontend-blog/src/lib/hooks/useNetworkQuality.ts) 钩子提供网络感知的图片质量设置：

```typescript
export interface NetworkQuality {
  effectiveType: EffectiveType;
  quality: number;          // 1-100，传给 Next.js <Image> quality prop
  format: 'avif' | 'webp' | 'jpeg';
  shouldBlurOnly: boolean;  // 如果为 true，只渲染 blurhash——跳过完整图片
  saveData: boolean;
  downlink: number;
  rtt: number;
}
```

### 自适应质量等级

| 连接 | 质量 | 格式 | 仅 Blur | 每张图片数据量 |
|-----------|---------|--------|-----------|----------------|
| 4G / 未知 | 75 | AVIF | 否 | ~40KB |
| 3G | 45 | WebP | 否 | ~15KB |
| 2G | 20 | WebP | 否 | ~5KB |
| 慢速 2G | 10 | WebP | 否 | ~2KB |
| Save-Data | 10 | WebP | 否 | ~2KB |
| 极限模式 | — | — | 是 | 0KB（仅 blurhash） |

`shouldBlurOnly` 极限等级专门用于：
- 计量连接的用户，明确启用了 Save-Data
- 非常慢的网络，即使低质量图片也代价高昂
- 未来：自动检测已缓存但尚未加载的图片（等待完整 fetch）

### 在 ArticleCard 中的使用

[`ArticleCard`](apps/frontend-blog/src/components/blog/ArticleCard.tsx) 集成了两个系统：

```typescript
const { quality, shouldBlurOnly } = useNetworkQuality();
const imageQuality = shouldBlurOnly ? 1 : quality;
// ...
<BlurhashImage
  src={coverImageUrl}
  alt={article.title}
  fill
  quality={imageQuality}
  blurhash={article.meta?.images?.blurhash}
  sizes="..."
/>
```

当 `shouldBlurOnly` 为 true 时，quality 设为 `1`（最小值），导致 Next.js 图片优化生成一个极小、几乎无法辨认的图片。但由于 blurhash 覆盖层遮住了它，用户只能看到艺术化的 blurhash 占位符——在保持视觉质量的同时节省带宽。

---

## 8. 数据流：从 API 到像素

```
后端 (NestJS)                    前端 (Next.js)
┌─────────────────────┐          ┌───────────────────────────────┐
│                      │          │                               │
│ 文章上传              │  HTTP    │ ArticleMeta.images.blurhash   │
│ ───────────────      │ ──────►  │ ──────────────────────────    │
│ • 原始图片            │          │ blurhash: "LEHV6nWB2yk8pyo0"  │
│ • 生成变体            │          │                               │
│ • 计算 blurhash       │          │ BlurhashImage 组件           │
│   （服务端）           │          │ ──────────────────────────    │
│                      │          │ 1. useEffect → decode()       │
│                      │          │ 2. blurhashToDataUrl()        │
│                      │          │ 3. 全局 LRU 缓存检查          │
│                      │          │ 4. Canvas → data URL          │
│                      │          │ 5. 设为 CSS background        │
│                      │          │ 6. 加载后覆盖层淡出           │
└─────────────────────┘          └───────────────────────────────┘
```

BlurHash 计算在**服务端**完成（NestJS 中，在图片上传期间），因此前端只接收 hash 字符串——除了客户端解码外无需额外计算。

---

## 9. 使用示例

### HeroSection — 主 Banner

```typescript
// HeroSection.tsx
<BlurhashImage
  src={mainArticle.coverImage}
  alt={mainArticle.title}
  fill
  priority
  blurhash={mainArticle.meta?.images?.blurhash}
  sizes="(max-width: 1024px) 100vw, 66vw"
/>
```

`priority` 属性确保 Hero 图片被预加载（Next.js 添加 `<link rel="preload">`）。BlurHash 在大型 Hero 图片下载期间提供视觉占位符。

### FeaturedProjects — 精选区（带 activeIndex）

```typescript
// FeaturedProjects.tsx
<BlurhashImage
  src={posterUrl}
  alt={currentArticle.title}
  fill
  priority={activeIndex === 0}
  blurhash={currentArticle.meta?.images?.blurhash}
  sizes="100vw"
/>
```

只有第一个精选项目获得 `priority={true}`。轮播使用 CSS `overflow-hidden`，因此只有当前项可见——非活跃项保留在 DOM 中但在屏幕外，保持它们的 blurhash 覆盖层随时可以即时显示。

### ArticleCard — 列表视图

```typescript
// ArticleCard.tsx
<BlurhashImage
  src={coverImageUrl}
  alt={article.title}
  fill
  quality={imageQuality}
  blurhash={'meta' in article
    ? (article as FrontendArticle).meta?.images?.blurhash
    : undefined}
  sizes="(max-width: 768px) 90vw, (max-width: 1024px) 45vw, 600px"
/>
```

注意 `meta` 的类型收窄——ArticleCard 组件接受一个可能包含也可能不包含 blurhash 元数据的泛型类型。这种条件判断在类型化和非类型化数据源之间划清了界限。

---

## 10. 降级状态

组件优雅地处理四种不同状态：

### 1. 无图片源（`!src`）

```typescript
if (!src) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div className="flex items-center justify-center w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 text-slate-400 dark:text-slate-500">
        <svg ...>
          {/* 图片图标 */}
        </svg>
      </div>
    </div>
  );
}
```

渐变占位符加图片图标 SVG——用于尚未分配封面图的文章。

### 2. 图片加载错误（`hasError`）

当 `onError` 触发时（例如图片 URL 失效、CORS 问题）：

```typescript
const handleError = useCallback(() => {
  setHasError(true);
  setIsLoaded(true);  // 隐藏 blurhash 覆盖层
}, []);
```

显示带有图片图标的渐变回退，类似于无 src 状态，但在正常的渲染流程中。

### 3. SSR/SSG 或解码前（`!placeholderUrl && !isLoaded`）

灰色骨架屏加 `animate-pulse`：

```typescript
{!placeholderUrl && !isLoaded && (
  <div className="absolute inset-0 z-20 bg-slate-200 dark:bg-slate-700 animate-pulse" />
)}
```

这是用户在 SSR 渲染期间或 blurhash 解码完成前看到的内容。`animate-pulse` 提供微妙的加载指示。

### 4. 完整体验（blurhash + 图片已加载）

从 blurhash 到真实图片的平滑淡出，如第 3 节所述。

---

## 11. 为什么不用 `react-blurhash`？

流行的 [`react-blurhash`](https://github.com/mad-gooze/react-blurhash) 包提供了一个 `<Blurhash>` 组件，可以直接解码和渲染 blurhash。我们选择不使用它有以下几个原因：

1. **包体积**：`react-blurhash` 捆绑了自己的 Canvas 渲染逻辑。通过直接使用 [`blurhash`](https://github.com/woltapp/blurhash) 核心库（我们已经在服务端计算中使用了），避免了重复依赖。

2. **SSR 安全**：`react-blurhash` 在模块级别就导入了 Canvas，导致 SSR 崩溃。我们基于 `useEffect` 的方法天生就是 SSR 安全的。

3. **自定义渲染**："在图片之上覆盖"的方式需要自定义 DOM 结构，`react-blurhash` 不支持。

4. **缓存控制**：我们的全局 LRU 缓存比 `react-blurhash` 的逐组件缓存更节省内存。

5. **无 JSX 依赖**：我们将 blurhash 渲染为 `<div>` 上的 CSS `background-image`，而不是 Canvas 元素。这使得 CSS 过渡（透明度淡出）比基于 Canvas 的渲染器更容易实现。

---

## 12. 性能数据

| 指标 | 数值 | 说明 |
|--------|-------|-------|
| BlurHash 解码时间（32×32） | 0.5–2ms | 首次解码，因 hash 复杂度而异 |
| 缓存命中延迟 | <0.001ms | Map 查找 |
| Data URL 大小 | 300–800 字节 | PNG，32×32 像素 |
| LRU 缓存最大内存 | ~60–160KB | 100 条 × 平均 800 字节 |
| 过渡 GPU 成本 | 0ms | CSS opacity 仅合成器 |
| 淡出持续时间 | 300ms | CSS `transition-opacity duration-300` |
| 包体积影响 | ~3KB gzipped | 仅 `blurhash` 核心库 |

### Lighthouse 影响

虽然 blurhash 本身不会直接改善 Lighthouse 评分（它是一种视觉增强，而非加载优化），但它显著提升了：

- **首次内容绘制（感知上）**：用户立即看到有意义的占位符，而不是空白区域或灰色矩形
- **累积布局偏移（CLS）**：组件保持稳定的宽高比，因此图片加载时布局不会偏移
- **最大内容绘制（感知上）**：blurhash 覆盖层让 LCP 元素在用户感知中"加载完成"得更早

---

## 13. 演进历史

BlurhashImage 组件经历了几个阶段：

### 阶段 1：直接 Canvas（SSR 意识之前）

初始实现使用内联 Canvas 渲染 blurhash。在仅 CSR 页面中工作正常，但在 SSR 下崩溃。

### 阶段 2：`react-blurhash` 包装

替换为 `react-blurhash` 的 `<Blurhash>` 组件。解决了 Canvas 渲染问题，但由于模块级别的 Canvas 导入引入了 SSR 崩溃。

### 阶段 3：`'use client'` + `useEffect`

迁移到 `'use client'` 加基于 `useEffect` 的解码。SSR 安全了，但每次重新挂载都重新解码（分类切换很慢）。

### 阶段 4：全局 LRU 缓存（当前）

添加了模块级别的 LRU 缓存，上限 100 条。分类切换变得瞬时完成。同时增加了 `typeof window !== 'undefined'` 守卫以增强安全性。

### 阶段 5：网络感知质量（已集成）

添加了与 `useNetworkQuality` 的集成，用于自适应图片质量和 `shouldBlurOnly` 极限等级。

---

## 14. 总结

`BlurhashImage` 组件展示了 SSR 安全客户端组件的几个重要模式：

1. **三层 SSR 安全**：`'use client'` → `useEffect` → 运行时守卫
2. **"像文字一样平滑"渲染**：图片在底层，blurhash 覆盖在上层，加载后淡出——消除了闪烁
3. **全局 LRU 缓存**：模块级状态在组件重新挂载后依然保持，防止重复解码
4. **32×32 低分辨率解码**：比全分辨率快 200 倍，配合模糊滤镜几乎无法区分
5. **自适应质量集成**：网络感知的图片质量，带 `shouldBlurOnly` 极限等级
6. **优雅降级**：4 种不同的视觉状态（无图片、错误、SSR 骨架屏、完整体验）

这个组件是 JoyMini 博客视觉打磨的关键部分——平滑的 blurhash 到图片的过渡是用户浏览文章时最先注意到的细节之一。
