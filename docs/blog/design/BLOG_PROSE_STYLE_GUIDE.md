# Blog 文章排版规范 v1.0.0

> ✅ 文章正文阅读体验规范

---

## 1. 正文排版规范

### 1.1 基础参数

| 属性     | 值     |
| -------- | ------ |
| 最大宽度 | 720px  |
| 字号     | 16px   |
| 行高     | 1.7    |
| 字重     | 400    |
| 段落间距 | 1.5rem |
| 行间距   | 1.7    |
| 段首缩进 | 0      |

### 1.2 标题层级

| 标题 | 字号            | 行高 | 字重 | 上下间距               |
| ---- | --------------- | ---- | ---- | ---------------------- |
| H1   | 2.25rem / 36px  | 1.2  | 700  | 上 2rem / 下 1.5rem    |
| H2   | 1.875rem / 30px | 1.3  | 600  | 上 2rem / 下 1rem      |
| H3   | 1.5rem / 24px   | 1.4  | 600  | 上 1.5rem / 下 1rem    |
| H4   | 1.25rem / 20px  | 1.4  | 600  | 上 1.5rem / 下 0.75rem |
| H5   | 1.125rem / 18px | 1.5  | 600  | 上 1rem / 下 0.5rem    |
| H6   | 1rem / 16px     | 1.5  | 600  | 上 1rem / 下 0.5rem    |

---

## 2. 元素样式规范

### 2.1 段落

```css
p {
  margin-bottom: 1.5rem;
  line-height: 1.7;
  text-align: justify;
}
```

### 2.2 列表

#### 无序列表

```css
ul {
  margin: 1rem 0;
  padding-left: 1.5rem;
  list-style-type: disc;
}

li {
  margin: 0.5rem 0;
  line-height: 1.6;
}
```

#### 有序列表

```css
ol {
  margin: 1rem 0;
  padding-left: 1.5rem;
  list-style-type: decimal;
}
```

### 2.3 引用块

```css
blockquote {
  margin: 1.5rem 0;
  padding: 1rem 1.5rem;
  border-left: 4px solid #3b82f6;
  background-color: #f8fafc;
  font-style: italic;
  border-radius: 0 0.5rem 0.5rem 0;
}
```

### 2.4 代码块

```css
pre {
  margin: 1.5rem 0;
  padding: 1rem;
  border-radius: 0.5rem;
  background-color: #1e293b;
  overflow-x: auto;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.875rem;
  line-height: 1.5;
}

code {
  font-family: "JetBrains Mono", monospace;
  background-color: #f1f5f9;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
}
```

### 2.5 图片

```css
img {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
  margin: 1.5rem 0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}
```

---

**文档版本**: 1.0.0  
**最后更新**: 2026-04-06
