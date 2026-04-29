---
tags:
  - i18n
  - Next.js
  - Architecture
  - TypeScript
  - NestJS
  - next-intl
---

# NestJS + Next.js 零侵入多语言架构：从 37 处修改到 1 处，从 8 小时到 5 分钟

## 1. 背景：多语言不是加几个翻译文件那么简单

### 1.1 真实痛点

当我们的博客系统要从中文/英文扩展到日语、韩语、法语、德语时，遇到了典型的"多语言技术债务"：

```
问题清单：
1. 数据库字段：title / titleEn 扁平字段满天飞
2. 表单处理：每个字段都要手动加 if (locale === 'en')
3. 预览页面：固定的 zh/en 硬编码
4. 语言切换状态不持久化，刷新页面丢失
5. 新增一种语言需要修改 37 处代码
```

**核心问题**：系统没有统一的多语言抽象层，每个模块各自为政地处理翻译。

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| 零破坏性修改 | 所有现有代码、接口、数据 100% 兼容 |
| 零重复代码 | 不允许出现任何 `if (locale === 'en')` |
| 渐进式迁移 | 分阶段上线，随时可回滚 |
| 未来扩展 | 新增语言只需改 1 行代码 |
| 企业级工作流 | 开发 → 翻译 → 审核 → 发布的完整链路 |

---

## 2. 核心类型系统：LocalizedString

### 2.1 类型定义

整个系统的多语言能力建立在 `LocalizedString` 泛型类型之上：

```typescript
// packages/shared — 全局唯一的多语言字符串类型
type Locale = "zh" | "en" | "ja" | "ko" | "fr" | "de";

type LocalizedString<T = string> = {
  [locale in Locale]?: T;
};
```

特性：
- **类型安全**：语言代码是枚举，不是任意字符串
- **泛型支持**：不仅可以存字符串，还可以存数字、对象、数组
- **全局统一**：所有模块使用同一标准

### 2.2 在数据库中的应用

Prisma Schema 使用 JSON 字段存储多语言数据：

```prisma
model BlogArticle {
  // 新多语言字段（JSON）
  title           Json?    // { zh: "标题", en: "Title", ja: "タイトル" }
  excerpt         Json?    // { zh: "摘要", en: "Excerpt" }
  content         Json?    // { zh: "内容", en: "Content" }
  contentMd       Json?    // Markdown 原文
  featuredImage   Json?    // { zh: "zh-img.jpg", en: "en-img.jpg" }

  // 旧字段保留，双写兼容（迁移期后删除）
  titleEn         String?
  excerptEn       String?
  contentEn       String?
  contentMdEn     String?
  featuredImageEn String?
}
```

---

## 3. 零停机迁移策略

### 3.1 透明兼容层

我们不搞"凌晨三点停机迁移"的方案，而是通过透明兼容层实现零停机迁移：

```typescript
// 自动兼容旧格式：string → LocalizedString
function normalizeLocalized(value: unknown): LocalizedString {
  if (typeof value === 'string') {
    // 旧客户端传的纯字符串 → 自动包装成 { zh: "xxx" }
    return { zh: value };
  }
  if (typeof value === 'object' && value !== null) {
    // 新客户端传的 LocalizedString → 直接使用
    return value as LocalizedString;
  }
  return {};
}
```

**迁移三阶段**：

| 阶段 | 操作 | 状态 |
|------|------|------|
| 第一阶段 | 新增 JSON 字段，新旧字段双写 | ✅ |
| 第二阶段 | 运行迁移脚本，现有数据迁移到新格式 | ⏳ |
| 第三阶段 | 确认稳定后删除旧字段 | 🔮 |

新旧客户端可以同时运行，所有数据自动向新格式迁移。

### 3.2 获取本地化值的工具函数

```typescript
// 统一的 getLocalizedValue 工具函数
function getLocalizedValue<T>(
  field: LocalizedString<T> | null | undefined,
  locale: Locale,
  fallbackLocale: Locale = 'zh'
): T | undefined {
  if (!field) return undefined;
  return field[locale] ?? field[fallbackLocale];
}
```

