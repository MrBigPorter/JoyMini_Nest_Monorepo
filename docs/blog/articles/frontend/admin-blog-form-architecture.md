---
title: 博客表单架构：forwardRef + Zod 验证 + Next.js 15 TS71007 兼容
description: 如何设计一个可复用的博客表单架构——从 forwardRef 暴露子表单方法、Zod Schema 验证、到 Next.js 15 Server Actions 编译检查的兼容方案
date: 2026-04-30
category: frontend
tags: [React, React Hook Form, Zod, Next.js, TypeScript, forwardRef]
---

# 博客表单架构：forwardRef + Zod 验证 + Next.js 15 TS71007 兼容

## 架构概览

admin-blog 的表单系统由三层组成：

```
ArticleForm (视图层)         ← forwardRef 暴露 getValues/reset
   ↓
useBlogForm (逻辑层)         ← Zod 验证 + 错误处理
   ↓
useBlogFormSubmit (提交层)   ← 纯提交逻辑，避免 TS71007
```

这种分层设计解决了三个核心问题：
1. **子表单独立性**：ArticleForm 使用 `forwardRef` 暴露方法，父组件不直接操作 RHF
2. **Zod 验证**：统一的 Schema 验证 + Toast 错误反馈
3. **Next.js 15 兼容**：Action 后缀命名 + 函数边界切割

## 一、ArticleForm：forwardRef 模式

### 为什么需要 forwardRef

文章编辑需要在弹窗中渲染 ArticleForm，父组件（Modal）需要：
- 获取表单值：`formRef.current.getValues()`
- 重置表单：`formRef.current.reset(initialData)`

`forwardRef` 允许子组件将内部方法暴露给父组件，而不破坏封装性。

### 接口设计

```typescript
// apps/admin-blog/src/views/blog/ArticleForm.tsx
const formSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  content: z.string().min(1, 'Content is required'),
  excerpt: z.string().optional(),
  featuredImage: z.any().optional(),
})

export interface ArticleFormRef {
  getValues: () => ArticleFormValues
  reset: (values: Partial<ArticleFormValues>) => void
}

interface ArticleFormProps {
  onUploadAction?: (file: File) => Promise<string>
  locale?: string          // 当前语言
  isLocalized?: boolean    // 是否多语言模式
  onFieldChangeAction?: (field: string, value: string) => void
}
```

### 安全的多语言字段取值

```typescript
function extractStringValue(value: any, locale = 'zh'): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    return value[locale] || value['zh'] || value['en'] || ''
  }
  return ''
}
```

多语言对象 `{ zh: "标题", en: "Title" }` 经过 `extractStringValue` 被安全提取为当前语言字符串。如果当前语言不存在，回退到中文 → 英文 → 空字符串。

### isResetting Ref 防污染

```typescript
const isResetting = useRef(false)

useImperativeHandle(ref, () => ({
  reset: (values) => {
    isResetting.current = true  // 标记 reset 进行中

    const safeValues = {
      title: extractStringValue(values?.title, locale),
      content: extractStringValue(values?.content, locale),
      // ...
    }
    form.reset(safeValues)

    requestAnimationFrame(() => {
      isResetting.current = false  // 下一帧恢复
    })
  },
}))
```

父组件调用 `reset()` 时，`isResetting` ref 阻止 `watch` 回调将旧的多语言对象传播到父表单，避免污染父表单的多语言存储层（参见 useLocalizedForm 文章）。

## 二、useBlogForm：Zod 验证集成

### 统一验证层

```typescript
// apps/admin-blog/src/hooks/useBlogForm.ts
export function useBlogForm<T extends z.ZodSchema>({
  schema,
  defaultValues,
  onSubmitAction,
}: UseBlogFormOptions<T>) {
  const form = useForm<z.infer<T>>({
    resolver: zodResolver(schema as any),
    defaultValues,
    shouldFocusError: false, // 防止验证失败滚动到隐藏的多语言字段
  })

  const handleSubmit = useCallback(
    async (data: z.infer<T>) => {
      try {
        await onSubmitAction(data)
      } catch (error: unknown) {
        // 智能错误提取: Axios error → Error object → 默认文案
        let message = '提交失败'
        if (error && typeof error === 'object') {
          if ('response' in error && error.response?.data?.message) {
            message = error.response.data.message
          } else if ('message' in error && typeof error.message === 'string') {
            message = error.message
          }
        }
        addToast('error', message)
      }
    },
    [onSubmitAction, addToast],
  )
  // ...
}
```

关键设计决策：
- **`shouldFocusError: false`**：多语言表单中隐藏字段（如 `content.en`）可能不可见，聚焦会滚动到不可见元素
- **智能错误提取**：支持 Axios `response.data.message`、普通 `Error.message`、默认文案三层回退
- **不展开返回对象**：直接返回 `{ form, submitHandler, isLoading, errors }`，避免触发表单函数的序列化检查

