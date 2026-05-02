# Frontend Blog 性能与稳定性优化计划

**日期**：2026-05-02  
**分析来源**：Vercel Observability 日志 + Sentry 错误报告 + 代码审查  
**优先级**：P0（线上 Bug）> P1（性能）> P2（代码质量）> P3（维护性）

---

## 问题总览

| # | 问题 | 严重程度 | 影响范围 |
|---|------|----------|----------|
| 1 | Cloudflare 缓存语言重定向，英文用户强制看中文 | 🔴 P0 | 所有非中文用户 |
| 2 | SW 旧 JS chunk 与新 bundle 版本混用 → TypeError 崩溃 | 🔴 P0 | 部署后所有导航用户 |
| 3 | 登录后重定向 `/zh/zh/bookmarks`（双重 locale） | 🔴 P0 | 所有需要登录后跳转的用户 |
| 4 | iOS Safari toolbar 收起时 BottomNav 底部白边 | 🔴 P0 | iOS Safari 所有用户 |
| 5 | SSR 两个 API 串行等待 | 🟠 P1 | 首页 SSR 耗时翻倍 |
| 5 | 导航链接无限制 prefetch → ISR 风暴 | 🟠 P1 | 后端并发激增 10s+ 阻塞 |
| 6 | Middleware 每请求重建 intl 实例 | 🟡 P2 | Edge 函数执行开销 |
| 7 | Middleware 每请求打 3 次 console.log | 🟡 P2 | Vercel 日志费用 + 噪音 |
| 8 | ISR revalidate 间隔相同，同时到期 | 🟡 P2 | 定时 revalidation 风暴 |
| 9 | Terser unsafe 优化标志 | 🟡 P2 | iOS WKWebView 潜在 bug |
| 10 | BottomNavigation navItems 重复定义 | 🔵 P3 | 代码维护问题 |

---

## P0-1：Cloudflare 缓存语言重定向（英文用户看中文）

### 问题描述

`middleware.ts` 第 28–30 行，当用户访问 `/` 时，Middleware 检测语言后执行
`NextResponse.redirect(url)`，但响应**没有设置 `Cache-Control: no-store`**。
Cloudflare 把这个 `302 /zh` 缓存下来，后续所有用户（包括英文用户）都收到
缓存的 302，直接跳到 `/zh` 显示中文。

**确认证据**：
- 用户 iPhone（`Accept-Language: en-US,en;q=0.9`）看到中文
- 图片响应头中 `cf-cache-status: HIT` 确认 Cloudflare 正在命中缓存
- `sec-ch-ua-platform: "iOS"` + Accept-Language 纯英文，排除系统语言原因

### 根本原因

```typescript
// middleware.ts 第 28-30 行
if (!hasLocalePrefix) {
  url.pathname = `/${detectedLocale}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url); // ❌ 未禁止缓存，未设 Vary
}
```

### 修复方案

**文件**：`middleware.ts`

```typescript
if (!hasLocalePrefix) {
  // 根路径直接加 trailing slash，消除 next-intl 的二次重定向（3跳→2跳）
  url.pathname = pathname === '/'
    ? `/${detectedLocale}/`
    : `/${detectedLocale}${pathname}`;

  const response = NextResponse.redirect(url);
  // 语言检测依赖 Accept-Language + Cookie，必须禁止 CDN 缓存
  response.headers.set('Cache-Control', 'no-store, no-cache');
  response.headers.set('Vary', 'Accept-Language, Cookie');
  return response;
}
```

同步修复无效语言重定向（第 37–40 行）也加 `Cache-Control: no-store`。

### 附加收益：减少一次重定向跳数

```
修复前：GET /  →  302 /zh  →  302 /zh/  →  200   （3 次网络往返）
修复后：GET /  →  302 /zh/  →  200              （2 次网络往返）
```

### 部署后必做

修复上线后，在 **Cloudflare Dashboard → Caching → Purge Cache** 手动清除 `/`
路径的旧缓存，否则已缓存的 `302 /zh` 仍会服务到自然过期。

---

## P0-2：SW 旧 JS Chunk 版本混用（`e[n].call` TypeError）

### 问题描述

Sentry 报告：用户从首页 `page=2` 导航到文章详情时，iPhone Chrome 报
`TypeError: undefined is not an object (evaluating 'e[n].call')`。

这是 Webpack 运行时错误：`__webpack_modules__[n]` 为 `undefined`，
说明主 bundle 引用了一个在当前已加载 chunk 中不存在的 module ID。

### 崩溃链路

```
新版本部署
    ↓ skipWaiting: true → 新 SW 立即接管
