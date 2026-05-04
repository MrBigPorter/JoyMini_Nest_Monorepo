---
title: 'admin-next LanguageProvider——向后兼容的 next-intl 桥接层'
slug: admin-next-language-provider
tags: Next.js, Admin, React, TypeScript, i18n, Internationalization, next-intl
description: A deep dive into the admin-next LanguageProvider — a backward-compatible shim that bridges next-intl with the legacy codebase. Covers the useLanguage hook, setLocale with cookie-based persistence, the getLocalizedValue utility, and migration strategy from custom i18n to next-intl.
---

# admin-next LanguageProvider——向后兼容的 next-intl 桥接层

> **Article A14** — The admin-next `LanguageProvider` is a thin compatibility layer that bridges `next-intl` with the existing codebase. Rather than replacing all locale calls at once, it provides a backward-compatible wrapper that allows incremental migration from a custom i18n system to `next-intl`.

- **Source**: [`LanguageProvider.tsx`](apps/admin-next/src/hooks/LanguageProvider.tsx) (97L)
- **Library**: `next-intl` — Next.js App Router internationalization
- **Pattern**: Shim/Wrapper — backward-compatible API surface
- **Series**: admin-next Architecture Deep Dive

---

## 1. 背景

admin-next 项目在初始化时使用了一套**自建 i18n 系统**：通过 `LanguageContext` 提供 locale 和 translations，通过自定义的 Provider 管理语言切换和消息加载。

随着项目迁移到 Next.js App Router，我们决定采用业界标准的 [`next-intl`](https://next-intl.dev) 库来替代自建方案。`next-intl` 提供了：

- Server Component 友好的 i18n（`next-intl` 的 `useLocale`、`useTranslations`）
- 基于文件的消息管理
- 自动 locale 检测与路由集成

但在实际迁移过程中，**API 不兼容** 问题导致无法一次性完成替换。大量存量组件使用了自定义的 `useLanguage()` hook，返回了 `{ locale, setLocale, translations }` 结构。

解决方案：保留原有的 `LanguageProvider` 和 `useLanguage` 导出，但将其**内部实现替换为 next-intl 的桥接层**。

---

## 2. 架构设计

### 2.1 职责分层

```text
┌─────────────────────────────────────────┐
│            Legacy Consumer              │
│  (useLanguage() → { locale, setLocale }) │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│         LanguageProvider (shim)         │
│   ┌──────────────────────────────────┐  │
│   │  useLanguage() hook              │  │
│   │  ├  locale ← next-intl useLocale │  │
│   │  ├  setLocale → cookie + refresh │  │
│   │  └  translations → undefined     │  │
│   └──────────────────────────────────┘  │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│         next-intl (real engine)         │
│   ├  useLocale() / useTranslations()    │
│   ├  NextIntlClientProvider             │
│   └  i18n/request.ts (server config)    │
└─────────────────────────────────────────┘
```

### 2.2 核心原则

| 原则 | 说明 |
|------|------|
| **向后兼容** | 所有现有 `import { useLanguage } from '@/hooks/LanguageProvider'` 无需修改 |
| **增量迁移** | 新组件直接使用 `next-intl`，旧组件继续使用 shim |
| **无状态 Provider** | `LanguageProvider` 组件本身变为空壳，真正的 Provider 是 `NextIntlClientProvider` |
| **Cookie 驱动** | locale 通过 `app_locale` cookie 在客户端和服务器之间同步 |

---

## 3. LanguageProvider 组件

[`LanguageProvider`](apps/admin-next/src/hooks/LanguageProvider.tsx:47) 是 React 组件，但在新架构中它是一个**空壳包装器**：

```tsx
export const LanguageProvider: React.FC<LanguageProviderProps> = ({
  children,
}) => {
  return <>{children}</>;
};
```

### 3.1 为何保留空壳？

尽管组件本身不渲染任何内容，保留它有几个好处：

1. **避免 import 错误**：布局文件中的 `<LanguageProvider>` 无需删除
2. **逐步迁移**：允许团队按组件逐个迁移到 `next-intl`
3. **兼容性**：如果未来需要在 Provider 层添加逻辑（如 locale 变更事件），可以直接扩展

### 3.2 Props 兼容性

```typescript
export interface LanguageProviderProps {
  children: ReactNode;
  /** @deprecated no longer needed; locale is driven by next-intl */
  initialLocale?: Locale;
  /** @deprecated no longer needed; messages are provided by next-intl */
  initialTranslations?: Record<string, string>;
}
```

`initialLocale` 和 `initialTranslations` 被标记为 `@deprecated`，但保持参数签名不变，避免编译错误。

---

## 4. useLanguage Hook

[`useLanguage`](apps/admin-next/src/hooks/LanguageProvider.tsx:53) 是桥接层的核心，它封装了 `next-intl` 的 API，对外暴露与旧系统一致的接口：

```typescript
export function useLanguage() {
  let locale: Locale = DEFAULT_LOCALE;
  try {
    locale = useLocale() as Locale;
  } catch {
    locale = DEFAULT_LOCALE;
  }

  const router = useRouter();

  const setLocale = useCallback(
    (newLocale: Locale) => {
      if (typeof document !== 'undefined') {
        document.cookie = `app_locale=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
        try {
          localStorage.setItem('app_locale', newLocale);
        } catch {
          // ignore
        }
      }
      const appStore = useAppStore.getState();
      if (appStore.lang !== newLocale) {
        appStore.setLang(newLocale);
      }
      router.refresh();
    },
    [router],
  );

  return { locale, setLocale, translations: undefined };
}
```

### 4.1 locale 读取

```typescript
try {
  locale = useLocale() as Locale;
} catch {
  locale = DEFAULT_LOCALE;
}
```

`useLocale()` 是 `next-intl` 的 hook，在 Server Component 和 Client Component 中都能工作。`try/catch` 确保在 `next-intl` 尚未初始化（如测试环境或 SSR 错误）时也能返回默认 locale，避免应用崩溃。

### 4.2 setLocale——Cookie + 刷新

语言切换的核心流程：

```
用户选择新语言
    │
    ▼
