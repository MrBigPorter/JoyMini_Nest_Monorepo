# Next.js 多语言零闪烁架构：Cookie 优先的唯一真理策略

> **架构关键词**：单一数据源、Cookie 优先、I18nProvider 路由同步  
> **适用场景**：Next.js App Router 多语言站点，需要零闪烁语言切换体验

---

## 1. 引言：多语言闪烁比你想的更常见

多语言站点的"闪一下"问题比认证闪动更隐蔽，却同样常见：

| 场景 | 表现 |
|------|------|
| 页面刷新 | 先显示默认语言 → 0.5 秒后切换到正确语言 |
| 语言切换 | 切换后 URL 没更新，或 API 请求用了旧语言 |
| 首次访问 | `Accept-Language` 检测与路由语言不一致 |
| 分享链接 | 用户 A 分享中文链接，用户 B 打开却显示英文 |

这些问题的根源只有一个——**语言检测逻辑分散且不一致**。

本文展示如何通过 **唯一真理原则** 和 **Cookie 优先策略**，彻底消除多语言闪烁。

---

## 2. 根因：为什么语言会闪烁

### 2.1 检测逻辑不统一

大多数多语言项目会犯以下错误之一：

```typescript
// ❌ 错误 1：每个模块自己检测语言
// middleware.ts
const locale = request.cookies.get("NEXT_LOCALE")?.value || "en";

// http.ts
const locale = window.location.pathname.split("/")[1] || "en";

// I18nProvider.tsx
const locale = localStorage.getItem("app-lang") || "en";
```

三个模块各自实现检测逻辑，**没有统一的优先级规则**。切换语言时，各个模块在不同时间点得出不同的语言结果，导致：
- API 请求用了旧语言
- 静态翻译文本用了新语言
- 页面渲染用了默认语言

### 2.2 使用不持久的状态源

```typescript
// ❌ 错误 2：依赖 localStorage
localStorage.setItem("app-lang", "zh-CN");
```

`localStorage` 的问题：
- SSR 时无法读取 → 服务端和客户端渲染结果不一致
- 不同标签页之间不同步
- 分享链接时丢失语言状态

### 2.3 没有明确的优先级

```
用户访问 /en/article-1
他的 Cookie 是 NEXT_LOCALE=zh-CN
他的浏览器 Accept-Language 是 ko

应该显示哪种语言？
```

没有明确优先级时，不同模块会给出不同答案，导致界面不一致。

---

## 3. 架构设计：唯一真理原则

### 3.1 核心原则

```
┌───────────────────────────────────────────────────────┐
│                   detectLocale()                       │
│             全局唯一语言检测函数                        │
│             整个系统唯一可信数据源                      │
└─────────────────────┬─────────────────────────────────┘
                      │
     ┌────────────────┼────────────────┐
     │                │                │
  ┌──▼────┐       ┌───▼────┐      ┌───▼──────┐
  │ 中间件 │      │ HTTP 客户端 │   │ I18nProvider │
  │ 路由  │      │ API 请求  │   │ 静态翻译    │
  └────────┘      └──────────┘      └──────────┘
```

**唯一真理原则**：整个系统只有一个语言检测数据源 `detectLocale()`，所有模块必须统一使用，禁止任何重复实现。

### 3.2 优先级设计

| 优先级 | 数据源 | 说明 | 场景 |
|--------|--------|------|------|
| 🔝 1 | `NEXT_LOCALE` Cookie | 用户明确意图，最高优先级 | 已登录用户、已切换过语言的用户 |
| 2 | URL 路径 | 呈现层状态 | 直接访问链接 /en/article |
| 3 | `Accept-Language` 头 | 首次访问检测 | 新用户第一次打开站点 |
| 4 | 默认语言 | 兜底 | 以上所有都失败 |

**为什么 Cookie 比 URL 路径优先级更高？**

假设用户把 `/en/bookmarks` 链接分享给朋友。朋友打开后发现页面是英文的，于是切换到中文。此时：
- URL 仍然指向 `/en/bookmarks`
- Cookie 已经被设置为 `zh-CN`

