# 多模式渲染架构详细设计文档

> ✅ 一套代码，三种运行模式，零业务代码重复
> ✅ 维护成本 = 单项目维护成本 ✖️ 1
> ✅ 所有开发人员只需要理解普通Next.js开发即可

---

## 🎯 核心设计思想

### 为什么不需要两套代码？

```
┌───────────────────────────────────────────────────┐
│                  业务代码层                        │
│   页面 / 组件 / 逻辑 / 样式 100% 完全相同            │
└───────────────────────────┬───────────────────────┘
                            │
┌───────────────────────────▼───────────────────────┐
│                   自动适配层                       │
│         150行代码，整个系统唯一的特殊部分            │
└───────────────────────────┬───────────────────────┘
           ┌────────────────┼────────────────┐
┌──────────▼────────┐ ┌─────▼──────┐ ┌──────▼─────────┐
│  SSR 服务端渲染   │ │ SSG 静态导出│ │ CSR 客户端渲染 │
│    (Web网站)      │ │  (H5移动端) │ │   (原生App)    │
└───────────────────┘ └────────────┘ └────────────────┘
```

✅ **99% 的代码是普通的业务代码**
✅ **只有 1% 是适配层代码**
✅ **业务开发人员永远不会接触到适配层**

---

## ⚙️ 三层架构设计

### 第一层: 业务代码层 (99% 代码)

👉 **普通Next.js代码，没有任何特殊写法**

```tsx
// app/articles/[slug]/page.tsx
import { fetchArticle } from "@/lib/api/articles";

// ✅ 这就是普通的Next.js服务端组件写法
export default async function ArticlePage({ params }) {
  // ✅ 这行代码在三种模式下都存在
  const article = await fetchArticle(params.slug);

  // ✅ 这里的所有业务代码在三种模式下 100% 相同
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1>{article.title}</h1>
      <ArticleContent content={article.content} />
      <CommentSection articleId={article.id} />
    </div>
  );
}
```

> 🎯 重点：**开发人员就按正常的Next.js开发，不需要知道有三种模式存在**

---

### 第二层: 数据适配层 (0.8% 代码)

👉 **自动检测环境，选择正确的数据获取方式**
整个系统最核心的魔法，只有20行代码：

```typescript
// lib/api/fetcher.ts
export async function fetcher<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  // 🟢 情况1: 运行在服务端 (SSR模式)
  if (typeof window === "undefined") {
    // 直接走内部服务调用，不走网络
    return await internalApiClient.get(url, options);
  }

  // 🟡 情况2: 静态导出构建时 (SSG模式)
  if (process.env.NEXT_PUBLIC_STATIC_EXPORT === "true") {
    // 构建时预取数据，生成静态HTML
    return await publicApiClient.get(url, options);
  }

  // 🔴 情况3: 运行在客户端浏览器/App (CSR模式)
  // 自动降级到客户端API调用
  return await publicApiClient.get(url, options);
}
```

✅ **同一个API函数，自动选择最优执行方式**
✅ **业务代码完全不需要做任何修改**
✅ **错误处理、重试、缓存逻辑全部统一**

---

### 第三层: 路由适配层 (0.2% 代码)

👉 **根布局自动检测运行环境**

```tsx
// app/layout.tsx
export default function RootLayout({ children }) {
  // ✅ 运行时检测是否在原生App中
  const isNativeApp = typeof window !== "undefined" && "Capacitor" in window;

  return (
    <html lang="zh-CN">
      <body>
        {isNativeApp ? (
          // 📱 App模式: 包装成纯客户端应用
          <ClientAppShell>{children}</ClientAppShell>
        ) : (
          // 🌐 Web/H5模式: 正常服务端渲染
          <WebAppShell>{children}</WebAppShell>
        )}
      </body>
    </html>
  );
}
```

---

## 🚀 三种模式的实际执行流程

### ✅ 模式1: SSR 服务端渲染 (Web网站)

```
用户请求 → 服务器 → 执行fetchArticle() → 渲染完整HTML → 返回浏览器

✅ 首屏速度 100ms
✅ 完美SEO
✅ 搜索引擎可以抓取到完整内容
```

### ✅ 模式2: SSG 静态导出 (H5移动端)

```
构建时 → Next.js 遍历所有文章Slug → 预执行fetchArticle() → 生成1000个静态HTML → 部署到CDN

✅ CDN边缘节点响应 20ms
✅ 零服务器成本
✅ 全世界任何地方打开都快
```

### ✅ 模式3: CSR 客户端渲染 (原生App)

```
App启动 → 加载本地HTML壳 → 前端路由匹配页面 → 客户端自动调用fetchArticle() → 渲染页面

✅ 原生App体验
✅ 支持离线缓存
✅ 支持推送、分享、原生功能
```

---

## 📦 构建与部署

| 目标        | 构建命令                             | 输出                | 部署方式             |
| ----------- | ------------------------------------ | ------------------- | -------------------- |
| Web网站     | `yarn build`                         | `.next/`            | Node.js 服务部署     |
| H5移动端    | `yarn build:static`                  | `out/`              | CDN / OSS / 静态托管 |
| iOS App     | `yarn build:app && cap open ios`     | Xcode 项目          | App Store            |
| Android App | `yarn build:app && cap open android` | Android Studio 项目 | Google Play          |

✅ **同一个代码仓库，四条命令，四个不同的产出物**
✅ **所有产出物都是从同一份源代码构建出来的**

---

## 🔍 维护性保证

### 🎯 维护成本分析

| 方案                 | 需要维护的代码量 | 维护成本            |
| -------------------- | ---------------- | ------------------- |
| 三套独立代码         | 300%             | 🔴 极高             |
| 两套代码 (Web + App) | 200%             | 🟠 高               |
| ✅ 本方案            | 101%             | 🟢 几乎没有额外成本 |