setLocale('en' / 'zh-TW' / 'ja')
    │
    ├── 写入 app_locale cookie（有效期 1 年，SameSite=Lax）
    ├── 写入 localStorage（客户端快速读取）
    ├── 更新 Zustand store（appStore.lang）
    └── router.refresh() → 触发 Server Component 重新渲染
        │
        ▼
      服务端 i18n/request.ts 读取 app_locale cookie
        │
        ▼
      返回对应语言的翻译消息
        │
        ▼
      页面以新语言重新渲染
```

关键设计点：

- **Cookie 优先**：服务器端只能读取 cookie，不能读取 `localStorage`。因此写入 cookie 是**强制性的**
- **localStorage 辅助**：客户端初始化时可快速从 `localStorage` 读取上一次选择的语言
- **router.refresh()**：通过 Next.js 的 `router.refresh()` 触发 Server Component 的重新渲染周期
- **Zustand 同步**：`appStore.setLang()` 确保客户端状态同步，用于不需要服务端渲染的 i18n 场景

### 4.3 translations 废弃

```typescript
return { locale, setLocale, translations: undefined };
```

`translations` 被设置为 `undefined`。这是因为翻译消息现在由 `next-intl` 的 `useTranslations()` hook 直接提供，不再需要通过 Context 下发。

调用 `translations.someKey` 的旧代码会在运行时抛出错误，引导开发者迁移到 `next-intl`。这是**故意设计**——推动团队完成迁移，而不是继续依赖已废弃的 API。

---

## 5. getLocalizedValue 工具

[`getLocalizedValue`](apps/admin-next/src/hooks/LanguageProvider.tsx:87) 是一个纯工具函数，用于从 `Record<Locale, T>` 结构中提取当前语言的值：

```typescript
export function getLocalizedValue<T>(
  value: Record<string, T | undefined> | undefined,
  locale: Locale,
): T | undefined {
  if (!value) return undefined;
  return value[locale] as T;
}
```

### 5.1 使用场景

```typescript
const productName = getLocalizedValue(product.name, locale);
// product.name = { en: 'T-shirt', 'zh-TW': 'T恤', ja: 'Tシャツ' }
// → 'T恤' (locale = 'zh-TW')
```

这种模式在以下场景中广泛使用：

- **API 返回的多语言数据**：从 Prisma 查询出的 JSON 字段
- **多语言枚举值**：如分类名称、Banner 标题、系统配置
- **动态内容**：用户创建的多语言内容

### 5.2 类型安全

函数签名中使用 `Record<string, T | undefined>` 而非 `Record<Locale, T>`，是因为：

1. **Partial data**：API 可能不返回所有语言的翻译
2. **Undefined fallback**：当某个语言的值不存在时，调用者需处理 `undefined`
3. **向后兼容**：旧数据可能没有完整的 Locale 键

---

## 6. 迁移策略

### 6.1 迁移路径

```
Phase 1 (当前)     Phase 2               Phase 3
─────────────     ───────────           ───────────
LanguageProvider  新组件直接使用          删除 LanguageProvider
(shim)             next-intl             完全迁移到 next-intl
useLanguage()      useTranslations()
```

### 6.2 新组件推荐用法

对于新编写的组件，建议直接使用 `next-intl`：

```tsx
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';