用户停留在首页 page=2（页面已加载旧版 bundle）
    ↓ 点击文章卡片 → Next.js 动态 import 文章页 chunk
SW 拦截 → StaleWhileRevalidate → 返回缓存中的旧 chunk（版本 A）
    ↓
新主 bundle（版本 B）中 module ID=n 在旧 chunk 中不存在
    ↓
TypeError: undefined is not an object (evaluating 'e[n].call') ❌
```

### 问题代码

```typescript
// next.config.ts 第 68-77 行
{
  urlPattern: /\.(?:js|css|mjs)$/i,
  handler: 'StaleWhileRevalidate', // ❌ 先返回旧版本，后台更新 → 版本混用
  options: {
    cacheName: 'static-js-css-assets',
    expiration: {
      maxEntries: 32,              // ❌ 只缓存 32 个文件，LRU 淘汰导致 chunk 缺失
      maxAgeSeconds: 24 * 60 * 60,
    },
  },
},
```

### 修复方案

**文件**：`next.config.ts`

**Step 1**：将 `/_next/static/` JS chunk 策略改为 `CacheFirst`（文件名含 hash，天然 immutable）：

```typescript
// 替换原有 static-js-css-assets 规则
{
  urlPattern: ({ url }) => url.pathname.startsWith('/_next/static/'),
  handler: 'CacheFirst',               // ✅ immutable 文件，安全永久缓存
  options: {
    cacheName: 'next-static-assets',
    expiration: {
      maxEntries: 200,                 // ✅ 足够容纳所有 chunk（原 32 远不够）
      maxAgeSeconds: 365 * 24 * 60 * 60,
    },
  },
},
```

**Step 2**：加 `cleanupOutdatedCaches: true`，SW 更新时自动清除旧版本：

```typescript
const withPWA = require('next-pwa')({
  // ...
  cleanupOutdatedCaches: true, // ✅ SW 激活时删除旧缓存，防止版本混用
});
```

**Step 3**：删除过宽泛的 `pages-cache` 规则（与 `navigation-pages` 冲突）：

```typescript
// 删除 ❌ — 过于宽泛，缓存所有 joyminis.com 响应，与 NetworkFirst 冲突
{
  urlPattern: /^https?:\/\/.*\.(joyminis\.com|localhost).*$/i,
  handler: 'StaleWhileRevalidate',
  ...
}
```

### 离线影响说明

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 访问过的页面，离线打开 | ✅ 可用（但旧版本） | ✅ 可用（正确版本） |
| 部署后，点击文章导航 | ❌ TypeError 崩溃 | ✅ 正常 |
| 从未访问的页面，离线打开 | ❌ 失败 | ❌ 失败（预期行为） |

---

## P1-1：SSR 两个 API 串行等待

### 问题描述

`[locale]/page.tsx` 中 `articles` 和 `categories` 两个独立 API 串行执行，
第一个完成后才发起第二个请求，浪费约 50% SSR 等待时间。

**证据**：`GET /zh/` CPU 79ms，Wall 1.21s，约 1.1s 全在等 API I/O。

### 问题代码

```typescript
// ❌ 串行
const initialData = await serverGet('/v1/frontend/blog/articles', ...);
const initialCategories = await serverGet('/v1/frontend/blog/categories', ...);
```

### 修复方案

```typescript
// ✅ 并行
const [initialData, initialCategories] = await Promise.all([
  serverGet<FrontendPaginatedResponse<FrontendArticle>>(
    '/v1/frontend/blog/articles',
    { lang: locale, page: 1, pageSize: 10 },
  ),
  serverGet<FrontendCategory[]>(
    '/v1/frontend/blog/categories',
    { lang: locale },
  ).catch(() => [] as FrontendCategory[]),
]);
```

**预期收益**：SSR 耗时从 `T(articles) + T(categories)` 降至 `max(T(articles), T(categories))`，节省约 40–60%。

---

## P1-2：导航链接 Prefetch 触发 ISR 风暴

### 问题描述

首页加载完成后，`BottomNavigation` 和 `Sidebar` 的所有 `NavLink` 立即
进入视口，Next.js 默认对视口内链接自动 prefetch，同时触发 categories、
tags、about、文章页的 ISR revalidation。

`ArticleCard` 的 `<Link>` 同样无 `prefetch={false}`，首屏 10 篇文章
的详情页全部被 prefetch。

**证据**：Observability 日志 t=9.9–10.2s 出现 5 个并发 GET，
t=10.67s 出现 4 个 `rpc default.revalidate` 同时阻塞 10s+。

### 修复方案

**文件 1**：`BottomNavigation.tsx` + `Sidebar.tsx`  

```typescript
// 首页链接保持默认（用户从其他页返回时有收益）
<NavLink href="/" ...>

