---
title: Next.js 返回导航完全指南：滚动位置恢复、URL 参数保持与 iOS 安全区域
slug: nextjs-back-navigation-scroll-restoration
tags: Next.js, Scroll Restoration, UX, iOS Safari, Embla Carousel, React
description: 本文深入剖析了 Next.js App Router 下返回导航滚动恢复失效的三大根因——sessionStorage 条件误判、URL 参数丢失、React Strict Mode 双重挂载，以及连带修复的 iOS Safari 安全区域抖动和 CategoryFilter 选项卡抖动问题。
---

# Next.js 返回导航完全指南：滚动位置恢复、URL 参数保持与 iOS 安全区域

## 一、背景

我们的博客前端（`frontend-blog`）使用 Next.js App Router + `next-intl` 多语言架构。用户通过首页文章列表进入文章详情页，阅读完毕后点击"返回"按钮，预期是回到之前的浏览位置，并且保持之前选择的分类筛选和页码。

但在生产环境中，返回导航出现了三个明显的体验问题：

| 问题 | 现象 | 严重程度 |
|------|------|----------|
| **滚动位置丢失** | 返回首页总是滚动到顶部 | P0 — 核心体验 |
| **URL 参数丢失** | `?category=xxx&page=2` 在返回时消失 | P0 — 核心体验 |
| **CategoryFilter 抖动** | 点击分类选项卡时动画卡顿、位置跳动 | P1 — 视觉体验 |
| **iOS 底部导航间隙** | Safari 滚动时底部导航出现白条或紧贴底部 | P1 — iOS 专属 |

本文将逐一拆解根因并给出最终修复方案。

---

## 二、Problem 1：返回导航滚动位置恢复

### 2.1 症状

1. **滚动位置不恢复** — 首页 → 点击文章 → 返回，永远滚动到顶部
2. **URL 查询参数丢失** — `?category=xxx&page=2` 在返回导航后消失

### 2.2 Bug A：Scroll Restoration 条件永远不匹配

问题出在 [`page.client.tsx`](../../apps/frontend-blog/src/app/[locale]/page.client.tsx:245) 的条件判断：

```typescript
// 原始代码
if (navigatedTo?.includes('/articles/') && savedScrollY) {
```

`navigatedTo` 的值是在首页 **unmount** 时设置的：

```typescript
// 首页 unmount 时的逻辑
sessionStorage.setItem('homeNavigatedTo', window.location.pathname);
```

关键问题在于：在 unmount 时，`window.location.pathname` 是**首页路径**（如 `/ja/`），而不是文章路径。所以 `includes('/articles/')` 永远为 `false`，滚动恢复代码永远不会执行。

### 2.3 Bug B：返回时没有保存 URL 状态

文章详情页的返回按钮实现如下：

```typescript
// articles/[slug]/page.client.tsx
const handleBack = useCallback(() => {
    setNavDirection('backward');
    router.push('/');  // 创建新历史记录，丢失 URL 参数
}, [router]);
```

`router.push('/')` 永远导航到首页根路径，丢失了之前可能存在的 `category`、`page` 等查询参数。

### 2.4 History Stack 边界情况

```
Home /ja/?category=xxx
  ↓ 点击文章卡片
Article /ja/articles/slug
  ↓ 切换语言 (router.replace，原地修改历史)
Article /ja/articles/slug  (同一 entry，locale cookie 变了)
  ↓ 点击收藏（未登录，router.push）
Login /ja/login?returnUrl=...
  ↓ 登录成功（router.push 回到文章）
Article /ja/articles/slug
  ↓ 点击返回
  ???
```

这里的关键决策是：**我们不能使用 `router.back()`**，因为：
- 如果用户登录过，`router.back()` 会回到登录页 ❌
- 如果用户切换过语言，`router.back()` 会回到前一个语言版本的首页 ❌

