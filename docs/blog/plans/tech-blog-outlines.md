# 技术博客文章大纲

> 三篇中文技术博客，来源于 JoyMini Nest Monorepo 项目的实际优化经验。
>
> 写作风格：实战向、有代码、有架构图、有前后对比数据。
>
> ✅ 三篇已全部完成，文件位于 `docs/blog/articles/` 目录。

---

## 目录

1. [文章一：React 跨组件 HLS 视频协调 —— 点击播放 + 单视频互斥](./docs/blog/articles/react-hls-cross-component-coordination.md) ✅
2. [文章二：Next.js 打包体积优化实战 —— 从 2MB 到 800KB 的系统化方法](./docs/blog/articles/nextjs-bundle-size-optimization-practice.md) ✅
3. [文章三：Yarn PnP 单体仓库 CI/CD 缓存策略 —— 5 层缓存把 15 分钟降到 3 分钟](./docs/blog/articles/yarn-pnp-monorepo-ci-caching.md) ✅

---

## 文章一：React 跨组件 HLS 视频协调 —— 点击播放 + 单视频互斥

**核心卖点**：一个真正的"产品问题 → 架构方案 → 代码实现"完整案例。

### 大纲

#### 1. 问题：首页加载 → 十几个 m3u8 请求同时发起

- **现象**：打开首页，DevTools Network 面板瞬间出现大量 `m3u8` 请求
- **根因分析**：
  - `HlsVideoPlayer` 组件在 `useEffect` 中无条件调用 `hls.loadSource()`
  - `autoPlay` 属性只控制 `video.play()`，但 HLS 流已经开始下载
  - 首页有 3 个组件同时使用视频：`HeroSection`、`FeaturedProjects`（轮播）、`ArticleCard`（卡片列表）
  - 用户看到的是封面图，但背后已经在疯狂下载视频流
- **核心矛盾**：UI 展示 vs 网络行为的不一致

#### 2. 方案设计：三层优化

- **第一层：组件内延迟加载**
  - `clickToPlay` prop：`true` 时不执行 `hls.loadSource()`
  - 显示封面图 + 播放按钮覆盖层
  - 用户点击后才初始化 HLS.js

- **第二层：跨组件单视频互斥**
  - 痛点：首页多个视频组件各自独立，无法知道其他组件的播放状态
  - 方案：`window.dispatchEvent(new CustomEvent('hls-video-play'))`
  - 任一视频开始播放 → 广播 → 所有其他视频收到事件 → 自动销毁
  - 通过 `detail.hlsUrl` 比对，避免自己停自己

- **第三层：React 生命周期配合**
  - `key={activeIndex}` 轮播切换时自动 remount，配合 `destroyVideo()` 做清理
  - `useRef` 存储 HLS 实例便于精准销毁
  - 页面可见性变化时重置状态

#### 3. 关键代码解读

```tsx
// HlsVideoPlayer.tsx — clickToPlay 核心逻辑
useEffect(() => {
  if (clickToPlay) return; // ← 关键：不自动加载
  initVideo(false);
  return () => destroyVideo();
}, [hlsUrl, clickToPlay]);

// 点击播放 → 通知所有其他组件停止
const handlePlayClick = useCallback(() => {
  window.dispatchEvent(
    new CustomEvent("hls-video-play", { detail: { hlsUrl } }),
  );
  setUserClicked(true);
  initVideo(true);
}, [hlsUrl, userClicked, initVideo]);

// 收到其他视频播放事件 → 销毁自己
const handleOtherVideoPlay = (e: CustomEvent) => {
  const otherHlsUrl = e.detail?.hlsUrl;
  if (otherHlsUrl === hlsUrl) return; // 是自己，忽略
  destroyVideo();
  setUserClicked(false);
};
```

**FeaturedProjects.tsx 的特殊处理**：

- 轮播组件有自己的 `hlsRef` / `videoRef`，不依赖 `HlsVideoPlayer`
- `goToSlide()` 中先 `destroyVideo()` 再 `setUserClicked(false)` 再切换 slide
- 同样监听 `hls-video-play` 事件

#### 4. 组件架构图

```
┌─────────────────────────────────────────────────────┐
│                  window (事件总线)                     │
│         window.dispatchEvent('hls-video-play')        │
└──────────┬──────────────────────────┬────────────────┘
           │                          │
    ┌──────▼──────┐          ┌───────▼───────┐
    │ HlsVideoPlayer│          │FeaturedProjects│
    │ (ArticleCard) │          │ (自有 hls.js)  │
    │              │          │               │
    │ clickToPlay  │          │ clickToPlay   │
    │ 延迟加载      │          │ 延迟加载       │
    │ CustomEvent  │          │ CustomEvent   │
    │ 监听+广播     │          │ 监听+广播      │
    └──────────────┘          └───────────────┘
```