// 非首页静态链接禁用自动 prefetch
<NavLink href="/categories" prefetch={false} ...>
<NavLink href="/tags"       prefetch={false} ...>
<NavLink href="/about"      prefetch={false} ...>
```

**文件 2**：`ArticleCard.tsx` — 改为 hover/touch 时按需 prefetch：

```typescript
<Link
  href={`/articles/${article.slug}`}
  prefetch={false}
  onMouseEnter={() => router.prefetch(`/articles/${article.slug}`)}
  onTouchStart={() => router.prefetch(`/articles/${article.slug}`)}
  ...
>
```

**预期收益**：首页加载触发的并发 ISR 请求数从 ~7 个降至 ~1 个。

---

## P2-1：Middleware 每请求重建 intl 实例

### 问题描述

`middleware.ts` 第 81 行在函数体内调用 `createMiddleware()`，每次请求
都新建实例，增加 Edge 函数运行开销。

### 修复方案

```typescript
// ✅ 模块顶层初始化一次
const intlMiddleware = createMiddleware({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localeDetection: false,
  localePrefix: 'always',
});

export default function middleware(request: NextRequest) {
  // 直接使用 intlMiddleware(request)
}
```

---

## P2-2：Middleware 每请求打 3 次 console.log

### 问题描述

3 个 `console.log` 在每个请求都执行，高并发时：
- Vercel 按日志行计费，显著增加成本
- 输出含 cookie 键名结构，存在信息泄露风险

### 修复方案

直接删除 3 处 `console.log`（第 47、66、75 行）。

---

## P2-3：ISR Revalidate 间隔相同导致定时风暴

### 问题描述

首页、categories、tags、about 页面的 `revalidate` 全部是 `60`，
导致缓存同时到期，批量触发 revalidation。

### 修复方案

错开各页面的 revalidate 间隔，避免同时到期：

| 页面 | 当前 | 修复后 | 理由 |
|------|------|--------|------|
| `[locale]/page.tsx` | 60s | **60s** | 内容最新鲜，保持最短 |
| `[locale]/layout.tsx` | 60s | **120s** | Layout 变动极少 |
| `categories/page.tsx` | 未设置 | **180s** | 分类变动不频繁 |
| `tags/page.tsx` | 未设置 | **240s** | 标签变动不频繁 |
| `about/page.tsx` | 未设置 | **600s** | 几乎不变 |

---

## P2-4：Terser Unsafe 优化标志

### 问题描述

`next.config.ts` 第 335–341 行的 `unsafe_*` Terser 标志对 JS 语义有破坏性，
在 iOS WKWebView 等特定引擎上可能引发隐性 runtime bug，
与 P0-2 的 `e[n].call` 错误可能存在叠加关系。

### 修复方案

删除所有 `unsafe_*` 标志：

```typescript
compress: {
  drop_debugger: true,
  drop_console: true,
  passes: 2,
  pure_getters: true,
  hoist_funs: true,
  hoist_props: true,
  reduce_vars: true,
  toplevel: true,
  // 删除: unsafe, unsafe_math, unsafe_methods, booleans_as_integers
},
```

---

## P3-1：BottomNavigation navItems 重复定义

### 问题描述

`BottomNavigation.tsx` 中 `navItems` 数组定义了两次（`useEffect` 内一次，
render 函数内一次），包含大量 SVG JSX，维护时容易不一致。

### 修复方案

将 `navItems` 提升到组件外部为模块级常量，两处共用同一份定义。

---

## P0-3：登录后重定向路径双重 locale 前缀（`/zh/zh/bookmarks`）

### 问题描述

用户未登录点击受保护链接 → 被重定向到登录页 → 登录成功后被导航到 `/zh/zh/bookmarks`（404）。

**复现 URL**：`https://blog.joyminis.com/zh/zh/bookmark`