如果 URL 优先级高于 Cookie，用户每次打开这个书签都会先闪一下英文，再跳回中文。

### 3.3 语言切换时序（零闪烁保证）

```
1. 用户点击"切换到中文"
       │
       ▼
2. 立即设置 NEXT_LOCALE=Cookie=zh-CN      ← 同步操作，无延迟
       │
       ▼
3. 所有后续 API 请求立即使用 zh-CN        ← Cookie 已更新
       │
       ▼
4. 所有静态翻译文本立即更新                ← I18nProvider 响应 Cookie 变更
       │
       ▼
5. I18nProvider 发现 Cookie 与 URL 不一致  ← 检测到不一致
       │
       ▼
6. 自动同步路由到 /zh-CN/bookmarks         ← 异步路由更新，不阻塞 UI
       │
       ▼
7. 整个过程零闪烁、零延迟、零不一致
```

---

## 4. 实战：唯一语言检测函数

### 4.1 `detectLocale()` 实现

```typescript
// src/lib/utils/locale.ts
import { cookies } from "next/headers";
import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";

// 支持的语言列表
export const LOCALES = ["en", "zh-CN", "ko", "ja", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/**
 * 全局唯一语言检测函数
 *
 * 所有模块必须通过此函数获取语言，禁止重复实现检测逻辑。
 * 优先级: Cookie > URL路径 > Accept-Language > 默认语言
 */
export function detectLocale(
  options: {
    cookieValue?: string | null;
    pathname?: string;
    headersList?: Headers;
  } = {},
): Locale {
  const { cookieValue, pathname, headersList } = options;

  // 优先级 1：Cookie（用户明确意图）
  if (cookieValue && isValidLocale(cookieValue)) {
    return cookieValue as Locale;
  }

  // 优先级 2：URL 路径
  if (pathname) {
    const pathLocale = pathname.split("/")[1];
    if (pathLocale && isValidLocale(pathLocale)) {
      return pathLocale as Locale;
    }
  }

  // 优先级 3：Accept-Language 头
  if (headersList) {
    try {
      const negotiator = new Negotiator({ headers: Object.fromEntries(headersList) });
      const languages = negotiator.languages();
      const matched = match(languages, LOCALES as string[], DEFAULT_LOCALE);
      return matched as Locale;
    } catch {
      // negotiator 或 intl-localematcher 可能抛异常
    }
  }

  // 优先级 4：默认语言
  return DEFAULT_LOCALE;
}

/**
 * 验证语言代码是否在支持列表中
 */
export function isValidLocale(locale: string): locale is Locale {
  return LOCALES.includes(locale as Locale);
}
```

### 4.2 Middleware 集成

```typescript
// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { detectLocale, DEFAULT_LOCALE } from "@/lib/utils/locale";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 检查路径中是否包含语言前缀
  const pathLocale = pathname.split("/")[1];
  const hasLocalePrefix = LOCALES.includes(pathLocale);

  // 从 Cookie 读取用户偏好
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;

  // 检测应该使用的语言
  const detectedLocale = detectLocale({
    cookieValue: cookieLocale,
    pathname,
    headersList: request.headers,
  });

  // 路径前缀与检测结果不匹配 → 重定向
  if (hasLocalePrefix && pathLocale !== detectedLocale) {
    const newPathname = pathname.replace(`/${pathLocale}`, `/${detectedLocale}`);
    const response = NextResponse.redirect(new URL(newPathname, request.url));
    response.cookies.set("NEXT_LOCALE", detectedLocale);
    return response;
  }

  // 路径没有语言前缀 → 添加检测到的语言
  if (!hasLocalePrefix) {
    const response = NextResponse.redirect(
      new URL(`/${detectedLocale}${pathname}`, request.url),
    );
    response.cookies.set("NEXT_LOCALE", detectedLocale);
    return response;
  }

  const response = NextResponse.next();
  // 确保 Cookie 最新
  response.cookies.set("NEXT_LOCALE", detectedLocale);
  return response;
}
```

### 4.3 HTTP 客户端集成

