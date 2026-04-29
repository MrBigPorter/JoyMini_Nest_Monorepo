# React 跨组件 HLS 视频协调：点击播放 + 单视频互斥

> 一次真实的前端性能优化案例。通过 `CustomEvent` 事件总线 + 延迟加载模式，彻底解决首页加载时大量视频流抢占带宽的问题。

---

Tags: React, Video, HLS, Hooks, Architecture

## 1. 问题：首页加载，十几个 m3u8 请求同时发起

一天，我打开博客首页，习惯性地按 F12 → Network 面板，看到了让人皱眉的一幕：

![Network 面板截图：大量 m3u8 请求]

密密麻麻的 `master.m3u8`、`variant.m3u8` 请求在页面加载的瞬间同时发起。首页明明只显示了封面图和文章卡片，但背后的视频流已经开始疯狂下载。

### 根因分析

经过排查，问题出在我们的 `HlsVideoPlayer` 组件上：

```tsx
// 简化后的原始代码
useEffect(() => {
  const hls = new Hls();
  hls.loadSource(hlsUrl); // ← 只要组件挂载就加载 HLS 流
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (autoPlay) {
      video.play(); // ← autoPlay 只控制"是否自动播放"
    } //    但流数据已经在下载了
  });
}, [hlsUrl, autoPlay]);
```

关键问题是：`autoPlay` prop 只控制了 `video.play()` 的调用，但 `hls.loadSource()` 在任何情况下都会执行。组件的设计者认为 "不自动播放 = 不消耗流量"，但实际上 HLS.js 从 `loadSource()` 开始就会建立连接并下载视频片段（.ts 文件）。

而首页上有 3 个组件同时使用视频：

| 组件               | 位置         | 视频数量           |
| ------------------ | ------------ | ------------------ |
| `HeroSection`      | 顶部大横幅   | 1-2 个             |
| `FeaturedProjects` | 精选项目轮播 | 1 个（当前 slide） |
| `ArticleCard`      | 文章卡片列表 | 每个卡片可能 1 个  |

结果是：首页加载 → 7-15 个 m3u8 请求同时发出 → 大量带宽浪费 → 页面加载变慢。

### 用户的实际感受

用户打开首页，看到的是精美的封面图和文章摘要。视觉上没有视频在播放。但手机的移动数据流量却在悄悄流失：

```
首页加载消耗：
  图片：~200KB
  API 请求：~50KB
  HLS 视频流：5-10MB ← 用户完全看不到，但在后台下载
```

这是一个典型的 **UI 展示与网络行为不一致** 的问题。

## 2. 方案设计：三层优化

### 第一层：组件内延迟加载

每个 `HlsVideoPlayer` 实例增加 `clickToPlay` 属性：

```tsx
interface HlsVideoPlayerProps {
  hlsUrl: string;
  poster?: string;
  autoPlay?: boolean;
  /** 延迟加载模式：用户点击后才初始化 HLS.js */
  clickToPlay?: boolean;
}
```

`clickToPlay={true}` 时组件的行为：

1. 不调用 `hls.loadSource()`，不建立任何网络连接
2. 显示封面图（`poster`）+ 播放按钮覆盖层
3. 用户点击播放按钮后执行初始化

```tsx
// 核心逻辑：clickToPlay 模式下延迟加载
useEffect(() => {
  if (clickToPlay) return; // ← 关键：跳过自动加载
  initVideo(false); // ← 普通模式：自动加载但不一定自动播放
  return () => destroyVideo();
}, [hlsUrl, clickToPlay]);
```

### 第二层：跨组件单视频互斥

如果只是加一个播放按钮，用户点击了第一个视频，再点击第二个，两个视频会同时播放——这比一开始自动加载好一些，但还不是理想体验。

真正的方案是：**同一时间只有一个视频能播放**。

怎么实现？几个组件之间没有父子关系，它们分布在页面不同位置。不能用 props、不能用 Context（太重量级），也不想引入新的状态管理库。