### 根本原因

所有**写入方**存入 sessionStorage 的路径均**已带 locale 前缀**：

| 写入位置 | 存储的值 |
|----------|----------|
| `ProtectedLink.tsx` L61 | `withLocale('/bookmarks', 'zh')` → `/zh/bookmarks` |
| `ProtectedRoute.tsx` L48 | `window.location.pathname` → `/zh/bookmarks` |
| `ProtectedRouteV2.tsx` L97 | `window.location.pathname` → `/zh/bookmarks` |
| `BookmarkButton.tsx` L59 | `window.location.pathname` → `/zh/bookmarks` |

但两处**读取方**又对已带 locale 的 rawPath 再次调用 `withLocale()`：

```typescript
// login/page.client.tsx L143 ❌
router.push(withLocale(rawPath, locale as any)); // /zh/bookmarks → /zh/zh/bookmarks

// oauth/callback/page.tsx L152 ❌
router.push(withLocale(rawPath, locale));        // /zh/bookmarks → /zh/zh/bookmarks
```

而 `LoginGuard` / `LoginGuardV2` 的读取是正确的：`router.push(redirectPath)` 直接推。

### 修复方案

**文件 1**：`login/page.client.tsx` L143  
**文件 2**：`oauth/callback/page.tsx` L152

```typescript
// ✅ rawPath 已含 locale 前缀，直接推
if (rawPath) {
  sessionStorage.removeItem('redirectAfterLogin');
  router.push(rawPath); // 不再调用 withLocale()
} else {
  router.push(withLocale('/', locale)); // 无 rawPath 时仍需加 locale
}
```

---

## P0-4：iOS Safari BottomNav toolbar 收起时底部出现白边

### 问题描述

在 iOS Safari 浏览器中，用户向下滚动时浏览器底部 toolbar 收起，
BottomNavigation 底部出现约 34px 白色空白条。

### 根本原因

iOS Safari browser 模式下 `env(safe-area-inset-bottom)` 行为：

| 状态 | `env(safe-area-inset-bottom)` | 效果 |
|------|-------------------------------|------|
| PWA standalone | 34px（home indicator） | spacer 填满 ✅ |
| 浏览器 toolbar 可见 | 0px（Safari 自行管理） | spacer = 0 ✅ |
| **浏览器 toolbar 收起动画中** | 0px（尚未更新） | viewport 已扩展至 home indicator 区域，但 spacer = 0 → **34px 白边** ❌ |

当 Safari toolbar 收起时，viewport 向下扩展约 34px（home indicator 区域），
但 `env(safe-area-inset-bottom)` 在动画期间仍报 0px，spacer div 高度为 0，
nav 背景色不覆盖 home indicator 区域，白色 webview 背景透出来。

### 修复方案

**文件**：`BottomNavigation.tsx`

在 `<nav>` 元素加 `relative`，并在 spacer div 之后追加一个绝对定位向下延伸的背景挡板：

```tsx
{/* iOS Safari toolbar-hide gap 兜底：
    将 nav 背景向下延伸 100px，覆盖 home indicator 区域。
    translate-y-full 推到 nav 底边之下，pointer-events-none 不影响交互。 */}
<div className="absolute bottom-0 left-0 right-0 h-[100px] bg-background translate-y-full pointer-events-none" />
```

无论 toolbar 动画进行到什么阶段，nav 背景都向下延伸 100px，彻底封住白边。