```typescript
// src/lib/api/http.ts
import { detectLocale } from "@/lib/utils/locale";

class HttpClient {
  private getLocale(): Locale {
    // 在服务端：从 Cookie 读取
    if (typeof window === "undefined") {
      const cookieValue = this.getCookie("NEXT_LOCALE");
      return detectLocale({ cookieValue });
    }

    // 在客户端：从 Cookie 读取（和服务端一致）
    const cookieValue = this.getCookie("NEXT_LOCALE");
    return detectLocale({ cookieValue });
  }

  async get<T>(url: string, params?: Record<string, string>): Promise<T> {
    const locale = this.getLocale();
    const response = await fetch(`${url}?lang=${locale}`, {
      headers: {
        "Accept-Language": locale,
        "x-locale": locale,
      },
      credentials: "include",
    });
    return response.json();
  }
}

export const httpClient = new HttpClient();
```

### 4.4 I18nProvider 路由同步

```typescript
// src/lib/providers/I18nProvider.tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { detectLocale, LOCALES } from "@/lib/utils/locale";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const getCookie = (name: string): string | null => {
      const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
      return match ? decodeURIComponent(match[2]) : null;
    };

    const cookieLocale = getCookie("NEXT_LOCALE");
    const pathLocale = pathname.split("/")[1];

    // 检测应该使用的语言
    const detectedLocale = detectLocale({ cookieValue: cookieLocale, pathname });

    // Cookie 与路径不一致 → 同步路由
    if (detectedLocale !== pathLocale && LOCALES.includes(pathLocale)) {
      const newPathname = pathname.replace(`/${pathLocale}`, `/${detectedLocale}`);
      router.replace(newPathname);
    }
  }, [pathname, router]);

  return <>{children}</>;
}
```

---

## 5. 绝对禁止与特殊例外

### 5.1 禁止清单

```typescript
// ❌ 禁止 1：在任何地方重复实现语言检测逻辑
function getLanguage() {
  // 不要在组件/Hook中自己解析路径
  const locale = window.location.pathname.split("/")[1];
  return locale;
}

// ❌ 禁止 2：直接读取 window.location 判断语言
const currentLang = window.location.pathname.includes("/zh") ? "zh" : "en";

// ❌ 禁止 3：硬编码默认语言
const locale = "en"; // 应该用 DEFAULT_LOCALE 常量

// ❌ 禁止 4：依赖 localStorage 存储语言状态
localStorage.setItem("language", "zh-CN");

// ❌ 禁止 5：导入不存在的导出函数
import { getLocale } from "@/lib/utils/locale"; // 应该用 detectLocale
```

### 5.2 唯一例外：根页面

```typescript
// src/app/page.tsx
// ⚠️ 根页面不能使用 detectLocale()
// 因为 Next.js 15 根路由上下文还没初始化完成

import { redirect } from "next/navigation";
import { LOCALES, DEFAULT_LOCALE } from "@/lib/utils/locale";
import { cookies } from "next/headers";

export default async function RootPage() {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;

  // ⭐ 手动实现最小化检测逻辑
  const locale = cookieLocale && LOCALES.includes(cookieLocale)
    ? cookieLocale
    : DEFAULT_LOCALE;

  redirect(`/${locale}`);
}
```

这是整个系统中 **唯一允许** 手动实现检测逻辑的地方。

---

## 6. 完整工作流程

### 正常访问

```
用户输入 blog.example.com/en/article-1
       │
       ▼
Middleware 读取 Cookie: NEXT_LOCALE=zh-CN
       │
       ▼
detectLocale() → Cookie 优先 → 返回 zh-CN
       │
       ▼
Cookie (zh-CN) ≠ URL 路径 (en) → 重定向到 /zh-CN/article-1
       │
       ▼
用户访问 /zh-CN/article-1  ✅ Cookie 和 URL 一致
```

### 语言切换

```
用户在 /en/bookmarks 页面点击"切换到中文"
       │
       ▼
前端设置 document.cookie = "NEXT_LOCALE=zh-CN"
       │
       ▼
所有后续 API 请求立即使用 zh-CN
       │
       ▼
I18nProvider 检测到 Cookie ≠ URL 路径
       │
       ▼
router.replace("/zh-CN/bookmarks")
       │
       ▼
✅ 整个过程零闪烁，API 请求和 UI 语言一致
```

