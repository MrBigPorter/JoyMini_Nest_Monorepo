---
title: AI 翻译问题检测面板：批量修复多语言内容的工程实践
description: 如何构建一个 822 行的翻译质量检测面板——自动扫描文章/分类/标签的翻译问题，支持批量修复和语言筛选
date: 2026-04-30
category: frontend
tags: [AI, Translation, i18n, React, TypeScript, CMS]
---

# AI 翻译问题检测面板：批量修复多语言内容的工程实践

## 背景

在多语言 CMS 中，翻译质量是一个持续性问题。随着文章数量的增长，手动检查每篇文章的翻译完整性变得不可行。admin-blog 的 [`BlogTranslationIssues`](apps/admin-blog/src/views/blog/BlogTranslationIssues.tsx) 面板（822 行）提供了一套自动检测 + 批量修复的解决方案。

### 检测维度

| 检测项 | 描述 |
|--------|------|
| **缺失翻译** | 文章/分类/标签的某个语言字段为空 |
| **残留源语言** | 翻译后内容仍是源语言字符 |
| **空字符串** | 字段值为空字符串而非正常内容 |
| **格式错误** | HTML 标签未关闭、Markdown 语法错误 |

## 一、架构设计

### API 数据结构

```typescript
interface TranslationIssue {
  articleId: string
  title: string
  issues: Array<{
    field: string       // 问题字段名，如 title, content, excerpt
    type: string        // 问题类型
    message: string     // 描述
    currentValue: string
    expectedLanguage: string
  }>
  severity: 'low' | 'medium' | 'high'
  lastAttempt: string   // 上次翻译时间
}
```

### UI 结构

```
BlogTranslationIssues (822 行)
├── 语言选择器           ← 筛选目标语言
├── 文章问题列表          ← 按文章分组的翻译问题
│   ├── 批量选择 (Checkbox)
│   ├── 单篇修复按钮
│   └── 批量修复按钮
├── 分类问题列表          ← 分类的翻译问题
│   ├── 全选/取消全选
│   ├── 单分类翻译
│   └── 批量翻译
└── 标签问题列表          ← 标签的翻译问题
    ├── 单标签翻译
    └── 批量翻译
```

## 二、核心实现

### 数据获取

```typescript
const {
  data: translationIssues,
  loading: issuesLoading,
  run: runIssues,
} = useRequest(
  () => blogApi.translation.getTranslationIssues(selectedLanguage),
  { manual: true },
)

// 初始加载
React.useEffect(() => {
  runIssues()
}, [])
```

使用 `ahooks` 的 `useRequest` 管理数据加载状态，`manual: true` 允许手动触发刷新。

### 选择状态管理

```typescript
const [selectedArticles, setSelectedArticles] = useState<string[]>([])

const handleArticleSelect = (articleId: string) => {
  setSelectedArticles((prev) =>
    prev.includes(articleId)
      ? prev.filter((id) => id !== articleId)
      : [...prev, articleId],
  )
}

const handleSelectAll = () => {
  if (!translationIssues?.issues) return
  setSelectedArticles(
    selectedArticles.length === translationIssues.issues.length
      ? []
      : translationIssues.issues.map((i) => i.articleId),
  )
}
```

全选/取消全选的切换逻辑：如果全部已选中则清空，否则全选。

### 分类翻译

```typescript
const handleTranslateCategory = async (categoryId: string) => {
  setTranslatingCategories((prev) => ({ ...prev, [categoryId]: true }))
  try {
    await blogApi.translation.translateCategory(categoryId, selectedLanguage)
    addToast('success', '分类翻译完成')
    // 延迟刷新，给后台任务处理时间
    setTimeout(() => runIssues(), 2000)
  } catch (error) {
    addToast('error', '翻译失败')
  } finally {
    setTranslatingCategories((prev) => ({ ...prev, [categoryId]: false }))
  }
}
```

- **乐观 UI**：点击后立即显示加载状态
- **延迟刷新**：翻译是 BullMQ 异步任务，需要给后台处理时间
- **逐项追踪**：`translatingCategories` 对象记录每个分类的翻译状态

### 批量操作

