---
title: 富文本编辑器深度定制：ReactQuill 懒加载 + Markdown 导入 + 自定义视频嵌入
description: 如何在 Next.js 中实现一个生产级的富文本编辑器——从 ReactQuill 懒加载避免 SSR 崩溃，到自定义 Html5VideoBlot 解决 Quill 不支持 <video> 标签的问题
date: 2026-04-30
category: frontend
tags: [ReactQuill, Rich Text Editor, Markdown, Next.js, TypeScript, Blot]
---

# 富文本编辑器深度定制：ReactQuill 懒加载 + Markdown 导入 + 自定义视频嵌入

## 为什么需要自定义富文本编辑器

在博客 CMS 中，富文本编辑器是核心组件。admin-blog 选择了 ReactQuill（`react-quill-new` 包）作为基础，但开箱即用的 Quill 无法满足所有需求：

| 需求 | Quill 原生支持 | 我们的方案 |
|------|---------------|-----------|
| SSR 兼容 | ❌ 浏览器 API 依赖 | 动态导入 + 骨架屏 |
| 图片上传 | ❌ 只支持 base64 | 自定义 handler + 上传 API |
| 视频嵌入 | ❌ 不支持 `<video>` 标签 | 自定义 Html5VideoBlot |
| Markdown 导入 | ❌ 不支持 | marked 解析 + 双栏预览 |
| 防死循环 | ❌ 易触发 | source 检查 + 内容对比 |

最终实现的 [`RichTextEditor`](apps/admin-blog/src/components/blog/RichTextEditor.tsx) 组件共 540 行，是 admin-blog 最复杂的 UI 组件之一。

## 一、SSR 安全：ReactQuill 懒加载

Quill 重度依赖浏览器 DOM API（`document`、`window`），在 Next.js SSR 环境中直接导入会导致崩溃。

### 动态导入策略

```typescript
const [ReactQuill, setReactQuill] = useState<typeof ReactQuillType | null>(null)

useEffect(() => {
  import('react-quill-new').then((mod) => {
    const ReactQuillModule = mod.default
    // 注册自定义 Blot（见第四节）
    const DynamicQuill = (ReactQuillModule as any).Quill
    if (DynamicQuill && !DynamicQuill.imports?.['formats/html5-video']) {
      registerHtml5VideoBlot(DynamicQuill)
    }
    loadCss() // 动态加载 Quill CSS
    setReactQuill(() => ReactQuillModule)
  })
}, [])
```

关键点：
- **`useState` 初始值为 `null`**：SSR 时不会渲染 Quill
- **动态 `import()`**：Webpack 将 Quill 拆分为独立 chunk，SSR 不加载
- **CSS 动态加载**：检查是否已存在，避免重复插入

### 骨架屏占位

```tsx
{!ReactQuill ? (
  <div className="h-[340px] bg-gradient-to-br from-gray-100 to-gray-200 animate-pulse rounded-lg" />
) : (
  <ReactQuill ... />
)}
```

Quill 未加载完成时显示一个 340px 高的脉冲动画骨架屏，消除布局抖动（CLS）。

## 二、防无限循环：事件处理策略

Quill 的事件模型很容易导致无限循环：`onChange → setValue → 重渲染 → 新 value prop → Quill 内部更新 → 触发 onChange → ...`

### 两层防护

```typescript
// 第一层：只传播用户操作
onChange={(content, delta, source, editor) => {
  if (source !== 'user') return; // 忽略程序化设置

  // 第二层：对比真实值
  setTimeout(() => {
    const realHtml = quillRef.current?.getEditor().root.innerHTML || ''
    if (realHtml !== value) {
      onChangeAction(realHtml)
    }
  }, 0)
}}
```

**第一层 `source !== 'user'`**：Quill 的 `onChange` 回调携带 `source` 参数，`'user'` 表示用户手动输入，`'api'` 表示代码调用。程序化设置（如初始化、reset）不触发回调。

**第二层 `realHtml !== value`**：即使 `source === 'user'`，也对比实际 DOM 内容是否真的变化。这是最终防线，确保不会因为 Quill 内部状态同步导致虚假更新。

### 初始化内容同步

Quill 加载完成后，需要将外部 `value` prop 同步到编辑器。但直接 `setHTML` 会在 Quill 未完全初始化时抛出异常：