---

## 已完成修复

| 修复 | 文件 | 描述 |
|------|------|------|
| ✅ P0-1 重定向缓存 + trailing slash | `middleware.ts` | Cache-Control: no-store + Vary: Accept-Language, Cookie + 根路径直接 /{locale}/ |
| ✅ P0-2 SW chunk 版本混用 | `next.config.ts` | cleanupOutdatedCaches + CacheFirst for _next/static/ + 删除宽泛缓存规则 |
| ✅ P0-3 双重 locale 前缀 | `login/page.client.tsx`, `oauth/callback/page.tsx` | `router.push(rawPath)` 不再调用 `withLocale()` |
| ✅ P0-4 iOS Safari 白边 | `BottomNavigation.tsx` | h-[100px] 绝对定位背景挡板 + safe-area spacer 位置修正 |
| ✅ P1-1 SSR API 串行 | `[locale]/page.tsx` | `Promise.all` 并行请求 articles + categories |
| ✅ P1-2 Prefetch ISR 风暴 | `BottomNavigation.tsx`, `Sidebar.tsx`, `ArticleCard.tsx` | 非首页链接 `prefetch={false}` + hover/touch 按需 prefetch |
| ✅ P2-1 Middleware intl 实例 | `middleware.ts` | `createMiddleware()` 提升到模块顶层 |
| ✅ P2-2 删除 middleware debug log | `middleware.ts`, `locale.ts` | 移除所有 `[DEBUG]` console.log |
| ✅ P2-4 Terser unsafe 标志 | `next.config.ts` | 删除 unsafe/unsafe_math/unsafe_methods 标志 |

### 剩余待修复

| 问题 | 文件 | 描述 |
|------|------|------|
| ⏳ P2-3 ISR revalidate 间隔 | 各 page.tsx | 未验证是否需要错开 |
| 🔵 P3-1 navItems 重复定义 | `BottomNavigation.tsx` | 模块级常量未提取，useEffect 与 render 各定义一次 |
---

## 实施顺序

```
第一批（立即，P0 线上 Bug）：
  ① middleware.ts — 重定向加 no-store + Vary + trailing slash + 删 console.log + createMiddleware 提升
  ② next.config.ts — SW CacheFirst + cleanupOutdatedCaches + 删危险 Terser
  ③ login/page.client.tsx + oauth/callback/page.tsx — 修复双重 locale 前缀
  ④ BottomNavigation.tsx — 追加背景挡板修复 iOS Safari 白边
  ⑤ Cloudflare Purge Cache /

第二批（当天，P1 性能）：
  ④ [locale]/page.tsx — Promise.all 并行 API
  ⑤ BottomNavigation.tsx + Sidebar.tsx — prefetch={false}
  ⑥ ArticleCard.tsx — hover-prefetch

第三批（本周，P2 质量）：
  ⑦ 各页面 revalidate 错开
  ⑧ BottomNavigation navItems 去重
```

---

## 预期收益

| 指标 | 修复前 | 修复后（预期） |
|------|--------|---------------|
| 英文用户显示中文 | 100% 复现 | **消除** |
| 部署后导航 TypeError | 每次部署出现 | **消除** |
| 首页首次加载 Wall Time | ~1.21s | **~0.5–0.7s** |
| 首页加载触发并发 ISR 数 | ~7 个 | **~1 个** |
| Middleware 日志量 | 每请求 3 行 | **0 行** |
| 首页加载重定向跳数 | 3 跳 | **2 跳** |

---

## 开发环境语言检测修复（Docker + Turbopack）

### 问题描述

在 `docker compose` + `next dev --turbopack` 开发环境下，刷新页面始终 fallback 到 `zh`（默认语言），无法根据浏览器语言设置自动切换。

**关键发现**：`headers()` from `next/headers` 在 Docker + Turbopack 中**只返回 6 个代理级别头**：

| Header | 值 |
|--------|-----|
| `host` | `localhost:4002` |
| `connection` | `keep-alive` |
| `x-forwarded-for` | ... |
| `x-forwarded-host` | ... |
| `x-forwarded-port` | `4002` |
| `x-forwarded-proto` | `http` |

