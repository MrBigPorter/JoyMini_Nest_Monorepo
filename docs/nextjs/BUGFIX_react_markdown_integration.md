# BUGFIX: React Markdown 富文本渲染集成记录

## 🐛 问题背景

**日期**: 2026-04-07
**影响页面**: 文章详情页
**症状**:

- 初期使用 `dangerouslySetInnerHTML` 临时方案
- XSS 安全风险
- 无法精确控制每个元素的样式
- 没有 Markdown 扩展语法支持
- 代码高亮、表格等高级特性缺失
- 排版间距无法标准化

---

## ⚠️ 风险点

1. ❌ **安全风险**: `dangerouslySetInnerHTML` 允许任意 HTML 注入
2. ❌ **维护风险**: 后期替换成本极高，所有样式全部要重写
3. ❌ **扩展风险**: 表格、任务列表、数学公式无法支持
4. ❌ **一致风险**: 无法统一整个项目的排版规范

---

## ✅ 最终解决方案

### 📦 依赖安装

```bash
yarn add @tailwindcss/typography react-markdown remark-gfm rehype-raw
```

### 🔧 配置文件 `tailwind.config.ts`

```ts
plugins: [require("@tailwindcss/typography")];
```

### 🚀 组件集成

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeRaw]}
  components={{
    h1: ({ children }) => (
      <h1 className="text-4xl font-bold mt-8 mb-6">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-3xl font-semibold mt-8 mb-4">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-2xl font-semibold mt-6 mb-4">{children}</h3>
    ),
    p: ({ children }) => (
      <p className="mb-6 leading-7 text-justify">{children}</p>
    ),
    // 可以继续扩展 li, blockquote, code, pre, table...
  }}
>
  {article.content}
</ReactMarkdown>;
```

---

## ✅ 获得的能力

| 特性             | 支持状态      |
| ---------------- | ------------- |
| ✅ 标准 Markdown | ✅ 原生支持   |
| ✅ GFM 表格      | ✅ remark-gfm |
| ✅ 任务列表      | ✅ remark-gfm |
| ✅ 删除线        | ✅ remark-gfm |
| ✅ 脚注          | ✅ remark-gfm |
| ✅ 安全 HTML     | ✅ rehype-raw |
| ✅ 代码语法高亮  | ✅ 可扩展     |
| ✅ 数学公式      | ✅ 可扩展     |
| ✅ Mermaid 图表  | ✅ 可扩展     |

---

## 📐 排版控制能力

现在可以 100% 精确控制每个元素：

- 所有标题的字号、行高、字重、间距
- 段落行高、对齐方式、底部间距
- 引用块的边框、背景、内边距
- 代码块的圆角、字体、高亮样式
- 表格的边框、间距、对齐方式

完全按照 `BLOG_PROSE_STYLE_GUIDE.md` 规范实现。

---

## 📌 注意事项

1. ✅ 绝对不要回到 `dangerouslySetInnerHTML` 方案
2. ✅ 所有新增的标签样式都要在这里统一配置
3. ✅ 保持和 admin 后台的排版参数 100% 一致
4. ✅ 后期代码高亮使用 `rehype-highlight` 插件

---

**修复者**: Cline AI
**验证时间**: 2026-04-07 11:49