前端所有组件只依赖这一个函数获取当前语言的内容。

---

## 4. 前端架构：全局语言上下文

### 4.1 LanguageContext 设计

整个系统只有一个语言状态，由 `LanguageContext` 管理：

```typescript
interface LanguageContext {
  /** 当前激活语言 */
  locale: Locale;

  /** 切换语言，整个系统自动响应 */
  setLocale: (locale: Locale) => void;

  /** 自动获取当前语言的内容 */
  localize: <T>(field: LocalizedString<T>, fallback?: Locale) => T | undefined;

  /** UI 文案翻译 */
  t: (key: string, params?: Record<string, any>) => string;
}
```

核心原则：
- **单一数据源**：Header 是唯一修改语言的地方
- **自动响应**：所有组件通过 context 自动获取当前语言
- **零传递**：不需要通过 props 传递 locale

### 4.2 路由参数同步

在 Next.js + next-intl 中，locale 来自路由参数 `/[locale]/`：

```typescript
// apps/frontend-blog/src/lib/i18n/config.ts
export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as any)) {
    return { locale: routing.defaultLocale, messages: {} };
  }

  return {
    locale,
    messages: {
      ...(await import(`../../messages/${locale}/common.json`)).default,
    },
  };
});
```

语言切换通过 next-intl 的 `useRouter` 实现：

```typescript
function LanguageSwitch() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useLanguage();

  const switchTo = (newLocale: string) => {
    router.replace(`/${newLocale}${pathname.replace(/^\/[a-z]+/, '')}`);
  };

  return (
    <select value={locale} onChange={(e) => switchTo(e.target.value)}>
      <option value="zh">中文</option>
      <option value="en">English</option>
      <option value="ja">日本語</option>
    </select>
  );
}
```

---

## 5. 零 if else 表单设计

### 5.1 useLocalizedForm Hook

这是整个多语言表单系统的核心——一个 Hook 解决所有表单的多语言绑定：

```typescript
function useLocalizedForm<T extends FieldValues>(form: UseFormReturn<T>) {
  const { locale } = useLanguage();

  return {
    /** 自动绑定到当前语言的字段 */
    localize: (fieldName: keyof T) => ({
      value: form.watch(fieldName)?.[locale] || "",
      onChange: (value: any) =>
        form.setValue(`${fieldName}.${locale}` as any, value),
    }),
  };
}
```

### 5.2 使用方式

```tsx
const form = useForm()
const { localize } = useLocalizedForm(form)

return (
  <>
    <FormInput label="标题" {...localize('title')} />
    <RichImageUploadTextEditor
      label="内容"
      {...localize('content')}
    />
    <FormUpload label="封面" {...localize('featuredImage')} />
  </>
)
```

这就是全部代码。没有判断，没有分支，没有三元表达式。

用户切换到日语时，`localize('title')` 自动绑定到 `title.ja` 字段；切换到中文时，绑定到 `title.zh` 字段。

### 5.3 修复过的 Bug：`[object Object]` 显示问题

在多语言表单实现过程中，遇到过一个典型的时序 Bug：

```typescript
// 修复前：使用 queueMicrotask 导致初始化延迟
useEffect(() => {
  queueMicrotask(() => {
    // 初始化逻辑...
  });
}, []);

// 修复后：同步初始化 + 字段变化监控
useEffect(() => {
  allFields.forEach((fieldName) => {
    const currentValue = getValues(fieldName as Path<T>);
    storageRef.current[fieldName as string] = currentValue;
  });

  const subscription = watch((value) => {
    allFields.forEach((fieldName) => {
      const fieldValue = value[fieldName];
      if (fieldValue !== undefined) {
        storageRef.current[fieldName as string] = fieldValue;
      }
    });
  });

  return () => subscription.unsubscribe();
}, [allFields, getValues, watch]);
```

**根因**：`queueMicrotask` 导致表单初始化延迟，而 `initializedRef` 阻止了重新初始化。

---

## 6. 动态语言管理系统

### 6.1 后端 API

语言配置存储在数据库中，支持运行时动态开关：

