---
title: '多语言渲染与编辑器：解决 [object Object] 与 AI 翻译编辑'
description: 深入分析多语言渲染中的 [object Object] 问题根源，介绍 renderLocalizedText 5 级回退渲染函数和 LocalizedFieldEditor 双栏翻译编辑器的工程实现
date: 2026-04-30
category: frontend
tags: [React, i18n, TypeScript, Next.js, AI Translation, Localization]
---

# 多语言渲染与编辑器：解决 `[object Object]` 与 AI 翻译编辑

## 问题背景

在 admin-blog 的多语言架构中，所有内容字段（标题、摘要、正文等）都以 `Record<Locale, string>` 格式存储。然而在实际渲染中，经常出现两种典型问题：

1. **`[object Object]` 显示** — 直接对多语言对象使用 `{value}` 或 `String(value)`，导致 React 调用 `toString()` 返回 `"[object Object]"`
2. **编辑体验割裂** — 翻译人员需要一个直观的"原文 + 译文"双栏编辑器，而非直接在原始表单中修改

本文深入分析这两个问题的根源，并展示 admin-blog 如何通过两个关键模块解决它们：

- [`renderLocalizedText`](apps/admin-blog/src/utils/localizedText.ts) — 统一的 5 级回退渲染函数
- [`LocalizedFieldEditor`](apps/admin-blog/src/components/blog/LocalizedFieldEditor.tsx) — 双栏 AI 翻译编辑器

---

## 一、`[object Object]` 问题根源

### 1.1 JSX 隐式字符串化

React 的 JSX 表达式 `{value}` 内部调用与 `String(value)` 相同的隐式转换：

```typescript
// ❌ 错误用法：直接渲染多语言对象
const title = { en: 'Hello', zh: '你好' };
return <h1>{title}</h1>;  // 页面显示: [object Object]
```

原因在于 JavaScript 的 `Object.prototype.toString()` 方法未被子类覆盖时，所有普通对象都会返回 `"[object Object]"`。

### 1.2 多层嵌套传播

当多语言对象经过 API 请求、状态更新、组件 props 传递后，开发者容易忘记某层需要解包：

```typescript
// ❌ API 返回是完整的多语言对象，但渲染时忘记提取当前语言
const article = await api.getArticle(id);
return <div>{article.title}</div>;  // title = { en: "...", zh: "..." } → [object Object]
```

### 1.3 TypeScript 类型误导

TypeScript 的类型注解可能隐藏运行时数据的真实形状：

```typescript
// ❌ title 声明为 string，但运行时实际是对象
interface Article {
  title: string;  // 实际可能是 string | Record<Locale, string>
}
```

---

## 二、`renderLocalizedText` — 统一渲染层

为了解决上述问题，我们设计了统一的 [`renderLocalizedText`](apps/admin-blog/src/utils/localizedText.ts:13) 工具函数，建立 5 级回退链。

### 2.1 完整代码

```typescript
// apps/admin-blog/src/utils/localizedText.ts

export const renderLocalizedText = (
  value: any,
  locale: string = 'zh',
  fallback: string = '',
): string => {
  // 第1级：处理 null/undefined
  if (value == null) return fallback;

  // 第2级：如果是字符串，直接返回（已渲染好的单语言数据）
  if (typeof value === 'string') return value;

  // 第3级：如果是多语言对象
  if (typeof value === 'object' && value !== null) {
    // 优先使用当前语言
    if (value[locale]) return String(value[locale]);

    // 回退到中文（默认语言）
    if (value.zh) return String(value.zh);

    // 回退到英文（辅助回退）
    if (value.en) return String(value.en);

    // 尝试获取第一个可用的语言值
    const firstValue = Object.values(value).find((v) => v != null);
    if (firstValue) return String(firstValue);

    return fallback;
  }

  // 第4级：其他类型（number, boolean 等）转换为字符串
  return String(value);
};
```

### 2.2 5 级回退链设计

| 级别 | 条件 | 返回 | 场景 |
|------|------|------|------|
| 1 | `value == null` | `fallback` | 数据库字段缺失 |
| 2 | `typeof value === 'string'` | `value` | 非多语言字段（如 slug） |
| 3a | `value[locale]` 存在 | `String(value[locale])` | 用户偏好语言 |
| 3b | `value.zh` 存在 | `String(value.zh)` | 默认中文回退 |
| 3c | `value.en` 存在 | `String(value.en)` | 英文辅助回退 |
| 3d | 任意语言键存在 | 第一个有效值 | 极罕见乱数据 |
| 3e | 空对象 | `fallback` | 对象存在但无值 |
| 4 | 其他类型 | `String(value)` | number/boolean |

**关键设计决策**：为什么先检查 `typeof string` 再检查 object？

