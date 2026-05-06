---
title: 浏览器语言检测链：Next.js 三层架构实现自动语言推送
slug: browser-language-detection-chain
tags: [i18n, Next.js, Middleware, TypeScript, next-intl]
description: 本文详细阐述了一个三层的浏览器语言检测链架构，涵盖 Middleware Cookie 设置、i18n request.ts 解析和客户端 I18nProvider 同步，以及 Monorepo 中两个 Next.js 应用的差异化实现。
---

## 目录

## 1. 背景

在多语言博客系统中，用户在首次访问时应该自动看到与其浏览器语言匹配的内容。这就需要一个 **浏览器语言检测链（Browser Language Detection Chain）**——从 HTTP 请求到客户端渲染的全链路自动语言适配。

在 [`JoyMini_Nest_Monorepo`](/) 项目中，我们有两个 Next.js 应用需要这一能力：

| 应用 | 用途 | 用户群体 |
|------|------|----------|
| [`frontend-blog`](apps/frontend-blog) | 公开博客 | 全球读者 |
| [`admin-blog`](apps/admin-blog) | 管理后台 | 多语言管理员 |
| [`admin-next`](apps/admin-next) | 新版管理后台 | 多语言管理员 |

每个应用的 i18n 实现细节不同，但浏览器语言检测的核心架构是一致的。

## 2. 架构总览：三层检测链

语言检测链分为三个层次，按优先级从低到高排列如下：

```
┌──────────────────────────────────────────────────────┐
│  第三层：客户端 I18nProvider（最高优先级）              │
│  · 监听 navigator.language 变化                       │
│  · 覆盖 Middleware 设置的 Cookie                      │
│  · 用户手动切换语言后同步状态                          │
├──────────────────────────────────────────────────────┤
│  第二层：i18n/request.ts（服务端中间优先级）            │
│  · 解析 Cookie 中的 locale                            │
│  · 回退到 Accept-Language Header                      │
│  · 默认回退到 zh                                      │
├──────────────────────────────────────────────────────┤
│  第一层：middleware.ts（最低优先级，处理重定向）         │
│  · 检测 URL 中是否缺少 locale 前缀                     │
│  · 读取 Accept-Language Header                        │
│  · 设置 locale Cookie                                 │
│  · 302 重定向到 /{locale}/path                        │
└──────────────────────────────────────────────────────┘
```

### 优先级原则

```
用户手动选择 > 客户端检测 > Cookie 持久化 > Accept-Language Header > 默认语言
```

每个上层可以覆盖下层的结果，确保：

1. **首次访问**：自动检测浏览器语言
2. **后续访问**：Cookie 持久化用户偏好
3. **用户手动切换**：覆盖自动检测结果
4. **所有场景**：确保不会出现无语言前缀的 URL

## 3. 第一层：Middleware（Cookie 设置 + 重定向）

### 3.1 核心职责

Middleware 在 Edge Runtime 中运行，负责：

1. 检查请求 URL 是否包含 locale 前缀
2. 如果没有，从 `Accept-Language` Header 检测浏览器语言
3. 设置 locale Cookie 供后续请求使用
4. 302 重定向到 `/{locale}/path`

### 3.2 工具函数

```typescript
// lib/utils/locale.ts
import { match } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';

const SUPPORTED_LOCALES = ['zh', 'en', 'ja', 'ko', 'fr', 'de'] as const;
const DEFAULT_LOCALE = 'zh';

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function getLocaleFromRequest(request: Request): SupportedLocale {
  // Step 1: Check Accept-Language header
  const headers = { 'accept-language': request.headers.get('accept-language') || '' };
  const languages = new Negotiator({ headers }).languages();

  try {
    // Step 2: Use intl-localematcher to find best match
    const matched = match(languages, SUPPORTED_LOCALES, DEFAULT_LOCALE);
    return matched as SupportedLocale;
  } catch {
    // Step 3: Fallback to default if matching fails
    return DEFAULT_LOCALE;
  }
}

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}
```

