# Frontend-Blog 三端统一客户端架构设计

> H5 / Web / App 三端同构方案
> 技术栈: Next.js 15 + Capacitor.js + Tailwind CSS

---

## 1. 项目定位

### 1.1 目标

独立的博客前端展示客户端，一套代码同时支持:

- Web浏览器访问 (SSR/SSG)
- H5移动端页面
- iOS / Android 原生App (Capacitor打包)
- 未来支持 PWA / Electron桌面端

### 1.2 核心设计原则

1. **代码100%复用**: 业务逻辑、组件、样式完全共享
2. **平台自适应**: 自动检测运行环境，提供对应平台体验
3. **性能优先**: 分层缓存、渐进式加载、离线支持
4. **渐进增强**: Web基础版 → 增强H5 → 原生App功能

---

## 2. 技术栈选型

| 层级       | 技术选择                  | 说明                            |
| ---------- | ------------------------- | ------------------------------- |
| 框架       | Next.js 15 App Router     | 官方推荐，支持SSR/SSG/ISR       |
| 原生桥接   | Capacitor.js 6            | 官方维护，性能优于Ionic/Cordova |
| UI框架     | Tailwind CSS 3.4          | 响应式设计，统一跨端样式        |
| 状态管理   | Zustand                   | 轻量、高性能、支持持久化        |
| 数据获取   | TanStack Query v5         | 缓存、重试、乐观更新            |
| 类型系统   | TypeScript 5.4            | 全链路类型安全                  |
| 富文本渲染 | DOMPurify + ReactMarkdown | 安全的内容渲染                  |

---

## 3. 目录结构设计

```
apps/frontend-blog/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx         # 根布局
│   │   ├── page.tsx           # 博客首页
│   │   ├── articles/
│   │   │   ├── page.tsx       # 文章列表页
│   │   │   └── [slug]/
│   │   │       └── page.tsx   # 文章详情页
│   │   ├── categories/
│   │   │   ├── page.tsx       # 分类列表
│   │   │   └── [slug]/
│   │   │       └── page.tsx   # 分类文章列表
│   │   ├── tags/
│   │   │   ├── page.tsx       # 标签云
│   │   │   └── [slug]/
│   │   │       └── page.tsx   # 标签文章列表
│   │   └── search/
│   │       └── page.tsx       # 搜索结果页
│   │
│   ├── components/            # UI组件库
│   │   ├── core/             # 基础原子组件
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Avatar.tsx
│   │   │   ├── Skeleton.tsx
│   │   │   └── InfiniteScroll.tsx
│   │   ├── blog/             # 博客业务组件
│   │   │   ├── ArticleCard.tsx
│   │   │   ├── ArticleList.tsx
│   │   │   ├── ArticleDetail.tsx
│   │   │   ├── ArticleRenderer.tsx
│   │   │   ├── CategorySidebar.tsx
│   │   │   ├── TagCloud.tsx
│   │   │   ├── CommentItem.tsx
│   │   │   ├── CommentSection.tsx
│   │   │   └── SearchBox.tsx
│   │   ├── layout/           # 布局组件
│   │   │   ├── Header.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── MobileNavBar.tsx
│   │   └── platform/         # 平台特化组件
│   │       ├── ShareButton.tsx
│   │       ├── BackButton.tsx
│   │       └── OfflineIndicator.tsx
│   │
│   ├── lib/                   # 核心逻辑层
│   │   ├── api/              # API客户端层
│   │   │   ├── client.ts     # 统一HTTP客户端
│   │   │   ├── articles.ts   # 文章接口
│   │   │   ├── categories.ts # 分类接口
│   │   │   ├── tags.ts       # 标签接口
│   │   │   ├── comments.ts   # 评论接口
│   │   │   └── index.ts
│   │   ├── hooks/            # 自定义Hooks
│   │   │   ├── useDeviceDetect.ts
│   │   │   ├── usePlatformDetect.ts
│   │   │   ├── useArticles.ts
│   │   │   ├── useCategories.ts
│   │   │   └── useOffline.ts
│   │   ├── store/            # 状态管理
│   │   │   ├── useArticleStore.ts
│   │   │   ├── useUIPreferenceStore.ts
│   │   │   └── useOfflineStore.ts
│   │   ├── utils/            # 工具函数
│   │   │   ├── dateFormat.ts
│   │   │   ├── htmlSanitizer.ts
│   │   │   ├── slugify.ts
│   │   │   └── seo.ts
│   │   └── types/            # 类型定义
│   │       ├── article.ts
│   │       ├── category.ts
│   │       ├── tag.ts
│   │       ├── comment.ts
│   │       └── platform.ts
│   │
│   ├── styles/               # 全局样式
│   │   ├── globals.css
│   │   ├── prose.css        # 文章正文排版样式
│   │   └── platform.css     # 平台特定样式
│   │
│   └── constants/            # 常量配置
│       ├── routes.ts
│       ├── api.ts
│       └── app.config.ts
│
├── capacitor/                # Capacitor原生项目
│   ├── ios/
│   ├── android/
│   └── web/
├── capacitor.config.ts       # Capacitor配置
├── next.config.ts           # Next.js配置
├── tailwind.config.ts       # Tailwind配置
├── tsconfig.json            # TypeScript配置
└── package.json
```