```typescript
useEffect(() => {
  if (!ReactQuill) return
  if (hasInitialized.current) return

  const attempt = () => {
    try {
      const quill = quillRef.current?.getEditor()
      if (!quill) {
        requestAnimationFrame(attempt) // 重试直到就绪
        return
      }
      if (value) {
        quill.clipboard.dangerouslyPasteHTML(value)
      } else {
        quill.setText('')
      }
      hasInitialized.current = true
    } catch (err) {
      requestAnimationFrame(attempt)
    }
  }
  attempt()
}, [ReactQuill])
```

- **`hasInitialized` ref**：确保初始化只执行一次
- **`requestAnimationFrame` 重试**：Quill 的 `getEditor()` 可能在渲染后尚未就绪，用 rAF 循环直到可用
- **`dangerouslyPasteHTML`**：Quill 的 HTML 导入方式，保留格式

## 三、自定义图片上传

Quill 默认的图片处理是 base64 嵌入，会导致：
- 数据库膨胀
- 编辑性能下降
- 无法做 CDN 优化

### 自定义 handler

```typescript
const imageHandler = useCallback(() => {
  const input = document.createElement('input')
  input.setAttribute('type', 'file')
  input.setAttribute('accept', 'image/*')
  input.click()

  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return

    setIsUploading(true)
    const url = await onUploadAction(file, (pct) => setUploadProgress(pct))

    const quill = quillRef.current?.getEditor()
    if (quill) {
      // 安全插入：Clamp index 防止越界
      let range = quill.getSelection()
      if (!range) range = { index: quill.getLength(), length: 0 }
      const insertIndex = Math.max(0, Math.min(range.index, quill.getLength()))

      quill.insertEmbed(insertIndex, 'image', url, 'user')

      // 手动触发 onChange
      setTimeout(() => {
        onChangeAction(quill.root.innerHTML)
      }, 0)
    }
  }
}, [onUploadAction])
```

关键细节：
- **Range 边界保护**：`Math.max(0, Math.min(index, length))` 防止插入位置越界
- **上传进度**：通过回调函数将上传进度传递到 UI
- **手动 `onChange`**：`insertEmbed` 是程序化操作（`source='api'`），不会触发 `onChange`，需要手动调用

## 四、自定义视频嵌入：Html5VideoBlot

### 问题：Quill 不支持 `<video>`

Quill 的 `BlockEmbed` 基类只预定义了 `image` 和 `video`（仅支持 iframe/embed 嵌入），不支持 HTML5 `<video>` 标签。尝试 `insertEmbed('video', url)` 会静默丢弃。

### Blot 机制简介

Quill 使用 **Parchment**（它的底层文档模型）将 DOM 节点映射为 "Blot"。每个 Blot 对应一种内容类型：

```
Parchment 文档树
├── Block Blot (段落)
│   ├── Inline Blot (加粗、斜体)
│   └── Embed Blot (图片、视频、分隔线)
└── BlockEmbed Blot (块级嵌入)
```

自定义视频嵌入需要创建一个继承 `BlockEmbed` 的新 Blot。

### Html5VideoBlot 实现

```typescript
// apps/admin-blog/src/components/blog/Html5VideoBlot.ts
export function registerHtml5VideoBlot(Quill: any): void {
  // 检查该 Quill 实例是否已注册
  try {
    if (Quill?.imports?.['formats/html5-video']) return
  } catch (_) {}

  const BlockEmbed = Quill.import('blots/block/embed')

  class Html5VideoBlot extends BlockEmbed {
    static blotName = 'html5-video'
    static tagName = 'video'
    static className = 'ql-video'

    static create(url: string) {
      const node: HTMLVideoElement = super.create()
      node.controls = true
      node.preload = 'metadata'
      node.playsInline = true
      node.setAttribute('src', url)

      // 添加 Tailwind 样式
      const existing = node.getAttribute('class') || ''
      node.setAttribute('class', `${existing} w-full rounded-lg my-4`.trim())

      // 添加 <source> 子元素（含 MIME 类型推断）
      const source = document.createElement('source')
      source.setAttribute('src', url)
      // 从 URL 推断 MIME: .mp4 → video/mp4, .webm → video/webm
      // ...
      node.appendChild(source)

      return node
    }

    static value(node: HTMLElement) {
      return node.getAttribute('src')
        || node.querySelector('source')?.getAttribute('src')
        || ''
    }
  }

  Quill.register('formats/html5-video', Html5VideoBlot, true)
}
```