### TS71007 的根本原因

Next.js 15 RC 引入了更严格的 Server Actions 编译检查。当在 Client Component 中传递函数时，Next.js 会检查该函数是否可能被序列化：

```typescript
// ❌ 触发 TS71007: 展开 useForm 返回对象的属性
const { register, handleSubmit, watch } = useForm()
// handleSubmit 和 watch 被展开后传递给 Server Action → 编译警告

// ✅ 正确: 传递完整 form 对象
const form = useForm()
return <SomeComponent form={form} />
```

form hook（`useForm`）返回的对象包含 `register`、`handleSubmit` 等方法引用。如果在组件中将这些函数展开并传递给 Server Action，Next.js 15 会发出 TS71007 警告。因此我们选择 **不展开 RHF 属性，始终传递完整 form 对象**。

## 三、useBlogFormSubmit：纯提交逻辑

### 分离原因

Next.js 15 的另一个约束是：`useForm()` 必须在组件内部直接调用，不能作为自定义 Hook 的返回值跨边界传递：

```typescript
// ❌ 错误: useForm 在 Hook 内部，返回值跨组件边界
export function useCustomForm() {
  const form = useForm() // 正确位置
  return { form }        // 可能触发 TS71007
}

// ✅ 正确: useForm 在组件内部
function MyComponent() {
  const form = useForm() // 必须在这里
  const { handleSubmit } = useBlogFormSubmit({ onSubmitAction })
}
```

因此我们将 **纯提交逻辑** 抽到独立 Hook：

```typescript
// apps/admin-blog/src/hooks/useBlogFormSubmit.ts
export function useBlogFormSubmit<T extends z.ZodSchema>({
  onSubmitAction,
}: UseBlogFormSubmitOptions<T>) {
  const addToast = useToastStore((state) => state.addToast)

  const handleSubmit = useCallback(
    async (data: z.infer<T>) => {
      try {
        await onSubmitAction(data)
      } catch (error: unknown) {
        // 同上: 三层回退错误提取
        // ...
      }
    },
    [onSubmitAction, addToast],
  )

  return { handleSubmit }
}
```

### 使用组合

```typescript
function ArticleCreatePage() {
  const form = useForm<ArticleSchema>({
    resolver: zodResolver(articleSchema),
  })

  const { handleSubmit } = useBlogFormSubmit({
    onSubmitAction: async (data) => {
      await api.createArticle(data)
    },
  })

  const { localize, getFullLocalizedValue } = useLocalizedForm({
    watchAction: form.watch,
    setValueAction: form.setValue,
    errors: form.formState.errors,
    locale: currentLocale,
  })
  // ...
}
```

## 四、三层架构协作图

```
父组件 (Modal/Page)
│
├── useForm()           ← RHF 实例（必须在组件内创建）
├── useBlogFormSubmit() ← 纯提交逻辑
└── useLocalizedForm()  ← 多语言存储层
    │
    └── ArticleForm (forwardRef)  ← 子表单
        ├── form.useForm()        ← 独立于父组件的 RHF 实例
        ├── RichTextEditor        ← 富文本编辑
        ├── FormTextField         ← 标题
        ├── FormTextareaField     ← 摘要
        └── FormMediaUploaderField ← 封面图
```

父子组件各有独立的 `useForm()` 实例，通过 `forwardRef` 桥接。父组件的 `useLocalizedForm` 监控子组件的字段变化，维护全局多语言存储层。

## 五、Schema 设计模式

### 文章 Schema

```typescript
const articleSchema = z.object({
  title: z.string().min(1, '标题不能为空'),
  content: z.string().min(1, '内容不能为空'),
  excerpt: z.string().optional(),
  featuredImage: z.any().optional(),
  categoryId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
  publishedAt: z.string().optional(),
})
```

### 分类 Schema

```typescript
const categorySchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  slug: z.string().min(1, 'Slug 不能为空'),
  description: z.string().optional(),
})
```

所有 Schema 通过 `zodResolver` 绑定到 `useForm`，提交时自动验证，错误通过 Toast 反馈给用户。

## 总结

admin-blog 的表单架构展示了几个关键设计原则：

1. **分层分离**：视图层（ArticleForm）与逻辑层（useBlogForm）与提交层（useBlogFormSubmit）各司其职
2. **封装性**：`forwardRef` 暴露最小接口，不泄露 RHF 内部实现
3. **防御性**：`isResetting` ref + `extractStringValue` 防止多语言数据污染
4. **框架适配**：Action 后缀 + 不展开返回对象，兼容 Next.js 15 严格检查

这个模式适用于任何需要多语言、多层级、可复用表单的 CMS 系统。