答案是 **浏览器原生的 CustomEvent**：

```tsx
// 用户点击播放时，广播一个自定义事件
const handlePlayClick = useCallback(() => {
  // 1. 通知所有其他视频组件：停下来
  window.dispatchEvent(
    new CustomEvent("hls-video-play", {
      detail: { hlsUrl },
    }),
  );

  // 2. 初始化自己
  setUserClicked(true);
  initVideo(true);
}, [hlsUrl, initVideo]);
```

其他所有视频组件都监听这个事件：

```tsx
// 每个视频组件启动时监听
useEffect(() => {
  const handleOtherVideoPlay = (e: CustomEvent) => {
    const otherHlsUrl = e.detail?.hlsUrl;
    // 如果是自己发出的，忽略
    if (otherHlsUrl === hlsUrl) return;
    // 否则销毁自己，回到待播放状态
    destroyVideo();
    setUserClicked(false);
  };

  window.addEventListener(
    "hls-video-play",
    handleOtherVideoPlay as EventListener,
  );

  return () => {
    window.removeEventListener(
      "hls-video-play",
      handleOtherVideoPlay as EventListener,
    );
  };
}, [hlsUrl, destroyVideo]);
```

**设计思路**：用 `window` 作为一个轻量级事件总线。不需要任何第三方库，不需要 Context Provider 包裹，零额外依赖。

### 第三层：React 生命周期配合

HLS.js 实例需要手动管理生命周期。不能依赖垃圾回收，必须显式销毁：

```tsx
const destroyVideo = useCallback(() => {
  // 1. 销毁 HLS.js 实例（释放 Web Worker、解码器等资源）
  if (hlsRef.current) {
    hlsRef.current.destroy();
    hlsRef.current = null;
  }

  // 2. 停止并清空原生 video 元素
  if (videoRef.current) {
    videoRef.current.pause();
    videoRef.current.removeAttribute("src");
    videoRef.current.load(); // 重置状态
  }
}, []);
```

#### 轮播组件的特殊处理

`FeaturedProjects` 是一个轮播幻灯片组件，它不直接使用 `HlsVideoPlayer`，而是有自己的 HLS.js 管理。轮播切换时：

```tsx
const goToSlide = useCallback(
  (index: number) => {
    if (isTransitioning || index === activeIndex) return;
    setIsTransitioning(true);

    destroyVideo(); // 销毁当前视频
    setUserClicked(false); // 重置点击状态
    setActiveIndex(index); // 切换 slide（触发 remount）

    // 动画完成后释放锁
    setTimeout(() => setIsTransitioning(false), 500);
  },
  [activeIndex, articles.length, isTransitioning, destroyVideo],
);
```

利用 React 的 `key={activeIndex}` 机制：每次切换 slide，整个容器 remount，视频元素重新创建，ref 重新绑定，生命周期干净利落。

#### 页面可见性处理

用户切到其他标签页时，应该停止视频播放：

```tsx
useEffect(() => {
  const handleVisibility = () => {
    if (document.hidden) {
      destroyVideo();
      setUserClicked(false); // 回来后需要重新点击播放
      stopAutoPlay(); // 停止轮播自动切换
    } else {
      startAutoPlay(); // 恢复轮播
    }
  };
  document.addEventListener("visibilitychange", handleVisibility);
  return () =>
    document.removeEventListener("visibilitychange", handleVisibility);
}, [destroyVideo, stopAutoPlay, startAutoPlay]);
```

## 3. 组件架构图