所以**保留 `router.push()` 是正确的**，但必须让 `router.push()` 携带正确的路径和参数。

### 2.5 Fix 1：ArticleCard 保存页面 URL

在 [`ArticleCard.tsx`](../../apps/frontend-blog/src/components/blog/ArticleCard.tsx:285) 的 `onPointerDown` 中，将当前页面 URL（不含 locale 前缀）保存到 `sessionStorage`：

```typescript
onPointerDown={() => {
    setNavDirection('forward');
    if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        const search = window.location.search;
        // 去掉 locale 前缀，让 next-intl 自动处理当前语言
        const localePrefix = `/${useLocale()}`;
        const pathWithoutLocale = path.startsWith(localePrefix)
            ? path.slice(localePrefix.length) || '/'
            : path;
        sessionStorage.setItem('previousPageUrl', pathWithoutLocale + search);
    }
}}
```

设计决策说明：
- **Locale 剥离**：保存时不带 locale 前缀，让 `next-intl` 在 `router.push()` 时自动拼上当前语言
- **PointerDown 时机**：在 `onPointerDown`（而非 `onClick`）触发，确保在与 article 链接导航的竞争中胜出
- **完整 Search String**：保留 `?category=xxx&page=2`，让返回时能恢复筛选状态

### 2.6 Fix 2：文章页读取保存的 URL

在 [`articles/[slug]/page.client.tsx`](../../apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx:110-113) 中修改 `handleBack`：

```typescript
const handleBack = useCallback(() => {
    setNavDirection('backward');
    const previousUrl = typeof window !== 'undefined'
        ? sessionStorage.getItem('previousPageUrl')
        : null;
    if (previousUrl) {
        router.push(previousUrl);
        sessionStorage.removeItem('previousPageUrl');
    } else {
        router.push('/');
    }
}, [router]);
```

这样做的效果：
- 有 `previousPageUrl` → 携带完整路径和参数返回首页
- 没有 `previousPageUrl`（直接输入 URL 或书签进入文章）→ 降级到 `router.push('/')`
- 使用后立即 `removeItem` → 防止重复使用旧记录

### 2.7 Fix 3：修复 scroll restoration 条件

在 [`page.client.tsx`](../../apps/frontend-blog/src/app/[locale]/page.client.tsx:245) 中，把错误的条件替换为正确的 `isBackNavigation`：

```typescript
// 原始代码（永远不匹配）
if (navigatedTo?.includes('/articles/') && savedScrollY) {

// 修复后
if (isBackNavigation && savedScrollY) {
```

`isBackNavigation` 在组件中已经通过 `getNavDirection()` 计算好：

```typescript
const isBackNavigation =
    typeof window !== 'undefined' &&
    getNavDirection() === 'backward' &&
    allArticles.length > 0;
```

这个条件正确反映了"从文章页返回首页"的导航场景。

---

## 三、Problem 2：CategoryFilter 选项卡抖动

### 3.1 症状

"首页的 tab 每次点击都在抖动，特别是点击到后面的时候，动画回来特别长，很突然。"

### 3.2 根因分析

两个因素交互作用导致：

**因子 A：`transition-all` 在 Embla 轮播中的反馈循环**

选项卡按钮的样式定义：

```typescript
className={`
    flex-shrink-0 px-5 py-2.5 rounded-lg text-sm font-semibold
    transition-all duration-200 whitespace-nowrap      // ← 问题在这里
    ${isActive
        ? 'bg-blue-600 text-white shadow-sm shadow-blue-300'
        : ...
    }
`}
```

当一个选项卡被点击变成激活态时，它的背景色、文字颜色和阴影同时变化。`transition-all` 会动画化**所有 CSS 属性**，包括 `box-shadow`。由于阴影的扩散半径会影响元素的视觉宽度，而这又触发了 Embla 轮播的重新居中计算——**大小变化 → Embla 重居中 → 位置变化 → 更多视觉效果 → 更多居中 → 抖动**，形成了一个反馈循环。