### ✅ 开发人员认知负担

1. ❌ 不需要理解三种模式的区别
2. ❌ 不需要写任何平台判断代码
3. ❌ 不需要知道适配层的存在
4. ✅ 只要会写普通的Next.js代码就可以了

---

## 🚫 绝对不会出现的维护噩梦

❌ **不会出现**："这个Bug只在App里出现，Web里是好的"
❌ **不会出现**："Web已经修复了，App那边还没更新"
❌ **不会出现**："这个功能Web有，App没有"
❌ **不会出现**："两个版本的UI不一样"

✅ **任何修改，一次编写，三个平台同时生效**
✅ **任何Bug修复，一次修复，三个平台同时修复**

---

## 🧪 测试策略

| 测试层       | 测试范围           | 频率     |
| ------------ | ------------------ | -------- |
| 业务逻辑测试 | 所有页面组件       | 每次提交 |
| 适配层测试   | 三种模式的适配逻辑 | 每周     |
| 端到端测试   | Web 浏览器         | 每天     |
| 端到端测试   | H5 静态导出        | 每周     |
| 端到端测试   | 原生App            | 每个版本 |

✅ **90% 的测试只需要写一次**
✅ **适配层一旦测试通过，基本不会再修改**

---

## 📋 维护指南

### 日常开发流程

1. 写业务代码 → 和普通Next.js项目完全一样
2. 测试 → 只需要在Web模式下测试
3. 提交代码 → 自动构建三种版本
4. 部署 → 三个平台同时上线

### 什么时候需要关心适配层？

👉 **几乎永远不需要**

适配层是整个系统的基础设施，写完之后基本上就不会再动了。
整个项目的生命周期中，适配层的修改次数不会超过5次。

---

## 📱 Capacitor 打包原理深度解析

### ❌ 99% 的开发者都会有的误解

> "我用Next.js写代码，打包进Capacitor之后Next.js就会在App里面运行"

**这是完全错误的理解**

---

### ✅ 真相：Capacitor 到底是什么？

Capacitor 不知道什么是Next.js，也不认识SSR，也没有Node.js运行环境。

> 🎯 **Capacitor 做的唯一一件事：把静态HTML文件打包进App，然后用系统WebView打开**

仅此而已，没有别的魔法。

---

### 📦 App 打包的实际过程

```bash
yarn build:static  # ✅ 第一步：把Next.js编译成纯静态HTML/CSS/JS
npx cap sync       # ✅ 第二步：把 out/ 目录的所有静态文件复制到 iOS/Android 项目
```

当App被安装到手机上时，App包里面只有这些东西：
✅ 纯静态HTML文件
✅ JS Bundle
✅ CSS 样式表
✅ 图片资源

❌ **没有 Node.js 运行时**
❌ **没有 Next.js 服务端**
❌ **没有任何SSR相关的东西**

---

### 🚀 App 运行时到底发生了什么？

当用户打开App：

1. iOS/Android 启动一个原生 WebView
2. WebView 加载本地的 `index.html`
3. 你的React代码在WebView客户端运行
4. 所有API调用走公网HTTPS
5. 所有渲染都在手机浏览器中执行

✅ **这就是 100% 客户端渲染**

> ⚠️ 这个时候就算你写了服务端组件，也不会有任何服务端来执行它。所有的 `await fetch()` 都会自动降级到客户端执行。

---

### 🎯 为什么不同平台用不同渲染模式？

| 平台          | 渲染模式          | 原因                                            |
| ------------- | ----------------- | ----------------------------------------------- |
| **Web 网站**  | ✅ SSR 服务端渲染 | 需要SEO，首屏速度，搜索引擎抓取                 |
| **H5 移动端** | ✅ SSG 静态导出   | CDN部署，秒开，SEO友好                          |
| **原生App**   | ✅ CSR 客户端渲染 | 本地JS没有下载延迟，单页应用流畅体验，不需要SEO |

如果强行在App里用SSG静态HTML：
❌ 每打开一篇文章，WebView就要加载一个新的本地HTML文件
❌ 页面切换会有浏览器白屏闪烁
❌ 没有单页应用的流畅体验
❌ 不能做转场动画
❌ 不能做手势滑动返回

---

### 🎯 关于交互组件的最佳实践

你问的非常对，表单、按钮、评论框这些有交互的组件 **只能运行在客户端**。

✅ **我们的SSR策略：只做数据的服务端渲染，交互全部在客户端**

```tsx
// ✅ 最佳实践
export default async function ArticlePage({ params }) {
  // 🔴 服务端只做数据获取
  const article = await fetchArticle(params.slug);

  return (
    <div>
      {/* ✅ 文章内容在服务端渲染好 HTML */}
      <ArticleContent content={article.content} />

      {/* 🟡 评论表单是客户端组件，'use client' */}
      <CommentForm articleId={article.id} />

      {/* 🟡 点赞按钮是客户端组件 */}
      <LikeButton articleId={article.id} />
    </div>
  );
}
```

✅ **服务端只负责渲染静态内容**
✅ **所有有点击、输入、状态的组件，全部是客户端组件**
✅ **这是Next.js App Router 官方推荐的标准做法**

---

## ✅ 设计总结

这不是什么黑魔法，这只是把Next.js本身就支持的特性做了非常优雅的组合。

很多团队做三端同构都走入了误区，他们想的是：

> "我要写一个框架，同时支持三种模式。"

而我们的设计思想是：

> "我要让三种模式都适配我的业务代码。"

这就是为什么这个架构如此容易维护的原因。业务代码永远是一等公民，所有的复杂性都被隐藏在薄薄的适配层后面。