#### 5. 数据对比

| 指标             | 优化前            | 优化后               | 收益              |
| ---------------- | ----------------- | -------------------- | ----------------- |
| 首页 m3u8 请求数 | 7-15 个           | 0 个（直到用户点击） | 100% 减少初始请求 |
| 首页数据消耗     | ~5-10MB           | ~100KB（封面图）     | 减少 98%+         |
| 内存占用         | 多个 HLS 实例共存 | 最多 1 个            | 降低 80%+         |

#### 6. 边界情况处理

- 快速点击 → `if (userClicked) return;` 防重复
- 视频加载失败 → `hasError` 状态，隐藏播放按钮
- Safari 原生 HLS → `video.canPlayType('application/vnd.apple.mpegurl')` 兜底
- 页面切到后台 → `visibilitychange` 事件触发销毁
- 轮播自动切换 → `key={activeIndex}` 触发完全 remount

#### 7. 总结

- `CustomEvent` 是 React 跨组件通信被低估的方案 —— 不需要 Context、Redux、prop drilling
- HLS.js 生命周期管理的关键：`destroy()` 必须在组件卸载时调用
- "先显示再加载"是视频类页面的核心性能优化原则

**预计长度**：1500-2000 字 + 代码片段 + 架构图

---

## 文章二：Next.js 打包体积优化实战 —— 从 2MB 到 800KB 的系统化方法

**核心卖点**：一个可复用的检查清单 + 每一步都有实际数据。

### 大纲

#### 1. 背景：一个 Next.js 博客应用，打包体积 2MB+

- 项目是 Yarn 4 PnP 单体仓库，包含博客前端 + 管理后台 + API
- 分析工具：`@next/bundle-analyzer`
- 发现问题：首屏 JS 包含大量不需要的代码

#### 2. 优化一：审计 dependencies vs devDependencies

- **问题**：8 个 `@capacitor/*` 包在生产依赖中（Capacitor 是移动端打包工具，Web 构建不需要）
- **操作**：全部移到 `devDependencies`
- **效果**：减少约 800KB 打包体积
- **启示**：定期审计依赖，区分构建时和运行时

#### 3. 优化二：optimizePackageImports —— 免费的性能

- **原理**：Next.js 14+ 实验性功能，自动 tree-shake barrel export
- **配置**：

```ts
experimental: {
  optimizePackageImports: [
    '@repo/ui',
    'lucide-react',
    'lodash',
    'date-fns',
    'framer-motion',
    'react-markdown',
    'react-syntax-highlighter',
    'hls.js',
  ],
}
```

- **效果**：`lucide-react` 从全量 500+ icon 到只打包实际使用的
- **注意事项**：只对支持 side-effects 标记的包有效

#### 4. 优化三：next/dynamic 懒加载重型组件

- **问题**：`SearchModal`、`MobileSettingsDrawer` 在 Header 中，每个页面都加载
- **解决**：`dynamic(() => import('./SearchModal'), { ssr: false })`
- **同样处理**：文章详情页的 markdown 渲染器（`react-markdown` + `rehype-raw` + `remark-gfm` + `react-syntax-highlighter`）
- **提取模式**：创建 `ArticleMarkdown` 组件统一封装

```tsx
// 从页面直接导入改为动态导入
const ArticleMarkdown = dynamic(
  () => import("@/components/blog/ArticleMarkdown"),
  { ssr: false, loading: () => <div className="animate-pulse h-96" /> },
);
```

#### 5. 优化四：transpilePackages 清理

- **问题**：`transpilePackages` 包含了 `@lucky/shared`（已经预构建过的包）
- **解决**：移除，让 Next.js 直接使用构建产物
- **效果**：减少构建时的重复转译

#### 6. 优化效果汇总

| 优化项                    | 体积减少   | 类型         |
| ------------------------- | ---------- | ------------ |
| Capacitor 移到 devDeps    | ~800KB     | 依赖审计     |
| optimizePackageImports    | ~200KB     | Tree-shaking |
| lazy-load Header 组件     | ~150KB     | 代码分割     |
| lazy-load ArticleMarkdown | ~300KB     | 代码分割     |
| transpilePackages 清理    | ~50KB      | 构建优化     |
| **总计**                  | **~1.5MB** |              |

#### 7. 方法论总结：系统化检查清单

1. ✅ `npm ls --production` 审计生产依赖
2. ✅ `@next/bundle-analyzer` 可视化分析
3. ✅ 检查 `experimental.optimizePackageImports`
4. ✅ 检查 `transpilePackages` 是否包含预构建包
5. ✅ 检查每个页面的 `__NEXT_DATA__` 和 chunk 大小
6. ✅ 识别"全局加载但只在特定页面使用"的组件 → `next/dynamic`