**没有** `accept-language`、`cookie`、`user-agent` 等浏览器原始头。这是 Docker 网络层 + Turbopack HMR 的已知交互问题。

### 叠加问题

1. **Next.js bug #69273**：middleware 对根路由 `/` 不执行，RootPage 必须自行处理 locale 检测
2. **`next-intl` locale 优先级**：`useCurrentLocale()` 优先读 URL 参数，始终返回 `zh`（因为 root redirect `→ /zh`）

### 修复方案

**核心思路**：两层 fallback 策略

```
请求 /
  ↓
RootPage（服务端）
  ├─ ① Cookie 检测 → 有则 redirect
  ├─ ② Accept-Language 检测 → 有则 redirect（headers() 在 Docker 中返回 null）
  └─ ③ fallback → redirect /zh
        ↓
I18nProvider（客户端，`'use client'`）
  ├─ ④ navigator.language 检测
  ├─ ⑤ 设置 NEXT_LOCALE cookie
  └─ ⑥ window.location.href 硬跳转
```

#### 修改文件

**文件 1**：`apps/frontend-blog/src/lib/providers/I18nProvider.tsx`

```typescript
'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useCurrentLocale } from '@/lib/hooks/useCurrentLocale';
import { LOCALES, DEFAULT_LOCALE } from '@/lib/i18n/config';

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  const actualLocale = useCurrentLocale();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // 同步语言到 HTML 和全局变量
    document.documentElement.lang = actualLocale;
    (globalThis as any).__NEXT_INTL_LOCALE__ = actualLocale;

    // 仅在服务端检测失败时做客户端回退
    if (actualLocale !== DEFAULT_LOCALE) return;

    const browserLang = navigator.language.split('-')[0].toLowerCase();
    if (!browserLang || browserLang === actualLocale) return;
    if (!(LOCALES as readonly string[]).includes(browserLang)) return;

    // 设置 NEXT_LOCALE cookie，后续请求服务端直接识别
    const expires = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toUTCString();
    document.cookie = `NEXT_LOCALE=${browserLang}; path=/; expires=${expires}; SameSite=Lax`;

    // 硬跳转确保服务端重新渲染
    const newPathname = pathname.replace(`/${actualLocale}`, `/${browserLang}`);
    console.log(`[I18nProvider] Client-side locale redirect: ${actualLocale} → ${browserLang}`);
    window.location.href = newPathname;
  }, [actualLocale, pathname]);

  return <>{children}</>;
}
```

**文件 2**：`apps/frontend-blog/src/app/page.tsx`（RootPage）

```typescript
export default async function RootPage() {
  const cookieStore = await cookies();
  const cookieLocale =
    cookieStore.get('NEXT_LOCALE')?.value || cookieStore.get('locale')?.value;

  // ① Cookie 优先
  if (cookieLocale && LOCALES.includes(cookieLocale as (typeof LOCALES)[number])) {
    redirect(`/${cookieLocale}`);
    return;
  }

  // ② Accept-Language 检测（Docker 中返回 null）
  const headersList = await headers();
  const acceptLanguage = headersList.get('accept-language');
  const browserLocale = parseAcceptLanguage(acceptLanguage);
  if (browserLocale) {
    redirect(`/${browserLocale}`);
    return;
  }

  // ③ fallback → 客户端 I18nProvider 接管
  redirect(`/${DEFAULT_LOCALE}`);
}
```

### 修复后效果

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 首次访问，浏览器语言 en | `/zh` | `/en`（客户端 navigator.language 检测） |
| 首次访问，浏览器语言 ja | `/zh` | `/ja` |
| 切换语言后刷新 | `/zh`（cookie 丢失） | 对应语言（NEXT_LOCALE cookie 持久化） |
| 后端 API `headers()` 在 Docker 中 | 只有 6 个代理头 | 不变（无法修复），但客户端补偿 |

### 部署说明

修改文件后**必须重启容器**才能生效：

```bash
docker compose restart frontend-blog
```

原因是 Docker Desktop on macOS 的 bind mount + Turbopack 文件变更通知传播存在延迟，单纯 HMR 可能无法正确重新编译。