因为非多语言字段（如 `slug`、`createdAt`）本身就是字符串类型，不需要解包。而多语言字段在独立存储层（即 [`useLocalizedForm`](docs/blog/articles/frontend/admin-blog-localized-form.md) 中的 `storageRef`）中是对象格式，需要通过语言键提取。

### 2.3 配套工具函数

除了核心的 `renderLocalizedText`，`localizedText.ts` 还提供了三个重要工具：

#### `getLocalizedValue` — 快速提取

```typescript
// apps/admin-blog/src/utils/localizedText.ts:52
export const getLocalizedValue = (
  obj: Record<string, any> | undefined | null,
  locale: string = 'zh',
): string => {
  if (!obj) return '';
  return obj[locale] || obj.zh || obj.en || '';
};
```

比 `renderLocalizedText` 更轻量，适用于已知输入是多语言对象的场景（如表格列渲染）。

#### `isLocalizedObject` — 类型守卫

```typescript
// apps/admin-blog/src/utils/localizedText.ts:65
export const isLocalizedObject = (value: any): boolean => {
  if (!value || typeof value !== 'object') return false;

  const hasLanguageKey = Object.keys(value).some((key) =>
    ['en', 'zh', 'ja', 'ko', 'fr', 'es', 'de'].includes(key),
  );

  return hasLanguageKey;
};
```

用于运行时判断一个值是否是多语言对象，在需要区分处理时非常有用。

#### `normalizeLocalizedData` — 数据迁移

```typescript
// apps/admin-blog/src/utils/localizedText.ts:82
export const normalizeLocalizedData = (data: any): Record<string, string> => {
  if (!data) return { zh: '', en: '' };

  if (isLocalizedObject(data)) {
    return { zh: data.zh || '', en: data.en || '', ...data };
  }

  if (typeof data === 'string') {
    return { zh: data, en: '' };
  }

  // 旧格式兼容：{ name, nameEn }
  if (data.name && typeof data.name === 'string') {
    return { zh: data.name, en: data.nameEn || '' };
  }

  return { zh: '', en: '' };
};
```

**迁移场景**：旧系统使用 `{ name: "中文", nameEn: "English" }` 格式，新系统使用 `{ zh: "中文", en: "English" }` 格式。`normalizeLocalizedData` 在数据入口处统一转换，避免下游组件感知历史格式差异。

#### `renderLocalizedTableData` — 批量渲染

```typescript
// apps/admin-blog/src/utils/localizedText.ts:118
export const renderLocalizedTableData = <T extends Record<string, any>>(
  data: T[],
  fields: string[],
  locale: string = 'zh',
): T[] => {
  return data.map((item) => {
    const processed = { ...item } as any;
    fields.forEach((field) => {
      if (field in processed) {
        processed[field] = renderLocalizedText(processed[field], locale);
      }
    });
    return processed as T;
  });
};
```

**使用场景**：在表格组件中，批量将多语言字段渲染为当前语言的字符串：

```typescript
// 使用前：title 字段显示 [object Object]
const tableData = articles.map(a => ({
  ...a,
  title: renderLocalizedText(a.title, currentLocale),
}));

// 使用后（等价写法）：
const tableData = renderLocalizedTableData(articles, ['title', 'summary'], locale);
```

---

## 三、`LocalizedFieldEditor` — 双栏翻译编辑器

`renderLocalizedText` 解决了**渲染**问题，而 `LocalizedFieldEditor` 解决了**编辑**问题——让翻译人员在一个直观的双栏界面中工作。

### 3.1 组件接口设计

```typescript
// apps/admin-blog/src/components/blog/LocalizedFieldEditor.tsx:10
interface LocalizedFieldEditorProps {
  isOpen: boolean;            // Modal 是否打开
  onCloseAction: () => void;  // 关闭回调
  sourceLocale: Locale;       // 源语言（如 'zh'）
  targetLocale: Locale;       // 目标语言（如 'en'）
  sourceValue: string;        // 原文内容（已提取的字符串）
  currentValue: string;       // 当前译文
  fieldType: 'text' | 'textarea' | 'richtext';  // 字段类型
  label: string;              // 字段标签
  onSaveAction: (value: string) => void;  // 保存回调
}
```

**设计要点**：
- `sourceValue` 和 `currentValue` 都是字符串（已由父组件通过 `renderLocalizedText` 或 `getLocalizedValue` 提取），编辑器不需要关心多语言对象结构
- `fieldType` 决定使用什么输入控件渲染译文区域
- 所有回调使用 `Action` 后缀命名（`onSaveAction`），遵循 TS71007 约定

### 3.2 状态管理