function MyComponent() {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  return (
    <div>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
    </div>
  );
}
```

对比旧系统的用法：

```tsx
// 旧系统（仍可用，但不推荐用于新代码）
import { useLanguage } from '@/hooks/LanguageProvider';

function MyComponent() {
  const { locale, translations } = useLanguage();
  return <h1>{translations?.['dashboard.title']}</h1>;
}
```

### 6.3 迁移检查清单

| 检查项 | 旧 API | 新 API |
|--------|--------|--------|
| 获取 locale | `useLanguage().locale` | `useLocale()` |
| 翻译文本 | `translations?.['key']` | `useTranslations('ns')('key')` |
| 切换语言 | `useLanguage().setLocale(locale)` | `document.cookie + router.refresh()` |
| 多语言数据 | `getLocalizedValue(data, locale)` | 同上（无替代方案，继续使用） |
| Provider 包装 | `<LanguageProvider>` | `<NextIntlClientProvider>` |

---

## 7. 设计决策

### 7.1 为什么选择 Cookie 而非 URL 参数？

| 方案 | 优点 | 缺点 |
|------|------|------|
| **Cookie**（当前） | 不改变 URL 结构，SEO 友好 | 客户端 JS 需操作 cookie |
| **URL 参数**（如 `?lang=en`） | 无状态，可分享链接 | URL 冗余，需处理参数同步 |
| **子域名**（如 `en.admin.example.com`） | 浏览器自动处理 | DNS 配置复杂 |

admin-next 是**内部管理后台**，不涉及 SEO，因此 Cookie 方案是最简单的——无需修改路由结构，只需在服务端读取 cookie 即可确定语言。

### 7.2 为什么保留 LanguageContext？

`LanguageContext` 虽然不再被 `LanguageProvider` 使用，但定义仍然保留：

```typescript
export const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);
```

这是为了：如果某个依赖 `useContext(LanguageContext)` 的第三方代码存在，删除 Context 会导致运行时错误。保留它确保完整的向后兼容性。

---

## 8. 总结

admin-next 的 `LanguageProvider` 桥接层是一个**渐进式迁移**的典型案例——在不破坏现有代码的前提下，引入新的标准化 i18n 方案。

### 关键要点

- **向后兼容 shim**：保留旧的 `LanguageProvider` 和 `useLanguage` 导出签名
- **next-intl 驱动**：locale 由 `next-intl` 的 `useLocale()` 提供
- **Cookie 持久化**：`app_locale` cookie 实现服务端 locale 同步
- **router.refresh()**：语言切换后刷新 Server Component 渲染
- **getLocalizedValue**：处理 API 返回的多语言数据
- **增量迁移**：新组件直接使用 `next-intl`，旧组件通过 shim 过渡