**因子 B：`align: 'center'` 导致长距离滚动**

```typescript
const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'center',           // ← 问题在这里
    containScroll: 'keepSnaps',
    dragFree: false,
    slidesToScroll: 1,
});
```

`align: 'center'` 强制 Embla 将选中选项卡保持在视口中央。当点击列表**末尾**的选项卡时，右侧没有足够的幻灯片来填充，Embla 会滚动一个很长的距离试图居中，然后突然撞到边界停下——这就是"动画特别长，很突然"的根因。

### 3.3 Fix 4 & 5：CategoryFilter 两处修改

**Fix 4**：`transition-all` → `transition-colors`

```typescript
// 原始
transition-all duration-200 whitespace-nowrap

// 修复后
transition-colors duration-200 whitespace-nowrap
```

只动画化 `color` 和 `background-color` 相关属性，消除 `box-shadow` 变化对布局的影响，打断反馈循环。

**Fix 5**：`align: 'center'` → `align: 'start'`

```typescript
const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',            // 修复
    containScroll: 'keepSnaps',
    dragFree: false,
    slidesToScroll: 1,
});
```

`align: 'start'` 让 Embla 左对齐滚动容器。点击末尾选项卡时，滚动距离大幅缩短，不再有突然停止的感觉。

---

## 四、Problem 3：iOS Safari 底部导航间隙

### 4.1 症状

1. **滚动时底部出现白条** — iOS Safari 中向上滚动，底部导航和屏幕边缘之间出现可见间隙
2. **返回后导航紧贴底部** — 进入文章 → 滚动到底 → 点击返回 → 底部导航安全区域丢失，home indicator 可能遮挡按钮

### 4.2 根因

CSS 中使用了 `env(safe-area-inset-bottom)`：

```css
/* globals.css */
--safe-area-bottom: env(safe-area-inset-bottom, 0px);
```

问题在于 `env(safe-area-inset-bottom)` 是一个**静态的 CSS 环境变量**，只在首次渲染时求值。它：
- 初始值是工具栏显示时的安全区域（~34px）
- **不会更新**：当 iOS Safari 工具栏隐藏时，`env(safe-area-inset-bottom)` 保持不变
- **SPA 导航后可能变为 0**：Next.js 客户端导航后，CSS 变量可能重新求值为 `0px`

当工具栏隐藏时：
- `visualViewport` 向下扩展（高度增加）
- `env(safe-area-inset-bottom)` 仍然是 34px → 垫片太大 → 出现白边

### 4.3 Fix 6：使用 `window.visualViewport` API

在 [`BottomNavigation.tsx`](../../apps/frontend-blog/src/components/BottomNavigation.tsx) 中添加动态安全区域计算：

```typescript
useEffect(() => {
  const updateSafeArea = () => {
    if (typeof window !== 'undefined' && window.visualViewport) {
      const vv = window.visualViewport;
      const safeAreaBottom = window.innerHeight - (vv.height + vv.offsetTop);
      document.documentElement.style.setProperty(
        '--safe-area-bottom',
        `${Math.max(safeAreaBottom, 0)}px`,
      );
    }
  };

  updateSafeArea();

  if (typeof window !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateSafeArea);
  }

  return () => {
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', updateSafeArea);
    }
  };
}, [pathname]);
```

`window.visualViewport` API 的优势：
- 在 iOS Safari 工具栏显示/隐藏时触发 `resize` 事件
- 提供 `vv.height`（可见区域高度）和 `vv.offsetTop`（顶部工具栏高度）
- 动态计算：`safeAreaBottom = window.innerHeight - (vv.height + vv.offsetTop)`

这个方案用**运行时值**取代了**静态 CSS 环境变量**：
- **工具栏可见**：`window.innerHeight - vv.height ≈ 34px`（正确安全区域）
- **工具栏隐藏**：`visualViewport` 扩展 → 差值 ≈ 0px（无白边）
- **SPA 导航返回**：`pathname` 变化触发重新计算 → 恢复正确值