### Next.js Chunk Isolation 问题

Next.js 的动态导入（`import('react-quill-new')`）会创建独立的 Webpack chunk。这意味着页面上可能存在多个 Quill 类实例，每个实例都需要单独注册 Blot：

```
Chunk A (主包)          Chunk B (react-quill-new)
─────────────          ──────────────────────
Quill.register()  →    Quill 类实例 A
                       （Html5VideoBlot 已注册）

                       Quill 类实例 B
                       （Html5VideoBlot 未注册 → 视频插入失败）
```

解决方案是在 **动态导入完成时** 和 **每次插入视频前** 都尝试注册：

```typescript
// 加载时注册
import('react-quill-new').then((mod) => {
  registerHtml5VideoBlot(mod.default.Quill) // 注册到实例 A
})

// 插入前二次确认
const QuillCtor = quill.constructor as any
if (!QuillCtor?.imports?.['formats/html5-video']) {
  registerHtml5VideoBlot(QuillCtor) // 注册到实例 B
}
```

### Fallback 机制

在某些情况下（如无头浏览器测试、SSR 调试），`insertEmbed` 可能静默失败。组件实现了双重 fallback：

```typescript
quill.insertEmbed(insertIndex, 'html5-video', url, 'user')

setTimeout(() => {
  const afterHtml = quill.root.innerHTML
  if (afterHtml === beforeHtml) {
    // insertEmbed 没有改变内容 → 回退到 dangerouslyPasteHTML
    const videoHtml = `<video controls src="${url}"></video>`
    quill.clipboard.dangerouslyPasteHTML(insertIndex, videoHtml)
  }
  onChangeAction(quill.root.innerHTML)
}, 0)
```

## 五、Markdown 导入

### 双栏预览模式

```typescript
// apps/admin-blog/src/components/blog/MarkdownImportModal.tsx
const marked = new Marked({ gfm: true, breaks: true, silent: true })

const handleMarkdownChange = (e) => {
  const value = e.target.value
  setMarkdown(value)

  try {
    if (value.trim()) {
      const html = marked.parse(value) as string
      setPreviewHtml(html)
    }
  } catch (err) {
    setError('Markdown 解析失败')
  }
}
```

UI 布局为左右双栏：
- 左侧：Markdown 源码编辑区（`<textarea>`，等宽字体）
- 右侧：HTML 实时预览（`dangerouslySetInnerHTML` + Tailwind prose）

### 浏览器语言检测

```typescript
const isZh = typeof navigator !== 'undefined'
  && navigator.language.startsWith('zh')
```

模态框的文案（标题、按钮、placeholder）根据浏览器语言自动切换中文/英文，无需依赖完整的 i18n 系统。

### 导入到编辑器

```typescript
const handleImportMarkdown = (html: string) => {
  const quill = quillRef.current?.getEditor()
  if (quill) {
    quill.clipboard.dangerouslyPasteHTML(html)
    const content = quill.root.innerHTML
    onChangeAction(content) // 手动触发更新
  }
}
```

## 六、组件架构总结

```
RichTextEditor (540 行)
├── 懒加载层
│   ├── useState<ReactQuill | null>
│   ├── useEffect → import('react-quill-new')
│   └── 骨架屏占位 (340px animate-pulse)
├── HTML5 视频支持
│   ├── Html5VideoBlot (BlockEmbed 继承)
│   ├── 动态 Blot 注册 (处理 Chunk Isolation)
│   └── dangerouslyPasteHTML fallback
├── 图片上传
│   ├── 自定义 handler (file input → API → embed)
│   ├── Range 边界保护
│   └── 上传进度指示器
├── Markdown 导入
│   └── MarkdownImportModal (双栏预览模式)
├── 事件防护
│   ├── source !== 'user' 过滤
│   └── realHtml !== value 对比
└── 初始化同步
    ├── hasInitialized ref
    └── requestAnimationFrame 重试
```

## 总结

这个 RichTextEditor 组件展示了几个重要的工程实践：

1. **SSR 兼容**：动态导入 + 骨架屏，适合 Next.js 等 SSR 框架
2. **框架适配**：通过自定义 Blot 扩展 Quill 能力，而非替换编辑器
3. **防御性编程**：Range 边界保护、多重注册检查、insertEmbed fallback
4. **事件安全**：两层防护杜绝无限循环

对于需要富文本编辑器的 Next.js 项目，这是一个可以参考的完整实现模式。