---

## 4. 分层架构设计

### 4.1 架构分层

```
┌─────────────────────────────────────┐
│             表示层                   │
│  页面组件 / 路由 / 布局 / 交互        │
└───────────────────┬─────────────────┘
                    │
┌───────────────────▼─────────────────┐
│             业务组件层               │
│  ArticleCard / CommentSection 等    │
└───────────────────┬─────────────────┘
                    │
┌───────────────────▼─────────────────┐
│             状态管理层               │
│  Zustand Store / TanStack Query     │
└───────────────────┬─────────────────┘
                    │
┌───────────────────▼─────────────────┐
│             API服务层                │
│  统一HTTP客户端 / 请求拦截 / 响应处理  │
└───────────────────┬─────────────────┘
                    │
┌───────────────────▼─────────────────┐
│             平台适配层               │
│  Capacitor / Web API / 环境检测      │
└─────────────────────────────────────┘
```

### 4.2 数据流方向

1. **单向数据流**: 页面 → 组件 → Store → API → 后端
2. **自动缓存**: TanStack Query 管理接口缓存
3. **离线支持**: 缓存数据持久化到本地存储
4. **乐观更新**: 用户操作即时响应，后台同步

---

## 5. 平台适配策略

### 5.1 环境自动检测

```typescript
// 运行时平台检测
export const usePlatform = () => {
  const [platform, setPlatform] = useState<
    "web" | "ios" | "android" | "electron"
  >("web");
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.Capacitor) {
      const p = Capacitor.getPlatform();
      setPlatform(p);
      setIsNative(p !== "web");
    }
  }, []);

  return { platform, isNative, isWeb: platform === "web" };
};
```

### 5.2 功能渐进增强

| 功能     | Web版          | H5版           | 原生App    |
| -------- | -------------- | -------------- | ---------- |
| 文章浏览 |                |                |            |
| 评论功能 |                |                |            |
| 分享功能 | 浏览器API      | 微信JS-SDK     | 原生分享   |
| 推送通知 | Web Push       | Web Push       | 原生推送   |
| 离线阅读 | Service Worker | Service Worker | 本地数据库 |
| 深色模式 |                |                | 系统适配   |
| 手势导航 | ❌             |                |            |

### 5.3 组件条件渲染

```tsx
const ShareButton = () => {
  const { isNative } = usePlatform();

  if (isNative) {
    return <NativeShareButton />; // 使用Capacitor Share API
  }

  return <WebShareButton />; // 使用Web Share API
};
```

---

## 6. API层设计

### 6.1 统一API客户端

```typescript
class BlogApiClient {
  private baseURL: string;
  private headers: HeadersInit;

  constructor() {
    this.baseURL =
      process.env.NEXT_PUBLIC_API_URL || "https://api.joyminis.com";
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    const url = new URL(`${this.baseURL}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) =>
        url.searchParams.append(k, String(v)),
      );
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers,
      next: { revalidate: 300 }, // Next.js ISR 缓存5分钟
    });

    return response.json();
  }

  // post / put / delete 方法...
}