边界情况：

| 场景 | 预期行为 |
|------|----------|
| iOS Safari 向上滚动（工具栏隐藏） | 底部导航无白边 |
| iOS Safari 向下滚动（工具栏显示） | 安全区域平滑恢复 |
| 文章页 → 滚动到底 → 返回首页 | 安全区域正确恢复 |
| 非 iOS 浏览器（无 visualViewport） | 降级到 CSS `env(safe-area-inset-bottom)` |
| 桌面浏览器 | 无影响（visualViewport ≈ window.innerHeight） |

---

## 五、Problem 4：React Strict Mode 双重挂载竞态

### 5.1 根因

Next.js 在开发模式下默认启用 React Strict Mode，它会**双重挂载**组件。以下是破坏滚动恢复的精确时序：

```
1. 第一次挂载
   ├── useLayoutEffect 执行
   │   ├── 读取 homeScrollY: '7207'
   │   ├── scrollTo(0, 7207) ✅  滚动恢复成功！
   │   └── sessionStorage.removeItem('homeScrollY')  ← 删除了 7207！
   └── useEffect 滚动追踪监听器挂载

2. Strict Mode 清理（模拟卸载）
   └── useEffect 清理保存 scrollPosRef.current
       └── scrollPosRef 还是 0（尚未触发 scroll 事件）
       └── sessionStorage.setItem('homeScrollY', '0')  ← 覆盖为 0！

3. 第二次挂载（最终）
   └── useLayoutEffect 执行
       ├── 读取 homeScrollY: '0'
       └── scrollTo(0, 0) ❌  滚动恢复被撤销！
```

为什么 `scrollPosRef` 还是 0？ref 初始化为 `useRef(0)`，scroll 事件监听器在 `useEffect` 中挂载（异步，在 paint 之后）。从 `useLayoutEffect` 恢复滚动（同步，在 paint 之前）到 Strict Mode 清理之间，**没有任何 scroll 事件触发** — 所以 ref 一直为 0，然后写入了 0 到 storage。

### 5.2 Fix 7：添加 scrollRestoredRef

在 [`page.client.tsx`](../../apps/frontend-blog/src/app/[locale]/page.client.tsx) 中做两处修改：

```typescript
const scrollRestoredRef = useRef(false);

useLayoutEffect(() => {
  if (allArticles.length > 0) {
    const savedScrollY = sessionStorage.getItem('homeScrollY');

    if (isBackNavigation && savedScrollY && !scrollRestoredRef.current) {
      scrollRestoredRef.current = true;
      window.scrollTo(0, Number(savedScrollY));
    }

    // 不要在这里 removeItem。
    // 让 scroll 追踪的 useEffect cleanup 在下一次离开首页时自然覆盖。
    // 这防止了 Strict Mode 双重挂载过早清除值。
  }
}, [allArticles]);
```

设计原理：
- **`scrollRestoredRef`**：追踪"已经恢复过滚动"，防止后续 re-render（如数据加载完成）再次执行 scrollTo
- **移除 `sessionStorage.removeItem`**：让 scroll 追踪的 `useEffect` cleanup 在下一次导航离开时自然覆盖旧值
- Strict Mode 第一次挂载：恢复滚动 → `ref = true`
- Strict Mode 清理：写入 0 到 storage → 但 `ref` 不受影响
- Strict Mode 第二次挂载：`ref = true` → 跳过恢复 ✅

### 5.3 安全性分析