### 新用户首次访问

```
用户（浏览器语言=ko）首次访问 blog.example.com
       │
       ▼
Middleware: 无 Cookie, 无 URL 前缀
       │
       ▼
detectLocale() → Accept-Language 匹配 → ko
       │
       ▼
重定向到 /ko 并设置 Cookie: NEXT_LOCALE=ko
       │
       ▼
✅ 用户看到韩文界面，无需手动选择
```

---

## 7. 边界情况处理

### 7.1 不支持的路径前缀

```typescript
// 用户访问 /fr/some-page（fr 不在 LOCALES 中）
const pathLocale = pathname.split("/")[1]; // "fr"
const isValid = LOCALES.includes(pathLocale); // false

// → 使用 Cookie 或 Accept-Language 检测
// → 重定向到正确的语言路径
```

### 7.2 语言切换后 API 请求时序

```
语言切换时序：
t=0ms  用户点击"切换"
t=0ms  Cookie 设置完成（同步）
t=1ms  API 请求 A 发出 → 使用新语言 ✅
t=5ms  API 请求 B 发出 → 使用新语言 ✅
t=50ms I18nProvider 检测到不一致 → 开始同步路由
t=100ms 路由更新完成

关键：Cookie 同步设置保证了所有新请求立即使用新语言。
路由更新是"显示层"的修正，不影响数据层的一致性。
```

### 7.3 多个标签页

```typescript
// 标签页 A 切换到中文
document.cookie = "NEXT_LOCALE=zh-CN";

// 标签页 B（仍显示英文）
// 下一次页面导航或请求时，Middleware 会读取 Cookie
// → 自动将标签页 B 切换到中文

// 但如果是 SPA 导航（无服务器请求）
// I18nProvider 的 useEffect 在 pathname 变化时触发
// → 同样会同步到中文
```

---

## 8. 迁移指南

### 从旧架构迁移

```diff
// Step 1: 统一检测函数
- const locale = window.location.pathname.split("/")[1];
+ import { detectLocale } from "@/lib/utils/locale";
+ const locale = detectLocale({ cookieValue: getCookie("NEXT_LOCALE") });

// Step 2: 替换 localStorage
- localStorage.setItem("language", "zh-CN");
+ document.cookie = "NEXT_LOCALE=zh-CN; path=/; max-age=31536000";

// Step 3: 移除重复逻辑
- // 到处都有语言检测，移除它们
+ // 所有地方都只用 detectLocale()
```

### 检查清单

- [ ] 所有语言检测统一使用 `detectLocale()`
- [ ] `NEXT_LOCALE` Cookie 是语言状态的唯一存储
- [ ] 优先级始终是 Cookie > 路径 > Accept-Language > 默认
- [ ] 根页面 `page.tsx` 是唯一特殊例外
- [ ] 没有使用 `localStorage` 存储语言
- [ ] I18nProvider 负责同步 Cookie 和路由

---

## 9. 总结

多语言零闪烁的核心密码只有三条：

| 原则 | 说明 | 效果 |
|------|------|------|
| **唯一真理** | 只有一个 `detectLocale()` | 所有模块语言状态一致 |
| **Cookie 优先** | `NEXT_LOCALE` Cookie 最高优先级 | 切换即时生效，SSR 可读 |
| **I18nProvider 同步** | 自动同步 Cookie 与路由 | 零闪烁，零不一致 |

**什么时候需要这套架构？**

- ✅ 多语言 Next.js 站点（2 种语言以上）
- ✅ 需要语言切换功能
- ✅ 关注语言切换时的用户体验
- ✅ SSR/SSG/ISR 混合部署

**什么时候不需要？**

- ❌ 单语言站点
- ❌ 仅客户端渲染的 SPA
- ❌ 使用 `next-intl` 等成熟方案且无需自定义

---

*本文基于实际项目迭代总结，相关源码参考 [`src/lib/utils/locale.ts`](apps/frontend-blog/src/lib/utils/locale.ts)、[`apps/frontend-blog/middleware.ts`](apps/frontend-blog/middleware.ts)。*