```typescript
const handleBatchFix = async () => {
  if (selectedArticles.length === 0) {
    addToast('warning', '请先选择要修复的文章')
    return
  }

  setFixingInProgress(true)
  try {
    await blogApi.translation.batchFixIssues(
      selectedArticles,
      selectedLanguage,
    )
    addToast('success', `已提交 ${selectedArticles.length} 篇文章的修复`)
    setSelectedArticles([])
    setTimeout(() => runIssues(), 2000)
  } catch (error) {
    addToast('error', '批量修复失败')
  } finally {
    setFixingInProgress(false)
  }
}
```

## 三、UI 组件

### Checkbox 组件

自制的 Checkbox 组件，不依赖任何 UI 库：

```typescript
const Checkbox = ({
  checked, onChange, disabled
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}) => (
  <label className={`inline-flex items-center relative ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className="sr-only"
    />
    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
      checked
        ? 'bg-primary-500 border-primary-500'
        : 'border-gray-300 dark:border-white/20'
    }`}>
      {checked && (
        <svg className="w-3 h-3 text-white" /* checkmark path */ />
      )}
    </div>
  </label>
)
```

- `sr-only` 隐藏原生 checkbox，自定义样式
- 支持 `disabled` 状态
- 深色模式适配

### Badge 组件

用于显示问题类型：

```typescript
<Badge
  variant={item.type === 'missing' ? 'error' : 'warning'}
  size="sm"
>
  {item.message}
</Badge>
```

### Skeleton 加载态

```typescript
const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse bg-gray-200 dark:bg-white/10 rounded ${className}`} />
)
```

## 四、分类和标签翻译的特殊性

分类和标签的翻译与文章不同：

| 特性 | 文章 | 分类/标签 |
|------|------|-----------|
| 字段数 | 3+ (title, content, excerpt) | 1-2 (name, description) |
| 翻译量 | 大 | 小 |
| 检测频率 | 按需 | 按需 |
| 批量操作 | 批量修复 | 批量翻译 |

分类和标签的翻译直接调用 API 翻译接口，不走 BullMQ 队列（内容量小，即时完成）：

```typescript
const handleBatchTranslateCategories = async () => {
  setBatchTranslatingCategories(true)
  try {
    await Promise.all(
      selectedCategories.map((id) =>
        blogApi.translation.translateCategory(id, selectedLanguage)
      ),
    )
    addToast('success', `已翻译 ${selectedCategories.length} 个分类`)
    setSelectedCategories([])
    setTimeout(() => runIssues(), 2000)
  } finally {
    setBatchTranslatingCategories(false)
  }
}
```

## 五、与后端 AI 处理器的协作

```
BlogTranslationIssues (前端)
       │
       ▼  GET /api/translation/issues?language=en
       │
┌─────────────────────────────────────┐
│  TranslationJobService (后端)        │
│  1. 扫描所有文章的 translationStatus  │
│  2. 对比各语言字段完整性              │
│  3. 返回问题列表                      │
└─────────────────────────────────────┘
       │
       ▼  POST /api/translation/batch-fix
       │
┌─────────────────────────────────────┐
│  BlogAiProcessor (BullMQ Worker)    │
│  1. 接收修复任务                     │
│  2. 调用 Gemini API 翻译             │
│  3. 更新数据库                       │
│  4. 记录翻译进度                     │
└─────────────────────────────────────┘
```

前端面板触发修复 → 后端创建 BullMQ 任务 → Worker 异步处理 → 进度面板实时追踪。

## 六、工程要点

1. **语言选择器**：下拉框选择目标语言，触发重新扫描
2. **延迟刷新**：翻译任务提交后 2 秒自动刷新，给后台处理时间
3. **状态追踪**：每个分类/标签的翻译状态独立记录
4. **错误处理**：所有 API 调用包裹 try/catch，失败 Toast 提示
5. **性能**：使用 `useRequest` 的 `loading` 状态避免重复请求

## 总结

`BlogTranslationIssues` 面板的核心价值在于将 **AI 翻译的质量控制** 从人工检查变为自动化扫描 + 批量修复。它与后端的 BullMQ 翻译处理器和 TranslationJobService 配合，构成了完整的翻译质量保证闭环。