| 场景 | 行为 |
|------|------|
| 硬刷新 | `isBackNavigation` = false → 不恢复 |
| 首页 → 文章 → 返回（第一次） | `scrollRestoredRef` 初始为 false → 恢复 ✅ |
| 数据加载完成 → `allArticles` 变化 | `scrollRestoredRef` 为 true → 跳过 ✅ |
| 首页 → 文章 → 返回（第二次） | 全新挂载 → ref 初始化为 false → 再次恢复 ✅ |
| Strict Mode 双重挂载 | 第一次挂载恢复（ref=true）。清理写入 0。第二次挂载：ref=true → 跳过，忽略旧的 0 ✅ |

---

## 六、修复全景

### 6.1 涉及文件

| # | 文件 | 变更 |
|---|------|------|
| 1 | `ArticleCard.tsx` | `onPointerDown` 中保存 locale-agnostic 路径 + search 到 `sessionStorage` |
| 2 | `articles/[slug]/page.client.tsx` | `handleBack` 从 `sessionStorage` 读取 `previousPageUrl`；无记录时降级到 `/` |
| 3 | `page.client.tsx` | 修复条件：`navigatedTo?.includes('/articles/')` → `isBackNavigation`；添加 `scrollRestoredRef`；移除立即 `removeItem` |
| 4 | `CategoryFilter.tsx` | `transition-all` → `transition-colors` on tab buttons |
| 5 | `CategoryFilter.tsx` | `align: 'center'` → `align: 'start'` in Embla config |
| 6 | `BottomNavigation.tsx` | 使用 `window.visualViewport` API 动态计算安全区域底部 |

### 6.2 边界情况矩阵

| 场景 | 预期行为 |
|------|----------|
| 首页 → 文章 → 返回 | 滚动恢复、URL 参数保持、正确语言 |
| 首页 → 文章 → 切换语言 → 返回 | 正确当前语言、滚动恢复 |
| 首页 → 文章 → 登录 → 文章 → 返回 | 跳过登录页，回到首页 |
| 分类页 → 文章 → 返回 | 回到正确分类页 |
| 直接 URL/书签 → 文章 → 返回 | 降级到 `router.push('/')` + 正确语言 |
| 浏览器返回按钮 | `popstate` → `getNavDirection()` = `backward` → 滚动恢复 |
| CategoryFilter 点击 | 无抖动，平滑颜色过渡 |
| CategoryFilter 末位点击 | 短滚动距离，无突然停止 |
| Strict Mode 双重挂载（开发） | 第一次挂载恢复，ref 阻止第二次 |
| 开发 HMR/Fast Refresh | 同样受 scrollRestoredRef 保护 |
| iOS Safari 工具栏隐藏 | 底部导航无白边 |
| iOS Safari 工具栏显示 | 安全区域平滑恢复 |

---

## 七、总结

本文解决的不仅仅是"返回后滚动恢复"这一个问题，而是一系列围绕 **SPA 返回导航体验**的连锁问题。

四个问题看似独立，实则共享相同的根因背景：

1. **App Router 的客户端导航模式** — `router.push()` 不携带 `history.state`，手动管理 `sessionStorage` 必须周全
2. **Strict Mode 开发时双重挂载** — 暴露了临时代码路径依赖问题（`sessionStorage.removeItem` 时机）
3. **CSS 静态值的局限性** — `env(safe-area-inset-bottom)` 和 `transition-all` 在不合适的场景下都产生了副作用
4. **第三方库交互** — Embla Carousel 的 `align: 'center'` 与 `transition-all` 形成了意想不到的反馈循环

修复的核心经验：
- **保存 URL 状态时始终考虑 locale 前缀**：`next-intl` 会自动处理，存储时不应该带 locale
- **使用 ref 而非 storage 标志位**：`useRef` 在 Strict Mode 双重挂载中保持状态，比 `sessionStorage` 更可靠
- **不要急于删除 storage 中的值**：依赖自然的 overwrite 而不是主动 remove，避免竞态
- **CSS `transition-all` 是危险的**：在动态布局上下文中永远指定具体属性
- **CSS `env()` 是静态的**：运行时变化需要使用 JS API 动态更新