**预计长度**：1500-2000 字 + 代码 + 对比表

---

## 文章三：Yarn PnP 单体仓库 CI/CD 缓存策略 —— 5 层缓存把 15 分钟降到 3 分钟

**核心卖点**：GitHub Actions + Yarn 4 PnP 的缓存实践，5 种缓存类型，每种都有具体配置。

### 大纲

#### 1. 背景：4 个 CI 工作流，每次跑 15 分钟

- Yarn 4 PnP 单体仓库（无 `node_modules`，依赖在 `.yarn/cache` 的 zip 中）
- 4 个工作流：`ci.yml`、`deploy-backend.yml`、`deploy-admin-cloudflare.yml`、`playwright.yml`
- 问题：每个工作流都从零安装依赖和构建

#### 2. 缓存类型详解

##### 2.1 Docker Layer Cache（deploy-backend.yml）

- **目的**：加速 NestJS API 的 Docker 镜像构建
- **机制**：`type=gha` 的 GitHub Actions cache backend
- **配置**：`cache-from: type=gha` + `cache-to: type=gha,mode=max`
- **效果**：后续构建复用之前的 layer，跳过 `yarn install` 和编译层

##### 2.2 Yarn PnP Zip Cache

- **目的**：缓存 `.yarn/cache` 目录中的依赖 zip 文件
- **配置**：

```yaml
- uses: actions/cache@v4
  with:
    path: .yarn/cache
    key: yarn-cache-${{ runner.os }}-${{ hashFiles('yarn.lock') }}
    restore-keys: yarn-cache-${{ runner.os }}-
```

##### 2.3 node_modules（Yarn PnP 虚拟目录）

- **注意**：Yarn 4 PnP 模式下，依赖不存储在传统 `node_modules`，但 `yarn install --immutable` 会生成 `.pnp.*` 文件和 `.yarn/unplugged`
- **缓存**：`.pnp.cjs` + `.pnp.loader.mjs` 生成的缓存

##### 2.4 Turborepo Remote Cache

- **目的**：跨工作流复用构建产物
- **配置**：`turbo.json` 中定义 `outputs`，结合 `actions/cache` 实现

##### 2.5 Playwright Browser Cache

- **目的**：缓存浏览器二进制文件（~300MB）
- **配置**：

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ hashFiles('yarn.lock') }}
```

#### 3. Cache Key 设计原则

```yaml
key: my-cache-${{ runner.os }}-${{ hashFiles('yarn.lock') }}
restore-keys: |
  my-cache-${{ runner.os }}-
```

- `hashFiles('yarn.lock')`：依赖变化时自动失效
- `runner.os`：macOS/Linux runner 不同
- `restore-keys` 兜底：当精确匹配失败时，使用最近的缓存

#### 4. 注意陷阱：Yarn 4 PnP 的特殊性

- **陷阱 1**：`actions/setup-node@v4` 默认启用 `cache: 'yarn'`，但 Yarn 4 的缓存路径不同
- **陷阱 2**：PnP 模式下没有完整的 `node_modules`，不要缓存不存在的路径
- **陷阱 3**：`yarn install --immutable` 在 CI 中会验证缓存完整性，必须确保缓存一致性

#### 5. 优化效果

| 工作流                      | 优化前 | 优化后 | 加速比 |
| --------------------------- | ------ | ------ | ------ |
| ci.yml                      | ~8min  | ~3min  | 2.7x   |
| deploy-backend.yml          | ~10min | ~4min  | 2.5x   |
| deploy-admin-cloudflare.yml | ~6min  | ~2min  | 3x     |
| playwright.yml              | ~5min  | ~2min  | 2.5x   |

#### 6. 总结

- 缓存策略不是"加一个 cache action 就行"，需要理解底层工具的工作方式
- cache key 设计决定命中率，`restore-keys` 提供兜底
- 定期验证缓存命中情况：GitHub Actions 的日志中会显示 `Cache restored from key: xxx`

**预计长度**：1200-1800 字 + 代码配置 + 对比表

---

## 写作顺序建议

1. **先写文章二（Next.js 打包优化）**—— 受众最广，适用性最强
2. **再写文章一（HLS 点击播放）**—— 最有技术深度，适合掘金/知乎
3. **最后写文章三（CI/CD 缓存）**—— 受众最窄，偏 DevOps

## 发布平台建议

- **掘金** / **segmentfault**：中文技术社区，适合文章一和文章二
- **知乎**：文章一（独特性高，容易引发讨论）
- **个人博客**：三篇都发，形成系列