```typescript
// apps/admin-blog/src/components/blog/LocalizedFieldEditor.tsx:33
const [value, setValue] = useState(currentValue);

// 每次打开重置状态
useEffect(() => {
  if (isOpen) {
    setValue(currentValue);
  }
}, [isOpen, currentValue]);
```

**为什么使用 `useState` 而不是直接受控？** 因为编辑器是 Modal 形态，用户可能在输入过程中关闭再打开，需要确保每次打开时状态重置为最新 `currentValue`。

### 3.3 LOCALE_NAMES 映射

```typescript
// apps/admin-blog/src/components/blog/LocalizedFieldEditor.tsx:57
const LOCALE_NAMES: Record<Locale, { native: string; flag: string }> = {
  zh: { native: '简体中文', flag: '🇨🇳' },
  en: { native: 'English', flag: '🇺🇸' },
  ja: { native: '日本語', flag: '🇯🇵' },
  ko: { native: '한국어', flag: '🇰🇷' },
  fr: { native: 'Français', flag: '🇫🇷' },
  de: { native: 'Deutsch', flag: '🇩🇪' },
};
```

这个映射表提供了每个语言的原生名称和 Emoji 国旗，用于 UI 显示。它是硬编码在组件内部的，因为：
- 语言列表固定且很小（6 种语言）
- 国旗 Emoji 需要手动维护
- 放在组件外部反而增加寻址成本

### 3.4 双栏布局

```tsx
// apps/admin-blog/src/components/blog/LocalizedFieldEditor.tsx:74
<div className="grid grid-cols-2 gap-6">
  {/* 原文 - 左侧 */}
  <div className="space-y-4 p-4 border rounded-lg shadow-sm bg-gray-50/50">
    <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
      {LOCALE_NAMES[sourceLocale].flag} 原文
    </h3>
    <div className="p-3 rounded-md border border-gray-200 min-h-[280px] whitespace-pre-wrap text-sm">
      {sourceValue || '(空)'}
    </div>
  </div>

  {/* 译文 - 右侧 */}
  <div className="space-y-4 p-4 border rounded-lg shadow-sm bg-blue-50/30 border-blue-100">
    <h3 className="font-semibold text-sm text-blue-800 flex items-center gap-2">
      {LOCALE_NAMES[targetLocale].flag} 译文
    </h3>
    {/* 根据 fieldType 渲染不同的输入控件 */}
  </div>
</div>
```

| 区域 | 背景色 | 边框 | 用途 |
|------|--------|------|------|
| 原文（左） | `bg-gray-50/50` | 普通灰色 | 只读展示，防误触 |
| 译文（右） | `bg-blue-50/30` | `border-blue-100` | 蓝色高亮，可编辑 |

### 3.5 三种字段类型支持

```tsx
{fieldType === 'text' && (
  <input type="text" value={value}
    onChange={(e) => setValue(e.target.value)}
    placeholder="请输入翻译内容"
    className="w-full px-3 py-2 border border-gray-200 rounded-md outline-none
      focus:ring-0 focus:border-blue-400"
  />
)}

{fieldType === 'textarea' && (
  <textarea value={value}
    onChange={(e) => setValue(e.target.value)}
    rows={12}
    placeholder="请输入翻译内容"
    className="w-full px-3 py-2 border border-gray-200 rounded-md
      min-h-[220px] outline-none focus:ring-0 focus:border-blue-400"
  />
)}

{fieldType === 'richtext' && (
  <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
    <RichTextEditor
      value={value}
      onChangeAction={setValue}
      placeholder="请输入翻译内容"
    />
  </div>
)}
```

三种字段类型分别对应 admin-blog 中的不同字段：

| `fieldType` | 对应字段 | 输入控件 |
|-------------|----------|----------|
| `text` | 标题、slug | `<input type="text">` |
| `textarea` | 摘要、描述 | `<textarea rows={12}>` |
| `richtext` | 正文内容 | `<RichTextEditor>` |

### 3.6 AI 翻译按钮（TODO 状态）

```typescript
// TODO: AI 翻译接口等待后端导出
const { run: translate, loading: isTranslating } = useRequest(
  async () => {
    setValue(`[${targetLocale}] ${sourceValue}`);  // 临时模拟
    return;
  },
  { manual: true },
);
```

当前 `translate` 函数处于**模拟阶段**，实际逻辑为：

1. 调用后端 AI 翻译 API（由 `BlogAiProcessor` 执行）
2. 返回翻译结果并填入 `setValue`
3. 用户确认后调用 `onSaveAction`

**为什么不做成自动翻译？** 因为：
- 翻译需要消耗 API 额度，必须由用户手动触发
- 翻译结果可能需要人工校正
- 后端 AI 翻译接口导出与 [`BlogTranslationIssues`](docs/blog/articles/frontend/admin-blog-translation-issues.md) 的批量翻译共用同一个 BullMQ 队列

