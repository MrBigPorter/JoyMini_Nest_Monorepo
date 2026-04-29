# Next.js 打包体积优化实战：从 2MB 到 800KB 的系统化方法

> 本文源于对一个实际 Next.js 博客应用的性能优化。通过系统化的依赖审计、代码分割和构建配置优化，将首屏 JS 体积减少了约 60%。文中提到的方法和检查清单适用于大多数 Next.js 项目。

---

Tags: Next.js, Performance, Bundle Size

## 1. 背景：一个 "看起来不重" 的博客，打包 2MB+

这是一个基于 Next.js 15 的博客前端，属于 Yarn 4 PnP 单体仓库的一部分。项目结构包含博客前端、管理后台和 API 服务三个子应用。

某天习惯性地打开 Chrome DevTools → Network 面板，发现首屏加载的 JS 体积接近 **2MB**（压缩前）。对于一个以文本内容为主的博客来说，这显然是不正常的。

用 `@next/bundle-analyzer` 跑了一次可视化分析，问题浮出水面：

- 8 个 `@capacitor/*` 包出现在生产构建中（Capacitor 是移动端打包工具，Web 构建完全不需要）
- `Header` 组件中懒加载的搜索弹窗和设置抽屉被直接打包进主 chunk
- 文章详情页的 markdown 渲染相关依赖（`react-markdown` + `rehype-raw` + `remark-gfm` + `react-syntax-highlighter`）在首页就加载了
- 一些库如 `lucide-react`、`date-fns` 由于 barrel export 导致 tree-shaking 不彻底

## 2. 优化一：审计 dependencies vs devDependencies

这是最直接、收益最高的优化。

**问题**：`package.json` 的 `dependencies` 中包含：

```json
{
  "dependencies": {
    "@capacitor/core": "...",
    "@capacitor/status-bar": "...",
    "@capacitor/splash-screen": "..."
    // ... 总共 8 个 @capacitor/* 包
  }
}
```

Capacitor 是一个将 Web 应用打包为移动端原生应用的框架。但在纯 Web 构建中，这些包完全不会被使用。然而，Next.js 在生产构建时会将 `dependencies` 中的包视为"可能被使用"，从而包含在打包范围内。

**解决**：将所有 Capacitor 包移到 `devDependencies`：

```json
{
  "devDependencies": {
    "@capacitor/core": "...",
    "@capacitor/status-bar": "..."
    // ...
  }
}
```

**效果**：打包体积减少约 **800KB**。

**启示**：很多项目中的 `dependencies` 是"历史遗留"——某个阶段安装了，后来不用了，但没人清理。建议定期运行 `npm ls --production`（或 Yarn 的 `yarn info`）来审计哪些包真的在生产运行时需要。

## 3. 优化二：optimizePackageImports —— 免费的 Tree-Shaking

Next.js 14 引入了一个实验性功能 `optimizePackageImports`，它会自动对指定包做"按需引入"的转换，即使你写的 import 是 `import { a, b, c } from 'large-package'`。

**问题**：一些流行的 React 库使用 barrel export 模式（一个 `index.ts` 重新导出所有内容），导致 Webpack/Turbopack 无法有效 tree-shake。

**配置**：

```ts
// next.config.ts
const nextConfig = {
  experimental: {
    optimizePackageImports: [
      "@repo/ui", // 内部组件库
      "lucide-react", // 图标库，500+ 图标
      "lodash", // 工具库
      "date-fns", // 日期工具
      "framer-motion", // 动画库
      "react-markdown", // Markdown 渲染
      "react-syntax-highlighter", // 代码高亮
      "rehype-raw",
      "remark-gfm",
      "embla-carousel-react",
      "hls.js",
    ],
  },
};
```

**效果**：以 `lucide-react` 为例，优化前打包了全部 500+ 图标（即使只用了几个），优化后只包含实际使用的图标。整体减少约 **200KB**。

**注意事项**：这个功能对支持 `sideEffects: false`（在 `package.json` 中标记）的包最有效。对于不支持此标记的包，效果有限。

## 4. 优化三：next/dynamic 懒加载重型组件

**问题**：`Header` 组件中包含了搜索弹窗和移动端设置抽屉：

```tsx
// 优化前 — 两个弹窗组件在 Header 中直接导入
import { SearchModal } from "./SearchModal";
import { MobileSettingsDrawer } from "./MobileSettingsDrawer";
```

由于 `Header` 出现在每个页面的布局中，这意味着每个页面都会加载这两个组件的代码，即使它们很少被打开。

**解决**：使用 `next/dynamic` 按需加载：

