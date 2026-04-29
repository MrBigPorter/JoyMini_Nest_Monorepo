# Plan: CSDN-Style Article Rendering with Syntax Highlighting

## Problem

Frontend blog and admin preview article rendering looks poor. Code blocks lack syntax highlighting. Previous dangerouslySetInnerHTML approach didn't improve visual quality.

## Solution

Use `react-markdown` + `react-syntax-highlighter` to render articles with syntax-highlighted code blocks, just like CSDN. Content auto-detection: markdown → ReactMarkdown + syntax highlighting; HTML → dangerouslySetInnerHTML fallback.

## Packages Status

| Package | frontend-blog | admin-blog |
|---------|--------------|------------|
| `react-markdown` | ✅ 已安装 `^10.0.0` | ✅ 已安装 `^10.1.0` |
| `react-syntax-highlighter` | ✅ 已安装 `^15.5.0` | ❌ 需要安装 |
| `remark-gfm` | ✅ 已安装 `^4.0.1` | ✅ 已安装 `^4.0.1` |
| `rehype-raw` | ✅ 已安装 `^7.0.0` | ❌ 需要安装 |

## Todo List

### Step 1: 安装 admin-blog 依赖

```bash
yarn workspace @lucky/admin-blog add react-syntax-highlighter rehype-raw
yarn workspace @lucky/admin-blog add -D @types/react-syntax-highlighter
```

### Step 2: 修改 frontend-blog ArticleMarkdown.tsx

**文件**: [`apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx)

完整重写，核心逻辑：

```typescript
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// 按需注册语言（减小打包体积）
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
// ... etc

SyntaxHighlighter.registerLanguage('tsx', tsx);
// ... etc

// 自动检测：如果是 HTML → dangerouslySetInnerHTML
// 如果是 markdown → ReactMarkdown + SyntaxHighlighter
const isHtml = /<[a-z][\s\S]*>/i.test(content);

if (isHtml) {
  return <article ... dangerouslySetInnerHTML={{ __html: content }} />;
}

return (
  <article className="prose ...">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        code({ node, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          if (match) {
            return <SyntaxHighlighter style={oneDark} language={match[1]} ...>{children}</SyntaxHighlighter>;
          }
          return <code className={className}>{children}</code>;
        }
      }}
    >
      {content}
    </ReactMarkdown>
  </article>
);
```

### Step 3: 修改 frontend-blog page.client.tsx

**文件**: [`apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx:172)

```diff
- <ArticleMarkdown content={article.content || ''} />
+ <ArticleMarkdown content={article.contentMd || article.content || ''} />
```

### Step 4: 修改 admin-blog 预览页 page.tsx

**文件**: [`apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/[slug]/page.tsx:287)

当前：`dangerouslySetInnerHTML={{ __html: localizedContent }}`

改成：导入并使用类似 ArticleMarkdown 的组件，支持 markdown + 语法高亮和 HTML 自动检测。

或者直接在页面内嵌入同样的逻辑（不抽取公共组件）。

### Step 5: 运行类型检查

```bash
yarn workspace @lucky/frontend-blog type-check
yarn workspace @lucky/admin-blog type-check
```

## 数据兼容性

| 内容来源 | contentMd | content | 走哪条路 |
|----------|-----------|---------|---------|
| 导入的 markdown | ✅ 原始 markdown | HTML | ReactMarkdown + 语法高亮 |
| Quill 编辑器创建 | ❌ 空 | HTML (带 quill 类) | dangerouslySetInnerHTML |

## 体积控制

使用 `PrismLight` + 按需注册语言，只注册博客文章常用的：
- `tsx`, `typescript`, `javascript`, `jsx`
- `bash`, `json`, `yaml`, `css`, `scss`
- `sql`, `markdown`, `python`, `go`

打包体积增加约 **10KB gzipped**，仅在文章详情页加载。
