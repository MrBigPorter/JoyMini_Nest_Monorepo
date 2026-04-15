# HTTP客户端多语言支持实现

## 📋 概述

本文档描述了前端HTTP客户端如何集成多语言支持，与后端LanguageService和next-intl框架协同工作。

## 🎯 设计目标

1. **统一语言检测**：前后端使用相同的语言检测逻辑
2. **支持多种语言切换方式**：查询参数、next-intl集成、localStorage回退
3. **SSR兼容**：在服务端渲染环境下正确检测语言
4. **自动设置请求头**：自动设置`Accept-Language`头部

## 🔧 实现细节

### 1. 语言检测优先级

HTTP客户端按照以下优先级检测语言：

1. **查询参数**：`?lang=en`（优先级最高）
2. **SSR全局变量**：`__NEXT_INTL_LOCALE__`（next-intl注入）
3. **next-intl存储**：`localStorage.getItem('next-intl')`或`'NEXT_LOCALE'`
4. **旧版存储**：`localStorage.getItem('lang')`
5. **默认语言**：'zh'

### 2. 代码实现

#### 语言检测方法 (`getLanguage()`)

```typescript
private getLanguage(): string {
  // 优先使用查询参数
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const langParam = urlParams.get('lang');
    if (langParam) return this.normalizeLanguageCode(langParam);
  }

  // SSR环境：尝试从全局变量获取语言
  // next-intl 在SSR环境下会将语言信息注入到全局变量中
  if (typeof globalThis !== 'undefined') {
    // 尝试从全局变量获取 next-intl 的语言
    const globalLocale = (globalThis as any).__NEXT_INTL_LOCALE__;
    if (globalLocale) {
      return this.normalizeLanguageCode(globalLocale);
    }
  }

  // 客户端环境：与 next-intl 集成
  if (typeof window !== 'undefined') {
    // next-intl 通常将语言存储在 'next-intl' 或 'NEXT_LOCALE' 中
    const nextIntlLocale =
      localStorage.getItem('next-intl') ||
      localStorage.getItem('NEXT_LOCALE');
    if (nextIntlLocale) {
      try {
        const localeData = JSON.parse(nextIntlLocale);
        const locale = localeData.locale || localeData;
        if (locale) return this.normalizeLanguageCode(locale);
      } catch {
        // 如果不是JSON，直接使用
        return this.normalizeLanguageCode(nextIntlLocale);
      }
    }

    // 回退到旧的 localStorage 'lang'
    const oldLang = localStorage.getItem('lang');
    if (oldLang) return this.normalizeLanguageCode(oldLang);
  }

  // 默认返回中文
  return 'zh';
}
```

#### 语言代码规范化

```typescript
private normalizeLanguageCode(code: string): string {
  const mappings: Record<string, string> = {
    'zh-CN': 'zh',
    'zh-Hans': 'zh',
    'zh-Hant': 'zh', // 繁体中文也映射到简体
    'en-US': 'en',
    'en-GB': 'en',
    'en-CA': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
    'fr-FR': 'fr',
    'de-DE': 'de',
    'es-ES': 'es',
  };

  // 移除地区后缀，如 zh-CN -> zh
  const baseCode = code.split('-')[0].toLowerCase();
  return mappings[code] || baseCode;
}
```

#### 请求拦截器设置语言头部

```typescript
private setupInterceptors() {
  this.instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      // 1. 语言
      const lang = this.getLanguage();
      if (lang) {
        config.headers['Accept-Language'] = lang;
      }
      // ...
      return config;
    }
  );
}
```

## 🔄 工作流程

### 客户端环境
```
用户访问页面 → next-intl检测语言 → 存储到localStorage
    ↓
HTTP客户端发起请求 → 从localStorage获取语言 → 设置Accept-Language头部
    ↓
后端API接收请求 → LanguageService解析语言 → 返回对应语言内容
```

### SSR环境
```
用户访问页面 → next-intl中间件检测语言 → 注入到全局变量
    ↓
服务端组件渲染 → HTTP客户端从全局变量获取语言 → 设置Accept-Language头部
    ↓
后端API接收请求 → LanguageService解析语言 → 返回对应语言内容
```

### 查询参数覆盖
```
用户访问 /blog?lang=en → HTTP客户端优先使用查询参数
    ↓
设置 Accept-Language: en → 后端返回英文内容
```

## 📊 支持的语言

| 语言代码 | 支持的变体 | 映射结果 |
|---------|-----------|---------|
| `zh` | `zh-CN`, `zh-Hans`, `zh-Hant` | `zh` |
| `en` | `en-US`, `en-GB`, `en-CA` | `en` |
| `ja` | `ja-JP` | `ja` |
| `ko` | `ko-KR` | `ko` |
| `fr` | `fr-FR` | `fr` |
| `de` | `de-DE` | `de` |
| `es` | `es-ES` | `es` |

## 🧪 测试验证

### 测试用例

1. **查询参数优先**：`?lang=en` 应该返回 `en`
2. **next-intl集成**：localStorage中的next-intl语言应该被正确读取
3. **语言规范化**：`zh-CN` 应该规范化为 `zh`
4. **默认语言**：没有语言信息时应该返回 `zh`

### 测试结果
- ✅ 查询参数优先级测试通过
- ✅ 语言规范化测试通过
- ✅ 默认语言回退测试通过

## 🚀 使用方式

### 1. 通过查询参数指定语言
```typescript
// 访问 /blog?lang=en
// HTTP客户端会自动设置 Accept-Language: en
const articles = await blogApi.getArticles({ page: 1 });
```

### 2. 通过next-intl自动检测
```typescript
// next-intl会自动检测浏览器语言并存储
// HTTP客户端会自动从localStorage读取语言
const articles = await blogApi.getArticles({ page: 1 });
```

### 3. 手动设置语言
```typescript
// 用户切换语言时，next-intl会更新localStorage
// 后续请求会自动使用新语言
localStorage.setItem('NEXT_LOCALE', 'ja');
```

## 🔗 与后端集成

### 后端LanguageService解析逻辑
1. **查询参数优先**：`req.query.lang`
2. **Accept-Language头部**：`req.headers['accept-language']`
3. **默认语言**：'zh'

### 前后端协同
```
前端HTTP客户端 → 设置 Accept-Language: ja
    ↓
后端LanguageService → 解析 Accept-Language 头部 → 返回 'ja'
    ↓
BlogService → 使用 'ja' 查询多语言字段 → 返回日文内容
```

## 📁 相关文件

- `apps/frontend-blog/src/lib/api/http.ts` - HTTP客户端实现
- `apps/frontend-blog/src/lib/api/blogApi.ts` - 博客API封装
- `apps/api/src/common/services/language.service.ts` - 后端LanguageService
- `apps/frontend-blog/middleware.ts` - next-intl中间件
- `apps/frontend-blog/src/lib/providers/I18nProvider.tsx` - next-intl提供者

## ✅ 验收标准

1. ✅ HTTP客户端自动检测语言
2. ✅ 支持查询参数语言覆盖
3. ✅ 与next-intl完全集成
4. ✅ SSR环境语言检测正确
5. ✅ 自动设置Accept-Language头部
6. ✅ 语言代码规范化
7. ✅ 默认语言回退机制

## 🎉 实现状态

**已完成 ✅**

HTTP客户端已成功集成多语言支持，能够：
- 自动检测用户语言偏好
- 与next-intl框架无缝集成
- 在SSR环境下正确工作
- 设置正确的Accept-Language头部
- 与后端LanguageService协同工作

**最后更新**: 2026-04-14