### 3.3 Middleware 实现

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getLocaleFromRequest, isSupportedLocale } from '@/lib/utils/locale';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if pathname already starts with a supported locale
  const pathnameHasLocale = pathname.split('/')[1];
  if (pathnameHasLocale && isSupportedLocale(pathnameHasLocale)) {
    return NextResponse.next();
  }

  // Detect locale from Accept-Language header
  const locale = getLocaleFromRequest(request);

  // Set locale cookie for i18n/request.ts
  const response = NextResponse.redirect(new URL(`/${locale}${pathname}`, request.url));
  response.cookies.set('locale', locale, {
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
    sameSite: 'lax',
  });

  return response;
}

export const config = {
  matcher: [
    // Skip internal Next.js paths and static files
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
```

### 3.4 Cookie 配置说明

| 参数 | 值 | 说明 |
|------|-----|------|
| `maxAge` | 365 天 | 用户偏好持久化一年 |
| `path` | `/` | 全站生效 |
| `sameSite` | `lax` | 允许同站导航携带 |

## 4. 第二层：i18n/request.ts（服务端 Locale 解析）

### 4.1 核心职责

[`next-intl`](https://next-intl-docs.vercel.app/) 的 `request.ts` 文件在每个服务端组件渲染时执行，负责解析当前请求的语言环境：

```typescript
// i18n/request.ts
import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { match } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';

const SUPPORTED_LOCALES = ['zh', 'en', 'ja', 'ko', 'fr', 'de'];
const DEFAULT_LOCALE = 'zh';

export default getRequestConfig(async () => {
  // Priority 1: Check locale Cookie (user's persisted preference)
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('locale')?.value;
  if (cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale)) {
    return { locale: cookieLocale };
  }

  // Priority 2: Check Accept-Language header (browser preference)
  const headersList = await headers();
  const acceptLanguage = headersList.get('accept-language') || '';
  const languages = new Negotiator({
    headers: { 'accept-language': acceptLanguage },
  }).languages();

  try {
    const matched = match(languages, SUPPORTED_LOCALES, DEFAULT_LOCALE);
    return { locale: matched };
  } catch {
    // Priority 3: Fallback to default
    return { locale: DEFAULT_LOCALE };
  }
});
```

### 4.2 为什么不只依赖 Cookie？

Middleware 在检测到浏览器语言后设置了 Cookie，但 `request.ts` 中的 Cookie 检查是第二层的第一优先级。这样设计的原因：

1. **直接访问场景**：用户可能通过书签直接访问 `/{locale}/path`，此时 Middleware 不执行重定向，但 `request.ts` 需要正确解析 locale
2. **Cookie 过期**：如果 Cookie 过期，`request.ts` 回退到 Accept-Language Header
3. **测试友好**：可以直接设置 Cookie 头来模拟不同语言

### 4.3 类型安全

```typescript
// 确保 request.ts 返回的 locale 类型与组件一致
type Locale = 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de';

// App/[locale]/layout.tsx — 类型安全的 params
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  // locale 的类型是 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de'
  return <>{children}</>;
}
```

## 5. 第三层：客户端 I18nProvider（最高优先级）

### 5.1 核心职责

客户端 Provider 在浏览器中运行，负责：

1. 读取 `navigator.language` 获取浏览器语言
2. 与 Middleware 设置的 Cookie 对比
3. 如果用户浏览器语言不同，更新 Cookie 并刷新页面

### 5.2 Provider 实现

```typescript
// lib/providers/I18nProvider.tsx
'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from '@/i18n/routing';
import { AbstractIntlMessages, NextIntlClientProvider } from 'next-intl';

const SUPPORTED_LOCALES = ['zh', 'en', 'ja', 'ko', 'fr', 'de'];

interface I18nProviderProps {
  locale: string;
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}