### 3.7 保存流程

```typescript
// apps/admin-blog/src/components/blog/LocalizedFieldEditor.tsx:52
const handleSave = () => {
  onSaveAction(value);  // 将译文传回父组件
  onCloseAction();       // 关闭 Modal
};
```

父组件接收到译文后，会将其写入 `useLocalizedForm` 的独立存储层：

```typescript
// 父组件中的使用示意
const handleSaveTranslation = (articleId: string, field: string, value: string) => {
  localize(field as keyof ArticleFormData).onChangeAction(value);
  // localize() 返回 { value, onChangeAction }，其中 onChangeAction
  // 会将 value 写入 storageRef[field][targetLocale] = value
};
```

---

## 四、整体数据流

```
┌─────────────────────────────────────────────────────────────┐
│                        Data Flow                            │
│                                                             │
│  API Response                                                │
│  { title: { en: "...", zh: "..." } }                        │
│         │                                                    │
│         ▼                                                    │
│  normalizeLocalizedData(title)                               │
│  → { zh: "...", en: "..." }                                 │
│         │                                                    │
│  ┌──────┴──────────┬────────────────────────┐               │
│  ▼                  ▼                        ▼               │
│  Render             Edit                    Table            │
│  renderLocalized    LocalizedFieldEditor    renderLocalized  │
│  Text(title, 'en')  .open({                  TableData(      │
│  → "Hello"           sourceValue:            articles,       │
│                       renderLocalizedText(   ['title'],      │
│                         title, 'zh'),         'en')          │
│                       currentValue:          → title列       │
│                         title.en,            显示"Hello"     │
│                       fieldType: 'text',                     │
│                       onSaveAction: (v) =>                   │
│                         localize(field)                      │
│                         .onChangeAction(v)                   │
│                     })                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、与独立存储层的关系

[`useLocalizedForm`](docs/blog/articles/frontend/admin-blog-localized-form.md) 提供了多语言表单的独立存储层（`storageRef`），而 `renderLocalizedText` 和 `LocalizedFieldEditor` 分别解决了渲染和编辑两个关键场景：

| 模块 | 职责 | 输入 | 输出 |
|------|------|------|------|
| `storageRef` (useLocalizedForm) | 存储全部语言的值 | 表单操作 | `Record<Locale, string>` |
| `renderLocalizedText` | 提取当前语言的渲染值 | 多语言对象 + locale | 渲染字符串 |
| `LocalizedFieldEditor` | 编辑特定语言的值 | 源语言值 + 目标语言值 | 译文字符串 |

**三者配合的工作流**：

1. 表单加载时，`useLocalizedForm` 从 API 获取完整多语言数据存入 `storageRef`
2. 页面渲染使用 `renderLocalizedText` 提取当前语言显示
3. 用户点击翻译按钮 → 打开 `LocalizedFieldEditor`（源语言展示只读原文，目标语言可编辑）
4. 用户保存 → 调用 `localize(field).onChangeAction(value)` 写入 `storageRef`
5. 表单提交 → `getFullLocalizedValue(field, allLocales)` 收集所有语言的完整数据 → API

---

## 六、最佳实践总结

### 6.1 使用 `renderLocalizedText` 而非 `getLocalizedValue`

```typescript
// ✅ 推荐：renderLocalizedText 处理更多边界情况
renderLocalizedText(article.title, locale);

// ⚠️ 仅当确定输入是多语言对象时使用
getLocalizedValue(article.title, locale);
```

### 6.2 始终使用 `normalizeLocalizedData` 在入口处转换

```typescript
// ✅ API 响应到达应用边界时立即标准化
const article = {
  ...raw,
  title: normalizeLocalizedData(raw.title),
};
```

### 6.3 表格渲染使用 `renderLocalizedTableData`

```typescript
// ✅ 批量处理，避免逐个调用
const processed = renderLocalizedTableData(articles, ['title', 'summary'], locale);
```

### 6.4 `LocalizedFieldEditor` 只接收字符串

```typescript
// ✅ 父组件负责提取多语言值
<LocalizedFieldEditor
  sourceValue={renderLocalizedText(article.title, sourceLocale)}
  currentValue={getLocalizedValue(article.title, targetLocale)}
  onSaveAction={(value) => localize('title').onChangeAction(value)}
/>
```

通过这三层设计，admin-blog 彻底解决了多语言渲染中的 `[object Object]` 问题，同时为翻译人员提供了直观的双栏编辑体验。AI 翻译集成（当前 TODO）将成为连接 [`BlogTranslationIssues`](docs/blog/articles/frontend/admin-blog-translation-issues.md) 批量检测与逐字段精细编辑的桥梁。