```
┌─────────────────────────────────────────────────────────┐
│                      window 事件总线                      │
│           window.dispatchEvent('hls-video-play')          │
└───────────┬──────────────────────────┬───────────────────┘
            │                          │
     ┌──────▼──────┐          ┌───────▼────────┐
     │ HlsVideoPlayer│          │FeaturedProjects│
     │ (通用组件)    │          │ (轮播，自有hls) │
     │              │          │                │
     │ clickToPlay  │          │ clickToPlay    │
     │ 延迟加载      │          │ 延迟加载        │
     │ CustomEvent  │          │ CustomEvent    │
     │ 监听+广播     │          │ 监听+广播       │
     │              │          │ key remount    │
     └──────┬───────┘          └────────────────┘
            │
     ┌──────▼──────┐
     │ ArticleCard  │
     │ (文章卡片)    │
     │              │
     │ 直接使用     │
     │ HlsVideoPlayer│
     │ clickToPlay  │
     └──────────────┘
```

**特点**：三个组件各自独立，通过 `window` 上的自定义事件进行单向通信。不需要 Context、Redux、或 prop drilling。

## 4. 边界情况处理

在实际开发中，我们处理了以下边界情况：

### 快速点击防抖

```tsx
const handlePlayClick = useCallback(
  (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (userClicked) return; // ← 已经点击过了，忽略
    // ... 初始化
  },
  [userClicked /* ... */],
);
```

### Safari 原生 HLS 支持

Safari 不支持 MSE（Media Source Extensions），但原生支持 HLS。需要通过 `canPlayType` 检测：

```tsx
if (Hls.isSupported()) {
  // 使用 hls.js
} else if (video.canPlayType("application/vnd.apple.mpegurl")) {
  // Safari 原生 HLS
  video.src = hlsUrl;
  video.play().catch(() => {});
}
```

### 视频加载失败

```tsx
// 监听 HLS 错误事件
hls.on(Hls.Events.ERROR, (_event, data) => {
  if (data.fatal) {
    setHasError(true); // ← 隐藏播放按钮，显示错误状态
    destroyVideo();
  }
});
```

### 防止自己停自己

```tsx
const handleOtherVideoPlay = (e: CustomEvent) => {
  const otherHlsUrl = e.detail?.hlsUrl;
  if (otherHlsUrl === hlsUrl) return; // ← 忽略自己发出的广播
  // ...
};
```

## 5. 数据对比

| 指标             | 优化前           | 优化后                   | 收益               |
| ---------------- | ---------------- | ------------------------ | ------------------ |
| 首页 m3u8 请求数 | 7-15 个          | **0 个**（直到用户点击） | 减少 100% 初始请求 |
| 首页数据消耗     | ~5-10 MB         | ~100 KB（仅封面图）      | **减少 98%+**      |
| HLS.js 实例数    | 多个共存         | 最多 1 个                | 降低 80%+ 内存占用 |
| 用户感知         | 流量消耗、页面慢 | 立即显示、按需播放       | 体验显著提升       |

> **关键指标**：优化前每次首页访问都在下载 5-10MB 的视频数据，而这些视频用户可能根本不会播放。优化后只有用户明确点击播放时才会下载。

## 6. 总结与思考

### 技术要点

1. **CustomEvent 是 React 跨组件通信被低估的方案**。当组件之间没有明确的 Props 传递关系时，用 `window` 事件总线比引入 Redux/Context 更轻量、更直接。

2. **HLS.js 生命周期管理**。HLS 实例不是普通的 JS 对象，它包含 Web Worker、缓冲区、网络连接等资源。必须在组件卸载时调用 `hls.destroy()`，否则会造成内存泄漏和持续的网络活动。

3. **"先显示再加载"的原则**。对于媒体重内容（视频、大图、3D 模型等），"先让用户看到内容，等交互时再加载"是最核心的性能优化原则。

### 适用场景

这套模式不仅适用于 HLS 视频，也可以用于：

- 音频播放器（同一时间只能播放一首）
- 大图查看器（点击查看原图）
- 视频会议组件（只有一个活跃的摄像头）

---

_本文基于 JoyMini Nest Monorepo 项目的实际优化经验。项目使用 Next.js 15 + HLS.js，代码开源可在 GitHub 上查看。_