export function I18nProvider({ locale, messages, children }: I18nProviderProps) {
  const router = useRouter();
  const pathname = usePathname();

  // ⭐ 仅在客户端首次渲染时执行
  useEffect(() => {
    const browserLang = navigator.language?.split('-')[0];

    if (!browserLang || !SUPPORTED_LOCALES.includes(browserLang)) {
      return; // Unsupported browser language, keep current
    }

    if (browserLang !== locale) {
      // Browser language differs from Cookie locale
      // Update Cookie and redirect
      document.cookie = `locale=${browserLang}; path=/; max-age=${365 * 24 * 60 * 60}`;
      router.replace(`/${browserLang}${pathname}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
```

### 5.3 与 Middleware 的协作

Middleware 和客户端 Provider 可能存在冲突——如果用户在中文浏览器中设置 Cookie 为 English，然后访问 `site.com/en/...`，客户端不应再将语言切换为中文。

| 场景 | Middleware 行为 | Client Provider 行为 | 结果 |
|------|----------------|---------------------|------|
| 首次访问，浏览器为英文 | 设置 Cookie=en，重定向到 /en | 检测到 navigator=en，Cookie=en，无操作 | ✅ 显示英文 |
| 用户手动切换到中文 | URL 变为 /zh | 检测到 navigator=en，Cookie=zh | ✅ 保持中文（用户手动切换覆盖） |
| Cookie 过期，浏览器为日文 | 重定向到 /ja，设置 Cookie=ja | 检测到 navigator=ja，Cookie=ja，无操作 | ✅ 显示日文 |
| URL 直接访问 /fr，浏览器为中文 | 不重定向（URL 已有 locale） | 检测到 navigator=zh，Cookie=fr | ✅ 保持法文（URL 优先级最高） |

**关键**：客户端 Provider 仅在首次加载时执行一次，不会在后续导航中自动切换。用户手动切换语言后，Cookie 被更新，后续访问保持用户的偏好。

## 6. 应用差异化：admin-blog vs admin-next

虽然核心架构一致，但两个管理后台的实现细节有所不同。

### 6.1 admin-blog（next-intl v3 实现）

[`admin-blog`](apps/admin-blog) 使用 `next-intl` v3，Middleware 和 `request.ts` 需要手动配置 locale resolution：

```typescript
// admin-blog — 手动 Cookie + Accept-Language 解析
export function getLocaleFromRequest(): SupportedLocale {
  // Check Cookie
  const cookieLocale = document.cookie
    .split('; ')
    .find(row => row.startsWith('locale='))
    ?.split('=')[1];

  if (cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale)) {
    return cookieLocale as SupportedLocale;
  }

  // Fallback to browser language
  const browserLang = navigator.language?.split('-')[0];
  if (browserLang && SUPPORTED_LOCALES.includes(browserLang)) {
    return browserLang as SupportedLocale;
  }

  return DEFAULT_LOCALE;
}
```

### 6.2 admin-next（next-intl v4 实现）

[`admin-next`](apps/admin-next) 使用 `next-intl` v4，API 有所不同——`useRouter` 等 Hook 需要从 `@/i18n/routing` 导入：

```typescript
// admin-next — v4 routing import
import { useRouter, usePathname } from '@/i18n/routing';
// 而非 next-intl/client

export function I18nProvider({ locale, messages, children }: I18nProviderProps) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Same detection logic as admin-blog
    const browserLang = navigator.language?.split('-')[0];
    if (browserLang && SUPPORTED_LOCALES.includes(browserLang) && browserLang !== locale) {
      document.cookie = `locale=${browserLang}; path=/; max-age=${365 * 24 * 60 * 60}`;
      router.replace(`/${browserLang}${pathname}`);
    }
  }, []);
  // ...
}
```

### 6.3 i18n 硬编码字符串的清理

在实现语言检测链的过程中，我们也在两个应用中发现并修复了大量硬编码的 UI 字符串。

**admin-blog 的修复范围：**

| 位置 | 修复内容 |
|------|----------|
| [`Sidebar.tsx`](apps/admin-blog/src/components/layout/Sidebar.tsx) | Toast 消息、折叠按钮 title、折叠按钮文字、Logout loading 状态 |
| [`Header.tsx`](apps/admin-blog/src/components/layout/Header.tsx) | Toast 消息、DisplayName fallback |
| [`SettingsClient.tsx`](apps/admin-blog/src/...) | CONFIG_META 中的硬编码 label |
| [`BlogTranslationProgress.tsx`](apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx) | AiServiceStatusCard 和 ProviderSelector 中的英文硬编码 |

**admin-next 的修复范围：**

| 位置 | 修复内容 |
|------|----------|
| [`Sidebar.tsx`](apps/admin-next/src/components/layout/Sidebar.tsx) | Toast 消息、折叠按钮文字、Logout loading |
| [`Header.tsx`](apps/admin-next/src/components/layout/Header.tsx) | Toast 消息、DisplayName fallback |
| en/zh/ja/fr/ko/de 6 个 locale 文件 | 新增所有硬编码字符串的翻译键 |

通用 i18n key 模式：

```json
{
  "common": {
    "logoutLoading": "Logging out...",
    "collapse": "Collapse sidebar",
    "expand": "Expand sidebar"
  },
  "toast": {
    "logoutSuccess": "Logged out successfully",
    "logoutFailed": "Failed to log out"
  }
}
```

## 7. 内容语言跟随 Locale

语言检测链确定了 UI 的语言（导航、按钮、提示信息），但博客**内容**（文章标题、正文、分类名）的语言需要额外处理。

### 7.1 后端传递 Locale

所有博客内容 API 都支持 `locale` 参数，后端据此返回对应语言的翻译内容：

```typescript
// blogApi — 传递当前 locale
const getArticles = async (params: {
  locale: string;  // 当前 UI 语言
  page: number;
  pageSize: number;
}) => {
  return http.get('/blog/articles', {
    params: {
      lang: params.locale,  // 传递给后端
      page: params.page,
      pageSize: params.pageSize,
    },
  });
};
```

### 7.2 前端使用 LocalizedText

在渲染博客内容时，使用 `LocalizedText` 组件自动选择当前语言的内容：

```tsx
// 组件中的使用
function ArticleCard({ article, locale }: { article: Article; locale: string }) {
  return (
    <div>
      <h2>
        <LocalizedText
          text={article.titleLocalized}
          locale={locale}
          fallback={article.title}
        />
      </h2>
      <p>
        <LocalizedText
          text={article.contentLocalized}
          locale={locale}
          fallback={article.content}
        />
      </p>
    </div>
  );
}
```

### 7.3 迁移清单

将内容语言与 UI locale 绑定的改动涉及以下层面：

| 层 | 改动 | 文件 |
|----|------|------|
| API 参数 | 添加 `locale` 参数 | `blog.service.ts`、`blog.controller.ts` |
| API 调用 | 传递当前 locale | `api/index.ts` |
| 文章列表页 | locale 参数传递 | `page.tsx` |
| 文章详情页 | locale 参数传递 | `[slug]/page.tsx` |
| 文章编辑弹窗 | 修复硬编码 `'zh'` | `BlogArticleModal.tsx` |
| 翻译质量检测 | 使用 LocalizedText | `BlogTranslationQualityDetection.tsx` |

## 8. 边缘情况处理

### 8.1 不支持的浏览器语言

当用户的浏览器语言不在支持列表中时（如 `navigator.language = 'th'` 泰语），回退到默认语言 `zh`：

```typescript
const browserLang = navigator.language?.split('-')[0];
if (!browserLang || !SUPPORTED_LOCALES.includes(browserLang)) {
  return DEFAULT_LOCALE; // Fallback to zh
}
```

### 8.2 语言子标签

`navigator.language` 可能返回 `en-US`、`zh-CN` 等子标签格式。我们使用 `.split('-')[0]` 提取主要语言代码：

```typescript
// navigator.language = "en-US" → "en"
// navigator.language = "zh-CN" → "zh"
// navigator.language = "zh-Hans-CN" → "zh"
const primaryLang = navigator.language?.split('-')[0];
```

### 8.3 Cookie 与 URL 不一致

用户可能通过分享链接直接访问 `site.com/ja/path`，但 Cookie 中存储的是 `en`。此时 URL 的 locale 优先级最高，客户端 Provider 不会覆盖。

### 8.4 SSR 环境中的 navigator

`navigator.language` 仅在客户端可用。在 SSR 环境中，始终使用 Middleware 设置的 Cookie 或 Accept-Language Header：

```typescript
// 安全的浏览器语言检测（仅在客户端执行）
export function useBrowserLocale(): SupportedLocale {
  const isClient = useIsClient(); // 自定义 Hook

  if (!isClient) {
    return DEFAULT_LOCALE; // SSR fallback
  }

  const browserLang = navigator.language?.split('-')[0];
  if (browserLang && SUPPORTED_LOCALES.includes(browserLang)) {
    return browserLang as SupportedLocale;
  }

  return DEFAULT_LOCALE;
}
```

## 9. 验证清单

### Middleware 层

- [ ] 访问 `/path`（无 locale 前缀）→ 自动重定向到 `/{locale}/path`
- [ ] 访问 `/en/path` → 不重定向，正常显示英文
- [ ] 不支持的浏览器语言 → 重定向到 `/zh/path`
- [ ] Cookie 正确设置 `maxAge=365d`、`path=/`、`sameSite=lax`

### request.ts 层

- [ ] Cookie 存在 → 使用 Cookie 中的 locale
- [ ] Cookie 不存在，Accept-Language 存在 → 使用匹配的 locale
- [ ] 两者都不存在 → 回退到 `zh`

### 客户端 Provider 层

- [ ] 首次加载 → 浏览器语言与 Cookie 一致时不做任何操作
- [ ] 浏览器语言与 Cookie 不一致 → 更新 Cookie 并重定向
- [ ] 不支持的语言 → 不触发任何切换
- [ ] 用户手动切换 → 不覆盖用户选择

### 内容语言层

- [ ] 文章列表按当前 locale 显示对应翻译
- [ ] 文章详情按当前 locale 显示对应翻译
- [ ] 分类名按当前 locale 显示
- [ ] 所有 locale 文件键完整覆盖

## 10. 总结

浏览器语言检测链是 i18n 系统中容易被忽视但至关重要的环节。本文的三层架构实现了：

1. **Middleware 层**（Edge Runtime）：高效处理 URL 重定向和 Cookie 设置
2. **request.ts 层**（服务端运行时）：为 next-intl 提供正确的 locale 解析
3. **客户端 Provider 层**（浏览器运行时）：处理浏览器语言变化和用户偏好持久化

这一架构的关键设计原则：

- **低层提供默认值，高层覆盖底层**：Cookie 覆盖 Accept-Language，用户手动选择覆盖 Cookie
- **分层解耦**：每层仅依赖前一层的结果，可独立测试和替换
- **类型安全**：`SupportedLocale` 类型贯穿全链路，确保 locale 值在编译期可验证
- **渐进增强**：首次访问全自动，后续访完全受控

## 11. 相关文档

- [NestJS + Next.js 零侵入多语言架构](docs/blog/articles/architecture/nestjs-nextjs-i18n-architecture.md)
- [LanguageProvider + next-intl 实现](docs/blog/articles/admin-next/language-provider-next-intl.md)
- [Next.js 渲染模式指南](docs/blog/articles/frontend/nextjs-rendering-modes-guide.md)
- [Zustand + Cookie Storage SSR 认证存储](docs/blog/articles/frontend/zustand-cookie-storage-ssr-auth.md)