export const api = new BlogApiClient();
```

### 6.2 接口缓存策略

| 接口     | 缓存时间 | 缓存位置          |
| -------- | -------- | ----------------- |
| 文章详情 | 24小时   | CDN + Next.js ISR |
| 文章列表 | 10分钟   | CDN + 浏览器缓存  |
| 分类列表 | 1小时    | CDN + 全局缓存    |
| 标签列表 | 1小时    | CDN + 全局缓存    |
| 评论列表 | 5分钟    | TanStack Query    |

---

## 7. 性能优化方案

### 7.1 渲染优化

1. **SSR首屏**: 首页、文章详情页采用SSR
2. **增量静态生成**: 已发布文章自动ISR
3. **组件懒加载**: 评论区、侧边栏动态导入
4. **无限滚动**: 列表页虚拟滚动 + 分页加载

### 7.2 资源优化

1. **图片优化**: Next.js Image 自动格式转换、懒加载
2. **代码分割**: 按路由自动分割代码
3. **字体优化**: 本地字体 + preload
4. **CSS优化**: Tailwind 原子化CSS + 清除未使用样式

---

## 8. 构建与部署流程

### 8.1 多目标构建

```json
{
  "scripts": {
    "dev": "next dev",
    "build:web": "next build",
    "build:app": "next build && npx cap sync",
    "build:ios": "npm run build:app && npx cap open ios",
    "build:android": "npm run build:app && npx cap open android",
    "export:static": "next build && next export"
  }
}
```

### 8.2 部署目标

1. **Web版**: 部署到 Vercel / Cloudflare Pages
2. **H5版**: 静态导出部署到CDN
3. **iOS App**: 编译后提交 App Store
4. **Android App**: 编译后提交 Google Play / 国内应用市场

---

## 9. 开发计划与优先级

### 🔴 第一阶段 (1-2天)

- [ ] 初始化Next.js项目结构
- [ ] 配置Tailwind CSS + 主题系统
- [ ] 实现多语言i18n系统
- [ ] 实现API客户端层
- [ ] 完成首页、文章列表、文章详情页基础版

### 🟠 第二阶段 (3-4天)

- [ ] 分类页面、标签页面、搜索功能
- [ ] 评论系统
- [ ] SEO优化 (meta标签、结构化数据)
- [ ] 响应式布局适配

### 🟡 第三阶段 (5-6天)

- [ ] 集成Capacitor.js
- [ ] 原生功能对接 (分享、推送)
- [ ] 离线阅读功能
- [ ] App打包测试

### 🟢 第四阶段 (7天+)

- [ ] 性能优化
- [ ] PWA支持
- [ ] 埋点与统计
- [ ] 深色/浅色主题切换

---

## 10. 与现有系统集成

### 10.1 后端API

- 复用 `/v1/public/blog/*` 公开接口
- 无需认证即可读取已发布内容
- 评论提交可选择匿名或登录用户

### 10.2 管理后台

- 内容管理继续使用现有的 `admin-next`
- 客户端与管理后台共享数据库模型
- 内容变更实时通过Webhook通知客户端刷新缓存

---

## 11. 多语言 i18n 系统设计

### 11.1 设计原则

**静态文案多语言**: 页面标题、按钮、导航栏、提示文字
❌ **动态内容不翻译**: 文章内容、评论、分类名称等接口返回数据保持原样

### 11.2 技术选型

- 使用 `next-intl` (Next.js官方推荐国际化方案)
- 支持服务端组件与客户端组件
- 自动语言检测与路由本地化

### 11.3 目录结构

```
src/
├── messages/
│   ├── en.json
│   ├── zh-CN.json
│   └── zh-TW.json
├── i18n.ts
├── middleware.ts
└── app/
    └── [locale]/
        ├── layout.tsx
        └── ... 所有页面路由
```

### 11.4 翻译文件示例

```json
// messages/zh-CN.json
{
  "common": {
    "home": "首页",
    "articles": "文章",
    "categories": "分类",
    "tags": "标签",
    "search": "搜索",
    "loadMore": "加载更多",
    "noResults": "没有找到相关内容",
    "back": "返回"
  },
  "article": {
    "readTime": "阅读时间",
    "views": "浏览",
    "comments": "评论",
    "share": "分享",
    "relatedArticles": "相关文章"
  },
  "comment": {
    "title": "评论",
    "writeComment": "发表评论",
    "submit": "提交",
    "loginRequired": "请先登录后评论"
  },
  "search": {
    "placeholder": "搜索文章...",
    "result": "找到 {count} 篇文章"
  }
}
```

### 11.5 使用方式

```tsx
// 服务端组件
import { useTranslations } from "next-intl/server";

export default async function HomePage() {
  const t = await useTranslations("common");
  return <h1>{t("home")}</h1>;
}
```

```tsx
// 客户端组件
"use client";
import { useTranslations } from "next-intl";

export default function SearchBox() {
  const t = useTranslations("search");
  return <input placeholder={t("placeholder")} />;
}
```

---

## 12. 主题系统设计 (复用admin-next规范)

### 12.1 设计原则

**完全复用admin-next主题系统**，无需重新设计，保持视觉一致性
共享颜色体系、间距、圆角、阴影等设计Token
100% 与管理后台视觉风格统一

### 12.2 技术方案

- Tailwind CSS 3.4 深色模式 (与admin-next相同配置)
- CSS变量主题系统
- 支持系统跟随 / 浅色 / 深色 三种模式
- 状态持久化到 localStorage

### 12.2 主题状态管理

```typescript
// store/useThemeStore.ts
import { create } from "zustand";

type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: "system",
  resolvedTheme: "light",
  setTheme: (theme) => {
    set({ theme });
    localStorage.setItem("theme", theme);
  },
}));
```

### 12.3 Tailwind 配置

```javascript
// tailwind.config.ts
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#eff6ff",
          500: "#3b82f6",
          900: "#1e3a8a",
        },
        background: {
          light: "#ffffff",
          dark: "#0f172a",
        },
        text: {
          light: "#1e293b",
          dark: "#f1f5f9",
        },
      },
    },
  },
};
```

### 12.4 主题切换组件

```tsx
"use client";
export default function ThemeToggle() {
  const { theme, setTheme } = useThemeStore();

  return (
    <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
      <option value="system">跟随系统</option>
      <option value="light">浅色模式</option>
      <option value="dark">深色模式</option>
    </select>
  );
}
```

---

## 13. 代码复用方案 (复用admin-next公共代码)

### 13.1 可直接复用的核心模块

**HTTP客户端完整复用** (优先级最高)

- `http.ts` 完整的Axios封装 (588行生产级代码)
- 自动Token刷新与401处理
- 请求去重与取消
- 智能重试机制 (指数退避)
- 统一错误处理与Toast提示
- Sentry链路追踪
- 自动语言头注入
- SSR/浏览器双环境适配
- Type类型定义 (`api/types.ts`)
- 请求响应格式规范
- 分页响应格式 `PaginatedResponse<T>`

**工具函数复用**

- `sanitizeHtml.ts` XSS安全过滤
- 日期格式化工具
- SEO元标签生成工具
- Slug生成工具

**状态管理模式复用**

- Zustand Store 最佳实践
- TanStack Query 使用模式
- Toast 通知系统
- 主题状态管理

**UI组件复用**

- 所有 `@repo/ui` 基础组件
- 按钮、卡片、头像、骨架屏
- 无限滚动组件
- 表单组件与验证模式

---

### 13.2 HTTP客户端移植方案

**不需要重写**，直接从 admin-next 移植：

```
src/lib/api/
├── http.ts           ← 完整复制，仅修改baseURL
├── types.ts          ← 复用ApiResponse/PaginatedResponse
└── blogApi.ts        ← 博客专属接口定义
```

**仅需修改2行配置**:

```typescript
// http.ts 中仅需修改 baseURL 配置
const baseURL =
  typeof window === "undefined"
    ? process.env.INTERNAL_API_URL || "http://localhost:3000/api"
    : process.env.NEXT_PUBLIC_API_URL || "https://api.joyminis.com";
```

---

### 13.3 博客API示例

```typescript
// src/lib/api/blogApi.ts
import http from "./http";
import type { PaginatedResponse } from "./types";
import type { Article, Category, Tag, Comment } from "@/types/blog";

export const blogApi = {
  // 文章接口
  getArticles: (params?: {
    page?: number;
    pageSize?: number;
    categoryId?: string;
    tagId?: string;
  }) =>
    http.get<PaginatedResponse<Article>>("/v1/public/blog/articles", params),

  getArticleBySlug: (slug: string) =>
    http.get<Article>(`/v1/public/blog/articles/${slug}`),

  // 分类接口
  getCategories: () => http.get<Category[]>("/v1/public/blog/categories"),

  // 标签接口
  getTags: () => http.get<Tag[]>("/v1/public/blog/tags"),

  // 评论接口
  getComments: (articleId: string, params?: { page?: number }) =>
    http.get<PaginatedResponse<Comment>>(
      `/v1/public/blog/articles/${articleId}/comments`,
      params,
    ),

  postComment: (
    articleId: string,
    data: { author: string; email: string; content: string },
  ) =>
    http.post<Comment>(`/v1/public/blog/articles/${articleId}/comments`, data),
};
```

---

### 13.4 开发效率提升

节省至少 **3人天** 开发时间 (无需从零写HTTP客户端)
经过生产验证的错误处理逻辑
与管理后台100%行为一致
所有后端接口约定已经对齐
直接复用接口调试经验

---

## 14. Monorepo 集成方案

### 14.1 Turbo 配置

**完全复用现有monorepo配置，不需要特殊修改**

```json
// turbo.json 自动继承
{
  "pipeline": {
    "frontend-blog#build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "out/**"]
    },
    "frontend-blog#dev": {
      "cache": false
    },
    "frontend-blog#lint": {
      "dependsOn": ["^lint"]
    },
    "frontend-blog#test": {
      "dependsOn": ["^test"]
    }
  }
}
```

### 14.2 复用Monorepo规范

**TypeScript配置**: 继承 `@repo/typescript-config/nextjs.json`
**ESLint配置**: 继承 `@repo/eslint-config/next.js`
**Prettier配置**: 复用根目录 `.prettierrc`
**Tailwind配置**: 继承 `@repo/ui` 主题配置
**依赖版本**: 所有包版本与monorepo保持一致

### 14.3 项目初始化命令

```bash
# 1. 初始化Next.js项目
cd apps
npx create-next-app@latest frontend-blog --typescript --tailwind --eslint --app --no-src-dir --no-import-alias

# 2. 配置monorepo继承
# 修改tsconfig.json, .eslintrc.cjs 继承monorepo配置

# 3. 安装依赖
cd frontend-blog
yarn add @capacitor/core @capacitor/ios @capacitor/android next-intl zustand @tanstack/react-query

# 4. 启动开发服务器
yarn dev
```

---

## 15. 环境变量配置

**与admin-next完全一致的环境变量规范**

| 变量名                     | 说明                |
| -------------------------- | ------------------- |
| `NEXT_PUBLIC_API_URL`      | API 接口地址        |
| `NEXT_PUBLIC_API_BASE_URL` | API 基础路径        |
| `INTERNAL_API_URL`         | SSR 内部调用地址    |
| `NEXT_PUBLIC_SITE_URL`     | 站点公网URL         |
| `NEXT_PUBLIC_GA_ID`        | Google Analytics ID |

```bash
# 复制admin-next环境文件
cp apps/admin-next/.env.development apps/frontend-blog/
cp apps/admin-next/.env.production apps/frontend-blog/
```

---

## 16. App 打包特别说明

> ⚠️ **重要**: Capacitor App 打包不支持 Next.js SSG/ISR，需要静态导出

### 16.1 构建配置

```json
// package.json
{
  "scripts": {
    "dev": "next dev",
    "build:web": "next build",
    "build:static": "next build && next export",
    "build:app": "npm run build:static && npx cap sync",
    "open:ios": "npx cap open ios",
    "open:android": "npx cap open android"
  }
}
```

### 16.2 App 打包流程

1. 执行 `npm run build:static` 生成静态HTML
2. Capacitor 将 out/ 目录打包进原生App
3. App 运行时完全是客户端渲染
4. 所有API调用走公网HTTPS接口

---

## 17. 测试与部署规范

**测试配置**: 复用 admin-next Vitest / Playwright 配置
**部署流程**: 复用现有CI/CD流水线
**环境区分**: Development / Staging / Production 三环境
**监控系统**: 复用现有Sentry / Prometheus 集成

---

## 18. 快速启动指南

### 第一步: 项目初始化

```bash
# 从monorepo根目录执行
make init-blog-frontend
```

### 第二步: 启动开发服务器

```bash
cd apps/frontend-blog
yarn dev
# 访问 http://localhost:3001
```

### 第三步: 构建Web版本

```bash
yarn build:web
# 输出到 .next 目录
```

### 第四步: 构建App版本

```bash
yarn build:app
yarn open:ios
# 在Xcode中编译运行
```

---

**文档版本**: 1.3.0  
**最后更新**: 2026-04-06  
**负责人**: 架构组