```tsx
import dynamic from "next/dynamic";

const SearchModal = dynamic(
  () => import("./SearchModal").then((mod) => mod.SearchModal),
  { ssr: false },
);

const MobileSettingsDrawer = dynamic(() => import("./MobileSettingsDrawer"), {
  ssr: false,
});
```

**同样的思路用于文章详情页**：

文章详情页使用了 `react-markdown` 及其插件进行内容渲染：

```tsx
// 优化前 — 页面直接导入
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
```

这些依赖总大小约 300KB+，但只在文章详情页使用。优化方案是创建一个包裹组件，然后动态导入：

```tsx
// ArticleMarkdown.tsx — 新建的包裹组件
"use client";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

export function ArticleMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      rehypePlugins={[rehypeRaw]}
      remarkPlugins={[remarkGfm]}
      // ...
    />
  );
}

// 在页面中动态导入
const ArticleMarkdown = dynamic(
  () => import("@/components/blog/ArticleMarkdown"),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse h-96 bg-slate-100 rounded-lg" />
    ),
  },
);
```

**效果**：

- Header 组件懒加载减少 ~150KB
- ArticleMarkdown 懒加载减少 ~300KB
- 两者合计约 **450KB**

## 5. 优化四：transpilePackages 清理

**问题**：`next.config.ts` 中的 `transpilePackages` 配置：

```ts
// 优化前
transpilePackages: ['@lucky/shared', '@repo/ui'],
```

`@lucky/shared` 是一个预构建的包（通过 `tsc` 编译后发布），它已经有编译好的 JS 文件。但 `transpilePackages` 会让 Next.js 再次对它进行 Babel/SWC 转译，既浪费构建时间，又可能引入不一致。

**解决**：只保留真正需要转译的包：

```ts
// 优化后
transpilePackages: ['@repo/ui'],  // 这个包使用 JSX，需要转译
```

**效果**：减少构建时约 50KB 的重复转译开销。

## 6. 优化效果总览

| 优化项                 | 减少体积   | 类型     | 难度 |
| ---------------------- | ---------- | -------- | ---- |
| Capacitor 移到 devDeps | ~800KB     | 依赖审计 | ⭐   |
| optimizePackageImports | ~200KB     | 构建配置 | ⭐   |
| Header 组件懒加载      | ~150KB     | 代码分割 | ⭐⭐ |
| ArticleMarkdown 懒加载 | ~300KB     | 代码分割 | ⭐⭐ |
| transpilePackages 清理 | ~50KB      | 构建配置 | ⭐   |
| **总计**               | **~1.5MB** |          |      |

> 注意：这些优化不是简单的叠加，因为它们作用于不同的代码路径。实际首屏 JS 体积从约 2MB（压缩前）降到了约 800KB（压缩前）。

## 7. 系统化检查清单

经过这次优化，我总结了一套可复用的检查清单。每次接手或审查一个 Next.js 项目时，可以按这个顺序过一遍：

### 第一步：依赖审计

- [ ] `npm ls --production` 查看生产依赖
- [ ] 确认每个包是否真的在运行时需要
- [ ] 平台特定包（Capacitor、Electron 等）是否应该在 `devDependencies`

### 第二步：打包分析

- [ ] 配置 `@next/bundle-analyzer` 进行可视化分析
- [ ] 检查哪些包占据了最大的体积
- [ ] 检查是否有包意外出现在多个 chunk 中

### 第三步：优化配置

- [ ] 检查 `experimental.optimizePackageImports` 是否覆盖了所有大型库
- [ ] 检查 `transpilePackages` 中是否包含已经预构建的包
- [ ] 检查 `images.remotePatterns` 是否完整

### 第四步：代码分割

- [ ] 找出"全局加载但只在特定页面使用"的组件
- [ ] 使用 `next/dynamic` 进行懒加载
- [ ] 确保 `ssr: false` 用于需要浏览器 API 的组件

### 第五步：验证

- [ ] 运行 `next build` 查看每个页面的 First Load JS
- [ ] 对比优化前后的核心 Web 指标
- [ ] 确认懒加载的组件在用户交互时能快速加载（考虑 prefetch）

## 8. 总结

优化打包体积不需要魔术，也不需要重构整个应用。它只需要：

1. **知道看哪里**—— `@next/bundle-analyzer` 是你的眼睛
2. **知道改什么**—— 依赖审计 + 构建配置 + 代码分割，三管齐下
3. **知道验证**—— 数据说话，对比前后差异

最难的部分其实是"意识到需要优化"——大多数开发者只有在 Lighthouse 评分低于 50 时才会想起来看一眼打包体积。但就像本文展示的，很多优化只是配置层面的改动，收益却非常可观。

---

_本文涉及的代码来自实际项目 JoyMini Nest Monorepo。项目使用 Next.js 15 + Yarn 4 PnP，代码开源可在 GitHub 上查看。_