```http
GET /v1/admin/system/locales

Response:
{
  "locales": [
    { "code": "zh", "name": "中文", "enabled": true },
    { "code": "en", "name": "English", "enabled": true },
    { "code": "ja", "name": "日本語", "enabled": false },
    { "code": "ko", "name": "한국어", "enabled": false },
    { "code": "fr", "name": "Français", "enabled": false },
    { "code": "de", "name": "Deutsch", "enabled": false }
  ]
}

PATCH /v1/admin/system/locales/:code
Body: { "enabled": true }
```

### 6.2 useAvailableLocales Hook

```typescript
export function useAvailableLocales() {
  const { data } = useSWR("/v1/admin/system/locales");

  return {
    locales: data?.locales ?? [],
    enabledLocales: data?.locales.filter((l) => l.enabled) ?? [],
    isEnabled: (code: Locale) =>
      data?.locales.find((l) => l.code === code)?.enabled ?? false,
  };
}
```

### 6.3 边界情况处理

| 场景 | 处理逻辑 |
|------|----------|
| 语言被关闭 | 已有翻译完整保留，不在表单上显示 |
| 语言重新打开 | 之前的翻译自动恢复，不需要重新翻译 |
| 新增语言 | 所有历史数据自动有了新字段，后台开始批量翻译 |
| 删除语言 | 翻译数据永久保留，随时可重新启用 |
| 翻译错误 | 管理员可随时手动覆盖单个语言 |

---

## 7. AI 自动翻译集成

### 7.1 翻译工作流

```typescript
async function translateDocument(id: string, sourceLocale: Locale) {
  const { enabledLocales } = useAvailableLocales();

  // 只翻译当前已启用的语言
  const targetLocales = enabledLocales
    .filter((l) => l.code !== sourceLocale)
    .map((l) => l.code);

  // 进入翻译队列
  await queueTranslation(id, sourceLocale, targetLocales);
}
```

### 7.2 批量翻译速度参考

| 文章数量 | 预计用时 |
|----------|----------|
| 100 篇 | ~10 秒 |
| 1,000 篇 | ~1.7 分钟 |
| 5,000 篇 | ~8.5 分钟 |
| 10,000 篇 | ~17 分钟 |

系统使用 BullMQ 队列，并发 2，每个请求间隔 60ms，完美适配 Gemini 1500RPM 限制。

---

## 8. 架构收益

### 8.1 量化对比

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 新增一种语言的修改处 | 37 处 | 1 处 |
| 新增语言耗时 | 8 小时 | 5 分钟 |
| 表单 if else 数量 | 12 个 | 0 个 |
| 代码总行数 | +520 行 | -180 行 |
| 多语言 Bug 数量 | 每个版本 3-5 个 | 接近 0 |

### 8.2 经验教训

```
❌ 绝对不要做的事：
  1. 不要写兼容层双写新旧字段
  2. 不要在数据库里存 titleEn / contentEn 扁平字段
  3. 不要在 Service 层做类型判断
  4. 不要在每层都做兼容转换

✅ 应该做的事：
  1. 直接用原生 JSON 字段（如 titleLocalized）
  2. 全链路只传递 LocalizedString<T> 类型
  3. 提供统一的 getLocalizedValue() 工具函数
  4. 在最外层自动兼容旧格式
```

---

## 9. 总结

这套多语言架构的核心思想可以用一句话概括：

> 我们不知道未来需要支持多少种语言。所以我们不做"N 语言系统"，我们做"无限语言系统"，然后用开关控制。

通过 `LocalizedString` 类型系统 + `useLocalizedForm` Hook + 动态语言管理，我们从 37 处修改降到了 1 处，从 8 小时降到了 5 分钟——而且零 if else。

正如我们的设计目标所说：
> 好的架构不是让你今天做的快。好的架构是让你接下来的 3 年，每天都做的和第一天一样快。

---

*相关文档：*
- [Blog AI 多语言翻译系统](../frontend/blog-ai-multilingual-translation.md)
- [next-intl v3 完整指南](../../i18n/I18N_NEXT_INTL_V3_FULL_GUIDE.md)
- [翻译文案规范](../../i18n/I18N_TRANSLATIONS_GUIDE.md)
